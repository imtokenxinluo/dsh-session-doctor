# dsh-hardening/upstream — P0 内核补丁上游提交材料

> 目标仓库：`github.com/deepseek-ai/deepseek-harness`（monorepo）
> 基线：`master @ 76fda729799fe9b3848dbe2c211d4b231032b81e`（2026-09 抓取）
> 源文件均从上游 raw 下载，diff 已用 `git apply --check` 验证可应用。

## 文件清单

| 文件 | 内容 |
|---|---|
| `P0-1-PR.md` | PR 描述：写路径守卫（render 非数组→text block 规范化 + 告警） |
| `P0-1.diff` | 对 `packages/core/tools/src/index.ts` 的可应用 diff（✓ apply --check） |
| `P0-1-tests.md` | 上游 vitest 风格测试（register 违约工具 → 断言 content 被包裹） |
| `P0-3-PR.md` | PR 描述：append 时强制执行消息形状（fail-fast，可选强化） |
| `P0-3.diff` | 对 `packages/core/session/src/index.ts` 的可应用 diff（✓ apply --check） |
| `P0-3-tests.md` | 上游 vitest 风格测试（坏 tool/result append 抛错、好记录正常） |
| `p0-1-guard.logic.test.mjs` | 本地逻辑验证（4/4 绿，含"无守卫时字符串穿过"RED 对照） |

## 提交建议顺序

1. **先 P0-1**（写路径守卫，治本且无破坏性：坏插件被宽容规范化而非报错）
2. **后 P0-3**（append fail-fast，可选；依赖 P0-1 先落地以修复已知违规者，
   否则仍在违规的第三方插件会在写路径当场抛错）

## 应用方法（维护者）

```bash
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness
cd deepseek-harness
git apply ../P0-1.diff    # 或按 P0-1-tests.md 补测试后提交
git apply ../P0-3.diff
pnpm test                # 仓库内跑全套 vitest
```

## 为什么值得提交（问题简述）

DSH 把工具 `output.render()` 的返回值原样写入会话日志且从不校验形状；
形状契约只在**加载**时执行，一次违规（如插件返回裸字符串）就使**整条会话历史
不可加载**（`SessionPersistenceCorruptionError`）。P0-1 在所有工具成功结果
的收口处规范化，P0-3 在会话 append 处 fail-fast——两者合起来让坏记录
**进不了日志**，从根上消除 2026-09 的 sftp_write 类事故。

## 本地逻辑验证（不依赖上游依赖，随时可跑）

```bash
node --test dsh-hardening/upstream/p0-1-guard.logic.test.mjs
# 4/4 pass（含 RED 对照：无守卫时字符串确实穿过）
```
