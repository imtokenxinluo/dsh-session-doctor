# 会话损坏形态目录（Defect Catalog）

> 依据：`@deepseek-ai/dsh-session` 的**加载期不变量**（本插件在 `src/validate.js` 中逐条复刻）。
> 目的：让"**什么会让会话打不开、什么能修、为什么不能修**"有据可查。
>
> 版本：0.2.2 ｜ 维护要求：每次 `validateEvent` 变更，本目录必须同步（否则它就变成误导）。

---

## 0. 为什么值得系统梳理

DSH 加载一个会话日志时，**任何一条事件违反约束，整个会话就被拒绝加载** —— 不是跳过那条记录，
而是整段历史"失忆"。所以这些形态的破坏力不是"丢一条消息"，而是"这段会话打不开了"。

对使用者来说，最痛的不是"坏了"，而是"**不知道坏在哪、能不能救、救的时候会不会更糟**"。
这份目录就是回答这三问。

---

## 1. 约束总表

`validateEvent(ev)` 检查的**全部**约束（复刻 loader 的 seed 边界）：

| # | 适用事件 | 约束 | 违反后果 |
|---|---------|------|---------|
| C-01 | 任意行 | 必须是合法 JSON | 该行无法解析 → 会话拒绝加载 |
| C-02 | 首个非空行 | 必须是 `type:"session"` 的 header | header 缺失/错位 |
| C-03 | `request/header` | `header.config` 的 `provider` 与 `model` 均为**非空字符串** | 拒绝加载 |
| C-04 | `request/header` | `config.reasoningEffort` **若存在**，必须是非空字符串 | 拒绝加载 |
| C-05 | `*message` | `message.id` 是非空字符串 | 拒绝加载 |
| C-06 | `*message` | `message.role` 与事件类型匹配（assistant→`assistant`；其余→`user`） | 拒绝加载 |
| C-07 | `*message` | `message.source` 是对象且 `source.kind` 是非空字符串 | 拒绝加载 |
| C-08 | `*message` | `message.content` 是**数组** | 拒绝加载 |
| C-09 | `assistant/message` | `source.kind === "model"` 且带 provider/model | 拒绝加载 |
| C-10 | `tool/result` | `source.kind === "tool"` 且 `source.callId` 是非空字符串 | 拒绝加载 |
| C-11 | `tool/result` | `message.content.length === 1` | 拒绝加载 |
| C-12 | `tool/result` | 首块 `block.type === "tool-result"` | 拒绝加载 |
| **C-13** | `tool/result` | **`block.content` 是数组** | 拒绝加载 —— **唯一可无损修复**（见 §2） |
| C-14 | `tool/result` | `block.toolCallId === source.callId` | 拒绝加载 |

> 非消息类事件（`turn/*`、`step/*`、chunk、compaction、retry 记录等）**不做形状检查** ——
> 真实 loader 在 seed 边界同样不检查它们。所以它们损坏**不会**导致会话打不开。

**关于"约束数 vs 错误信息数"**：上表把约束拆到**最小可判定单元**（14 条），
而 `validate.js` 里只有 **10 条** `return` 错误信息 —— 因为若干约束由**同一条判断合并覆盖**，
最典型的是 C-11 / C-12 / C-13：代码里是一条
`content.length !== 1 || !block || block.type !== "tool-result" || !Array.isArray(block.content)`，
对外只报一句 `tool-result block content must be an array (got …)`。
本目录**故意拆细**：因为"多块""类型不对""不是数组"对使用者是完全不同的故障，
而它们的**可修性也不同**（只有 C-13 可无损修）。

---

## 2. 可修复形态（C-13 的三种违反形状）

共同点：**修复过程不增加也不删除任何一个字符**，因此可以放心自动修。

| 编号 | 形态 | 来源 | 修法 | 证据 |
|------|------|------|------|------|
| **D-01** | `block.content` 是**裸字符串** | ✅ **真实事故**：`dsh-ssh-ops` 的 render-contract bug | 包成 `[{type:"text",text:…}]` | 真实会话 `session-890ef838` 等 3 例，坏 seq `115441` / `43861` / `326814` |
| **D-02** | `block.content` 是 `null` 或**字段缺失** | ⚠️ **防御性扩展**（真实数据中未观察到） | 置为 `[]`（**不编造**文本块） | 仅 fixture 测试 |
| **D-03** | `block.content` 是**单个对象**（非数组） | ⚠️ **防御性扩展**（同上） | 包成 `[obj]`，对象内一字不改 | 仅 fixture 测试 |

