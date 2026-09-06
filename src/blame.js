// blame.js — accident attribution: did an agent tool call kill the process?
//
// Answers, for one session artifact or a whole sessions root: "did the DSH /
// browser / app shutdown get caused by the model itself calling a tool?" —
// the forensic reading of a session log after an abrupt stop.
//
// Method (dual evidence, deliberately conservative — never accuse without both):
//   1. Find interruption markers: `tool/result` carrying the loader's
//      "tool call was interrupted" error, or `turn/end` with
//      reason.kind === "interrupted".
//   2. Look back to the last `tool/call` before the interruption and extract
//      the actual shell command from its JSON arguments.
//   3. Match the command against danger patterns (kill-process,
//      browser-close, self-restart). A dangerous call PLUS an interruption
//      right after it => agent-caused. A dangerous call with no interruption
//      => not an accident (the call may have failed or been harmless). An
//      interruption with no dangerous call before it => external cause.
//
// Read-only: never writes or modifies any session file.

import { readFile } from "node:fs/promises";
import { decodeFrames, scanFrames } from "./zstd.js";
import { findArtifacts } from "./scan.js";

/** Danger pattern groups, matched against the shell command text of a tool call. */
const DANGER_PATTERNS = [
  {
    category: "kill-process",
    label: "杀进程类（taskkill / Stop-Process / pkill / kill / Stop-Service / net stop 等）",
    re: /(taskkill\b|Stop-Process\b|pkill\b|killall\b|wmic\s+process|Stop-Service\b|net\s+stop\b|\bkill\s+-)/i
  },
  {
    category: "browser-close",
    label: "浏览器关闭（agent-browser close 等）",
    re: /agent-browser\s+close/i
  },
  {
    category: "self-restart",
    label: "自重启 harness（杀 dsh/node 进程后重新拉起）",
    re: /(restart[-\s_]*harness|harness.*restart|node\.exe.*dsh|dsh.*bin\.js|Start-Process.*(node|dsh))/i
  }
];

/** Pull the shell command text out of a tool call's JSON arguments. */
function extractCommand(callData) {
  const argsText = callData?.arguments;
  if (typeof argsText !== "string" || argsText.length === 0) return "";
  try {
    const a = JSON.parse(argsText);
    if (a && typeof a === "object") {
      for (const key of ["command", "script", "input", "expression", "prompt"]) {
        const v = a[key];
        if (typeof v === "string" && v.length > 0) return v;
      }
    }
    return "";
  } catch {
    return ""; // non-JSON arguments (e.g. opaque tools) — nothing to match
  }
}

function matchPatterns(command) {
  const hits = [];
  for (const p of DANGER_PATTERNS) {
    if (p.re.test(command)) hits.push({ category: p.category, label: p.label });
  }
  return hits;
}

/**
 * Attribute one session artifact.
 * @param {string} file - path to a session.jsonl[.zstd] artifact.
 * @returns {Promise<object>} report:
 *   { file, ok, error?, lines?, accident: boolean, suspect: object|null,
 *     interruptions: Array, verdict: "no-accident"|"agent-caused"|"external" }
 *   suspect: { line, seq, time, callId, name, command, patterns: [{category,label}] }
 */
export async function blameSessionFile(file) {
  let buf;
  try {
    buf = await readFile(file);
  } catch (error) {
    return { file, ok: false, error: error?.code === "ENOENT" ? "file not found" : String(error?.message ?? error) };
  }
  // A torn tail means the process died mid-write: the final write was cut off,
  // so the last evidence batch is missing. decodeFrames drops it; we still
  // report it so the user knows attribution rests on incomplete evidence.
  let tornTail = false;
  let lines;
  try {
    const { tornStart } = scanFrames(buf);
    tornTail = tornStart !== undefined;
    lines = decodeFrames(buf).split(/\r?\n/);
  } catch (error) {
    return { file, ok: false, error: `decode: ${String(error?.message ?? error)}` };
  }

  const calls = []; // every tool/call: { line, seq, time, callId, name, command }
  const interruptions = []; // { line, seq, time, kind: "tool-interrupted"|"turn-interrupted", callId? }
  let nonEmpty = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw.length === 0) continue;
    nonEmpty++;
    if (nonEmpty === 1) continue; // header line
    let ev;
    try { ev = JSON.parse(raw); } catch { continue; } // tolerate a bad line
    const type = ev?.type;
    if (type === "tool/call" && ev.data && typeof ev.data.callId === "string") {
      calls.push({
        line: i + 1,
        seq: ev.seq,
        time: ev.time,
        callId: ev.data.callId,
        name: ev.data.name,
        command: extractCommand(ev.data)
      });
    } else if (type === "tool/result") {
      const block = ev.data?.message?.content?.[0];
      const isError = block?.isError === true;
      const text = JSON.stringify(block?.content ?? "");
      if (isError && /interrupted/i.test(text)) {
        interruptions.push({
          line: i + 1,
          seq: ev.seq,
          time: ev.time,
          kind: "tool-interrupted",
          callId: ev.data?.message?.source?.callId
        });
      }
    } else if (type === "turn/end") {
      const kind = ev.data?.reason?.kind ?? ev.data?.reason;
      if (kind === "interrupted") {
        interruptions.push({ line: i + 1, seq: ev.seq, time: ev.time, kind: "turn-interrupted" });
      }
    }
  }

  if (interruptions.length === 0) {
    return { file, ok: true, lines: nonEmpty, tornTail, accident: false, suspect: null, interruptions: [], verdict: "no-accident" };
  }

  const base = { file, ok: true, lines: nonEmpty, tornTail, interruptions };

  // The latest interruption is the accident we attribute. Find the tool call
  // that precedes it: exact callId when the marker names one, otherwise the
  // most recent call at or before the interruption's time.
  const last = interruptions[interruptions.length - 1];
  let suspectCall = null;
  if (last.callId) {
    suspectCall = calls.find((c) => c.callId === last.callId) ?? null;
  }
  if (!suspectCall) {
    for (let i = calls.length - 1; i >= 0; i--) {
      if ((calls[i].time ?? 0) <= (last.time ?? Infinity)) { suspectCall = calls[i]; break; }
    }
  }

  const patterns = suspectCall ? matchPatterns(suspectCall.command) : [];
  if (suspectCall && patterns.length > 0) {
    return {
      ...base,
      accident: true,
      suspect: { ...suspectCall, patterns },
      verdict: "agent-caused",
      interruptionVerdict: "agent-caused"
    };
  }
  return { ...base, accident: false, suspect: null, verdict: "external", interruptionVerdict: "external" };
}

/**
 * Attribute every session artifact under a sessions root.
 * @param {string} root - sessions root or any dir tree containing artifacts.
 * @returns {Promise<{ reports: object[], summary: {scanned:number,accident:number,clean:number} }>}
 */
export async function blameSessionRoot(root) {
  const reports = [];
  const summary = { scanned: 0, accident: 0, clean: 0 };
  const artifacts = await findArtifacts(root);
  for (const file of artifacts) {
    const report = await blameSessionFile(file);
    reports.push(report);
    summary.scanned++;
    if (report.accident) summary.accident++;
    else summary.clean++;
  }
  return { reports, summary };
}
