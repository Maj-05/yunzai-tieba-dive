/**
 * index.js —— 插件入口（云崽标准结构）
 *
 * 目录结构（TRSS-Yunzai / Miao-Yunzai 通用）：
 *   plugins/yunzai-tieba-dive/
 *   ├── index.js            ← 本文件（加载 apps/ 下所有插件类）
 *   ├── package.json
 *   ├── apps/tieba.js       命令入口
 *   ├── lib/…               抓取/配置/状态/风格库/LLM/一轮任务
 *   └── config/…            预置说明
 *
 * 数据目录：plugins/yunzai-tieba-dive/data/tieba-duty/
 *   cookie.txt  ← 手动放 BDUSS（600 权限）
 *   config.json / state.json / style.json / cooldown.json / logs/ 自动生成
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 首次运行：建数据目录 + 预置 cookie.txt 模板
const dataDir = path.join(__dirname, 'data', 'tieba-duty')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
  const tpl = path.join(dataDir, 'cookie.txt')
  if (!fs.existsSync(tpl)) {
    fs.writeFileSync(tpl, 'BDUSS=把这里整串替换成你的BDUSS值\n', { mode: 0o600 })
  }
  console.log('[yunzai-tieba-dive] 数据目录已初始化:', dataDir)
}

const files = fs.readdirSync(path.join(__dirname, 'apps')).filter((f) => f.endsWith('.js'))
let ret = []
for (const f of files) {
  try {
    ret.push(import(`./apps/${f}`))
  } catch (e) {
    console.error(`[yunzai-tieba-dive] 载入 ${f} 失败:`, e)
  }
}
ret = await Promise.allSettled(ret)
const apps = {}
for (const [i, r] of ret.entries()) {
  const name = files[i].replace('.js', '')
  if (r.status !== 'fulfilled') {
    console.error(`[yunzai-tieba-dive] 载入 ${name} 失败:`, r.reason)
    continue
  }
  for (const [key, cls] of Object.entries(r.value)) {
    if (typeof cls === 'function' && /^class\s/.test(cls.toString())) apps[key || name] = cls
  }
}
export { apps }
