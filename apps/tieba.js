/**
 * apps/tieba.js —— 云崽命令入口
 *
 * 命令一览（主人可用全部；群友默认只能用只读的 #贴吧）：
 *   #贴吧                    —— 当前配置一览
 *   #贴吧刷一轮              —— 立即跑一轮（读帖+可选学习/回帖/签到）
 *   #贴吧日报 <吧名>         —— 生成/读取某吧日报
 *   #贴吧签到 [吧名]         —— 立即签到（缺省签配置里的所有吧）
 *   #贴吧设置 bars           —— 查看吧列表
 *   #贴吧设置 bars <多行/顿号分隔> —— 改吧列表
 *   #贴吧设置 <key> <value>  —— 改单个配置项
 *   #贴吧学习                —— 手动触发一轮「只学习不回帖」
 *   #贴吧谁在登录            —— whoami 登录态检查
 *   #贴吧熔断状态 / #贴吧熔断清除
 *
 * BDUSS 不走命令（避免留在聊天记录里）：直接编辑
 *   plugins/yunzai-tieba-dive/data/tieba-duty/cookie.txt
 *   内容一行：BDUSS=xxxxxx
 */
import plugin from '../../../lib/plugins/plugin.js'
import { readConfig, writeConfig, DEFAULTS } from '../lib/config.mjs'
import { whoami, listBar, followAndSign, readCooldown, clearCooldown } from '../lib/tieba.js'
import { stats as styleStats, clearBar } from '../lib/stylelib.mjs'
import { runRound, dailyReport } from '../lib/runner.mjs'
import { llmAvailable } from '../lib/llm.mjs'
import cfg from '../../../lib/config/config.js'

const SETTABLE = new Set([
  'autoSign', 'autoFollow', 'signAllFollowed', 'signHour',
  'autoReply', 'replyPerRound', 'replyPerDay', 'replyGapSec',
  'answerQuestions', 'toneGate', 'mention',
  'allowSubReply', 'subReplyPerRound', 'subReplyPerDay',
  'evolvePersona', 'learnHotOnly', 'styleMaxPerBar',
  'readPerRound', 'requestGapMs', 'dedupeDays',
  'autoRun', 'runHour', 'peakValley', 'noon', 'night',
  'notifyMaster', 'notifyGroupId', 'breakerEnabled', 'breakerMin',
  'diaryEnabled',
])
const BOOL_KEYS = new Set([
  'autoSign', 'autoFollow', 'signAllFollowed', 'autoReply', 'answerQuestions',
  'toneGate', 'allowSubReply', 'evolvePersona', 'learnHotOnly', 'autoRun',
  'peakValley', 'noon', 'night', 'notifyMaster', 'breakerEnabled', 'diaryEnabled',
])

