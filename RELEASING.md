# 发布纪律

版本号是给**用户**看的，不是给自己的进度条。
按下面五条来，避免用"有新版本"去打扰已经装好的人 —— 他们没有自动更新，
每次看到新版本都得手动装一次。

## 1. 文档不发版

README / 注释 / 示例 / 内部重构 → **只进 git，不发 npm**。

npm 页面上的 README 旧一点没有危害；为一条文档让所有老用户重装是净损失。
（GitHub 页面在 push 后立即更新，对"从列表点进来"的新用户已经够了。）

## 2. 批量发

攒够"用户能感知"的改动再发，**间隔至少 2~4 周**。
开发中的提交可以随时进 git —— 不发布不等于不交付。

## 3. 只有三类例外可以立刻发

| 类别 | 判断 |
|---|---|
| **崩溃** | 插件导致面板/会话不可用 |
| **数据损坏** | 写坏会话日志、写坏注册表 |
| **加载失败** | DSH 拒绝装载，或重装后改动不生效 |

## 4. CHANGELOG 写清"影响谁"

每条标注：

- **必更** —— 遇到这个问题的用户
- **可跳** —— 没遇到的用户，不更新也不会出事

让老用户能自己判断，而不是看到版本号就焦虑。

## 5. 尽量不破坏兼容

peer 范围写宽（如 `^0.1.0-rc.6 || ^0.2.0-rc.6`），让 DSH 小版本升级不至于
逼所有人重装。历史上最大的噪音源就是"内核一升级，全员被迫升级插件"。

---

## 发布前检查清单（本仓库）

``bash
cd D:\tool\claude_code\dsh-session-doctor

# 1) 测试
npm test              # node --test

# 2) 构建
npm run build         # 重建 lib/client.js（首行写源码指纹）

# 3) 附加校验
node scripts\verify-real.mjs   # 真机校验

# 4) 打包完整性
npx dsh-contract-check package .    # 检查 files 白名单是否会漏发运行文件

# 5) 身份（必须看到自己的账号）
npm whoami --registry=https://registry.npmjs.org

# 6) 发布
npm publish --registry=https://registry.npmjs.org --access public
``

## 发布后

- 升级本地 profile（**必须带官方源参数** —— 默认 registry 是镜像，会滞后几分钟）：
  pnpm add dsh-session-doctor@<version> --registry=https://registry.npmjs.org
- **重启 DSH** 才生效
- 可选：给该版本打 git tag