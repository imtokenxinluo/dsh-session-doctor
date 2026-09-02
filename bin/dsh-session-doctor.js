#!/usr/bin/env node
// dsh-session-doctor CLI.
//   scan  <root>            scan every session artifact under root
//   scan-file <file>        scan one artifact
//   repair <file> [--dry-run]  back up + losslessly repair one artifact
import { scanSessionFile, scanSessionRoot, repairSessionFile } from "../src/index.js";

function usage() {
  console.log(`dsh-session-doctor

usage:
  dsh-session-doctor scan <root>
      Scan every session artifact (session.jsonl[.zstd]) under <root> and
      print loader-mirror findings per session.

  dsh-session-doctor scan-file <file>
      Scan one artifact file.

  dsh-session-doctor repair <file> [--dry-run]
      Back up the artifact, then losslessly repair supported corruption
      (bare-string tool-result content -> text blocks). --dry-run reports
      what would change without writing.
`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "scan": {
      const root = rest[0];
      if (!root) return usage();
      const { reports, summary } = await scanSessionRoot(root);
      for (const r of reports) {
        if (r.ok) {
          console.log(`OK   ${r.file} (${r.lines} lines)`);
        } else if (r.error) {
          console.log(`ERR  ${r.file}: ${r.error}`);
        } else {
          console.log(`BAD  ${r.file} (${r.lines} lines):`);
          for (const f of r.findings) {
            console.log(`     line ${f.line} seq ${f.seq ?? "-"} ${f.type ?? ""} tool=${f.tool ?? "-"} — ${f.reason}`);
          }
        }
      }
      console.log(`\nscanned=${summary.scanned} clean=${summary.clean} corrupt=${summary.corrupt}`);
      if (summary.corrupt > 0) process.exitCode = 1;
      return;
    }
    case "scan-file": {
      const file = rest[0];
      if (!file) return usage();
      const r = await scanSessionFile(file);
      if (r.ok) { console.log(`OK ${file} (${r.lines} lines, 0 findings)`); return; }
      if (r.error) { console.log(`ERR ${file}: ${r.error}`); process.exitCode = 1; return; }
      console.log(`BAD ${file}:`);
      for (const f of r.findings) console.log(`  line ${f.line} seq ${f.seq ?? "-"} ${f.type ?? ""} tool=${f.tool ?? "-"} — ${f.reason}`);
      process.exitCode = 1;
      return;
    }
    case "repair": {
      const file = rest[0];
      const dryRun = rest.includes("--dry-run");
      if (!file) return usage();
      const result = await repairSessionFile(file, { dryRun });
      if (!result.changed) { console.log(`CLEAN ${file}: nothing to repair`); return; }
      console.log(`PATCHED seqs: [${result.patchedSeqs}]`);
      if (result.backupPath) console.log(`BACKUP: ${result.backupPath}`);
      if (dryRun) console.log(`DRY-RUN: file not written`);
      return;
    }
    default:
      return usage();
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