**为什么这三种安全**：C-13 只要求"是数组"，而不关心数组里是什么。把一个值**原样**放进数组
（或把"空"表示为空数组）是纯粹的**形状补齐**，不涉及语义判断。

**标注纪律**：D-01 是实测事故形态，D-02/D-03 是**推导出的可能形态**。README 与本表都如实区分 ——
不把"可能"说成"已发生"。

---

## 3. 只报告、不自动修的形态（及原因）

| 约束 | 形态 | 为什么不修 |
|------|------|-----------|
| C-01 | 某行 JSON 解析失败 | 无法安全重建缺失内容（可能丢数据，也可能猜错语义） |
| C-02 | 首行不是 session header | header 承载会话身份与创建信息，无法凭空生成 |
| C-03 / C-09 | 缺 provider/model | 无法推断"当时用的是哪个模型"；猜错会污染历史 |
| C-04 | `reasoningEffort` 为空串 | 理论上可**删除**该字段（约束是"若存在则须有效"），但**未观察到真实样本**，暂不实现 —— 不为假想问题增加写路径 |
| C-05 | 缺 `message.id` | id 是引用锚点，生成新 id 可能破坏下游引用 |
| C-06 | `role` 不匹配 | 可能反映真实语义错误，改它就是**篡改历史** |
| C-07 / C-10 | 缺 `source` / `kind` / `callId` | 无法推断工具来源与调用关系 |
| C-08 | `message.content` 不是数组 | 与 C-13 不同：这里的 content 应为**内容块数组**，但缺失时的正确形状无法确定 |
| C-11 | `tool/result` 的 content 不止一块 | 多块是**非法但信息完整**的状态，如何合并成一块属语义决策，不该由工具替用户决定 |
| C-12 | 首块不是 `tool-result` | 改类型标签等于重写语义 |
| C-14 | `toolCallId` 与 `source.callId` 不一致 | 两个值都可能是"对的"，无法判定哪个可信；覆盖任一方都可能写坏引用链 |

**贯穿原则**：**只有当"补齐后的状态是唯一合理解"时才自动修**。
凡是需要"在两个可能值之间选一个"或"推断本来是什么"的，一律只报告。

---

## 4. 尚未观察到、但理论上存在的形态

诚实声明：以下是**从约束推导**出的可能性，**不在真实数据中出现过**，因此**没有**对应修复：

- C-04 的"空 `reasoningEffort`"（若出现，删除该字段是安全修法）
- C-05/C-06/C-07 的组合缺失（修复需要重建身份信息，超出"无损"范畴）

**发现新形态怎么办**：先加**只报不修**的检测（`validateEvent` 返回 reason），
在真实数据中确认过再考虑修复 —— 顺序不能反。

---

## 5. 如何复现与验证

```bash
# 合成 fixture：scan 检出 / repair 无损 / blame 归因
npm test

# 真实数据验收（不碰真实数据：复制到临时目录再操作）
node scripts/verify-real.mjs
```

真实验收脚本的行为值得说明：那三个已知损坏会话**早已被修复**，所以脚本会**自动回退到
该会话自己修复前的 `.bak`**，再跑完整的 `scan → repair → scan` 链路 ——
否则这份验收会随着"数据被修好"而永久失效。

验收判定：
- `scan` 必须检出**精确的坏 seq**（与 2026-09-02 审计值一致）
- `repair` 之后 `scan` 必须 **0 findings**
- 修复前必写备份，且备份与原文**逐字节相同**

---

## 6. 与内核的关系

本目录描述的约束来自 `@deepseek-ai/dsh-session`。若上游放宽或收紧约束，
本插件的 `validateEvent` 必须同步更新，**本目录也必须同步** ——
一份过期的损坏形态目录比没有更糟（它会让人以为某形态安全）。

相关实现：
- 约束复刻：`src/validate.js`（`validateEvent`）
- 修复实现：`src/repair.js`（`patchToolResultLine`）
- 实时哨兵：`src/watch.js`（live 会话边写边校验，只告警不改文件）
- 事故归因：`src/blame.js`（回答"突然关闭是不是 agent 干的"）
