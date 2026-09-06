# dsh-session-doctor — 需求契约 (doublecheck spec)

## v1.2 增补：blame 事故归因（2026-09-06 用户确认）
- Goal：新增 blame 能力——回答"浏览器/软件/DSH 突然关闭是否由大模型自己调用
  工具造成"（会话尸检），bump 0.2.0 发布。
- Scope：src/blame.js（纯逻辑可单测）、bin CLI blame <file|root>（单会话尸检 /
  目录扫描汇总）、test/blame.test.js、README/SPEC 更新、version 0.2.0、git tag 并 push。
  复用现有 zstd/scan 解码。不做模型工具注册、不发 npm、不动 awesome（用户另说时再做）。
- AC：① 双重证据判定——断点前**危险命令命中 + 紧随中断**才算 agent-caused；
  ② 只危险无中断 → 不归因；只中断无危险 → external；③ 危险模式三类：
  kill-process（taskkill/Stop-Process/pkill/kill/Stop-Service/net stop）、
  browser-close（agent-browser close）、self-restart（杀 dsh/node 后重启）；
  ④ 真实每日荐股自杀会话副本能定位 21:08:28 pwsh 调用（Stop-Process dsh）并归因；
  ⑤ 干净会话 no-accident；⑥ torn tail 显式报告（证据不全提示）；
  ⑦ node --test 全绿；⑧ 真实验证只在副本上。
- 边界（如实）：只读分析绝不改文件；归因基于已落盘完整帧（torn tail 丢弃但显式
  标注）；live 会话以 tool/call 结尾（无 result）不算中断——无 interrupted 标记即
  no-accident，不误报进行中会话；agent-browser close 关的是自动化 daemon 会话，
  不影响 dsh → 会话正常完成即不归因（双重证据自然排除）。

---

## v1.1 增补：watch 实时哨兵（2026-09-02 用户确认）
- Goal 扩展：在 v1（scan/repair）基础上新增 watch——订阅 DSH `session/event`，
  对 live 会话新写入的 tool/result 等消息事件即时执行 loader 同款形状校验，
  违规立即告警（logger + onViolation 回调），坏记录刚产生就被发现。
- Scope：src/watch.js（纯校验核心 + per-session callId→tool 缓存，可单测）、
  src/plugin.js（cordis 插件壳：ctx.on("session/event"/"session/created") 桥接，
  装 profile 时使用；本仓库交付但不装 profile）、测试、README 更新。
- AC：① watch 对好 tool/result 返回 null；② 对字符串 content 的 tool/result
  返回含 seq/type/reason/tool 的违规；③ 经 tool/call 缓存能解析出 tool 名；
  ④ 无先例 callId 时仍报告（tool 名可为 undefined）；⑤ 插件壳用假 ctx
  （记录 on 回调 + logger）可测通；⑥ 全套测试仍绿。
- 边界（如实）：watch 在 append 后触发，**不阻止写入**（那属 P0 内核）；
  live 会话被 writer 占用，watch 不自动修文件，只告警（与 repair 冷会话互补）。

---

## Goal
在工作区交付一个可开源复用的 DSH 会话维护插件 dsh-session-doctor（JS ESM 单仓，暂不装 profile、不本地改内核），v1 提供 scan（遍历全部会话日志、按读路径同款校验报告损坏点）与 repair（对损坏会话备份并无损修复），并用真实会话副本验证 scan 检出已知坏记录、repair 后加载校验 0 失败。

## Scope
范围内：新建 D:\tool\claude_code\dsh-session-doctor\ 独立 git 仓库，含 package.json、src/（scan 与 repair 的纯逻辑 + CLI/插件入口）、README、LICENSE、测试；PLAN.md 已写入 dsh-hardening\PLAN.md 作为审查交付。范围外：不改 node_modules 内 dsh 内核（P0 仅文档化）；不安装进 web profile bundle；不实现 watch/audit-tools（仅 PLAN 记录）；不 push GitHub（用户稍后自行发布）；不动真实会话数据（验收用副本）。

## Acceptance criteria
1) dsh-session-doctor 目录为 git 仓库且结构完整（package.json/src/README/LICENSE/test）；2) scan 在真实会话副本上能检出已知 4 个损坏会话的坏 seq（含 sftp_write/sftp_mkdir 字符串 content），对无损坏会话报 OK；3) repair 对副本备份后修复，修复产物按读路径同款校验 0 失败，且除目标事件外内容不变（行数/seq/其余事件哈希不变）；4) 测试套件（node --test 或等价）全绿；5) PLAN.md 存在且覆盖 P0/P1/P2 清单与插件化边界。

## Failure modes
1) 扫描到未知损坏形态（非字符串 content 类）：scan 报告但不自动修复，repair 跳过并明确报错；2) 会话文件正被 live 写入：scan/repair 需能处理并发读（读取时快照），repair 先校验再改，避免与 writer 竞争；3) 备份失败：repair 中止且不改原文件；4) 重写 zstd 帧时校验和/帧边界错误：repair 中止，原文件保持不变（先写临时文件后替换或先备份）；5) 无会话目录/权限不足：scan 报空/权限错误而非崩溃。

## Priorities
正确性优先于功能广度：repair 的无损性（备份 + 帧级校验 + 可回滚）高于覆盖更多损坏类型；v1 只做 scan+repair，watch/audit-tools 可后续加；代码可读性与开源友好（README/许可证）与功能同等重要。

## Non-goals
用户明确不做：不改 dsh 内核代码（P0 仅文档化）；不装进当前 web profile；现在不 push GitHub；不做 watch/audit-tools 的 v1 实现；不修改任何真实会话数据（验收只用副本）。

## 验收记录 (2026-09-02)
- 单元测试 10/10 绿（node --test）
- 真实副本验收 3/3：890ef838@115441、1ea23697@43861、49e6040e@326814 scan 精确检出，repair 后 0 失败
- 干净会话副本（e55beedf 修复后）scan OK：59589 lines / 0 findings
- 对抗审查探针（890ef838 副本）：scan findings 含 line/seq/type/reason/tool=sftp_mkdir；
  repair 后 lines/events 不变（7978/7977）；re-repair 幂等 no-op（不重复备份）

### 审查确认的边界（如实记录）
- AC2 文字"已知 4 个损坏会话"指 2026-09-02 首次扫描状态（含当时已损坏的 e55beedf）；
  验收时 e55beedf 已修复转作"干净会话报 OK"对照，故真实损坏副本为 3 个 + 1 个干净对照，
  覆盖 AC2 的两种情形（检出损坏 / 干净 OK）。
- Failure-mode 2（live 写入并发）：v1 的 scan/repair 面向**冷会话**修复，无显式锁/写者检测；
  repair 采用"备份 → 临时文件 → rename 替换"，若与活跃 writer 并发可能丢尾部。
  已在 README 标注为冷会话工具；live 场景的 watch/哨兵属 P1-3 后续项。
