// audit-render-contract: unit tests against synthetic source snippets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const AUDIT = fileURLToPath(new URL("../scripts/audit-render-contract.mjs", import.meta.url));

function runAudit(content) {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-audit-"));
  const file = path.join(dir, "sample.js");
  writeFileSync(file, content);
  try {
    const out = execFileSync(process.execPath, [AUDIT, file], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("audit flags a tool whose render returns a bare string", () => {
  const { code, out } = runAudit(`
export const a = defineTool({
  name: "sftp_write_bad",
  description: "x",
  output: { schema: {}, render(args, value) { return \`Wrote \${value.bytes} bytes\`; } }
});
`);
  assert.equal(code, 1);
  assert.match(out, /sftp_write_bad/);
  assert.match(out, /OFFENDER/);
});

test("audit passes a tool whose render returns a ContentBlock[] array", () => {
  const { code, out } = runAudit(`
export const a = defineTool({
  name: "ssh_exec_good",
  description: "x",
  output: { schema: {}, render(args, value) { return [{ type: "text", text: "ok" }]; } }
});
`);
  assert.equal(code, 0);
  assert.match(out, /NO OFFENDERS/);
});
