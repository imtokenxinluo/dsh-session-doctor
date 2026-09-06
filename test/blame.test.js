// blame.test.js — accident attribution: did an agent tool call kill the process?
// Spec: dual evidence (dangerous call + immediate interruption) => agent-caused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { blameSessionFile, blameSessionRoot } from "../src/blame.js";
import { buildSessionLog, toolCall, toolResult, userMessage, stepStart, shellCall, interruptedToolResult, turnEnd } from "./helpers.mjs";
import { frame } from "./helpers.mjs";
import { constants } from "node:zlib";

async function withDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-doctor-blame-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function writeSession(dir, name, events, id = `session-${name}`) {
  const d = path.join(dir, name);
  mkdirSync(d, { recursive: true });
  const file = path.join(d, "session.jsonl.zstd");
  writeFileSync(file, buildSessionLog({ id, events }));
  return file;
}

test("blame: clean session with no interruption -> no accident, no suspect", async () => {
  await withDir(async (dir) => {
    const file = writeSession(dir, "clean", [
      stepStart({ seq: 0 }),
      userMessage({ seq: 1 }),
      toolCall({ seq: 2, callId: "c1", name: "demo" }),
      toolResult({ seq: 3, callId: "c1", content: [{ type: "text", text: "ok" }] }),
      turnEnd({ seq: 4, reasonKind: "completed" })
    ]);
    const r = await blameSessionFile(file);
    assert.equal(r.ok, true, JSON.stringify(r.error ?? r));
    assert.equal(r.accident, false);
    assert.equal(r.suspect, null);
    assert.equal(r.interruptions.length, 0);
    assert.equal(r.verdict, "no-accident");
  });
});

test("blame: dangerous kill command + immediate interruption -> agent-caused", async () => {
  await withDir(async (dir) => {
    const file = writeSession(dir, "suicide", [
      stepStart({ seq: 0 }),
      userMessage({ seq: 1 }),
      shellCall({ seq: 2, callId: "kill1", name: "pwsh", command: `$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'dsh' }; foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Process node.exe` }),
      interruptedToolResult({ seq: 3, callId: "kill1" }),
      turnEnd({ seq: 4, reasonKind: "interrupted" })
    ]);
    const r = await blameSessionFile(file);
    assert.equal(r.ok, true, JSON.stringify(r.error ?? r));
    assert.equal(r.accident, true);
    assert.ok(r.suspect, "expected a suspect call");
    assert.equal(r.suspect.callId, "kill1");
    assert.equal(r.suspect.name, "pwsh");
    assert.match(r.suspect.command, /Stop-Process/);
    assert.ok(r.suspect.patterns.some((p) => p.category === "kill-process"), `patterns: ${JSON.stringify(r.suspect.patterns)}`);
    assert.ok(r.interruptions.length >= 1, "at least one interruption marker expected");
  });
});

test("blame: dangerous browser-close command + interruption -> agent-caused (browser category)", async () => {
  await withDir(async (dir) => {
    const file = writeSession(dir, "browser", [
      stepStart({ seq: 0 }),
      userMessage({ seq: 1 }),
      shellCall({ seq: 2, callId: "bc1", name: "pwsh", command: "agent-browser close --all 2>$null; \"done\"" }),
      interruptedToolResult({ seq: 3, callId: "bc1" }),
      turnEnd({ seq: 4, reasonKind: "interrupted" })
    ]);
    const r = await blameSessionFile(file);
    assert.equal(r.accident, true);
    assert.ok(r.suspect.patterns.some((p) => p.category === "browser-close"), JSON.stringify(r.suspect.patterns));
  });
});

test("blame: dangerous command but NO interruption -> NOT agent-caused (single evidence insufficient)", async () => {
  await withDir(async (dir) => {
    const file = writeSession(dir, "nointerrupt", [
      stepStart({ seq: 0 }),
      userMessage({ seq: 1 }),
      shellCall({ seq: 2, callId: "k2", name: "pwsh", command: "Get-Process chrome | Stop-Process" }),
      toolResult({ seq: 3, callId: "k2", content: [{ type: "text", text: "done" }] }),
      turnEnd({ seq: 4, reasonKind: "completed" })
    ]);
    const r = await blameSessionFile(file);
    assert.equal(r.accident, false, "dangerous call without interruption must not be an accident");
    assert.equal(r.suspect, null);
  });
});

