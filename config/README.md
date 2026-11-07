# 预置说明

本目录不存真实配置 —— 真实配置在 `data/tieba-duty/config.json`（首次使用命令后自动生成，600 权限）。

## 放 BDUSS（唯一必须手动做的事）

```
plugins/yunzai-tieba-dive/data/tieba-duty/cookie.txt
```

内容一行：`BDUSS=你的BDUSS整串值`

获取：电脑浏览器登录 tieba.baidu.com → F12 → Application → Cookies → 复制 `BDUSS` 的 Value。

**不要把 BDUSS 发到 QQ 聊天里**（会留在聊天记录），插件也没有提供任何写 cookie 的命令，这是故意的。

## 常用配置速查（#贴吧设置 <项> <值>）

| 项 | 默认 | 说明 |
|---|---|---|
| bars | 空 | 要刷的吧（用 `#贴吧设置 bars 吧1 吧2`） |
| readPerRound | 5 | 每轮读几个帖 |
| autoSign | 关 | 每天 signHour 点自动签到 |
| autoReply | 关 | 允许回帖（用小号！） |
| replyPerDay | 3 | 每天回帖上限 |
| evolvePersona | 关 | 读帖时收集高赞回复进风格库 |
| autoRun | 关 | 每天 runHour 点自动跑一轮 |
| peakValley | 关 | 峰谷模式（只在午谷/晚谷跑） |
| notifyMaster | 关 | 跑完私聊主人 |
| notifyGroupId | 0 | 跑完发到某群 |

## LLM 配置（日报总结/回帖生成用）

插件按顺序找：

1. 云崽全局 AI 配置：`config/config/bot.yaml` 里的 `AI.key` / `AI.platform` / `AI.model`（miao/chess 风格）
2. 环境变量：`TIEBA_LLM_URL`（如 `https://api.deepseek.com/v1`）+ `TIEBA_LLM_KEY` + `TIEBA_LLM_MODEL`

都没有 → 插件照常跑采集/签到，日报给原始帖子列表，回帖生成跳过。
