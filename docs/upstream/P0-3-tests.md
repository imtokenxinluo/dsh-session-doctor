// P0-3 companion test — add to packages/core/session/tests/*.spec.ts
//
// Asserts append-time fail-fast: a malformed tool/result (block content not a
// ContentBlock[]) throws synchronously at append and never enters the log,
// while a well-formed message still appends. Runs under the repo's vitest
// setup with a real Session (same harness the loader uses at the seed
// boundary).

import { Session, SessionId } from '@deepseek-ai/dsh-session'

function makeSession() {
  return Session.create(SessionId('p0-3-test-session'))
}

it('P0-3: append rejects a tool/result whose block content is a bare string', () => {
  const session = makeSession()
  const bad = {
    turn: 1,
    step: 1,
    message: {
      source: { kind: 'tool', callId: 'c1' },
      content: [{
        type: 'tool-result',
        toolCallId: 'c1',
        content: 'Wrote 42 bytes to /tmp/x', // string, not ContentBlock[]
      }],
      role: 'user',
      id: 'msg-1',
    },
  }
  expect(() => session.append('tool/result', bad as never, { surfaceOp: 'append' }))
    .toThrow(/must contain one tool-result block/)
  expect(session.events.length).toBe(0) // nothing durably committed
})

it('P0-3 regression: a well-formed tool/result still appends', () => {
  const session = makeSession()
  const good = {
    turn: 1,
    step: 1,
    message: {
      source: { kind: 'tool', callId: 'c1' },
      content: [{
        type: 'tool-result',
        toolCallId: 'c1',
        content: [{ type: 'text', text: 'ok' }],
      }],
      role: 'user',
      id: 'msg-1',
    },
  }
  session.append('tool/result', good as never, { surfaceOp: 'append' })
  expect(session.events.length).toBe(1)
})
