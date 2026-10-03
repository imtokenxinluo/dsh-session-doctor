// 客户端产物检查：lib/client.js 必须与 src/client.js 同步。
//
// 为什么值得单测：面板是构建产物，源码改了却忘了 build 的话，
// 装上去的还是旧面板 —— 而且**不会有任何报错**。构建脚本在产物首行盖了源码指纹，
// 这里比对它，把"静默不同步"变成一条红灯。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src", "client.js");
const OUT = join(root, "lib", "client.js");

test("lib/client.js exists and is the ModuleLoader bundle format", () => {
  assert.ok(existsSync(OUT), "lib/client.js must be built (node scripts/build-client.mjs)");
  const out = readFileSync(OUT, "utf8");
  assert.match(out, /window\.__ModuleLoader__\.load\(/, "must register through the ModuleLoader");
  assert.match(out, /id:\s*"dsh-session-doctor"/, "must register under the doctor's plugin id");
  assert.match(out, /factory:/, "must expose a factory");
});

test("bundle fingerprint matches the current src/client.js", () => {
  const src = readFileSync(SRC, "utf8");
  const want = createHash("sha256").update(src).digest("hex");
  const out = readFileSync(OUT, "utf8");
  const m = out.match(/built-from-src-sha256:\s*([0-9a-f]{64})/);
  assert.ok(m, "bundle must carry a source fingerprint on line 1");
  assert.equal(m[1], want, "src/client.js changed without rebuilding -> run: node scripts/build-client.mjs");
});

test("bundle talks to the host routes the plugin actually mounts", () => {
  const out = readFileSync(OUT, "utf8");
  assert.match(out, /\/session-doctor\/report/, "must call the report route");
  assert.match(out, /\/session-doctor\/repair/, "must call the repair route");
});

test("bundle registers the settings page and points at the catalog", () => {
  const out = readFileSync(OUT, "utf8");
  assert.match(out, /settings\.section/, "must register a settings section");
  assert.match(out, /DEFECT-CATALOG/, "must point readers at the defect catalog");
});

test("react stays external (not inlined into the bundle)", () => {
  const out = readFileSync(OUT, "utf8");
  // 判定标准与 dsh 插件构建惯例一致：不应出现 react 的内部实现痕迹
  assert.equal(/react\.development\.js|__SECRET_INTERNALS/.test(out), false, "react must remain external");
  assert.ok(out.length < 200 * 1024, "a react-external bundle should stay small");
});
