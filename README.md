# dsh-session-doctor

会话体检与修复插件 for DeepSeek Harness：扫描存储的会话日志，找出会导致
历史加载失败的损坏记录（loader 同款校验），并无损修复已支持的那类形状漂移，
每次修复前自动备份。v1.2 起新增 **blame 事故归因**——快速判断
"浏览器 / 软件 / DSH 突然关闭是不是大模型自己调用工具干的"。

## 背景：为什么要这个工具

### 一个会"失忆"的会话历史

DSH 把会话日志存成"逐批追加、独立可解、带校验和的 zstd 帧"。**会话历史是
人与 DSH 之间交换记忆的唯一介质**——它坏一次，人和系统的连续交换就断一次
（历史不可加载 = 一起失忆）。

这个工具要解决的，是 DSH 的一个**系统性边界缺陷**，而不只是某个插件写坏了数据：

- **写入路径从不校验消息形状**（`Session.append` 只查 JSON 可序列化；
  `dsh-tools` 的工具结果投影原样落库）
- **形状校验只存在于加载路径**（`assertMessageEventShape`）
- 后果：一条形状违规的记录在**写入时毫无报错**，直到**下次加载**才以
  `SessionPersistenceCorruptionError` 让**整条会话历史**不可用

### 为什么 DSH 自己发现不了

类型契约 `render(): ContentBlock[]` 写在 TypeScript 里，DSH 自己的工具全部遵守
——内部闭环永远测不出问题。**第一次暴露必然来自第三方插件**（运行时边界没有
TS 保护）：2026-09，`dsh-ssh-ops` 的 `sftp_*`/`tunnel_*` 工具 `output.render()`
返回裸字符串，导致多个会话报 `history unavailable … must contain one
tool-result block`。这正是开源的意义：外部参与者帮内核找到了它自己发现不了的
边界 bug。

### 三层防线（本工具是其中一层）

