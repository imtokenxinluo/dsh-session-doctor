#!/usr/bin/env node
// dsh-session-doctor CLI.
//   scan  <root>            scan every session artifact under root
//   scan-file <file>        scan one artifact
//   repair <file> [--dry-run]  back up + losslessly repair one artifact
//   blame <file|root>       attribute an abrupt stop: did an agent tool call kill it?
import { scanSessionFile, scanSessionRoot, repairSessionFile, blameSessionFile, blameSessionRoot } from "../src/index.js";

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

  dsh-session-doctor blame <file|root>
      Accident attribution for an abrupt stop (browser / app / DSH closed
      unexpectedly): does the log show the model itself called a tool that
      killed the process? One file = single-session postmortem; a sessions
      root = per-session verdict summary. Read-only.
`);
}

function fmtTime(t) {
  if (!t) return "-";
  return new Date(t).toISOString();
}

function printBlame(r) {
  if (!r.ok) { console.log(`ERR  ${r.file}: ${r.error ?? "unknown"}`); return; }
  const kind = r.accident ? "AGENT-CAUSED" : (r.verdict === "external" ? "EXTERNAL" : "NO-ACCIDENT");
  console.log(`${kind}  ${r.file}`);
  if (r.tornTail) console.log(`  note: log ends in a torn frame (process died mid-write) — last evidence batch is missing`);
  if (r.interruptions.length > 0) {
    console.log(`  interruptions: ${r.interruptions.length} (latest seq ${r.interruptions[r.interruptions.length - 1].seq}, line ${r.interruptions[r.interruptions.length - 1].line})`);
  }
  if (r.suspect) {
    const s = r.suspect;
    console.log(`  suspect tool call:`);
    console.log(`    line ${s.line} seq ${s.seq} time ${fmtTime(s.time)}`);
    console.log(`    tool=${s.name} callId=${s.callId}`);
    console.log(`    command: ${String(s.command).slice(0, 400)}`);
    for (const p of s.patterns) console.log(`    pattern [${p.category}]: ${p.label}`);
  } else if (r.verdict === "external") {
    console.log(`  no dangerous agent tool call before the interruption; likely an external cause (system / manual close).`);
  }
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
    case "blame": {
      const target = rest[0];
      if (!target) return usage();
      const { stat } = await import("node:fs/promises");
      let isDir = false;
      try { isDir = (await stat(target)).isDirectory(); } catch {
        console.error(`blame: no such path ${target}`);
        process.exitCode = 1;
        return;
      }
      if (isDir) {
        const { reports, summary } = await blameSessionRoot(target);
        for (const r of reports) printBlame(r);
        console.log(`\nscanned=${summary.scanned} accident=${summary.accident} clean=${summary.clean}`);
        if (summary.accident > 0) process.exitCode = 1;
      } else {
        const r = await blameSessionFile(target);
        printBlame(r);
        if (r.accident) process.exitCode = 1;
      }
      return;
    }
    default:
      return usage();
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
