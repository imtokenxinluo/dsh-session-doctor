# dsh-session-doctor — Delivery Record

> Generated 2026-09-02. Verdict: **green**（证据充分，经对抗审查；独立 per-dimension
> verification 通道在本会话未能执行，见"验证说明"）。

## Spec（契约摘要，完整版见 SPEC.md）

- **Goal**：工作区交付可开源复用的 DSH 会话维护插件 dsh-session-doctor（JS ESM 单仓，
  暂不装 profile、不本地改内核），v1 = scan + repair，真实副本验证。
- **Scope**：`D:\tool\claude_code\dsh-session-doctor\` 独立 git 仓库（package.json /
  src / bin / README / LICENSE / SPEC / test / scripts）；审查文档
  `dsh-hardening\PLAN.md`。不改 dsh 内核、不装 profile、不 push GitHub、不碰真实会话数据。
- **AC**：① git 仓库结构完整；② scan 在真实副本检出已知坏 seq、干净会话报 OK；
  ③ repair 备份 + 修复后 0 失败 + 除目标事件外不变；④ 测试套件全绿；⑤ PLAN.md 覆盖 P0/P1/P2。
- **Failure modes**：未知损坏只报告不修；live 写入并发为冷会话边界（如实标注）；
  备份失败中止；重写失败不落盘；无目录/权限报错不崩溃。
- **Priorities**：repair 无损性 > 覆盖广度；正确性 > 功能广度。
- **Non-goals**：不改内核 / 不装 profile / 不 push / 不做 watch/audit-tools v1 / 不碰真实数据。

## 测试时间线（red → green）

| 阶段 | 证据 |
|---|---|
| red ×8 | 测试先于实现：模块缺失 / fixture 竞态 / 行数断言失败等，均为真实 red 输出 |
| green | `node --test test/scan.test.js test/repair.test.js` → 7/7 pass |
| red | `node --test test/`（Windows 目录参数问题，1 fail）→ 修正为 `npm test` |
| green | `npm test` → **10/10 pass** |
| green | `node scripts/verify-real.mjs` → **3/3**：890ef838@115441、1ea23697@43861、49e6040e@326814 scan 精确检出 → repair → 0 failures |
| green | 干净副本（e55beedf 修复后）scan OK：59589 lines / 0 findings |

## 对抗审查（adversary review，本会话手动执行）

探针脚本 `scripts/review-probe.mjs` 对真实损坏副本（890ef838）：
- scan findings 含完整上下文：`line 7939, seq 115441, type tool/result, tool=sftp_mkdir, reason "…content must be an array (got string)"`
- repair 后 **lines/events 完全不变**（7978/7977）——满足 AC3"除目标事件外内容不变"
- re-repair 幂等 no-op（`changed:false`，不重复备份）

审查发现的诚实边界（已写入 SPEC.md"审查确认的边界"）：
1. AC2 文字"4 个损坏会话"指首次扫描状态；验收时 e55beedf 已修复转作"干净报 OK"对照，
   实际为 3 个真实损坏 + 1 个干净对照，覆盖 AC2 两种情形。
2. Failure-mode 2（live 写入并发）：v1 面向冷会话，无锁/写者检测；repair 用
   备份 + 临时文件 + rename，与活跃 writer 并发可能丢尾部——README 已标注为冷会话工具，
   live 场景属 P1-3 watch 后续项。

## 验证说明（如实）

- `doublecheck_report(verify: true)` 已调用两次，报告均返回 **green**，
  但本会话的 verify 编排通道显示 "Verification: Not run" / "Adversary review: none"——
  独立 per-dimension checker 未真正执行，因此**不得宣称 verified/proven**。
- 交付状态按 green 表述：spec 已记录、red/green 时间线完整、对抗审查已做并记录边界。

## 交付物清单

- `D:\tool\claude_code\dsh-session-doctor\`（git repo，commits `46fb4ed` + `0cd4814`）
  - src/zstd.js / validate.js / scan.js / repair.js / index.js
  - bin/dsh-session-doctor.js（CLI：scan / scan-file / repair [--dry-run]）
  - test/（scan/repair/cli，10 tests）、scripts/verify-real.mjs、scripts/review-probe.mjs
  - README.md / LICENSE(MIT) / SPEC.md
- `D:\tool\claude_code\dsh-hardening\PLAN.md`（审查与补丁清单：P0 内核 / P1 插件 / P2 生态）
