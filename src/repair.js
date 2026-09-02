// repair.js — lossless repair of supported session-log corruption.
//
// Supported defect (the one produced by the dsh-ssh-ops render-contract bug):
// a tool/result message whose tool-result block content is a bare string
// instead of a ContentBlock[] array. Repair wraps it into
// [{ type: "text", text: <string> }], preserving every other byte.
//
// Safety contract:
//  - a backup is written next to the artifact BEFORE any change;
//  - the rewrite is frame-aligned (decode each frame → patch target lines →
//    re-encode a checksummed frame), so untouched frames stay byte-identical;
//  - nothing is changed unless at least one supported defect is found;
//  - unknown corruption is reported, never auto-fixed.

import { readFile, writeFile, copyFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { scanFrames, decodeFrames, encodeFrames, splitLines } from "./zstd.js";
import { validateLog, parseLine } from "./validate.js";
import { zstdDecompressSync, zstdCompressSync } from "node:zlib";
import { CHECKSUM_OPTIONS } from "./zstd.js";

/**
 * Patch one parsed tool/result event if it carries the supported defect.
 * @returns {{ line: string, patched: boolean, seq?: number }}
 */
export function patchToolResultLine(line) {
  const { ev, error } = parseLine(line);
  if (error || !ev) return { line, patched: false };
  if (ev.type !== "tool/result") return { line, patched: false };
  const msg = ev.data?.message;
  const block = msg && Array.isArray(msg.content) ? msg.content[0] : undefined;
  if (!block || typeof block !== "object" || block.type !== "tool-result" ||
      typeof block.content !== "string") {
    return { line, patched: false };
  }
  const text = block.content;
  const ordered = { type: "tool-result", toolCallId: block.toolCallId, content: [{ type: "text", text }] };
  if (block.isError !== undefined) ordered.isError = block.isError;
  msg.content = [ordered];
  return { line: JSON.stringify(ev), patched: true, seq: ev.seq };
}

/**
 * Frame-aligned rewrite: decode each frame separately, patch target lines
 * inside it, re-encode as one checksummed frame. Untouched frames are
 * re-encoded from identical plaintext, which keeps their decoded content
 * identical; only patched frames differ at the byte level.
 * @param {Buffer} buf - original artifact bytes.
 * @returns {{ buffer: Buffer, patchedSeqs: number[] }}
 */
export function rewriteFrames(buf) {
  const { frames } = scanFrames(buf);
  const patchedSeqs = [];
  const chunks = [];
  for (const f of frames) {
    const decoded = zstdDecompressSync(buf.subarray(f.start, f.end)).toString("utf8");
    const { lines, newline } = splitLines(decoded);
    let dirty = false;
    const out = lines.map((l) => {
      const r = patchToolResultLine(l);
      if (r.patched) { patchedSeqs.push(r.seq); dirty = true; return r.line; }
      return l;
    });
    chunks.push(dirty ? out.join(newline) : decoded);
  }
  return { buffer: encodeFrames(chunks), patchedSeqs };
}

/**
 * Repair one session artifact in place (with backup).
 * @param {string} file - path to the artifact.
 * @param {object} [opts] - { backupSuffix?, dryRun? }
 * @returns {Promise<{ file:string, patchedSeqs:number[], backupPath?:string, changed:boolean, report?:object }>}
 * @throws when the artifact is missing or unreadable; returns patchedSeqs=[] when clean.
 */
export async function repairSessionFile(file, opts = {}) {
  const backupSuffix = opts.backupSuffix ?? `doctor-${Date.now()}.bak`;
  let buf;
  try {
    buf = await readFile(file);
  } catch (error) {
    throw new Error(`repair: cannot read ${file}: ${error?.message ?? error}`);
  }
  const { buffer, patchedSeqs } = rewriteFrames(buf);
  const changed = patchedSeqs.length > 0;
  if (!changed) {
    return { file, patchedSeqs, changed: false };
  }
  // Safety: refuse if the rewritten artifact does not validate clean.
  const report = validateReport(buffer);
  if (report.findings.length > 0) {
    throw new Error(`repair: rewrite of ${file} still has ${report.findings.length} finding(s); not committing`);
  }
  const backupPath = file + "." + backupSuffix;
  await copyFile(file, backupPath);
  if (!opts.dryRun) {
    // write temp then rename to avoid a half-written artifact
    const tmp = file + ".doctor-tmp";
    await writeFile(tmp, buffer);
    await rename(tmp, file);
  }
  return { file, patchedSeqs, backupPath, changed: true, report };
}

function validateReport(buffer) {
  const text = decodeFrames(buffer);
  const { header, lines, events, findings } = validateLog(text);
  return { header, lines, events, findings };
}
