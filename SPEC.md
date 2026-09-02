# dsh-session-doctor — 需求契约 (doublecheck spec, 2026-09-02)

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
