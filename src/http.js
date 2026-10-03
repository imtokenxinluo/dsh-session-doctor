// http.js — 体检结果的同源 HTTP API（供可视化面板 / 外部脚本消费）。
//
// 为什么单独一层：扫描与修复都是 Node 侧的文件操作，浏览器拿不到。
// 这一层把它们变成可序列化的只读报告 + 一个显式的修复动作，
// 于是"看得见"（report）与"动手"（repair）在协议上就是分开的两件事 ——
// 面板可以只读展示，修复必须由用户点。
//
// 边界：本模块自己不决定扫描哪个目录（由 plugin 把 root 解析好传进来），
// 也不知道 DSH 的任何内部结构，纯粹是「请求 → 结果」。
import { scanSessionRoot, repairSessionFile } from "./index.js";

export const ROUTE_PREFIX = "/session-doctor";
export const REPORT_PATH = `${ROUTE_PREFIX}/report`;
export const REPAIR_PATH = `${ROUTE_PREFIX}/repair`;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const BODY_LIMIT = 64 * 1024;

function sendJson(res, code, payload) {
  res.writeHead(code, JSON_HEADERS);
  res.end(JSON.stringify(payload));
}

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { resolve({ ok: false, error: "body 过大" }); req.destroy?.(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve({ ok: true, value: {} });
      try {
        resolve({ ok: true, value: JSON.parse(text) });
      } catch (e) {
        resolve({ ok: false, error: `JSON 解析失败：${e?.message ?? e}` });
      }
    });
    req.on("error", (e) => resolve({ ok: false, error: String(e?.message ?? e) }));
  });
}

/** 一个会话的发现结果里，是否含"可无损修复"那一族（C-13：tool-result 的 content 不是数组）。 */
export function isRepairableFinding(reason) {
  return /tool-result block content/i.test(String(reason ?? ""));
}

/** 把扫描结果压成可安全 JSON 序列化的形状（显式挑字段，不带 Map/内部结构）。 */
export function toSessionView(r) {
  const findings = Array.isArray(r?.findings) ? r.findings : [];
  return {
    file: r?.file ?? null,
    ok: Boolean(r?.ok),
    lines: r?.lines ?? 0,
    error: r?.error ?? null,
    findings: findings.map((f) => ({
      line: f?.line ?? null,
      seq: f?.seq ?? null,
      type: f?.type ?? null,
      reason: f?.reason ?? null,
      tool: f?.tool ?? null,
      repairable: isRepairableFinding(f?.reason),
    })),
    repairable: findings.some((f) => isRepairableFinding(f?.reason)),
  };
}

/**
 * 建两个 handler。
 * @param {{deps: {report: () => Promise<object>, repair: (file: string) => Promise<object>}}} args
 */
export function createHttpHandlers({ deps }) {
  const wrap = (fn, method) => async (req, res) => {
    try {
      if (method && req.method !== method) {
        sendJson(res, 405, { ok: false, error: `${method} only` });
        return;
      }
      const out = await fn(req);
      if (!res.writableEnded) sendJson(res, 200, out);
    } catch (error) {
      if (!res.writableEnded) sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
    }
  };

  return {
    // 只读：报一次完整体检
    report: wrap(async () => deps.report(), "GET"),
    // 写：显式修复一个文件（写前必写备份，由 repairSessionFile 保证）
    repair: wrap(async (req) => {
      const body = await readBody(req);
      if (!body.ok) return { ok: false, error: body.error };
      const file = body.value?.file;
      if (typeof file !== "string" || file.length === 0) {
        return { ok: false, error: "缺少 file" };
      }
      return deps.repair(file);
    }, "POST"),
  };
}