test("blame: interruption but NO dangerous call before it -> not agent-caused (labels external)", async () => {
  await withDir(async (dir) => {
    const file = writeSession(dir, "external", [
      stepStart({ seq: 0 }),
      userMessage({ seq: 1 }),
      toolCall({ seq: 2, callId: "c2", name: "demo" }),
      toolResult({ seq: 3, callId: "c2", content: [{ type: "text", text: "ok" }] }),
      turnEnd({ seq: 4, reasonKind: "interrupted" })
    ]);
    const r = await blameSessionFile(file);
    assert.equal(r.accident, false);
    assert.equal(r.suspect, null);
    assert.equal(r.interruptions.length, 1);
    assert.equal(r.interruptionVerdict, "external");
  });
});

test("blame: interruption right after a benign tool -> external, no accusation of the benign tool", async () => {
  await withDir(async (dir) => {
    const file = writeSession(dir, "benign", [
      stepStart({ seq: 0 }),
      userMessage({ seq: 1 }),
      toolCall({ seq: 2, callId: "c3", name: "read" }),
      toolResult({ seq: 3, callId: "c3", content: [{ type: "text", text: "file contents" }] }),
      turnEnd({ seq: 4, reasonKind: "interrupted" })
    ]);
    const r = await blameSessionFile(file);
    assert.equal(r.accident, false);
    assert.equal(r.suspect, null);
  });
});

test("blame: log ending in a torn frame reports the truncation explicitly", async () => {
  await withDir(async (dir) => {
    const d = path.join(dir, "torn");
    mkdirSync(d, { recursive: true });
    const file = path.join(d, "session.jsonl.zstd");
    // complete frames then a truncated (torn) final frame = process died mid-write
    const full = buildSessionLog({
      id: "session-torn",
      events: [
        stepStart({ seq: 0 }),
        userMessage({ seq: 1 }),
        shellCall({ seq: 2, callId: "c4", name: "pwsh", command: "Stop-Process -Id 123 -Force" }),
        interruptedToolResult({ seq: 3, callId: "c4" })
      ]
    });
    const torn = frame(JSON.stringify(turnEnd({ seq: 4, reasonKind: "interrupted" }))).subarray(0, 12); // cut mid-frame
    const buf = Buffer.concat([full, torn]);
    writeFileSync(file, buf);
    const r = await blameSessionFile(file);
    assert.equal(r.ok, true, JSON.stringify(r.error ?? r));
    assert.equal(r.tornTail, true, "should flag the torn tail");
    assert.equal(r.accident, true, "the complete frames still show the kill call + interruption");
  });
});

test("blame: root scan reports each session's accident state", async () => {
  await withDir(async (dir) => {
    writeSession(dir, "a-suicide", [
      stepStart({ seq: 0 }),
      userMessage({ seq: 1 }),
      shellCall({ seq: 2, callId: "ka", name: "pwsh", command: "taskkill /IM node.exe /F" }),
      interruptedToolResult({ seq: 3, callId: "ka" }),
      turnEnd({ seq: 4, reasonKind: "interrupted" })
    ]);
    writeSession(dir, "b-clean", [
      stepStart({ seq: 0 }),
      userMessage({ seq: 1 }),
      toolCall({ seq: 2, callId: "cb", name: "demo" }),
      toolResult({ seq: 3, callId: "cb", content: [{ type: "text", text: "ok" }] }),
      turnEnd({ seq: 4, reasonKind: "completed" })
    ]);
    const rr = await blameSessionRoot(dir);
    // two sessions under dir: one accident, one clean
    const byId = {};
    for (const r of rr.reports) {
      byId[path.basename(path.dirname(r.file))] = r;
    }
    assert.equal(rr.reports.length, 2, JSON.stringify(rr.reports.map((x) => x.file)));
    assert.equal(byId["a-suicide"].accident, true, JSON.stringify(byId["a-suicide"]));
    assert.equal(byId["b-clean"].accident, false, JSON.stringify(byId["b-clean"]));
  });
});
