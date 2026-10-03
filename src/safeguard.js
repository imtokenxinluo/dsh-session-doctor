// safeguard.js — 一条命令走完「冷备 → 体检 → 修复 → 回读校验」。
//
// 为什么需要它：doctor 原本只在 repair **单个文件**时做逐文件备份。也就是说，
// 「我要一次修好几个损坏会话」这件事**缺少一条全局退路** —— 万一修完发现不对，
// 手里只有每个文件各自的 .bak，没有"修之前那一刻的整库快照"。
//
// 顺序是刻意的，且不可颠倒：
//   1. 冷备（必须**先成功并逐文件校验**，否则立即中止，绝不进入修复）
//   2. 扫描（确认要修哪些）
//   3. 修复（每个文件仍然各自有 .bak + 回读校验，双保险）
//   4. 最后再扫一遍（回读校验：0 findings 才算通过）
//
// 与 dsh-session-backup 的分工：那个包做增量/历史冷备（长期归档），
// 这里做的是"动手前的就地快照"（一次性的、与本次修复绑定的退路）。
import { cp, mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { scanSessionRoot } from "./scan.js";
import { repairSessionFile } from "./repair.js";

/** 会话产物文件名（与 scan 的发现规则一致）。 */
const ARTIFACT_RE = /^session\.jsonl(\.zstd)?$/;

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** 递归收集一个目录树里的文件（相对路径 → 绝对路径）。 */
async function walkFiles(root, rel = "", out = new Map()) {
  const dir = path.join(root, rel);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const nextRel = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) await walkFiles(root, nextRel, out);
    else if (e.isFile()) out.set(nextRel, path.join(root, nextRel));
  }
  return out;
}

/**
 * 量一下要备份多大的树（dry-run 用；只读）。
 * @returns {Promise<{files:number, bytes:number, artifacts:number}>}
 */
export async function measureTree(root) {
  const files = await walkFiles(root);
  let bytes = 0;
  let artifacts = 0;
  for (const [, abs] of files) {
    try {
      bytes += (await stat(abs)).size;
    } catch { /* 读不到就跳过计量 */ }
    if (ARTIFACT_RE.test(path.basename(abs))) artifacts++;
  }
  return { files: files.size, bytes, artifacts };
}

/**
 * 冷备一整棵树到 backupDir，并**逐文件校验 sha256**。
 * 只读源目录，绝不修改；目标已存在同名文件时不覆盖（force: false）。
 * @returns {Promise<{files:number, bytes:number, verified:number, manifestPath:string}>}
 */
export async function coldBackup(root, backupDir, { log = () => {} } = {}) {
  const src = await walkFiles(root);
  await mkdir(backupDir, { recursive: true });
  await cp(root, backupDir, { recursive: true, force: false, errorOnExist: false });

  const manifest = { root, backupDir, createdAt: new Date().toISOString(), entries: [] };
  let bytes = 0;
  let verified = 0;
  for (const [rel, abs] of src) {
    const dst = path.join(backupDir, rel);
    const a = await readFile(abs);
    let b;
    try {
      b = await readFile(dst);
    } catch (error) {
      throw new Error(`冷备校验失败：目标缺少 ${rel}（${error?.message ?? error}）`);
    }
    const ha = sha256(a);
    const hb = sha256(b);
    if (ha !== hb) throw new Error(`冷备校验失败：${rel} 的 sha256 不一致`);
    bytes += a.length;
    verified++;
    manifest.entries.push({ path: rel.split(path.sep).join("/"), bytes: a.length, sha256: ha });
  }
  const manifestPath = path.join(backupDir, "doctor-backup-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  log(`冷备完成：${verified} 个文件 / ${(bytes / 1048576).toFixed(1)} MB，逐文件 sha256 校验通过`);
  return { files: src.size, bytes, verified, manifestPath };
}

/**
 * 一条命令：冷备 → 扫描 → 修复 → 回读校验。
 *
 * @param {string} root - sessions 根目录
 * @param {{backupDir?:string, apply?:boolean, log?:(m:string)=>void}} options
 *   `apply: false`（默认）= dry-run：只报告将要做什么，不复制也不修改。
 * @returns {Promise<object>} 分步结果；任一步失败都带上 `stoppedAt` 说明停在哪。
 */
export async function safeguard(root, options = {}) {
  const { backupDir, apply = false, log = () => {} } = options;
  const result = { root, backupDir: backupDir ?? null, apply, stoppedAt: null };

  // 1. 体检（只读）
  const before = await scanSessionRoot(root);
  result.before = { scanned: before.summary.scanned, corrupt: before.summary.corrupt };
  const corruptFiles = before.reports.filter((r) => !r.ok && !r.error).map((r) => r.file);
  result.corruptFiles = corruptFiles;
  log(`体检：${before.summary.scanned} 个会话，${before.summary.corrupt} 个损坏`);

  if (!backupDir) {
    result.stoppedAt = "no-backup-dir";
    log("未指定 --backup-to：已停止在体检阶段（不复制、不修复）。");
    return result;
  }

  const size = await measureTree(root);
  result.size = size;
  log(`待冷备：${size.files} 个文件 / ${(size.bytes / 1048576).toFixed(1)} MB（其中会话产物 ${size.artifacts} 个）`);

  if (!apply) {
    result.stoppedAt = "dry-run";
    log(`dry-run：以上是计划。加 --apply 执行冷备${corruptFiles.length > 0 ? ` + 修复 ${corruptFiles.length} 个损坏会话` : ""}。`);
    return result;
  }

  // 2. 冷备 —— 失败即中止，绝不带着"没有退路"的状态去修
  try {
    result.backup = await coldBackup(root, backupDir, { log });
  } catch (error) {
    result.stoppedAt = "backup-failed";
    result.backupError = String(error?.message ?? error);
    log(`冷备失败，已中止（未做任何修复）：${result.backupError}`);
    return result;
  }

  // 3. 修复（每个文件仍各自带 .bak + 回读校验）
  result.repaired = [];
  for (const file of corruptFiles) {
    try {
      const r = await repairSessionFile(file);
      result.repaired.push({ file, patchedSeqs: r.patchedSeqs, backupPath: r.backupPath ?? null });
      log(`修复 ${path.basename(path.dirname(file))}：patched ${r.patchedSeqs.length} 处`);
    } catch (error) {
      result.repaired.push({ file, error: String(error?.message ?? error) });
      log(`修复失败 ${file}：${error?.message ?? error}`);
    }
  }

  // 4. 回读校验
  const after = await scanSessionRoot(root);
  result.after = { scanned: after.summary.scanned, corrupt: after.summary.corrupt };
  result.ok = after.summary.corrupt === 0;
  log(`回读校验：${after.summary.scanned} 个会话，剩余损坏 ${after.summary.corrupt} 个 → ${result.ok ? "通过" : "未通过"}`);
  if (!result.ok) result.stoppedAt = "verify-failed";
  return result;
}
