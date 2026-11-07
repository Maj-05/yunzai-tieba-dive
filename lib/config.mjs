/**
 * lib/config.mjs —— 云崽版配置
 *
 * 移植自 dsh-tieba-dive 的 lib/config.mjs，改动点：
 * 1. 数据目录跟随 lib/tieba.js 的 homeDir()（插件内 data/，或 YUNZAI_TIEBA_HOME）
 * 2. 去掉 DSH 专属字段（headlessProfile / dshBin / 宿主注入），换成云崽的：
 *    - notifyMaster：跑完一轮要不要私聊主人汇报
 *    - replyPerDay 默认调低（云崽场景一般挂小号，先保守）
 * 3. LLM 配置从云崽 cfg 读取（见 lib/llm.mjs），这里不存 key
 */
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from './tieba.js'

export const configFile = () => path.join(homeDir(), 'config.json')

export const DEFAULTS = {
  // —— 账号与刷帖 ——
  bars: [],               // 要刷的吧，一行一个（命令 #贴吧设置 bars 时按行拆）
  keywords: [],           // 标题关键词，命中排前（不过滤）
  readPerRound: 5,        // 每轮读几个帖子
  requestGapMs: 1200,     // 两次请求最小间隔（下限 300）
  dedupeDays: 7,          // 已读帖子 N 天内不再推

  // —— 签到 ——
  autoSign: false,        // 每天 signHour 点自动签一轮
  autoFollow: true,       // 没关注的吧先关注再签
  signAllFollowed: false, // 签到覆盖账号关注的所有吧
  signHour: 9,

  // —— 回帖（默认关）——
  autoReply: false,
  replyPerRound: 1,
  replyPerDay: 3,         // 云崽默认比 DSH 版（5）保守
  replyGapSec: 60,
  answerQuestions: true,
  toneGate: true,         // 拦客服腔
  mention: '',            // 回帖时 @ 的昵称（空不 @）

  // —— 楼中楼（默认关）——
  allowSubReply: false,
  subReplyPerRound: 1,
  subReplyPerDay: 3,

  // —— 学习与风格库 ——
  evolvePersona: false,   // 读帖时把高赞回复收进风格库
  learnHotOnly: true,
  styleMaxPerBar: 40,     // 每吧最多存多少条

  // —— 人设 ——
  personaText: '',        // 云崽侧的人设文本（拼 prompt 用）
  styleSamples: '',       // 3~5 句「她平时怎么说话」

  // —— 定时（云崽 task）——
  autoRun: false,         // 每天自动跑一轮（由云崽 task 驱动）
  runHour: 21,            // 几点跑
  peakValley: false,      // 峰谷模式：只在午谷/晚谷跑
  noon: true,
  night: true,

  // —— 云崽专属 ——
  notifyMaster: false,    // 一轮结束后私聊主人发日报摘要
  notifyGroupId: 0,       // >0 时日报发这个群
  breakerEnabled: true,
  breakerMin: 30,

  // —— 日记（云崽场景简化：只留公开日记）——
  diaryEnabled: true,
}

const clampInt = (v, lo, hi, dflt) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

export function normalize(raw = {}) {
  const bars = Array.isArray(raw.bars)
    ? raw.bars.map((s) => String(s).trim()).filter(Boolean)
    : String(raw.bars || '').split(/[\n,，]/).map((s) => s.trim()).filter(Boolean)
  return {
    bars: bars.slice(0, 20),
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.map(String).filter(Boolean).slice(0, 50)
      : String(raw.keywords || '').split(/[\n,，]/).map(String).filter(Boolean).slice(0, 50),
    readPerRound: clampInt(raw.readPerRound, 1, 20, DEFAULTS.readPerRound),
    requestGapMs: clampInt(raw.requestGapMs, 300, 5000, DEFAULTS.requestGapMs),
    dedupeDays: clampInt(raw.dedupeDays, 1, 60, DEFAULTS.dedupeDays),

    autoSign: raw.autoSign === true,
    autoFollow: raw.autoFollow !== false,
    signAllFollowed: raw.signAllFollowed === true,
    signHour: clampInt(raw.signHour, 0, 23, DEFAULTS.signHour),

    autoReply: raw.autoReply === true,
    replyPerRound: clampInt(raw.replyPerRound, 0, 10, DEFAULTS.replyPerRound),
    replyPerDay: clampInt(raw.replyPerDay, 0, 30, DEFAULTS.replyPerDay),
    replyGapSec: clampInt(raw.replyGapSec, 10, 3600, DEFAULTS.replyGapSec),
    answerQuestions: raw.answerQuestions !== false,
    toneGate: raw.toneGate !== false,
    mention: String(raw.mention || '').slice(0, 40),

    allowSubReply: raw.allowSubReply === true,
    subReplyPerRound: clampInt(raw.subReplyPerRound, 1, 3, DEFAULTS.subReplyPerRound),
    subReplyPerDay: clampInt(raw.subReplyPerDay, 1, 10, DEFAULTS.subReplyPerDay),

    evolvePersona: raw.evolvePersona === true,
    learnHotOnly: raw.learnHotOnly !== false,
    styleMaxPerBar: clampInt(raw.styleMaxPerBar, 5, 100, DEFAULTS.styleMaxPerBar),

    personaText: String(raw.personaText || '').slice(0, 20000),
    styleSamples: String(raw.styleSamples || '').slice(0, 4000),

    autoRun: raw.autoRun === true,
    runHour: clampInt(raw.runHour, 0, 23, DEFAULTS.runHour),
    peakValley: raw.peakValley === true,
    noon: raw.noon !== false,
    night: raw.night !== false,

    notifyMaster: raw.notifyMaster === true,
    notifyGroupId: clampInt(raw.notifyGroupId, 0, 999999999, DEFAULTS.notifyGroupId),
    breakerEnabled: raw.breakerEnabled !== false,
    breakerMin: clampInt(raw.breakerMin, 1, 720, DEFAULTS.breakerMin),

    diaryEnabled: raw.diaryEnabled !== false,
  }
}

export function readConfig(override = {}) {
  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(configFile(), 'utf8')) } catch { /* 还没有配置文件 */ }
  return normalize({ ...DEFAULTS, ...override, ...saved })
}

export function writeConfig(patch = {}) {
  const next = normalize({ ...readConfig(), ...patch })
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 1) + '\n', { mode: 0o600 })
  try { fs.chmodSync(configFile(), 0o600) } catch { /* Windows 上没有 */ }
  return next
}
