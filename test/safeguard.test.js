// safeguard: 一条命令走完「冷备 → 体检 → 修复 → 回读校验」。
//
// 这份测试盯的是**安全顺序**，而不是功能花哨：
//   1. dry-run 绝不写任何东西；
//   2. 冷备必须先成功（且逐文件校验过）才允许进入修复；
//   3. 冷备失败时**一个字节都不许改**；
//   4. 走完链路后回读校验必须 0 损坏。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSessionLog, toolResult, toolCall, userMessage, stepStart } from "./helpers.mjs";
import { safeguard, coldBackup, measureTree } from "../src/safeguard.js";

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** 一个含单个损坏会话的 sessions 根。 */
function makeRoot(dir) {
  const root = path.join(dir, "sessions");
  const s1 = path.join(root, "session-bad");
  mkdirSync(s1, { recursive: true });
  const file = path.join(s1, "session.jsonl.zstd");
  const bytes = buildSessionLog({
    id: "session-bad",
    events: [
      stepStart({ seq: 0 }),
      userMessage({ seq: 1 }),
      toolCall({ seq: 2, callId: "call_a", name: "sftp_write" }),
      // 裸字符串 content —— 已知的真实事故形态
      toolResult({ seq: 3, callId: "call_a", content: "Wrote 1 bytes" }),
    ],
  });
  writeFileSync(file, bytes);
  return { root, file, bytes };
}

async function withDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-doctor-safeguard-"));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("dry-run writes nothing at all", async () => {
  await withDir(async (dir) => {
    const { root, file } = makeRoot(dir);
    const before = sha256(readFileSync(file));
    const backupDir = path.join(dir, "backup");
    const r = await safeguard(root, { backupDir, apply: false });

    assert.equal(r.stoppedAt, "dry-run");
    assert.equal(existsSync(backupDir), false, "dry-run must not create the backup dir");
    assert.equal(sha256(readFileSync(file)), before, "dry-run must not touch the artifact");
    assert.equal(r.before.corrupt, 1, "it still reports what it found");
    assert.equal(r.corruptFiles.length, 1);
    assert.ok(r.size.bytes > 0, "it reports how much would be backed up");
  });
});

test("without --backup-to it stops at the scan stage", async () => {
  await withDir(async (dir) => {
    const { root, file } = makeRoot(dir);
    const before = sha256(readFileSync(file));
    const r = await safeguard(root, { apply: true });
    assert.equal(r.stoppedAt, "no-backup-dir");
    assert.equal(r.repaired, undefined, "must not repair without a backup target");
    assert.equal(sha256(readFileSync(file)), before, "artifact untouched");
  });
});

test("--apply: cold backup verified, then repaired, then re-scan is clean", async () => {
  await withDir(async (dir) => {
    const { root, bytes } = makeRoot(dir);
    const backupDir = path.join(dir, "backup");
    const r = await safeguard(root, { backupDir, apply: true });

    assert.equal(r.ok, true, "final verification must pass");
    assert.equal(r.stoppedAt, null);
    assert.ok(r.backup.files > 0);
    assert.ok(existsSync(r.backup.manifestPath), "manifest written");
    assert.equal(r.repaired.length, 1);
    assert.equal(r.after.corrupt, 0, "no corruption left");
    assert.ok(r.repaired[0].patchedSeqs.length > 0, "it actually patched something");

    // 冷备里必须留有**修复前**的原始字节
    const backedUp = readFileSync(path.join(backupDir, "session-bad", "session.jsonl.zstd"));
    assert.equal(sha256(backedUp), sha256(bytes), "backup holds the pre-repair bytes");
  });
});

test("backup failure aborts before any repair (the whole point)", async () => {
  await withDir(async (dir) => {
    const { root, file } = makeRoot(dir);
    const before = sha256(readFileSync(file));
    // 用一个"文件"占住路径，使 backupDir 无法被创建为目录
    const blocker = path.join(dir, "blocker");
    writeFileSync(blocker, "not a directory");

    const r = await safeguard(root, { backupDir: path.join(blocker, "nested"), apply: true });

    assert.equal(r.stoppedAt, "backup-failed");
    assert.ok(r.backupError, "the failure reason is reported");
    assert.equal(r.repaired, undefined, "must NOT enter the repair stage");
    assert.equal(r.after, undefined, "must NOT claim a verification result");
    assert.equal(sha256(readFileSync(file)), before, "artifact must be byte-identical");
  });
});

test("coldBackup verifies every file and records sha256 in the manifest", async () => {
  await withDir(async (dir) => {
    const { root } = makeRoot(dir);
    const backupDir = path.join(dir, "cold");
    const r = await coldBackup(root, backupDir);

    assert.ok(r.verified >= 1);
    const manifest = JSON.parse(readFileSync(r.manifestPath, "utf8"));
    assert.equal(manifest.entries.length, r.verified);
    for (const e of manifest.entries) {
      assert.match(e.sha256, /^[0-9a-f]{64}$/, "each entry carries a sha256");
      assert.ok(e.bytes > 0);
    }
    // 冷备本身绝不修改源
    const src = readFileSync(path.join(root, "session-bad", "session.jsonl.zstd"));
    const manifestEntry = manifest.entries.find((e) => e.path.endsWith("session.jsonl.zstd"));
    assert.equal(sha256(src), manifestEntry.sha256, "source unchanged and matches manifest");
  });
});

test("measureTree is read-only and counts artifacts", async () => {
  await withDir(async (dir) => {
    const { root, file } = makeRoot(dir);
    const before = sha256(readFileSync(file));
    const size = await measureTree(root);
    assert.equal(size.artifacts, 1);
    assert.ok(size.files >= 1);
    assert.ok(size.bytes > 0);
    assert.equal(sha256(readFileSync(file)), before);
  });
});
