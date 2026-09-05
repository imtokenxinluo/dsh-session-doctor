// Local logic-level validation for P0-1 (write-path guard) before authoring the
// upstream PR diff. Mirrors the exact createSuccessResult fragment:
//
//   rendered = tool.output.render(...)
//   content  = snapshotProjection(render, rendered)   // no guard today
//
// and asserts that WITH the guard a bare-string render result is wrapped into
// [{ type: 'text', text }] (so the persisted record can never poison loading),
// while array results pass through untouched.
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── mirror of the proposed guard (as authored for the upstream PR) ──
function snapshotProjection(toolName, projector, candidate) {
  return candidate // upstream: snapshotJsonValue + lossless checks
}

function normalizeRenderedContent(toolName, rendered) {
  if (Array.isArray(rendered)) return rendered
  const text = typeof rendered === 'string' ? rendered : JSON.stringify(rendered)
  return [{ type: 'text', text }]
}

function createSuccessContent(renderResult, { guarded = true } = {}) {
  const rendered = renderResult
  const content = snapshotProjection('tool', 'render', rendered)
  if (!guarded) return content
  return normalizeRenderedContent('tool', content)
}

test('RED-case (today, no guard): bare-string render result passes through raw', () => {
  const content = createSuccessContent('Wrote 42 bytes to /tmp/x', { guarded: false })
  assert.equal(typeof content, 'string')
  assert.equal(content, 'Wrote 42 bytes to /tmp/x')
})

test('GREEN-case (with guard): bare string is wrapped into a text block', () => {
  const content = createSuccessContent('Wrote 42 bytes to /tmp/x', { guarded: true })
  assert.ok(Array.isArray(content))
  assert.equal(content.length, 1)
  assert.equal(content[0].type, 'text')
  assert.equal(content[0].text, 'Wrote 42 bytes to /tmp/x')
})

test('guard leaves a correct ContentBlock[] untouched', () => {
  const good = [{ type: 'text', text: 'ok' }]
  const content = createSuccessContent(good, { guarded: true })
  assert.equal(content, good) // same reference, no rewrite
})

test('guard wraps non-array non-string JSON via stringify (defensive)', () => {
  const content = createSuccessContent({ bytes: 42 }, { guarded: true })
  assert.ok(Array.isArray(content))
  assert.equal(content[0].type, 'text')
  assert.equal(content[0].text, '{"bytes":42}')
})
