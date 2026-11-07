/**
 * lib/stylelib.mjs —— 风格库（学习）
 *
 * 移植自 dsh-tieba-dive 的思路：
 * 读帖时把真实高赞回复入库（每吧 ≤ N 条），回帖前按话题关键词检索 2~4 条当参考。
 * 只学口气、不照抄 —— 这句话也要拼进 prompt 里。
 *
 * 文件：data/tieba-duty/style.json
 * 结构：{ kw: { updatedAt, samples: [{ text, likes, at }] } }
 */
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from './tieba.js'

const file = () => path.join(homeDir(), 'style.json')

function readAll() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')) } catch { return {} }
}

function writeAll(db) {
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(db, null, 1) + '\n', { mode: 0o600 })
  try { fs.chmodSync(file(), 0o600) } catch { /* Windows */ }
}

const REJECT = [
  /t\.cn|http/,                 // 带链接的
  /^[0-9\s,.]+$/,               // 纯数字/标点
  /签到|打卡|顶一|帮顶|沙发|前排|火钳|留名/, // 水楼
  /加微信|加Q|私聊|代练|出售|收购|广告/,   // 广告
]
const same = (a, b) => a.text === b.text

/** 收一条高赞回复入库（去重、过滤、限额） */
export function addSample(kw, text, likes = 0, maxPerBar = 40) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (t.length < 4 || t.length > 200) return false
  if (REJECT.some((re) => re.test(t))) return false
  const db = readAll()
  const bar = db[kw] || { updatedAt: 0, samples: [] }
  if (bar.samples.some((s) => same(s, { text: t }))) return false
  bar.samples.push({ text: t, likes: Number(likes) || 0, at: Date.now() })
  bar.samples.sort((a, b) => (b.likes - a.likes) || (b.at - a.at))
  bar.samples = bar.samples.slice(0, maxPerBar)
  bar.updatedAt = Date.now()
  db[kw] = bar
  writeAll(db)
  return true
}

/** 按话题检索：命中关键词的排前，其余按赞数补足 */
export function pickRefs(kw, topic = '', n = 3) {
  const db = readAll()
  const bar = db[kw]
  if (!bar || !bar.samples?.length) return []
  const words = String(topic || '').replace(/[^\p{Script=Han}a-zA-Z0-9]+/gu, ' ')
    .split(/\s+/).filter((w) => w.length >= 2)
  const scored = bar.samples.map((s) => {
    let score = s.likes || 0
    for (const w of words) if (s.text.includes(w)) score += 10_000
    return { s, score }
  })
  return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, n)).map((x) => x.s)
}

export function stats() {
  const db = readAll()
  const out = {}
  for (const [kw, bar] of Object.entries(db)) out[kw] = bar.samples?.length || 0
  return out
}

export function clearBar(kw) {
  const db = readAll()
  delete db[kw]
  writeAll(db)
}
