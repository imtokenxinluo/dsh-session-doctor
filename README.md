# dsh-session-doctor

会话体检与修复插件 for DeepSeek Harness：扫描存储的会话日志，找出会导致
历史加载失败的损坏记录（loader 同款校验），并无损修复已支持的那类形状漂移，
每次修复前自动备份。

## 背景：为什么要这个工具

DSH 把会话日志存成"逐批追加、独立可解、带校验和的 zstd 帧"。写入路径
（`Session.append` / `dsh-tools` 的工具结果投影）**从不校验消息形状**，
形状校验只存在于加载路径——一旦某条记录形状违规，整个会话历史都无法加载
（`SessionPersistenceCorruptionError`），且除撕裂尾部外没有自动恢复。

实际案例（2026-09）：插件 `dsh-ssh-ops` 的 `sftp_*`/`tunnel_*` 工具
`output.render()` 返回裸字符串，违反 `ContentBlock[]` 契约，导致多次
"history unavailable … must contain one tool-result block"。本工具即为此而生。

详见同目录 [`PLAN.md`](../dsh-hardening/PLAN.md)（审查与补丁清单，P0 内核
守卫需 upstream 决策；本仓库交付 P1 的 scan/repair）。

## 能力（v1 + v1.1）

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

## 安装 / 使用（独立包，暂不注册进 profile）

```bash
# CLI（不依赖 DSH 运行环境，纯 Node >= 22）
npm link                                   # 或 node bin/dsh-session-doctor.js
dsh-session-doctor scan <sessions-root>    # 扫描目录树
dsh-session-doctor scan-file <file>        # 扫单文件
dsh-session-doctor repair <file> [--dry-run]
```

作为 DSH 插件（cordis 服务插件）的接缝在 `src/` 顶部预留：`scanSessionRoot`
接受任意根目录，DSH profile 中可通过 `ctx.sessionPersistence` 定位真实根。

## 测试

```bash
npm test                # 合成 fixture：scan 检出/repair 无损
node scripts/verify-real.mjs   # 真实损坏会话副本验收（不碰真实数据）
```

`verify-real.mjs` 默认读 `D:\tool\dsh_data\sessions\--D-tool-claude_code--`
下已知损坏会话的副本，断言 scan 检出精确坏 seq、repair 后 0 失败。

## 安全边界

- 只修**一种已确认的缺陷**（字符串 content）；其它损坏一律报告不修。
- 修复前必备份；重写先写临时文件再替换；产物未通过复验则不落盘。
- 不碰真实数据：验收全在副本上进行。
- 代码零运行时依赖（只用 Node 内置 `node:zlib` / `node:fs`）。

## License

MIT
