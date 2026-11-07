# yunzai-tieba-dive

> 云崽（TRSS-Yunzai / Miao-Yunzai）贴吧插件：自动读帖、生成日报、每日签到；回帖可选，带频率与内容限制。

⚠️ 走的是贴吧手机版页面 + app protobuf（逆向解析），不是官方 API。贴吧改版可能失效，频繁请求可能触发风控；账号风险与发布内容由使用者自行承担。

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

## 致谢与许可

- 原版：[Nekomeow114/dsh-tieba-dive](https://github.com/Nekomeow114/dsh-tieba-dive)（MIT）
- 本仓库：MIT。抓取层代码版权归原作者所有。

## 免责声明

非官方接口，可能随时失效或触发风控。使用即表示理解并承担账号风险，以及所发布内容带来的责任。
