// http: 体检 API 的纯逻辑（可安全序列化 / 可修性判定 / handler 行为）。
// 不碰真实会话：全部用合成报告与假 req/res。
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHttpHandlers, toSessionView, isRepairableFinding, REPORT_PATH, REPAIR_PATH } from "../src/http.js";

/** 极简 req 替身：可写 body、可被 readBody 消费。 */
function fakeReq({ method = "GET", body = "" } = {}) {
  const req = new EventEmitter();
  req.method = method;
  if (body) req.body = body;
  // readBody 只用 on('data'|'end'|'error')
  setImmediate(() => {
    if (body) req.emit("data", Buffer.from(body, "utf8"));
    req.emit("end");
  });
  return req;
}

/** 极简 res 替身：记录状态码与 JSON。 */
function fakeRes() {
  const res = { statusCode: null, payload: null, headers: null, writableEnded: false };
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers; };
  res.end = (text) => { res.writableEnded = true; res.payload = text ? JSON.parse(text) : null; };
  return res;
}

test("routes are namespaced and distinct", () => {
  assert.equal(REPORT_PATH, "/session-doctor/report");
  assert.equal(REPAIR_PATH, "/session-doctor/repair");
  assert.notEqual(REPORT_PATH, REPAIR_PATH);
});

test("isRepairableFinding: only the C-13 family is repairable", () => {
  assert.equal(isRepairableFinding('tool-result block content must be an array (got string)'), true);
  assert.equal(isRepairableFinding("message has mismatched tool call ids"), false);
  assert.equal(isRepairableFinding("lacks identified message"), false);
  assert.equal(isRepairableFinding(null), false);
  assert.equal(isRepairableFinding(undefined), false);
});

test("toSessionView: explicit, JSON-safe, per-finding repairability", () => {
  const view = toSessionView({
    file: "/x/session.jsonl.zstd",
    ok: false,
    lines: 12,
    findings: [
      { line: 4, seq: 9, type: "tool/result", reason: "tool-result block content must be an array (got string)", tool: "sftp_write" },
      { line: 8, seq: 11, type: "user/message", reason: "lacks identified message" },
    ],
    toolNameByCallId: new Map([["call_a", "sftp_write"]]),
  });
  assert.equal(view.file, "/x/session.jsonl.zstd");
  assert.equal(view.ok, false);
  assert.equal(view.findings.length, 2);
  assert.equal(view.findings[0].repairable, true);
  assert.equal(view.findings[0].tool, "sftp_write");
  assert.equal(view.findings[1].repairable, false);
  assert.equal(view.repairable, true, "session-level flag is the OR of its findings");
  // 必须能被 JSON 往返（Map 之类不能被带出去）
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
});

test("toSessionView tolerates missing/odd shapes", () => {
  const view = toSessionView({});
  assert.equal(view.ok, false);
  assert.deepEqual(view.findings, []);
  assert.equal(view.repairable, false);
  assert.equal(toSessionView(null).lines, 0);
});

test("report handler: GET only, wraps deps result", async () => {
  const handlers = createHttpHandlers({ deps: { report: async () => ({ ok: true, summary: { scanned: 2, corrupt: 0 } }), repair: async () => ({ ok: true }) } });

  const good = fakeRes();
  await handlers.report(fakeReq({ method: "GET" }), good);
  assert.equal(good.statusCode, 200);
  assert.equal(good.payload.summary.scanned, 2);

  const wrong = fakeRes();
  await handlers.report(fakeReq({ method: "POST" }), wrong);
  assert.equal(wrong.statusCode, 405, "report is read-only");
});

test("report handler: a thrown dependency becomes a 500, not a crash", async () => {
  const handlers = createHttpHandlers({ deps: { report: async () => { throw new Error("boom"); }, repair: async () => ({}) } });
  const res = fakeRes();
  await handlers.report(fakeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.payload.error, /boom/);
});

test("repair handler: POST only, requires a file, forwards to deps", async () => {
  const seen = [];
  const handlers = createHttpHandlers({
    deps: {
      report: async () => ({}),
      repair: async (file) => { seen.push(file); return { ok: true, file, patchedSeqs: [7] }; },
    },
  });

  const wrong = fakeRes();
  await handlers.repair(fakeReq({ method: "GET" }), wrong);
  assert.equal(wrong.statusCode, 405, "repair must be POST");

  const missing = fakeRes();
  await handlers.repair(fakeReq({ method: "POST", body: "{}" }), missing);
  assert.equal(missing.payload.ok, false);
  assert.match(missing.payload.error, /file/);
  assert.equal(seen.length, 0, "no repair without a file");

  const ok = fakeRes();
  await handlers.repair(fakeReq({ method: "POST", body: JSON.stringify({ file: "/x/a.zstd" }) }), ok);
  assert.equal(ok.payload.ok, true);
  assert.deepEqual(ok.payload.patchedSeqs, [7]);
  assert.deepEqual(seen, ["/x/a.zstd"]);
});

test("repair handler: bad JSON body is rejected, not silently treated as empty", async () => {
  let called = 0;
  const handlers = createHttpHandlers({ deps: { report: async () => ({}), repair: async () => { called++; return { ok: true }; } } });
  const res = fakeRes();
  await handlers.repair(fakeReq({ method: "POST", body: "{not json" }), res);
  assert.equal(res.payload.ok, false);
  assert.match(res.payload.error, /JSON/);
  assert.equal(called, 0);
});
