// repair: backup + lossless fix of string-content tool/result records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSessionLog, toolResult, toolCall, userMessage, stepStart } from "./helpers.mjs";
import { repairSessionFile, patchToolResultLine } from "../src/repair.js";
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

// ── 同一约束的另外两种违反形态 ────────────────────────────────────────────────
// loader 要求 `tool-result` 块的 `content` 必须是数组（validate.js:59）。违反它的形态有三种，
// 其中第一种（裸字符串）来自 dsh-ssh-ops 的真实事故；下面两种是**防御性扩展** ——
// 它们同样能无损修复（内容的每一个字都保留），但在真实数据里尚未观察到。
// 用纯函数 patchToolResultLine 直接断言，避免把文件/压缩搅进来。
test("patch: single object content is wrapped into an array, content untouched", () => {
  const inner = { type: "text", text: "file body" };
  const line = JSON.stringify(toolResult({ seq: 1, callId: "call_b", content: inner }));
  const result = patchToolResultLine(line);
  assert.equal(result.patched, true, "object content must be repairable");
  const ev = JSON.parse(result.line);
  assert.deepEqual(ev.data.message.content[0].content, [inner], "wrapped, not altered");
  assert.equal(ev.data.message.content[0].toolCallId, "call_b", "toolCallId preserved");
});

test("patch: null content becomes an empty array", () => {
  const line = JSON.stringify(toolResult({ seq: 2, callId: "call_c", content: null }));
  const result = patchToolResultLine(line);
  assert.equal(result.patched, true, "null content must be repairable");
  const ev = JSON.parse(result.line);
  assert.deepEqual(ev.data.message.content[0].content, [], "no fabricated text block");
});

test("patch: missing content becomes an empty array", () => {
  const ev0 = toolResult({ seq: 3, callId: "call_d", content: "x" });
  delete ev0.data.message.content[0].content;
  const result = patchToolResultLine(JSON.stringify(ev0));
  assert.equal(result.patched, true, "absent content must be repairable");
  const ev = JSON.parse(result.line);
  assert.deepEqual(ev.data.message.content[0].content, []);
});

test("patch: an already-valid array content is left alone", () => {
  const line = JSON.stringify(toolResult({ seq: 4, callId: "call_e", content: [{ type: "text", text: "ok" }] }));
  const result = patchToolResultLine(line);
  assert.equal(result.patched, false, "valid content must not be rewritten");
  assert.equal(result.line, line, "line returned byte-identical");
});

test("patch: unsupported scalars are reported, never guessed", () => {
  for (const bad of [42, true]) {
    const line = JSON.stringify(toolResult({ seq: 5, callId: "call_f", content: bad }));
    const result = patchToolResultLine(line);
    assert.equal(result.patched, false, `content=${JSON.stringify(bad)} must not be auto-fixed`);
  }
});

test("repair end-to-end: object and null content in one file both get fixed", async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, "session.jsonl.zstd");
    const original = buildSessionLog({
      id: "session-mixed-shapes",
      events: [
        stepStart({ seq: 0 }),
        toolCall({ seq: 1, callId: "call_x", name: "read_file" }),
        toolResult({ seq: 2, callId: "call_x", content: { type: "text", text: "obj body" } }),
        toolResult({ seq: 3, callId: "call_x", content: null }),
      ],
    });
    writeFileSync(file, original);

    const result = await repairSessionFile(file);
    assert.deepEqual(result.patchedSeqs, [2, 3], "both new shapes repaired");
    assert.ok(result.backupPath && existsSync(result.backupPath), "backup written first");
    assert.equal(readFileSync(result.backupPath).equals(original), true, "backup equals original");

    const report = await scanSessionFile(file);
    assert.equal(report.ok, true, `expected clean after repair, got ${JSON.stringify(report.findings)}`);
  });
});
