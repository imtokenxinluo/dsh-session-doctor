// repair: backup + lossless fix of string-content tool/result records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSessionLog, toolResult, toolCall, userMessage, stepStart } from "./helpers.mjs";
import { repairSessionFile } from "../src/repair.js";
import { scanSessionFile } from "../src/scan.js";

async function withDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-doctor-repair-"));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

test("repair backs up first and fixes the file to zero loader failures", async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, "session.jsonl.zstd");
    const original = buildSessionLog({
      id: "session-bad",
      events: [
        stepStart({ seq: 0 }),
        userMessage({ seq: 1 }),
        toolCall({ seq: 2, callId: "call_a", name: "sftp_write" }),
        toolResult({ seq: 3, callId: "call_a", content: "Wrote 1 bytes to /tmp/a" }),
        userMessage({ seq: 4, text: "more" })
      ]
    });
    writeFileSync(file, original);

    const result = await repairSessionFile(file);
    assert.ok(result.backupPath, "backup path present");
    assert.ok(existsSync(result.backupPath), "backup file exists");
    assert.equal(readFileSync(result.backupPath).equals(original), true, "backup equals original");
    assert.deepEqual(result.patchedSeqs, [3]);

    const report = await scanSessionFile(file);
    assert.equal(report.ok, true, `expected no findings, got ${JSON.stringify(report.findings)}`);
    assert.equal(report.lines, 6);
  });
});

test("repair fixes multiple targets and leaves clean events untouched", async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, "session.jsonl.zstd");
    writeFileSync(file, buildSessionLog({
      id: "session-mixed",
      events: [
        stepStart({ seq: 0 }),
        userMessage({ seq: 1 }),
        toolCall({ seq: 2, callId: "call_ok", name: "demo_tool" }),
        toolResult({ seq: 3, callId: "call_ok", content: [{ type: "text", text: "fine" }] }),
        toolCall({ seq: 4, callId: "call_bad1", name: "sftp_write" }),
        toolResult({ seq: 5, callId: "call_bad1", content: "Wrote 9 bytes to /tmp/a" }),
        toolCall({ seq: 6, callId: "call_bad2", name: "sftp_mkdir" }),
        toolResult({ seq: 7, callId: "call_bad2", content: "Created directory /tmp/x" })
      ]
    }));
    const result = await repairSessionFile(file);
    assert.deepEqual(result.patchedSeqs, [5, 7]);
    const scan = await scanSessionFile(file);
    assert.equal(scan.ok, true, JSON.stringify(scan.findings));
  });
});

test("repair is a no-op (no backup, unchanged) when nothing to fix", async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, "session.jsonl.zstd");
    const buf = buildSessionLog({
      id: "session-clean",
      events: [
        stepStart({ seq: 0 }),
        userMessage({ seq: 1 }),
        toolCall({ seq: 2, callId: "c", name: "demo_tool" }),
        toolResult({ seq: 3, callId: "c", content: [{ type: "text", text: "ok" }] })
      ]
    });
    writeFileSync(file, buf);
    const before = sha256(readFileSync(file));
    const result = await repairSessionFile(file);
    assert.equal(result.patchedSeqs.length, 0);
    assert.equal(result.backupPath, undefined, "no backup for clean file");
    assert.equal(sha256(readFileSync(file)), before, "clean file untouched");
  });
});

test("repair refuses a missing file with a clear error", async () => {
  await assert.rejects(() => repairSessionFile("Z:\\no\\such\\file.jsonl.zstd"), /read/i);
});
