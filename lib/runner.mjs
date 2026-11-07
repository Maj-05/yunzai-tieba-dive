/**
 * lib/runner.mjs —— 一轮任务（读帖 → [学习] → [回帖] → 日报）
 *
 * 从 dsh-tieba-dive 的 prompts/duty.md + runner.mjs 移植：
 * DSH 版是把「一轮的执行说明」交给模型 agent 跑；云崽没有常驻 agent，
 * 所以改成**确定性流程**：抓取/筛选在代码里做死，只把「总结/写回帖」交给 LLM。
 * 这样没有 LLM 也能跑（采集/签到/日报原文照常，生成类降级跳过）。
 */
import { listBar, readThread, hotReplies, followAndSign, replyFloor, whoami } from './tieba.js'
import { readConfig } from './config.mjs'
import { markRead, wasRead, wasReplied, markReplied, isSigned, markSigned, bumpRounds } from './state.mjs'
import { addSample, pickRefs } from './stylelib.mjs'
import { genReply, genDailyReport, llmAvailable } from './llm.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from './tieba.js'

const logFile = () => path.join(homeDir(), 'logs', `run-${new Date().toISOString().slice(0, 10)}.log`)

function log(line) {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true })
    fs.appendFileSync(logFile(), `[${new Date().toISOString()}] ${line}\n`)
  } catch { /* 日志失败不影响任务 */ }
}

/**
 * 跑一轮。返回摘要对象（不抛错，所有失败都进 results）。
 * @param {{ bars?: string[], doSign?: boolean, doReply?: boolean, doLearn?: boolean }} opts
 */
export async function runRound(opts = {}) {
  const c = readConfig()
  const bars = (opts.bars?.length ? opts.bars : c.bars).filter(Boolean)
  const results = []
  const doReply = (opts.doReply ?? c.autoReply)
  const doLearn = (opts.doLearn ?? c.evolvePersona)

  if (!bars.length) {
    return { ok: false, summary: '还没配置要刷的吧。先用 #贴吧设置 bars 填吧名（一行一个）。', results }
  }
  try { await whoami() } catch (e) {
    return { ok: false, summary: `登录态不可用：${e.message}`, results }
  }

  for (const kw of bars) {
    const r = { kw, threads: [], learned: 0, replied: [], signed: false, error: '' }
    try {
      // 1) 列帖
      const list = await listBar(kw)
      if (!list.threads?.length) { r.error = '没读到帖子（吧名对吗？或被风控）'; results.push(r); continue }
      // 关键词置顶 + 已读沉底
      const kws = c.keywords
      const sorted = [...list.threads].sort((a, b) => {
        const ka = kws.some((k) => a.title.includes(k)) ? 1 : 0
        const kb = kws.some((k) => b.title.includes(k)) ? 1 : 0
        return kb - ka
      })
      const unread = sorted.filter((t) => !wasRead(t.id))
      const picked = (unread.length >= c.readPerRound ? unread : [...unread, ...sorted.filter((t) => wasRead(t.id))])
        .slice(0, c.readPerRound)
      r.threads = sorted.map((t) => ({ ...t, read: wasRead(t.id) }))

      // 2) 逐帖阅读（顺带学习/回帖）
      for (const t of picked) {
        try {
          const th = await readThread(t.id)
          markRead(t.id, c.dedupeDays)
          const floors = th.floors || []

          // 2a) 学习：拉真实高赞回帖入库
          if (doLearn) {
            try {
              const hot = await hotReplies(t.id, { rn: 30 })
              for (const h of hot.slice(0, 10)) {
                if (addSample(kw, h.text, h.likes, c.styleMaxPerBar)) r.learned++
              }
            } catch (e) { log(`[${kw}] 学习失败 tid=${t.id}: ${e.message}`) }
          }

          // 2b) 回帖：四道闸 —— 总开关 / 当日上限 / 同帖一天一次 / 最小间隔
          if (doReply && !wasReplied(t.id) && floors.length) {
            const s = readCfgDay()
            const lastAt = Math.max(0, ...Object.values(s.repliedMap || {}).map((v) => v?.at || 0))
            const gapOk = Date.now() - lastAt >= c.replyGapSec * 1000
            if (s.repliesToday < c.replyPerDay && gapOk) {
              const refs = pickRefs(kw, t.title, 3)
              const g = await genReply({ kw, title: t.title, floors, refs })
              if (g.ok) {
                const content = c.mention ? `${g.text}\n@${c.mention} ` : g.text
                const rr = await replyFloor({ kw, tid: t.id, content })
                if (rr.ok) {
                  markReplied(t.id, g.text)
                  r.replied.push({ tid: t.id, title: t.title, text: g.text })
                  log(`[${kw}] 已回帖 tid=${t.id}: ${g.text.slice(0, 50)}`)
                } else {
                  log(`[${kw}] 回帖失败 tid=${t.id}: ${rr.error || rr.raw || '未知'}`)
                }
              } else {
                log(`[${kw}] 生成放弃 tid=${t.id}: ${g.reason}`)
              }
            }
          }
        } catch (e) { log(`[${kw}] 读帖失败 tid=${t.id}: ${e.message}`) }
      }

      // 3) 签到
      if ((opts.doSign ?? c.autoSign) && !isSigned(kw)) {
        try {
          const sr = await followAndSign(kw, { autoFollow: c.autoFollow })
          if (sr.ok) { markSigned(kw); r.signed = true }
          else r.signError = sr.msg || sr.error || '签到失败'
        } catch (e) { r.signError = e.message }
      }
    } catch (e) {
      r.error = e.message
      log(`[${kw}] 一轮失败: ${e.message}`)
    }
    results.push(r)
  }

  bumpRounds()
  const totalRead = results.reduce((a, b) => a + (b.threads?.length || 0), 0)
  const totalReply = results.reduce((a, b) => a + (b.replied?.length || 0), 0)
  const totalLearn = results.reduce((a, b) => a + (b.learned || 0), 0)
  const signedList = results.filter((x) => x.signed).map((x) => x.kw)
  let summary = `本轮：读了 ${totalRead} 帖，学习 ${totalLearn} 条，回帖 ${totalReply} 条` +
    (signedList.length ? `，已签 ${signedList.join('、')}` : '')
  if (!llmAvailable()) summary += '（LLM 未配置：总结/回帖生成已跳过）'
  return { ok: true, summary, results }
}

function readCfgDay() {
  // state 是 ESM，同步拿不到 require —— 这里直接读 state.json 的当日计数
  try {
    const j = JSON.parse(fs.readFileSync(path.join(homeDir(), 'state.json'), 'utf8'))
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    return j.day === today ? j : { repliesToday: 0 }
  } catch { return { repliesToday: 0 } }
}

/** 生成当天日报（有 LLM 出总结，没有就出原始列表） */
export async function dailyReport(kw) {
  const c = readConfig()
  try {
    const list = await listBar(kw)
    const threads = (list.threads || []).slice(0, 25)
    if (!threads.length) return `「${kw}」今天没读到帖子。`
    const md = await genDailyReport({ kw, threads })
    const head = `📋 贴吧日报 · ${kw} · ${new Date().toLocaleDateString('zh-CN')}\n`
    if (md) return head + md
    // 无 LLM：原始列表兜底
    return head + threads.slice(0, 10).map((t) => `- ${t.title}（${t.reply || 0} 回复）`).join('\n')
  } catch (e) {
    return `日报生成失败：${e.message}`
  }
}
