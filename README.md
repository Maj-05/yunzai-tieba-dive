# yunzai-tieba-dive

> 云崽（TRSS-Yunzai / Miao-Yunzai）贴吧插件：自动读帖、生成日报、每日签到；回帖可选，带频率与内容限制。
> 移植自 [Nekomeow114/dsh-tieba-dive](https://github.com/Nekomeow114/dsh-tieba-dive)（DSH 插件版），**抓取与风控层原样保留，宿主层重写为云崽插件**。

⚠️ 走的是贴吧手机版页面 + app protobuf（逆向解析），不是官方 API。贴吧改版可能失效，频繁请求可能触发风控；账号风险与发布内容由使用者自行承担。**建议用小号。**

---

## 安装

```bash
# 在 Yunzai 根目录
git clone <本仓库> plugins/yunzai-tieba-dive
cd plugins/yunzai-tieba-dive && pnpm i   # 或 npm i（只装 node-fetch）
```

## 首次配置（两步）

**1. 放 BDUSS**（不要发到聊天里）：

```
plugins/yunzai-tieba-dive/data/tieba-duty/cookie.txt
```

内容一行：`BDUSS=你的BDUSS整串值`
（获取：电脑浏览器登录贴吧 → F12 → Application → Cookies → 复制 BDUSS 的 Value）

**2. 发命令**：

```
#贴吧设置 bars deepseek 原神     ← 填要刷的吧
#贴吧谁在登录                    ← 验证登录态
#贴吧刷一轮                      ← 立即跑一轮试试
```

## 命令

| 命令 | 权限 | 说明 |
|---|---|---|
| `#贴吧` | 所有人 | 状态一览 |
| `#贴吧日报 [吧名]` | 所有人 | 某吧日报（有 LLM 出总结，没有出帖子列表） |
| `#贴吧帮助` | 所有人 | 命令帮助 |
| `#贴吧刷一轮` | 主人 | 立即跑一轮（读帖 → 可选学习/回帖/签到） |
| `#贴吧学习` | 主人 | 只读帖+学风格库，不回帖 |
| `#贴吧签到 [吧名]` | 主人 | 立即签到（没关注的吧先关注） |
| `#贴吧设置 bars 吧1 吧2` | 主人 | 改吧列表 |
| `#贴吧设置 <项> <值>` | 主人 | 改配置（`#贴吧设置` 看全部项） |
| `#贴吧谁在登录` | 主人 | 验证 BDUSS |
| `#贴吧熔断状态` / `#贴吧熔断清除` | 主人/所有人 | 风控熔断查看/清除 |
| `#贴吧风格库清理 <吧名>` | 主人 | 清空某吧的风格库 |

## 与 DSH 原版的差异

| | dsh-tieba-dive（原版） | yunzai-tieba-dive（本仓库） |
|---|---|---|
| 宿主 | DeepSeek Harness 插件 | Yunzai plugin 类 + 命令规则 |
| 一轮执行 | 模型 agent 按 prompts/duty.md 自主跑 | **确定性流程**（代码写死步骤），只把「总结/写回帖」交给 LLM |
| 无 LLM 时 | 跑不起来 | **照常采集/签到**，日报退化为帖子列表 |
| 回帖生成 | 模型调用工具链 | `lib/llm.mjs` 单轮对话 + toneGate 拦截 |
| 设置页 | DSH Web 设置页 | QQ 命令（`#贴吧设置`） |
| 定时 | DSH headless 子进程 | 云崽 task（`config/config/` 下加 task）或 `#贴吧刷一轮` |
| 楼中楼回复 / 发新帖 / 发图 | 支持 | **未移植**（第一期先不做，需要再加） |
| 风控熔断 / curl 反爬 / protobuf 通道 | ✅ | ✅ 原样保留 |

## 从原版保留的东西（几乎零改动）

- `lib/tieba.js` — curl 子进程网络层（百度认 TLS 指纹，Node fetch 会 `is_login:0`）、手机版 `/mo/q/m` 解析、app protobuf 签名/回帖/关注/热门接口、图床上传
- `lib/cooldown.mjs` — 撞到「百度安全验证」落盘熔断
- 仅改了一处：数据目录从 `$DSH_HOME/tieba-duty` 改为插件内 `data/tieba-duty`（可用环境变量 `YUNZAI_TIEBA_HOME` 覆盖）

## 数据目录

```
plugins/yunzai-tieba-dive/data/tieba-duty/
├─ cookie.txt     # BDUSS（600，手动放）
├─ config.json    # 配置（600，#贴吧设置 生成）
├─ state.json     # 当日计数/已读去重/回帖留痕
├─ style.json     # 风格库（每吧 ≤40 条高赞回复）
├─ cooldown.json  # 熔断状态
└─ logs/          # 每日运行日志
```

## 定时任务（可选）

云崽在 `config/config/` 的 task 里加一条（TRSS-Yunzai 写法）：

```yaml
# 贴吧每日自动一轮（插件内已带开关，建议用这个统一入口）
yunzai-tieba-dive:
  job:
    - name: tieba-daily
      cron: "0 21 * * *"   # 每天 21 点
  # 也可以直接在插件 config 里开 autoRun: true + runHour: 21，
  # 然后加一条 task 调 #贴吧刷一轮 命令即可
```

或者最简单：开 `autoRun` 后用系统 crontab 定时给 bot 发一条 `#贴吧刷一轮`。

## LLM 配置

日报总结和回帖生成需要一个 OpenAI 兼容接口（只发文本，不用多模态）。按顺序找：

1. 云崽全局 AI 配置（`bot.yaml` 的 `AI.key` / `AI.platform`）
2. 环境变量 `TIEBA_LLM_URL` + `TIEBA_LLM_KEY` + `TIEBA_LLM_MODEL`

都没有 → 采集/签到照常，生成类自动跳过（不会报错卡死）。

## 安全边界

- 出站内容过滤：回帖含路径/链接/BDUSS/token 字样直接拒发
- toneGate：客服腔（首先/其次/希望对你有帮助…）拦截退回
- 四道闸：总开关 → 每日上限 → 同帖一天一次 → 最小间隔
- BDUSS 只存本地 cookie.txt（600），无任何命令能读出它
- **回帖默认关**；开了也建议小号，被封不心疼

## 未移植（原版有、这版没有）

- 楼中楼回复（`allowSubReply` 那套）
- 发新帖 / 带图回帖 / 图床上传
- 人设版本快照 / 漂移评分 / 日记
- MCP server
- Web 设置页（云崽用命令代替）

需要的话按原版 `lib/tieba.js` 的接口（`replySub` / `createThread` / `replyWithImage`）往 `runner.mjs` 里加，抓取层是现成的。

## 致谢与许可

- 原版：[Nekomeow114/dsh-tieba-dive](https://github.com/Nekomeow114/dsh-tieba-dive)（MIT）
- 本仓库：MIT。抓取层代码版权归原作者所有。

## 免责声明

非官方接口，可能随时失效或触发风控。使用即表示理解并承担账号风险，以及所发布内容带来的责任。
