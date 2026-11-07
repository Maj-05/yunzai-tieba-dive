/**
 * lib/llm.mjs —— 云崽侧的 LLM 调用（读帖总结 / 生成回帖）
 *
 * 优先级：
 * 1. 云崽配置里的 AI（cfg.bot 字段：key / platform / model）—— 大多数人装了
 *    chess/miao-plugin 的 AI 能力后这里就有值
 * 2. 环境变量 TIEBA_LLM_URL / TIEBA_LLM_KEY / TIEBA_LLM_MODEL（OpenAI 兼容接口）
 *
 * 都没有 → 返回 null，调用方降级成「只采集不生成」（读帖/签到不受影响）。
 *
 * ⚠️ 回帖默认关；开了也要过 toneGate 和限额（见 runner）。
 */
import fetch from 'node-fetch'
import cfg from '../../../lib/config/config.js'
import { readConfig } from './config.mjs'

function endpoint() {
  // 1) 云崽全局 AI 配置（miao/chess 风格：bot.AI.key 等）
  try {
    const key = cfg?.bot?.AI?.key || cfg?.AI?.key
    const platform = cfg?.bot?.AI?.platform || cfg?.AI?.platform
    if (key && platform) {
      return {
        url: String(platform).replace(/\/$/, '') + '/chat/completions',
        key,
        model: cfg?.bot?.AI?.model || cfg?.AI?.model || 'gpt-4o-mini',
      }
    }
  } catch { /* cfg 还没就绪 */ }
  // 2) 环境变量兜底
  if (process.env.TIEBA_LLM_URL && process.env.TIEBA_LLM_KEY) {
    return {
      url: process.env.TIEBA_LLM_URL.replace(/\/$/, '') + '/chat/completions',
      key: process.env.TIEBA_LLM_KEY,
      model: process.env.TIEBA_LLM_MODEL || 'gpt-4o-mini',
    }
  }
  return null
}

export const llmAvailable = () => Boolean(endpoint())

/** 单轮对话。system 设定 + user 内容，返回文本；失败返回 null */
export async function chat(system, user, { maxTokens = 900, temperature = 0.8 } = {}) {
  const ep = endpoint()
  if (!ep) return null
  try {
    const r = await fetch(ep.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ep.key}`,
      },
      body: JSON.stringify({
        model: ep.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
      timeout: 60_000,
    })
    if (!r.ok) return null
    const j = await r.json()
    const text = j?.choices?.[0]?.message?.content
    return typeof text === 'string' && text.trim() ? text.trim() : null
  } catch {
    return null
  }
}

// ── 内容生成 ────────────────────────────────────────────────────────────────

/** 客服腔拦截（与 DSH 版 toneGate 同词表思路） */
const TONE_GATE = [
  /首先/, /其次/, /总之/, /综上/, /希望对你有帮助/, /希望这能帮到你/,
  /作为一个AI/, /作为人工智能/, /我很抱歉/, /对不起[,，].*(帮|无法)/,
  /值得注意的是/, /需要指出的是/,
]
export const toneGateBlocked = (text) => TONE_GATE.some((re) => re.test(String(text || '')))

function personaBlock() {
  const c = readConfig()
  const parts = []
  if (c.personaText) parts.push(`【人设】\n${c.personaText}`)
  if (c.styleSamples) parts.push(`【平时怎么说话】\n${c.styleSamples}`)
  return parts.join('\n\n')
}

/**
 * 生成一条回帖。返回 { ok, text, blocked, reason }
 * blocked=true 表示 toneGate 拦截（调用方可选择重试或放弃）
 */
export async function genReply({ kw, title, floors, refs = [] }) {
  const c = readConfig()
  const sys = [
    '你是百度贴吧的一个普通吧友，在回帖。',
    '要求：',
    `- 口气自然，像真人随手回的，4~80 个字`,
    `- 不要客服腔（首先/其次/总之/希望对你有帮助 这类词一律不许出现）`,
    `- 不用 emoji 堆砌，最多一个`,
    `- 不提「AI」「模型」「生成」`,
    '- 不带链接、不带路径、不带任何凭证字样',
    '- 只学参考回复的口气，不照抄原句',
    personaBlock(),
    refs.length ? `【这个吧的人平时怎么回帖（仅参考口气）】\n${refs.map((r, i) => `${i + 1}. ${r.text}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')
  const user = [
    `吧：${kw}`,
    `帖子标题：${title}`,
    '楼主/楼层内容：',
    ...floors.slice(0, 8).map((f, i) => `${i + 1}. ${String(f).slice(0, 160)}`),
    '',
    '写一条回帖。只输出回帖正文本身，不要任何前后缀。',
  ].join('\n')
  let text = await chat(sys, user, { maxTokens: 160, temperature: 0.9 })
  if (!text) return { ok: false, reason: 'LLM 不可用或调用失败' }
  text = text.replace(/^["'「『]|["'」』]$/g, '').trim()
  if (c.toneGate && toneGateBlocked(text)) {
    return { ok: false, blocked: true, text, reason: '触发客服腔拦截' }
  }
  if (text.length < 4 || text.length > 400) return { ok: false, reason: `长度不合规（${text.length}）` }
  if (/t\.cn|http|BDUSS|token|C:\\|\/root/.test(text)) return { ok: false, reason: '含链接/敏感字样' }
  return { ok: true, text }
}

/** 生成一轮日报 */
export async function genDailyReport({ kw, threads }) {
  const sys = [
    '你在帮主人整理「百度贴吧-XX吧」今天在聊什么。',
    '输出 markdown，含：一段 3 行内的总述；「值得点开」列表（3~5 条，标题+一句话理由+回复数）。',
    '语气平实，不要客服腔，不要夸张标题党。',
    personaBlock(),
  ].filter(Boolean).join('\n')
  const user = [
    `吧：${kw}`,
    '今天的帖子（标题 | 回复数 | 是否已读）：',
    ...threads.slice(0, 25).map((t) => `- ${t.title} | ${t.reply || 0} | ${t.read ? '已读' : '未读'}`),
  ].join('\n')
  return chat(sys, user, { maxTokens: 700, temperature: 0.5 })
}
