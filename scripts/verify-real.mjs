// verify-real.mjs — acceptance against REAL corrupted session copies.
//
// Copies the known-corrupt sessions from the live DSH store into a temp dir,
// runs scan (must report the exact bad seqs) and repair (must leave zero
// loader failures), then reports. It never touches the real files.
//
// Usage: node scripts/verify-real.mjs [root]
//   root defaults to the live store: D:\tool\dsh_data\sessions\--D-tool-claude_code--

import { mkdtemp, cp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanSessionFile, repairSessionFile } from "../src/index.js";

const DEFAULT_ROOT = "D:\\tool\\dsh_data\\sessions\\--D-tool-claude_code--";

// session id -> expected bad seqs (from the 2026-09-02 audit)
const EXPECTED = {
  "session-890ef838-8fa9-4e4f-b646-b78b6a19cf8a": [115441],
  "session-1ea23697-400c-4c14-8a37-63604afc137c": [43861],
  "session-49e6040e-db42-4789-b44e-683ab65cb481": [326814]
};

async function main() {
  const root = process.argv[2] ?? DEFAULT_ROOT;
  const tmp = await mkdtemp(path.join(tmpdir(), "dsh-doctor-real-"));
  try {
    let checked = 0;
    let repaired = 0;
    for (const [id, badSeqs] of Object.entries(EXPECTED)) {
      const srcDir = path.join(root, id);
      const dstDir = path.join(tmp, id);
      await cp(srcDir, dstDir, { recursive: true });
      const file = path.join(dstDir, "session.jsonl.zstd");
      console.log(`\n== ${id} ==`);
      // 1. scan must detect the exact bad seqs
      const scan = await scanSessionFile(file);
      const foundSeqs = scan.findings.map((f) => f.seq).sort((a, b) => a - b);
      const ok = JSON.stringify(foundSeqs) === JSON.stringify([...badSeqs].sort((a, b) => a - b));
      console.log(`scan ok=${scan.ok} foundSeqs=[${foundSeqs}] expected=[${badSeqs}] ${ok ? "MATCH" : "MISMATCH!"}`);
      if (!ok) { console.log("  findings:", JSON.stringify(scan.findings, null, 2)); continue; }
      checked++;
      // 2. repair the copy
      const repair = await repairSessionFile(file);
      console.log(`repair patchedSeqs=[${repair.patchedSeqs}] backup=${path.basename(repair.backupPath ?? "")}`);
      // 3. post-repair scan must be clean
      const after = await scanSessionFile(file);
      console.log(`post-repair scan ok=${after.ok} findings=${after.findings.length}`);
      if (after.ok) repaired++;
    }
    console.log(`\nSUMMARY: scanned-with-expected-match=${checked}/${Object.keys(EXPECTED).length}, repaired-to-clean=${repaired}/${Object.keys(EXPECTED).length}`);
    if (checked !== Object.keys(EXPECTED).length || repaired !== Object.keys(EXPECTED).length) {
      process.exitCode = 1;
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
