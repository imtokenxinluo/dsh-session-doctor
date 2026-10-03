// plugin.js — cordis plugin shell that arms the live sentinel on a DSH ctx.
//
// Subscribe to the same events dsh-session-persistence uses, run loader-mirror
// validation on each appended message, and warn (plus fire onViolation) the
// moment a contract-violating event is written. Registering this plugin in a
// profile (e.g. web profile bundle list) arms watch for every session.
//
// Not installed into any profile by default (see SPEC v1.1 scope) — this file
// is the ready-made seam for when the user opts in.

import { createSessionSentinel } from "./watch.js";
// 直接从源头模块取，别走 index.js —— index.js 会 re-export 本文件，
// 形成循环导入后 ESM 里会报 "Cannot access 'plugin' before initialization"。
import { scanSessionRoot } from "./scan.js";
import { repairSessionFile } from "./repair.js";
import { createHttpHandlers, REPORT_PATH, REPAIR_PATH, toSessionView } from "./http.js";

/** 从 config/env 解析 sessions 根（面板与哨兵共用同一个来源）。 */
function resolveSessionsRoot(config, env) {
  if (typeof config.sessionsRoot === "string" && config.sessionsRoot) return config.sessionsRoot;
  const home = env.DSH_HOME;
  return typeof home === "string" && home ? `${home}/sessions` : null;
}

export default {
  name: "session-doctor-watch",
  apply(ctx, config = {}) {
    const env = config.env ?? process.env;
    const onViolation = config.onViolation ?? (() => {});
    const sentinel = createSessionSentinel({
      onViolation(session, violation) {
        ctx.logger?.warn?.(
          `[session-doctor] live violation session=${session?.id ?? "?"} seq=${violation.seq} type=${violation.type} tool=${violation.tool ?? "?"}: ${violation.reason}`
        );
        try { onViolation(session, violation); } catch { /* contained */ }
      }
    });
    ctx.on("session/event", (session, event) => {
      const violation = sentinel.handle(session, event);
      // A violation only needs surfacing; nothing to write here (live file).
    });
    ctx.on("session/disposed", () => { /* placeholder for future counters */ });

    // ── 可视化面板的宿主 API ────────────────────────────────────────────────
    // 浏览器拿不到文件系统，所以"看得见"这件事必须由宿主提供只读报告；
    // 修复则是分开的一个显式动作（面板点了才发生）。
    const deps = {
      report: async () => {
        const root = resolveSessionsRoot(config, env);
        if (!root) return { ok: false, error: "未找到 DSH_HOME，无法定位会话日志" };
        const { reports, summary } = await scanSessionRoot(root);
        return { ok: true, root, summary, sessions: reports.map(toSessionView) };
      },
      repair: async (file) => {
        try {
          const r = await repairSessionFile(file);
          return {
            ok: true,
            file,
            patchedSeqs: r.patchedSeqs ?? [],
            backupPath: r.backupPath ?? null,
            changed: Boolean(r.changed),
          };
        } catch (error) {
          return { ok: false, file, error: String(error?.message ?? error) };
        }
      },
    };
    const handlers = createHttpHandlers({ deps });

    try {
      if (typeof ctx.inject === "function") {
        ctx.inject(["webServer"], (wctx) => {
          const server = wctx?.webServer ?? wctx?.get?.("webServer");
          if (!server?.register) return;
          const disposers = [
            server.register({ kind: "exact", path: REPORT_PATH, handler: handlers.report }),
            server.register({ kind: "exact", path: REPAIR_PATH, handler: handlers.repair }),
          ];
          try { (wctx ?? ctx).effect?.(() => () => disposers.forEach((d) => d?.())); } catch { /* no effect seam */ }
          ctx.logger?.info?.(`[session-doctor] routes mounted: ${REPORT_PATH} (GET) · ${REPAIR_PATH} (POST)`);
        });
      }
    } catch (error) {
      ctx.logger?.warn?.(`[session-doctor] 路由注册失败（已忽略）：${error?.message ?? error}`);
    }
  }
};
