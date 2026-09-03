// audit-render-contract.mjs — find tools whose output.render returns a bare
// string instead of a ContentBlock[] array literal. Used by PATCHES.md §4 to
// detect offenders that would poison session logs on write.
import { readFile } from "node:fs/promises";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node audit-render-contract.mjs <src-or-lib-index.js> [...]");
  process.exit(2);
}

// Match: `name: "tool"` then (within 600 chars) `render(...) {` then the first
// return statement; flag when that return does NOT start with an array literal.
const TOOL_RE = /name:\s*"([^"]+)"[\s\S]{0,600}?render\([^)]*\)\s*\{([\s\S]{0,240}?)\breturn\s+([^;]+);/g;

let offenders = 0;
for (const file of files) {
  const s = await readFile(file, "utf8");
  let m;
  while ((m = TOOL_RE.exec(s)) !== null) {
    const tool = m[1];
    const returnExpr = m[3].trim();
    const isArray = /^\[/.test(returnExpr) || /^\{?\s*type\s*:\s*"text"/.test(returnExpr);
    if (!isArray) {
      offenders++;
      console.log(`OFFENDER  ${file}: ${tool}  render returns bare: ${returnExpr.slice(0, 80)}`);
    } else {
      console.log(`ok        ${file}: ${tool}`);
    }
  }
}
console.log(offenders === 0 ? "NO OFFENDERS" : `${offenders} offender(s) found`);
process.exit(offenders === 0 ? 0 : 1);
