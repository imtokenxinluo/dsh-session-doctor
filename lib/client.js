// built-from-src-sha256: 4995364033d278c5e6ed1202bbdd697745e1a8c99137d1ad526822c472b1ef98
window.__ModuleLoader__.load({
	id: "dsh-session-doctor",
	factory: (require) => {
var __sessionDoctorClient = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/client.js
  var client_exports = {};
  __export(client_exports, {
    default: () => client_default
  });
  var import_react = __require("react");
  var REPORT_URL = "/session-doctor/report";
  var REPAIR_URL = "/session-doctor/repair";
  var S = {
    root: { display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", fontSize: "13px", lineHeight: "1.6", color: "var(--dsw-alias-label-primary)", overflowY: "auto", height: "100%" },
    head: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
    title: { fontWeight: "600", fontSize: "13px" },
    note: { fontSize: "11.5px", color: "var(--dsw-alias-label-secondary)" },
    status: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
    err: { fontSize: "12px", color: "var(--dsw-alias-state-error-primary)" },
    row: { display: "flex", alignItems: "center", gap: "10px", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", padding: "8px 10px" },
    meta: { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" },
    name: { fontSize: "12.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    sub: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: "10.5px", color: "var(--dsw-alias-label-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    btn: { background: "none", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: "6px", cursor: "pointer", fontSize: "12px", padding: "4px 10px", flex: "none", color: "var(--dsw-alias-label-primary)" },
    ok: { fontSize: "12.5px", color: "var(--dsw-alias-state-success-primary)" }
  };
  function sessionIdOf(file) {
    const parts = String(file || "").split(/[\\/]/).filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : String(file || "");
  }
  function Panel() {
    const [report, setReport] = (0, import_react.useState)(null);
    const [status, setStatus] = (0, import_react.useState)("读取中…");
    const [failed, setFailed] = (0, import_react.useState)(false);
    const [busy, setBusy] = (0, import_react.useState)("");
    const [lastFix, setLastFix] = (0, import_react.useState)("");
    async function load() {
      setStatus("读取中…");
      setFailed(false);
      try {
        const res = await fetch(REPORT_URL, { cache: "no-store" });
        const r = await res.json();
        if (r && r.ok) {
          setReport(r);
          setStatus("");
        } else {
          setFailed(true);
          setStatus("读取失败：" + String(r && r.error || "未知错误"));
        }
      } catch (error) {
        setFailed(true);
        setStatus("读取失败：" + String(error && error.message || error));
      }
    }
    (0, import_react.useEffect)(function() {
      load();
    }, []);
    async function repair(file) {
      setBusy(file);
      setFailed(false);
      setLastFix("");
      try {
        const res = await fetch(REPAIR_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file })
        });
        const r = await res.json();
        if (r && r.ok) {
          const n = Array.isArray(r.patchedSeqs) ? r.patchedSeqs.length : 0;
          setLastFix("已修复 " + sessionIdOf(file) + "：patched " + String(n) + " 处" + (r.backupPath ? "（备份：" + String(r.backupPath).split(/[\\/]/).pop() + "）" : "") + " · dsh-contract-check 能在坏之前发现违规插件");
          await load();
        } else {
          setFailed(true);
          setStatus("修复失败：" + String(r && r.error || "未知错误"));
        }
      } catch (error) {
        setFailed(true);
        setStatus("修复失败：" + String(error && error.message || error));
      } finally {
        setBusy("");
      }
    }
    const sessions = report && Array.isArray(report.sessions) ? report.sessions : [];
    const corrupt = sessions.filter(function(s) {
      return s && !s.ok && !s.error;
    });
    const errored = sessions.filter(function(s) {
      return s && s.error;
    });
    const summary = report && report.summary || {};
    const head = (0, import_react.createElement)(
      "div",
      { style: S.head },
      (0, import_react.createElement)(
        "span",
        { style: S.title },
        "会话体检（" + String(summary.scanned || 0) + " 个会话，" + String(corrupt.length) + " 个损坏）"
      ),
      (0, import_react.createElement)("button", { style: S.btn, disabled: busy !== "", onClick: load }, "重新扫描")
    );
    const banner = (0, import_react.createElement)(
      "div",
      { style: S.note },
      "扫描用的是 DSH 加载路径同款规则（loader-mirror）：任何一条事件违反约束，整个会话就会拒绝加载。只有「可无损修复」的那一族（tool-result 的 content 不是数组）能一键修；其余一律只报告，绝不猜测改写。"
    );
    const note = (0, import_react.createElement)(
      "div",
      { style: S.note },
      report && report.root ? "扫描目录：" + String(report.root) : ""
    );
    const rows = corrupt.map(function(s) {
      const id = sessionIdOf(s.file);
      const first = Array.isArray(s.findings) && s.findings.length > 0 ? s.findings[0] : null;
      const detail = first ? "line " + String(first.line) + " · seq " + String(first.seq) + " · " + String(first.reason || "") : "损坏（无细节）";
      const more = Array.isArray(s.findings) && s.findings.length > 1 ? "（另有 " + String(s.findings.length - 1) + " 处）" : "";
      return (0, import_react.createElement)(
        "div",
        { key: s.file, style: S.row },
        (0, import_react.createElement)(
          "div",
          { style: S.meta },
          (0, import_react.createElement)("div", { style: S.name, title: s.file }, id),
          (0, import_react.createElement)("div", { style: S.sub, title: s.file }, detail + more)
        ),
        s.repairable ? (0, import_react.createElement)("button", {
          style: S.btn,
          disabled: busy !== "",
          onClick: function() {
            repair(s.file);
          }
        }, busy === s.file ? "修复中…" : "修复") : (0, import_react.createElement)("span", { style: S.note }, "仅报告")
      );
    });
    const errRows = errored.slice(0, 5).map(function(s) {
      return (0, import_react.createElement)(
        "div",
        { key: s.file, style: S.row },
        (0, import_react.createElement)(
          "div",
          { style: S.meta },
          (0, import_react.createElement)("div", { style: S.name }, sessionIdOf(s.file)),
          (0, import_react.createElement)("div", { style: S.sub }, String(s.error))
        )
      );
    });
    return (0, import_react.createElement)(
      "div",
      { style: S.root },
      head,
      banner,
      note,
      status ? (0, import_react.createElement)("div", { style: failed ? S.err : S.status }, status) : null,
      lastFix ? (0, import_react.createElement)("div", { style: S.ok }, lastFix) : null,
      corrupt.length === 0 && !status ? (0, import_react.createElement)("div", { style: S.ok }, "没有发现会阻断加载的损坏。") : null,
      (0, import_react.createElement)("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, rows),
      errRows.length > 0 ? (0, import_react.createElement)("div", { style: S.note }, "以下会话连读取都失败（不是形状问题）：") : null,
      (0, import_react.createElement)("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, errRows),
      (0, import_react.createElement)(
        "div",
        { style: S.note },
        "每个能修的形态、判定依据、以及「为什么不修」的逐条原因，见仓库里的 docs/DEFECT-CATALOG.md。修复前会自动逐文件备份；要一次性修一批，用 CLI 的 safeguard（冷备 → 体检 → 修复 → 回读校验）。"
      )
    );
  }
  var client_default = {
    // slot 当硬依赖：拿不到就不激活，而不是静默什么都不做
    inject: ["slots"],
    apply(ctx) {
      const slots = ctx.slots;
      if (!slots) return;
      slots.inject("settings.section", function() {
        return slots.register(
          { name: "settings.section", id: "session-doctor", label: "会话体检", order: 62 },
          function() {
            return (0, import_react.createElement)(Panel, null);
          }
        );
      });
    }
  };
  return __toCommonJS(client_exports);
})();

		return __sessionDoctorClient.default || __sessionDoctorClient;
	}
});
