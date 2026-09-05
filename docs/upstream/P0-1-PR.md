P0-1: guard the tool write path — normalize non-ContentBlock[] render output
================================================================================

Status
------
Type:      bug fix (write-path hardening)
Affects:   @deepseek-ai/dsh-tools
Package:   packages/core/tools
File:      packages/core/tools/src/index.ts
Base:      master @ 76fda729799fe9b3848dbe2c211d4b231032b81e

Problem
-------
`ToolOutputDefinition.render` is typed `render(args, value): ContentBlock[]`,
and that type is enforced nowhere at runtime. `createSuccessResult` snapshots
whatever `render` returns straight into the durable tool/result message:

    const content = snapshotProjection(tool.name, 'render', rendered)

A plugin whose `render` returns a bare string (a contract violation) therefore
persists a tool/result whose block `content` is a string. The session loader
(`dsh-session`'s `assertMessageEventShape`) requires `ContentBlock[]` there,
so the FIRST such record makes the WHOLE session history unloadable
(`SessionPersistenceCorruptionError`) — discovered only on the next load, not
at write time.

Real-world trigger (2026-09): the `dsh-ssh-ops` plugin's `sftp_*`/`tunnel_*`
tools returned bare strings from `output.render`, corrupting multiple sessions
("history unavailable … must contain one tool-result block").

Fix
---
Normalize the render projection at the single choke point every successful
tool result passes through (`createSuccessResult`): if the projected value is
not a `ContentBlock[]`, wrap it as a text block (bare string verbatim; any
other JSON value stringified). Log a warning naming the offending tool so
plugin authors hear about the violation, while the persisted record stays
valid forever after.

Why wrap instead of throw: throwing at write time would make every call of a
still-broken third-party plugin fail loudly for users; wrapping keeps the
plugin working AND keeps session logs loadable. Strict rejection remains an
option for later (see P0-3).

Why here: `createSuccessResult` is the single funnel for successful tool
outputs (native dispatch, around-dispatch wrappers, post-execute value
replacement all converge on it). One guard protects every tool, present and
future.

Diff
----
```diff
--- a/packages/core/tools/src/index.ts
+++ b/packages/core/tools/src/index.ts
@@ createSuccessResult, after `const content = snapshotProjection(...)`
-    const content = snapshotProjection(tool.name, 'render', rendered)
+    const projected = snapshotProjection(tool.name, 'render', rendered)
+    // Write-path guard: render() is typed ContentBlock[] but nothing enforces
+    // that at runtime. A contract-violating plugin (e.g. render returning a
+    // bare string) would otherwise persist a tool/result whose block content
+    // is not an array — which the session loader rejects on the NEXT load,
+    // making the whole session history unloadable. Normalize here so a bad
+    // render can never poison the log; warn so the plugin author hears.
+    const content = normalizeRenderedContent(tool.name, projected)
```

plus one module-level helper:
```ts
/**
 * Coerce one tool render projection to a valid ContentBlock[] before it is
 * durably recorded. Array results pass through untouched; a bare string is
 * wrapped as a text block verbatim; any other JSON value is stringified.
 * @returns a ContentBlock[] that can never fail loader shape validation.
 */
function normalizeRenderedContent(toolName: string, rendered: JsonValue): ContentBlock[] {
  if (Array.isArray(rendered)) return rendered as ContentBlock[]
  const text = typeof rendered === 'string' ? rendered : JSON.stringify(rendered)
  // eslint-disable-next-line no-console -- surfaced through the runtime logger where available
  console.warn(`tool "${toolName}" output.render() returned non-ContentBlock[] (${typeof rendered}); wrapping as a text block. Fix the plugin's output.render to return ContentBlock[].`)
  return [{ type: 'text', text }]
}
```

Note for reviewers: `createSuccessResult` lives on the runtime class that has
`this.ctx.logger`; if the maintainers prefer the structured logger over
`console.warn`, thread `this.ctx.logger.warn(...)` through — the snippet keeps
a dependency-free helper for testability. (The dsh-session-doctor local patch
used `this.ctx.logger.warn`; both are acceptable.)

Rationale / alternatives
-----------------------
- Alternative A (strict): throw `ToolOutputError` on non-array render. Rejected
  for this change because it turns every existing broken plugin call into a
  hard user-visible failure; normalization is the safe middle ground. A strict
  mode can layer on later behind a config flag.
- Scope: only `tool/result` content is normalized here; other message types are
  out of scope (see companion P0-3 for append-time enforcement).

Tests
-----
See `tests/tools.spec.ts` addition (PR test diff): register a tool whose
`output.render` returns a bare string, dispatch it, and assert the recorded
tool/result block content equals `[{ type: 'text', text: '<string>' }]` and the
session log passes loader-mirror validation.

Companion change
----------------
P0-3 (append-time shape enforcement) is prepared separately in this repo's
dsh-hardening material; this change alone already prevents new corrupt writes.
