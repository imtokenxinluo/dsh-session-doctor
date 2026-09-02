// scan: detect loader-mirror violations in a session log artifact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSessionLog, toolResult, toolCall, userMessage, stepStart } from "./helpers.mjs";
import { scanSessionFile } from "../src/scan.js";

async function withDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-doctor-scan-"));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("scan reports OK for a clean session log", async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, "session.jsonl.zstd");
    const buf = buildSessionLog({
      id: "session-clean",
      events: [
        stepStart({ seq: 0 }),
        userMessage({ seq: 1 }),
        toolCall({ seq: 2, callId: "call_1", name: "demo_tool" }),
        toolResult({ seq: 3, callId: "call_1", content: [{ type: "text", text: "ok" }] })
      ]
    });
    writeFileSync(file, buf);
    const report = await scanSessionFile(file);
    assert.equal(report.ok, true);
    assert.equal(report.findings.length, 0);
    assert.equal(report.lines, 5);
  });
});

test("scan reports a string-content tool/result with seq and tool name", async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, "session.jsonl.zstd");
    const buf = buildSessionLog({
      id: "session-bad",
      events: [
        stepStart({ seq: 0 }),
        userMessage({ seq: 1 }),
        toolCall({ seq: 2, callId: "call_sftp", name: "sftp_write" }),
        toolResult({ seq: 3, callId: "call_sftp", content: "Wrote 42 bytes to /tmp/x" })
      ]
    });
    writeFileSync(file, buf);
    const report = await scanSessionFile(file);
    assert.equal(report.ok, false);
    assert.equal(report.findings.length, 1);
    const f = report.findings[0];
    assert.equal(f.seq, 3);
    assert.equal(f.type, "tool/result");
    assert.match(f.reason, /content/);
    assert.equal(f.tool, "sftp_write");
  });
});

test("scan reports a missing file as an error finding, not a crash", async () => {
  const report = await scanSessionFile("Z:\\no\\such\\session.jsonl.zstd");
  assert.equal(report.ok, false);
  assert.ok(report.error);
});
