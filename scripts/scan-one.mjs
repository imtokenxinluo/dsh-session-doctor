// One-shot: scan a clean copy (must report ok=true, 0 findings).
import { scanSessionFile } from "../src/index.js";
const file = process.argv[2];
const r = await scanSessionFile(file);
console.log(JSON.stringify({ ok: r.ok, lines: r.lines, events: r.events, findings: r.findings.length, error: r.error ?? null }));
if (!r.ok) process.exitCode = 1;
