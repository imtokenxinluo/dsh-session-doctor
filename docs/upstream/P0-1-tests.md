// P0-1 companion test — add to packages/core/tools/tests/tools.spec.ts
//
// Registers a tool whose output.render violates the ContentBlock[] contract
// (returns a bare string), dispatches it through the real runtime, and asserts
// the durable result content is normalized to [{ type: 'text', text }] — i.e.
// a bad render can never poison a session log with a non-array block content.
//
// (Authored as a diff for the upstream PR; runs under the repo's vitest setup
// with the full ToolRuntime + AgentLoop ctx, not in this workspace.)

import { defineTool, ToolCallId } from '@deepseek-ai/dsh-tools'
// reuse the existing helpers in tools.spec.ts: setup(), fakeAgent(), testToolSignal

it('P0-1: wraps a bare-string output.render into a text block (write-path guard)', async () => {
  const ctx = await setup()
  ctx.tools.register(defineTool({
    name: 'sftp_write_standin',
    description: 'render contract violator (like dsh-ssh-ops sftp_*)',
    parameters: { path: { type: 'string' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' }, bytes: { type: 'number' } },
      },
      // BUG reproduction: returns a bare string, not ContentBlock[]
      render: (_args, value) => `Wrote ${value.bytes} bytes to ${value.path}`,
    },
    async execute(args) {
      return { path: args.path, bytes: 42 }
    },
  }))

  const result = await ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId('c1'),
    name: 'sftp_write_standin',
    arguments: { path: '/tmp/x' },
    agent: fakeAgent(),
  })

  expect(result.isError).toBe(false)
  // Before P0-1 this was the bare string; after P0-1 it is a text block.
  expect(Array.isArray(result.content)).toBe(true)
  expect(result.content[0]).toMatchObject({ type: 'text' })
  expect((result.content[0] as { text?: string }).text).toBe('Wrote 42 bytes to /tmp/x')
})

it('P0-1 regression: a compliant render is untouched', async () => {
  const ctx = await setup()
  ctx.tools.register(echoTool) // echoTool.render returns [{ type: 'text', text }]
  const result = await ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId('c2'),
    name: 'echo',
    arguments: { text: 'hi' },
    agent: fakeAgent(),
  })
  expect(result.content).toEqual([{ type: 'text', text: 'hi' }])
})
