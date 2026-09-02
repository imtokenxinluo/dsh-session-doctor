// Adversarial review probe: findings detail + tool name + line/event preservation on a real copy.
import { scanSessionFile, repairSessionFile } from "../src/index.js";
const file = process.argv[2];

const before = await scanSessionFile(file);
console.log("before:", JSON.stringify({ ok: before.ok, lines: before.lines, events: before.events, findings: before.findings }));

const rep = await repairSessionFile(file);
const after = await scanSessionFile(file);
console.log("repair:", JSON.stringify({ patched: rep.patchedSeqs, backup: !!rep.backupPath }));
console.log("after:", JSON.stringify({ ok: after.ok, lines: after.lines, events: after.events, findings: after.findings }));

// failure-mode probe: repair again on already-clean file must be a no-op
const rep2 = await repairSessionFile(file);
console.log("re-repair no-op:", JSON.stringify({ changed: rep2.changed, patched: rep2.patchedSeqs }));
if (!after.ok || after.findings.length !== 0) process.exitCode = 1;
