// 构建客户端产物：src/client.js → lib/client.js（DSH 的 ModuleLoader 格式）。
//
// ⚠️ 两条实机踩出来的经验（都写进代码了，别删）：
//   ① `react` 必须保持 external（由宿主 ModuleLoader 提供）。打进来会与宿主 React 双实例。
//   ② **受限沙箱下 esbuild 跑不了**：它的 JS 包装层要用**管道 stdio** 起原生子进程，
//      直接 `spawn EPERM`。这里**刻意不去升级沙箱权限绕过**（那是用户自己设的边界），
//      而是内置一条**不 spawn 任何东西**的兜底打包器 —— 只支持本客户端实际具有的形态
//      （唯一 import 是 react、无 JSX），长出别的形态会**明确拒绝**，绝不产出坏产物。
//
// 产物首行盖**源码指纹**：改了 src/client.js 忘重新构建时，测试能立刻发现。
//
// 用法：node scripts/build-client.mjs
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const PLUGIN_ID = 'dsh-session-doctor'
const ENTRY = join(PKG, 'src', 'client.js')

/** 依次尝试这些位置解析 esbuild（都没有就走兜底，不联网安装）。 */
const ESBUILD_BASES = [
  PKG + '/',
  'D:/tool/claude_code/dsh-stock-picks/',
  'D:/tool/claude_code/dsh-tip-jar/',
  process.cwd() + '/',
]

function loadEsbuild() {
  for (const base of ESBUILD_BASES) {
    try {
      const req = createRequire(base.endsWith('/') ? base : base + '/')
      const mod = req('esbuild')
      if (mod && typeof mod.build === 'function') return { mod, base }
    } catch { /* 换下一个 */ }
  }
  return null
}

/**
 * 兜底打包器：**不 spawn 任何子进程**。
 * 只处理本文件实际具有的形态：唯一的 import 是 `react`（external）、无 JSX。
 * 一旦源码长出别的 import 或 JSX，**明确拒绝**而不是悄悄产出坏产物。
 */
function bundleWithoutEsbuild(src) {
  const importRe = /^\s*import\s+(.+?)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm
  const specs = []
  for (const m of src.matchAll(importRe)) specs.push({ clause: m[1], from: m[2] })
  const others = specs.filter((s) => s.from !== 'react')
  if (others.length > 0) {
    throw new Error(`兜底打包器只支持 external react，源码还有：${others.map((s) => s.from).join(', ')}（请在有 esbuild 的环境中构建）`)
  }
  const react = specs.find((s) => s.from === 'react')
  if (!react) throw new Error('兜底打包器要求源码 import react（宿主提供）')
  if (/<[A-Z]/.test(src)) throw new Error('兜底打包器不支持 JSX（请在有 esbuild 的环境中构建）')
  const names = /^\{\s*([^}]*)\s*\}$/.exec(react.clause.trim())
  if (!names) throw new Error(`兜底打包器只支持命名导入，实际是：${react.clause}`)

  const body = src
    .replace(importRe, '')
    .replace(/export\s+default\s+/, 'const __sessionDoctorDefault = ')
  return `const { ${names[1]} } = require("react");\n${body}\n`
}

mkdirSync(join(PKG, 'lib'), { recursive: true })
const tmp = join(PKG, 'lib', '.client.tmp.js')

let bundle
let usingEsbuild = true
const esb = loadEsbuild()
if (esb) {
  try {
    await esb.mod.build({
      entryPoints: [ENTRY],
      outfile: tmp,
      bundle: true,
      format: 'iife',
      globalName: '__sessionDoctorClient',
      platform: 'browser',
      target: 'es2020',
      external: ['react'],
      charset: 'utf8',
      logLevel: 'warning',
    })
    bundle = readFileSync(tmp, 'utf8')
    rmSync(tmp)
    console.log(`打包方式: esbuild（来自 ${esb.base}）`)
  } catch (e) {
    const msg = String((e && e.message) || e)
    if (!/EPERM|spawn/i.test(msg)) throw e
    console.log(`esbuild 不可用（${msg.split('\n')[0]}）→ 改用无 spawn 的兜底打包器`)
    usingEsbuild = false
    bundle = bundleWithoutEsbuild(readFileSync(ENTRY, 'utf8'))
    console.log('打包方式: 兜底（纯 JS，不 spawn）')
  }
} else {
  console.log('找不到 esbuild（本脚本刻意不联网安装）→ 改用无 spawn 的兜底打包器')
  usingEsbuild = false
  bundle = bundleWithoutEsbuild(readFileSync(ENTRY, 'utf8'))
  console.log('打包方式: 兜底（纯 JS，不 spawn）')
}

// ── 自检 ──
const problems = []
if (!/require\(\s*["']react["']\s*\)/.test(bundle)) {
  problems.push('产物里没有 require("react") —— external 可能没生效，react 被打进来了')
}
if (bundle.length > 200 * 1024) {
  problems.push(`产物过大（${(bundle.length / 1024).toFixed(0)} KB > 200 KB）—— 很可能把依赖打进来了`)
}
for (const bad of [/api\.qrserver\.com/, /cdn\.jsdelivr\.net/, /unpkg\.com/]) {
  if (bad.test(bundle)) problems.push(`产物里出现第三方外链 ${bad} —— 客户端不许引第三方资源`)
}
if (problems.length) {
  console.error('构建自检失败：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

const sourceHash = createHash('sha256').update(readFileSync(ENTRY, 'utf8')).digest('hex')
const returnExpr = usingEsbuild
  ? '__sessionDoctorClient.default || __sessionDoctorClient'
  : '__sessionDoctorDefault'

const wrapped =
  '// built-from-src-sha256: ' + sourceHash + '\n' +
  'window.__ModuleLoader__.load({\n' +
  '\tid: "' + PLUGIN_ID + '",\n' +
  '\tfactory: (require) => {\n' +
  bundle +
  '\n\t\treturn ' + returnExpr + ';\n' +
  '\t}\n' +
  '});\n'

writeFileSync(join(PKG, 'lib', 'client.js'), wrapped, 'utf8')
console.log(`✓ 已生成 lib/client.js（${(wrapped.length / 1024).toFixed(1)} KB，react external）`)
console.log(`  源码指纹: ${sourceHash.slice(0, 16)}…`)