export class TiebaDive extends plugin {
  constructor() {
    super({
      name: '贴吧潜入',
      dsc: '贴吧自动读帖/日报/签到，回帖可选（移植自 dsh-tieba-dive）',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#贴吧$', fnc: 'status' },
        { reg: '^#贴吧刷一轮', fnc: 'round', permission: 'master' },
        { reg: '^#贴吧学习', fnc: 'learnOnly', permission: 'master' },
        { reg: '^#贴吧日报', fnc: 'report' },
        { reg: '^#贴吧签到', fnc: 'signNow', permission: 'master' },
        { reg: '^#贴吧设置 bars?$', fnc: 'getBars' },
        { reg: '^#贴吧设置 bars?\\s', fnc: 'setBars', permission: 'master' },
        { reg: '^#贴吧设置\\s+(\\S+)\\s+(.+)$', fnc: 'setKey', permission: 'master' },
        { reg: '^#贴吧设置$', fnc: 'getSettings' },
        { reg: '^#贴吧谁在登录', fnc: 'whoLogin', permission: 'master' },
        { reg: '^#贴吧熔断清除', fnc: 'breakerClear', permission: 'master' },
        { reg: '^#贴吧熔断状态', fnc: 'breakerStatus' },
        { reg: '^#贴吧风格库清理\\s+(\\S+)$', fnc: 'styleClear', permission: 'master' },
        { reg: '^#贴吧帮助$', fnc: 'help' },
      ],
    })
    // 触发一轮/签到的进行中标记（防并发重复跑）
    this._running = false
  }

  get c() { return readConfig() }

  async status(e) {
    const c = this.c
    const sty = styleStats()
    const lines = [
      '📖 贴吧潜入',
      `吧（${c.bars.length}）：${c.bars.join('、') || '（未配置，#贴吧设置 bars <吧名>）'}`,
      `关键词：${c.keywords.join('、') || '无'}`,
      `读帖 ${c.readPerRound}/轮 · 回帖 ${c.autoReply ? '开' : '关'} · 楼中楼 ${c.allowSubReply ? '开' : '关'}`,
      `签到 ${c.autoSign ? `开（每天 ${c.signHour} 点）` : '关'}`,
      `学习（风格库）${c.evolvePersona ? '开' : '关'} · 库存 ${Object.entries(sty).map(([k, v]) => `${k}:${v}`).join(' ') || '空'}`,
      `定时 ${c.autoRun ? `开（${c.runHour} 点${c.peakValley ? '，峰谷模式' : ''}）` : '关'}`,
      `LLM：${llmAvailable() ? '已配置（总结/回帖可用）' : '未配置（只能采集/签到，日报出原始列表）'}`,
      '详情：#贴吧帮助',
    ]
    await this.reply(lines.join('\n'))
    return true
  }

  async round(e) {
    if (this._running) { await this.reply('上一轮还在跑，等一下……'); return true }
    this._running = true
    try {
      await this.reply('开始刷一轮贴吧……（读帖有间隔，需要一点时间）')
      const r = await runRound({})   // 完全按配置
      await this.reply(r.summary)
      if (this.c.notifyMaster && r.ok) {
        const master = (cfg?.masterQQ || cfg?.bot?.masterQQ || [])[0]
        if (master) await Bot.pickUser(master).sendText(`[贴吧] ${r.summary}`)
      }
      if (this.c.notifyGroupId && r.ok) {
        await Bot.pickGroup(this.c.notifyGroupId).sendText(`[贴吧] ${r.summary}`)
      }
    } catch (err) {
      await this.reply(`一轮失败：${err.message}`)
    } finally { this._running = false }
    return true
  }

  async learnOnly(e) {
    if (this._running) { await this.reply('上一轮还在跑'); return true }
    this._running = true
    try {
      await this.reply('开始只读+学习（不回帖）……')
      const r = await runRound({ doReply: false, doSign: false, doLearn: true })
      const detail = r.results.map((x) => `${x.kw}：学 ${x.learned} 条${x.error ? '（' + x.error + '）' : ''}`).join('\n')
      await this.reply(`${r.summary}\n${detail}`)
    } finally { this._running = false }
    return true
  }

  async report(e) {
    const kw = e.msg.replace(/^#贴吧日报\s*/, '').trim() || this.c.bars[0]
    if (!kw) { await this.reply('用法：#贴吧日报 <吧名>（或先配置 bars）'); return true }
    await this.reply(`正在拉「${kw}」的日报……`)
    const md = await dailyReport(kw)
    // 云崽长文本用转发段更稳，但简版直接发；超 1500 字截断
    const text = md.length > 1500 ? md.slice(0, 1500) + '\n…（截断）' : md
    await this.reply(text)
    return true
  }

  async signNow(e) {
    const kws = e.msg.replace(/^#贴吧签到\s*/, '').trim()
    const bars = kws ? kws.split(/[\s,，、]+/).filter(Boolean) : this.c.bars
    if (!bars.length) { await this.reply('没配吧，先 #贴吧设置 bars <吧名>'); return true }
    const out = []
    for (const kw of bars) {
      try {
        const r = await followAndSign(kw, { autoFollow: this.c.autoFollow })
        out.push(r.ok ? `✅ ${kw}（${r.wasFollowing ? '已关注' : '新关注'}）` : `❌ ${kw}：${r.error || r.msg}`)
      } catch (err) { out.push(`❌ ${kw}：${err.message}`) }
    }
    await this.reply(out.join('\n'))
    return true
  }

  async getBars(e) {
    const c = this.c
    await this.reply(c.bars.length ? `当前吧列表：\n${c.bars.join('\n')}` : '吧列表是空的。改法：#贴吧设置 bars 吧名1 吧名2（空格/顿号分隔）')
    return true
  }

  async setBars(e) {
    const raw = e.msg.replace(/^#贴吧设置\s*bars?\s*/i, '').trim()
    const bars = raw.split(/[\n,，、\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20)
    if (!bars.length) { await this.reply('没解析到吧名。例：#贴吧设置 bars deepseek 原神'); return true }
    writeConfig({ bars })
    await this.reply(`吧列表已保存（${bars.length} 个）：\n${bars.join('、')}`)
    return true
  }

  async setKey(e) {
    const m = /^#贴吧设置\s+(\S+)\s+([\s\S]+)$/.exec(e.msg)
    if (!m) { await this.reply('用法：#贴吧设置 <配置项> <值>，#贴吧设置 看全部'); return true }
    const [, key, rawVal] = m
    if (key === 'personaText' || key === 'styleSamples') {
      writeConfig({ [key]: rawVal.slice(0, key === 'personaText' ? 20000 : 4000) })
      await this.reply(`${key} 已保存（${rawVal.length} 字）`)
      return true
    }
    if (key === 'keywords') {
      const arr = rawVal.split(/[\n,，、\s]+/).filter(Boolean)
      writeConfig({ keywords: arr })
      await this.reply(`关键词已保存：${arr.join('、') || '（空）'}`)
      return true
    }
    if (!SETTABLE.has(key)) {
      await this.reply(`不支持配置项「${key}」。可改：${[...SETTABLE].join(' ')}`)
      return true
    }
    let value = rawVal.trim()
    if (BOOL_KEYS.has(key)) {
      value = /^(1|true|开|on|yes)$/i.test(value)
    } else {
      const n = Number(value)
      if (!Number.isFinite(n)) { await this.reply(`${key} 要数字`); return true }
      value = n
    }
    writeConfig({ [key]: value })
    await this.reply(`已设置 ${key} = ${typeof value === 'boolean' ? (value ? '开' : '关') : value}`)
    return true
  }

  async getSettings(e) {
    const c = this.c
    const lines = Object.entries(DEFAULTS).map(([k]) => {
      const v = c[k]
      const shown = typeof v === 'boolean' ? (v ? '开' : '关') : Array.isArray(v) ? v.join('、') : String(v).slice(0, 40)
      return `${k} = ${shown}`
    })
    await this.reply(['⚙️ 当前配置（改法：#贴吧设置 <项> <值>）', ...lines].join('\n'))
    return true
  }

  async whoLogin(e) {
    try {
      const w = await whoami()
      await this.reply(`✅ 登录态有效（tbs=${w.tbs.slice(0, 6)}…）`)
    } catch (err) {
      await this.reply(`❌ ${err.message}\n把 BDUSS 写进 plugins/yunzai-tieba-dive/data/tieba-duty/cookie.txt（一行：BDUSS=xxx）`)
    }
    return true
  }

  async breakerStatus(e) {
    const c = readCooldown()
    await this.reply(c.active
      ? `🔥 熔断中（${c.reason}），到 ${new Date(c.until).toLocaleTimeString('zh-CN')} 自动解除`
      : '✅ 没有在熔断')
    return true
  }

  async breakerClear(e) {
    clearCooldown()
    await this.reply('熔断已手动清除（小心再撞验证码）')
    return true
  }

  async styleClear(e) {
    const kw = /^#贴吧风格库清理\s+(\S+)$/.exec(e.msg)[1]
    clearBar(kw)
    await this.reply(`「${kw}」的风格库已清空`)
    return true
  }

  async help(e) {
    await this.reply([
      '📖 贴吧潜入 · 命令',
      '#贴吧 — 状态一览',
      '#贴吧刷一轮 — 立即读帖（主人）',
      '#贴吧学习 — 只学风格不回帖（主人）',
      '#贴吧日报 [吧名] — 看某吧日报',
      '#贴吧签到 [吧名] — 立即签到（主人）',
      '#贴吧设置 bars 吧1 吧2 — 改吧列表（主人）',
      '#贴吧设置 <项> <值> — 改配置（主人）',
      '#贴吧设置 — 看全部配置项',
      '#贴吧谁在登录 — 验 BDUSS（主人）',
      '#贴吧熔断状态 / #贴吧熔断清除',
      '',
      '⚠️ BDUSS 请写进 data/tieba-duty/cookie.txt，别发到聊天里',
      '⚠️ 回帖默认关；自动回帖用小号，风险自担',
    ].join('\n'))
    return true
  }
}
