// dsh-session-doctor/src/client.js — 设置页「会话体检」面板。
//
// 这一层只做两件事：**把体检结论摆出来**（GET /session-doctor/report），
// 以及**让用户显式点一次修复**（POST /session-doctor/repair）。
// 它自己不算不修 —— 扫描与改写都在宿主侧，浏览器只呈现与触发。
//
// 写法上有几条是踩过坑后的硬约束：
//   · 内联样式，不依赖样式注入（注入失败会退化成裸 HTML）
//   · 所有列表数据先做 Array.isArray 校验（undefined 会让整个面板崩掉）
//   · slot 注册放在 apply 的最前面，后面任何一句抛错都不该影响它
import { createElement as h, useState, useEffect } from 'react'

const REPORT_URL = '/session-doctor/report'
const REPAIR_URL = '/session-doctor/repair'

const S = {
  root: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px', fontSize: '13px', lineHeight: '1.6', color: 'var(--dsw-alias-label-primary)', overflowY: 'auto', height: '100%' },
  head: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  title: { fontWeight: '600', fontSize: '13px' },
  note: { fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' },
  status: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
  err: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' },
  row: { display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)', padding: '8px 10px' },
  meta: { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '2px' },
  name: { fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sub: { fontFamily: 'ui-monospace,Consolas,monospace', fontSize: '10.5px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  btn: { background: 'none', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', padding: '4px 10px', flex: 'none', color: 'var(--dsw-alias-label-primary)' },
  ok: { fontSize: '12.5px', color: 'var(--dsw-alias-state-success-primary)' },
}

/** 会话 id 从路径里取：<root>/<session-id>/session.jsonl[.zstd] */
function sessionIdOf(file) {
  const parts = String(file || '').split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : String(file || '')
}

function Panel() {
  const [report, setReport] = useState(null)
  const [status, setStatus] = useState('读取中…')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState('')
  const [lastFix, setLastFix] = useState('')

  async function load() {
    setStatus('读取中…')
    setFailed(false)
    try {
      const res = await fetch(REPORT_URL, { cache: 'no-store' })
      const r = await res.json()
      if (r && r.ok) {
        setReport(r)
        setStatus('')
      } else {
        setFailed(true)
        setStatus('读取失败：' + String((r && r.error) || '未知错误'))
      }
    } catch (error) {
      setFailed(true)
      setStatus('读取失败：' + String((error && error.message) || error))
    }
  }

  useEffect(function () { load() }, [])

  async function repair(file) {
    setBusy(file)
    setFailed(false)
    setLastFix('')
    try {
      const res = await fetch(REPAIR_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file }),
      })
      const r = await res.json()
      if (r && r.ok) {
        const n = Array.isArray(r.patchedSeqs) ? r.patchedSeqs.length : 0
        // 修好之后提一次「事前」工具（自愿、可忽略）
        setLastFix('已修复 ' + sessionIdOf(file) + '：patched ' + String(n) + ' 处' + (r.backupPath ? '（备份：' + String(r.backupPath).split(/[\\/]/).pop() + '）' : '') + ' · dsh-contract-check 能在坏之前发现违规插件')
        await load()
      } else {
        setFailed(true)
        setStatus('修复失败：' + String((r && r.error) || '未知错误'))
      }
    } catch (error) {
      setFailed(true)
      setStatus('修复失败：' + String((error && error.message) || error))
    } finally {
      setBusy('')
    }
  }

  const sessions = report && Array.isArray(report.sessions) ? report.sessions : []
  const corrupt = sessions.filter(function (s) { return s && !s.ok && !s.error })
  const errored = sessions.filter(function (s) { return s && s.error })
  const summary = (report && report.summary) || {}

  const head = h('div', { style: S.head },
    h('span', { style: S.title },
      '会话体检（' + String(summary.scanned || 0) + ' 个会话，' + String(corrupt.length) + ' 个损坏）'),
    h('button', { style: S.btn, disabled: busy !== '', onClick: load }, '重新扫描'))

  const banner = h('div', { style: S.note },
    '扫描用的是 DSH 加载路径同款规则（loader-mirror）：任何一条事件违反约束，整个会话就会拒绝加载。' +
    '只有「可无损修复」的那一族（tool-result 的 content 不是数组）能一键修；其余一律只报告，绝不猜测改写。')

  const note = h('div', { style: S.note },
    report && report.root ? '扫描目录：' + String(report.root) : '')

  const rows = corrupt.map(function (s) {
    const id = sessionIdOf(s.file)
    const first = Array.isArray(s.findings) && s.findings.length > 0 ? s.findings[0] : null
    const detail = first
      ? 'line ' + String(first.line) + ' · seq ' + String(first.seq) + ' · ' + String(first.reason || '')
      : '损坏（无细节）'
    const more = Array.isArray(s.findings) && s.findings.length > 1 ? '（另有 ' + String(s.findings.length - 1) + ' 处）' : ''
    return h('div', { key: s.file, style: S.row },
      h('div', { style: S.meta },
        h('div', { style: S.name, title: s.file }, id),
        h('div', { style: S.sub, title: s.file }, detail + more)),
      s.repairable
        ? h('button', {
            style: S.btn,
            disabled: busy !== '',
            onClick: function () { repair(s.file) },
          }, busy === s.file ? '修复中…' : '修复')
        : h('span', { style: S.note }, '仅报告'))
  })

  const errRows = errored.slice(0, 5).map(function (s) {
    return h('div', { key: s.file, style: S.row },
      h('div', { style: S.meta },
        h('div', { style: S.name }, sessionIdOf(s.file)),
        h('div', { style: S.sub }, String(s.error))))
  })

  return h('div', { style: S.root },
    head,
    banner,
    note,
    status ? h('div', { style: failed ? S.err : S.status }, status) : null,
    lastFix ? h('div', { style: S.ok }, lastFix) : null,
    corrupt.length === 0 && !status
      ? h('div', { style: S.ok }, '没有发现会阻断加载的损坏。')
      : null,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, rows),
    errRows.length > 0 ? h('div', { style: S.note }, '以下会话连读取都失败（不是形状问题）：') : null,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, errRows),
    h('div', { style: S.note },
      '每个能修的形态、判定依据、以及「为什么不修」的逐条原因，见仓库里的 docs/DEFECT-CATALOG.md。' +
      '修复前会自动逐文件备份；要一次性修一批，用 CLI 的 safeguard（冷备 → 体检 → 修复 → 回读校验）。'))
}

export default {
  // slot 当硬依赖：拿不到就不激活，而不是静默什么都不做
  inject: ['slots'],
  apply(ctx) {
    const slots = ctx.slots
    if (!slots) return
    slots.inject('settings.section', function () {
      return slots.register(
        { name: 'settings.section', id: 'session-doctor', label: '会话体检', order: 62 },
        function () { return h(Panel, null) },
      )
    })
  },
}