| 防线 | 作用 | 形态 | 状态 |
|---|---|---|---|
| 事前（写路径守卫） | render 非数组 → 规范化，坏记录进不了日志 | DSH 内核补丁（P0-1） | 已提交上游 [Discussion #5647](https://github.com/deepseek-ai/deepseek-harness/discussions/5647) |
| **实时（watch）** | 新写入违规即告警，不等下次加载 | **本插件 v1.1** | ✅ |
| **事后（scan/repair）** | 扫描+备份+无损修复已坏会话 | **本插件 v1** | ✅ |

内核补丁（P0-1/P0-3）的完整 before/after、测试与 Agent Note 见本仓库
[`docs/upstream/`](docs/upstream/)，系统审查全貌见
[`docs/PATCHES.md`](docs/PATCHES.md)（补丁实施手册）与
[`docs/PLAN.md`](docs/PLAN.md)（补丁分层清单）。

> 补丁材料同时在 DSH 上游公开讨论：
> [deepseek-harness Discussion #5647](https://github.com/deepseek-ai/deepseek-harness/discussions/5647)
> （官方暂不接受外部 PR，缺陷已按官方渠道上报）。

## 什么时候用它

| 场景 | 做什么 |
|---|---|
| GUI 报 "history unavailable … must contain one tool-result block" | `scan-file <该会话.jsonl.zstd>` 确认 → `repair <file>` 无损修复 |
| 想预防：担心哪个插件又在写坏记录 | 装 profile 让 watch 生效，或 `scan <sessions-root>` 定期体检 |
| DSH 升级后怀疑旧补丁/旧会话有问题 | 按 [`docs/PATCHES.md`](docs/PATCHES.md) §5 核对清单重打 |
| 想找哪个插件违反了 render 契约 | `scripts/audit-render-contract.mjs <插件 src/lib>` |
| 浏览器 / 软件 / DSH **突然关闭**，怀疑是大模型自己干的 | `blame <会话文件或 sessions 根>` 事故归因（见下） |

## blame 事故归因（v1.2）

会话日志天然留痕：每次工具调用（含 shell 命令全文）与中断标记都在里面。
`blame` 做"尸检"——自动定位中断断点，回看断点前的工具调用链，匹配危险模式：

| 判定 | 条件 |
|---|---|
| **AGENT-CAUSED** | 断点前最近的工具调用命中危险命令（杀进程 / 关浏览器 / 自重启 harness）**且**会话紧随中断 |
| **EXTERNAL** | 有中断，但断点前无危险 agent 调用 → 疑系统/手动关闭 |
| **NO-ACCIDENT** | 无中断标记（含 live 进行中会话）→ 不算事故 |

- **双重证据门槛**：只执行过危险命令但会话继续正常跑 → **不归因**（命令可能失败或无害）；
  只有中断但无危险命令 → 归因外部。宁可不冤枉，不臆测。
- 危险模式三类：`kill-process`（taskkill / Stop-Process / pkill / kill / Stop-Service /
  net stop）、`browser-close`（agent-browser close）、`self-restart`（杀 dsh/node 后重启）。
- 命令从工具调用的 JSON 参数里提取（pwsh/bash 的 `command`/`script` 等字段）。
- 日志尾部 torn frame（进程写到一半被杀）会显式标注"最后一批证据缺失"。
- **只读**：绝不修改任何会话文件。

真实案例（2026-09-06，每日荐股会话把自己 dsh 进程杀了）：
```
$ dsh-session-doctor blame <sessions-root>
AGENT-CAUSED  ...\scheduled-run-3fd818d1-...\session.jsonl.zstd
  suspect tool call:
    line 23487 seq 384394 time 2026-09-06T13:08:28.114Z
    tool=pwsh callId=call_00_uZEnOVXTh4ythv4NwqeF3377
    command: $procs = Get-CimInstance ... Stop-Process -Id $p.ProcessId -Force ... Start-Process ...
    pattern [kill-process]: 杀进程类（...）
    pattern [self-restart]: 自重启 harness（...）
```

## 能力（v1 + v1.1 + v1.2）

- **scan** — 遍历一个 sessions 根目录（或单文件），按 DSH 加载路径同款规则
  校验每条事件，报告损坏会话、行号、seq、事件类型、涉及的 tool 名与原因。
- **repair** — 对单个损坏会话文件：先备份（`<file>.<ts>.bak`），再把
  "tool-result 块 content 为裸字符串"的记录无损包裹成
  `[{type:"text",text:"…"}]`，帧级重写（未损坏帧字节不变）；重写产物会先
  复验 0 失败才落盘。未知损坏形态只报告、不自动修。
- **watch（v1.1 实时哨兵）** — 订阅 DSH `session/event`，对 live 会话新写入的
  消息事件**即时**执行 loader 同款校验，违规立刻告警（logger + `onViolation`），
  坏记录刚产生就被发现，不再等下次加载才炸。
  - 核心：`src/watch.js`（`createSessionWatcher` / `createSessionSentinel`，纯逻辑可单测）
  - 插件壳：`src/plugin.js`（cordis 插件，注册进 profile 即全会话生效；默认不装）
  - 边界：事件在 append 后才发布，watch **不阻止写入**（那属 P0 内核守卫）；
    live 会话由 writer 占用，watch 只告警不改文件（修复交给冷会话的 repair）。
- **blame（v1.2 事故归因）** — 见上文：中断断点定位 + 断点前工具调用链 +
  危险模式匹配 + 双重证据判定（agent-caused / external / no-accident），
  只读分析，回答"突然关闭是不是大模型干的"。

## 安装 / 使用（独立包，暂不注册进 profile）

```bash
# CLI（不依赖 DSH 运行环境，纯 Node >= 22）
npm link                                   # 或 node bin/dsh-session-doctor.js
dsh-session-doctor scan <sessions-root>    # 扫描目录树
dsh-session-doctor scan-file <file>        # 扫单文件
dsh-session-doctor repair <file> [--dry-run]
dsh-session-doctor blame <file|root>       # 事故归因：突然关闭是不是 agent 干的
```

作为 DSH 插件（cordis 服务插件）的接缝在 `src/` 顶部预留：`scanSessionRoot`
接受任意根目录，DSH profile 中可通过 `ctx.sessionPersistence` 定位真实根。

## 测试

```bash
npm test                # 合成 fixture：scan 检出/repair 无损/blame 归因判定
node scripts/verify-real.mjs   # 真实损坏会话副本验收（不碰真实数据）
```

`verify-real.mjs` 默认读 `D:\tool\dsh_data\sessions\--D-tool-claude_code--`
下已知损坏会话的副本，断言 scan 检出精确坏 seq、repair 后 0 失败。
blame 的真实验收：对真实"每日荐股自杀"会话副本（含
`Stop-Process ... dsh` 命令 + interrupted 标记）能定位嫌疑调用并判 agent-caused；
对干净/外部中断会话分别判 no-accident / external（本次开发即以此验收）。

## 安全边界

- 只修**一种已确认的缺陷**（字符串 content）；其它损坏一律报告不修。
- 修复前必备份；重写先写临时文件再替换；产物未通过复验则不落盘。
- 不碰真实数据：验收全在副本上进行。
- 代码零运行时依赖（只用 Node 内置 `node:zlib` / `node:fs`）。

## License

MIT
