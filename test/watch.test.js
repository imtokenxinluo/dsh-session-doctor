// watch: live sentinel — validate session/event messages as they are written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionWatcher } from "../src/watch.js";
import { toolResult, toolCall, userMessage, stepStart } from "./helpers.mjs";

function watcher(handlers = {}) {
  return createSessionWatcher({ onViolation: handlers.onViolation });
}

test("watch passes a well-formed tool/result (no violation)", () => {
  const w = watcher();
  const sess = { id: "session-a" };
  w.remember(sess, toolCall({ seq: 2, callId: "c1", name: "demo_tool" }));
  const violation = w.check(sess, toolResult({ seq: 3, callId: "c1", content: [{ type: "text", text: "ok" }] }));
  assert.equal(violation, null);
});

test("watch flags a string-content tool/result with seq/reason/tool", () => {
  const w = watcher();
  const sess = { id: "session-a" };
  w.remember(sess, toolCall({ seq: 2, callId: "cs", name: "sftp_write" }));
  const violation = w.check(sess, toolResult({ seq: 3, callId: "cs", content: "Wrote 42 bytes to /tmp/x" }));
  assert.ok(violation, "expected a violation");
  assert.equal(violation.seq, 3);
  assert.equal(violation.type, "tool/result");
  assert.match(violation.reason, /content/);
  assert.equal(violation.tool, "sftp_write");
});

test("watch resolves tool name via the tool/call cache", () => {
  const w = watcher();
  const sess = { id: "session-b" };
  w.remember(sess, toolCall({ seq: 10, callId: "cx", name: "sftp_mkdir" }));
  const v = w.check(sess, toolResult({ seq: 11, callId: "cx", content: "Created dir /x" }));
  assert.equal(v.tool, "sftp_mkdir");
});

test("watch still reports when the callId has no prior tool/call (tool undefined)", () => {
  const w = watcher();
  const v = w.check({ id: "session-c" }, toolResult({ seq: 5, callId: "ghost", content: "bad" }));
  assert.ok(v);
  assert.equal(v.tool, undefined);
});

test("watch ignores non-message events and clean user messages", () => {
  const w = watcher();
  const sess = { id: "session-d" };
  assert.equal(w.check(sess, stepStart({ seq: 0 })), null);
  assert.equal(w.check(sess, userMessage({ seq: 1 })), null);
});

test("watch invokes onViolation once per bad event", () => {
  const seen = [];
  const w = watcher({ onViolation: (s, v) => seen.push([s.id, v.seq]) });
  const sess = { id: "session-e" };
  w.remember(sess, toolCall({ seq: 2, callId: "c", name: "sftp_write" }));
  w.check(sess, toolResult({ seq: 3, callId: "c", content: "bad" }));
  w.check(sess, toolResult({ seq: 4, callId: "c", content: [{ type: "text", text: "fine" }] }));
  assert.deepEqual(seen, [["session-e", 3]]);
});

test("watch plugin shell wires ctx.on('session/event') and logs violations", async () => {
  // fake cordis ctx: records handlers per event name, exposes logger + sessions.list
  const handlers = new Map();
  const warnings = [];
  const fakeCtx = {
    on(name, cb) { handlers.set(name, cb); },
    logger: { warn: (m) => warnings.push(String(m)) },
    sessions: { list: () => [] }
  };
  const { default: plugin } = await import("../src/plugin.js");
  const instance = typeof plugin === "function" ? plugin(fakeCtx) : plugin;
  const apply = instance?.apply ?? instance;
  if (typeof apply === "function") await apply(fakeCtx);

  assert.ok(handlers.has("session/event"), "plugin must subscribe session/event");
  const sess = { id: "session-p", header: { id: "session-p" } };
  const evBad = toolResult({ seq: 3, callId: "c", content: "bad" });
  // feed tool/call first so the cache can resolve a name, then the bad result
  const cbEvent = handlers.get("session/event");
  cbEvent(sess, toolCall({ seq: 2, callId: "c", name: "sftp_write" }));
  cbEvent(sess, evBad);
  assert.ok(warnings.length >= 1, "plugin must warn on violation");
  assert.match(warnings[0], /sftp_write/);
});
