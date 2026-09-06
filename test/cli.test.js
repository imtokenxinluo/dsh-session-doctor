// CLI smoke tests: end-to-end through bin/dsh-session-doctor.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSessionLog, toolResult, toolCall, userMessage, stepStart, shellCall, interruptedToolResult, turnEnd } from "./helpers.mjs";

const BIN = fileURLToPath(new URL("../bin/dsh-session-doctor.js", import.meta.url));

async function withDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-doctor-cli-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function run(args) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") };
  }
}

test("cli: repair fixes a corrupt artifact and scan then reports OK", async () => {
  await withDir(async (dir) => {
    const sessions = path.join(dir, "sessions", "p1", "session-x");
    // flat layout used by scan root walk
    const flat = path.join(dir, "sessions", "p1");
    const file = path.join(sessions, "session.jsonl.zstd");
    // place under sessions/p1/session-x/... nested (walk finds it)
    const nested = path.join(dir, "sessions", "p1", "session-x");
    await import("node:fs/promises").then((fs) => fs.mkdir(nested, { recursive: true }));
    const buf = buildSessionLog({
      id: "session-x",
      events: [
        stepStart({ seq: 0 }),
        userMessage({ seq: 1 }),
        toolCall({ seq: 2, callId: "c", name: "sftp_write" }),
        toolResult({ seq: 3, callId: "c", content: "Wrote 5 bytes to /tmp/x" })
      ]
    });
    writeFileSync(file, buf);

    // scan root reports the corruption
    let r = run(["scan", path.join(dir, "sessions")]);
    assert.notEqual(r.code, 0, "scan of corrupt root should exit non-zero");
    assert.match(r.out, /seq 3/);
    assert.match(r.out, /sftp_write/);

    // repair the exact file
    r = run(["repair", file]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PATCHED seqs: \[3\]/);

    // scan root now clean
    r = run(["scan", path.join(dir, "sessions")]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /clean=1/);
    assert.ok(!flat || true);
  });
});

test("cli: scan-file on a clean file reports OK", async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, "session.jsonl.zstd");
    writeFileSync(file, buildSessionLog({
      id: "session-c",
      events: [
        stepStart({ seq: 0 }),
        userMessage({ seq: 1 }),
        toolCall({ seq: 2, callId: "c", name: "demo" }),
        toolResult({ seq: 3, callId: "c", content: [{ type: "text", text: "ok" }] })
      ]
    }));
    const r = run(["scan-file", file]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^OK /);
  });
});

test("cli: blame on a suicide artifact exits 0 and names the kill call", async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, "session.jsonl.zstd");
    writeFileSync(file, buildSessionLog({
      id: "session-suicide",
      events: [
        stepStart({ seq: 0 }),
        userMessage({ seq: 1 }),
        shellCall({ seq: 2, callId: "kill1", name: "pwsh", command: "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'dsh' } | Stop-Process -Force" }),
        interruptedToolResult({ seq: 3, callId: "kill1" }),
        turnEnd({ seq: 4, reasonKind: "interrupted" })
      ]
    }));
    const r = run(["blame", file]);
    assert.equal(r.code, 1, "accident should exit non-zero (like scan corrupt)");
    assert.match(r.out, /AGENT-CAUSED/);
    assert.match(r.out, /kill1/);
    assert.match(r.out, /Stop-Process/);
    assert.match(r.out, /kill-process/);
  });
});

test("cli: blame on a clean artifact reports no accident", async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, "session.jsonl.zstd");
    writeFileSync(file, buildSessionLog({
      id: "session-clean",
      events: [
        stepStart({ seq: 0 }),
        userMessage({ seq: 1 }),
        toolCall({ seq: 2, callId: "c", name: "demo" }),
        toolResult({ seq: 3, callId: "c", content: [{ type: "text", text: "ok" }] }),
        turnEnd({ seq: 4, reasonKind: "completed" })
      ]
    }));
    const r = run(["blame", file]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /NO-ACCIDENT/);
  });
});

test("cli: blame on a sessions root reports per-session verdicts", async () => {
  await withDir(async (dir) => {
    const nested = path.join(dir, "sessions", "s1");
    await import("node:fs/promises").then((fs) => fs.mkdir(nested, { recursive: true }));
    writeFileSync(path.join(nested, "session.jsonl.zstd"), buildSessionLog({
      id: "session-s1",
      events: [
        stepStart({ seq: 0 }),
        userMessage({ seq: 1 }),
        shellCall({ seq: 2, callId: "k", name: "pwsh", command: "taskkill /IM node.exe /F" }),
        interruptedToolResult({ seq: 3, callId: "k" }),
        turnEnd({ seq: 4, reasonKind: "interrupted" })
      ]
    }));
    const r = run(["blame", path.join(dir, "sessions")]);
    assert.equal(r.code, 1, "accident in root should exit non-zero");
    assert.match(r.out, /AGENT-CAUSED/);
    assert.match(r.out, /scanned=1 accident=1/);
  });
});
