/**
 * lib/state.mjs —— 当日计数 / 已读去重 / 签到记录 / 回帖留痕
 *
 * 移植自 dsh-tieba-dive 的状态思路，简化成云崽够用的一套：
 * 全部落在一个 state.json，按天滚动。
 */
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from './tieba.js'

const stateFile = () => path.join(homeDir(), 'state.json')

function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function readState() {
  let s = {}
  try { s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) } catch { /* 新状态 */ }
  // 跨天：计数清零，已读保留（由 dedupeDays 控制清理）
  if (s.day !== today()) {
    s = {
      day: today(),
      // 当日计数
      repliesToday: 0,
      subRepliesToday: 0,
      signed: {},            // kw -> true
      roundsToday: 0,
      // 已读：tid -> 时间戳
      readMap: s.readMap || {},
      // 回帖留痕：tid -> { at, content }（同一帖一天只回一次）
      repliedMap: s.repliedMap || {},
    }
  }
  return s
}

export function writeState(s) {
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 1) + '\n', { mode: 0o600 })
  try { fs.chmodSync(stateFile(), 0o600) } catch { /* Windows */ }
  return s
}

/** 记一次已读，并清理超过 dedupeDays 的旧记录 */
export function markRead(tid, dedupeDays = 7) {
  const s = readState()
  s.readMap[String(tid)] = Date.now()
  const cutoff = Date.now() - dedupeDays * 86400_000
  for (const [k, at] of Object.entries(s.readMap)) {
    if (at < cutoff) delete s.readMap[k]
  }
  writeState(s)
}

export const wasRead = (tid) => {
  const s = readState()
  return Boolean(s.readMap[String(tid)])
}

/** 回帖留痕 + 当日计数 */
export function markReplied(tid, content, kind = 'reply') {
  const s = readState()
  s.repliedMap[String(tid)] = { at: Date.now(), content: String(content || '').slice(0, 120), kind }
  if (kind === 'sub') s.subRepliesToday = (s.subRepliesToday || 0) + 1
  else s.repliesToday = (s.repliesToday || 0) + 1
  // 留痕只保最近 3 天
  const cutoff = Date.now() - 3 * 86400_000
  for (const [k, v] of Object.entries(s.repliedMap)) {
    if (!v || v.at < cutoff) delete s.repliedMap[k]
  }
  writeState(s)
}

export const wasReplied = (tid) => {
  const s = readState()
  return Boolean(s.repliedMap[String(tid)])
}

export function markSigned(kw) {
  const s = readState()
  s.signed = s.signed || {}
  s.signed[String(kw)] = true
  writeState(s)
}

export const isSigned = (kw) => Boolean(readState().signed?.[String(kw)])

export function bumpRounds() {
  const s = readState()
  s.roundsToday = (s.roundsToday || 0) + 1
  writeState(s)
  return s.roundsToday
}
