P0-3: enforce message shape at append time (fail-fast, optional hardening)
================================================================================

Status
------
Type:      hardening (fail-fast), optional — depends on P0-1 landing first
Affects:   @deepseek-ai/dsh-session
Package:   packages/core/session
File:      packages/core/session/src/index.ts
Base:      master @ 76fda729799fe9b3848dbe2c211d4b231032b81e

Problem
-------
Message-shape invariants (`assertMessageEventShape`) are enforced ONLY on the
load/seed boundary. The write path (`Session.append`) validates
JSON-serializability and surface metadata but never the message shape, so a
malformed `tool/result` (e.g. block content not a `ContentBlock[]`) is
durably committed and only surfaces as `SessionPersistenceCorruptionError` on
the NEXT load — taking the whole session history down with it.

P0-1 (dsh-tools) prevents NEW bad records from plugins whose `render` violates
the contract. P0-3 closes the loop at the session boundary: any producer that
appends a shape-invalid message fails AT THE APPEND SITE, before the event
enters the durable log.

Fix
---
Call the same `assertMessageEventShape` used by the loader, inside
`Session.append`, immediately before `this.surfaceManager.validateNext(...)`.
Only message-bearing event types are checked (the function itself early-returns
for other types), so the hot path for markers/chunks is unaffected.

```diff
--- a/packages/core/session/src/index.ts
+++ b/packages/core/session/src/index.ts
@@ Session.append, before `this.surfaceManager.validateNext(event as SessionEvent)`
     const event = deepFreeze({ ... }) as unknown as SessionEvent<T>
+    // P0-3 write-path fail-fast: enforce the same message-shape invariants the
+    // loader enforces at the seed boundary, so a malformed message can never be
+    // durably committed. It used to fail only on the NEXT load, making the
+    // whole session history unloadable. assertMessageEventShape early-returns
+    // for non-message types, so markers/chunks take no extra path.
+    assertMessageEventShape(event as unknown as Record<string, unknown>,
+      `session append at seq ${event.seq}`)
     this.surfaceManager.validateNext(event as SessionEvent)
```

Notes for reviewers
-------------------
- `assertMessageEventShape` is module-scoped in this same file and already used
  by `adoptSessionEvent` — no import needed, no duplication.
- Only the three message types are shape-checked (`user/message`,
  `assistant/message`, `tool/result`); everything else returns immediately.
- Interaction with P0-1: after P0-1 lands, well-behaved plugins produce valid
  records; this change turns any remaining producer bug into a loud
  write-time error instead of a silent log poison.

Risk / trade-off
----------------
- Strictness: a still-broken third-party plugin would now see its calls throw
  at write time instead of writing a bad record. That is the intended
  fail-fast contract, but it IS a behavior change for broken plugins — hence
  "optional" and recommended to ship AFTER P0-1 (which fixes the known
  offenders by normalization).
- Performance: one extra function call per append of a message event; the
  check is O(1) (first content block only), negligible.

Tests
-----
Add to `packages/core/session/tests/…spec.ts`:
- appending a `tool/result` whose block content is a bare string → assert
  `append` throws synchronously and the log length is unchanged.
- appending a well-formed `tool/result` → succeeds (regression).
