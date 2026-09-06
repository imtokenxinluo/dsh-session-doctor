// Fixture builder is async-friendly: rewrite helpers to plain async imports.
import { zstdCompressSync, constants } from "node:zlib";

export const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };

/** Compress one JSONL chunk as an independently decodable checksummed frame. */
export function frame(text) {
  return zstdCompressSync(Buffer.from(text, "utf8"), CHECKSUM_OPTIONS);
}

export function toolResult({ seq, callId = "call_1", content, isError = false }) {
  return {
    type: "tool/result",
    seq,
    time: 1700000000000 + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        source: { kind: "tool", callId },
        content: [{
          type: "tool-result",
          toolCallId: callId,
          content,
          ...(isError ? { isError: true } : {})
        }],
        role: "user",
        id: `msg-${seq}`
      }
    },
    surfaceOp: "append",
    sourceEventSeqs: [seq - 1]
  };
}

export function toolCall({ seq, callId = "call_1", name = "demo_tool", arguments: args = "{}" }) {
  return { type: "tool/call", seq, time: 1700000000000 + seq, data: { turn: 1, step: 1, callId, name, arguments: args } };
}

/** tool/call shaped like the real pwsh/bash calls: JSON arguments with a command field. */
export function shellCall({ seq, callId = "call_1", name = "pwsh", command }) {
  return toolCall({ seq, callId, name, arguments: JSON.stringify({ command }) });
}

/** tool/result carrying the loader's "interrupted after it was recorded" error. */
export function interruptedToolResult({ seq, callId = "call_1" }) {
  return {
    type: "tool/result",
    seq,
    time: 1700000000000 + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        source: { kind: "tool", callId },
        content: [{
          type: "tool-result",
          toolCallId: callId,
          isError: true,
          content: [{ type: "text", text: "The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown." }]
        }],
        role: "user",
        id: `msg-${seq}`
      }
    },
    surfaceOp: "append",
    sourceEventSeqs: [seq - 1]
  };
}

/** turn/end with a reason kind (completed | interrupted). */
export function turnEnd({ seq, reasonKind = "completed" }) {
  return { type: "turn/end", seq, time: 1700000000000 + seq, data: { turn: 1, reason: { kind: reasonKind } } };
}

export function userMessage({ seq, text = "hello" }) {
  return {
    type: "user/message",
    seq,
    time: 1700000000000 + seq,
    data: { content: [{ type: "text", text }], source: { kind: "user" }, role: "user", id: `u-${seq}` },
    surfaceOp: "append"
  };
}

export function stepStart({ seq }) {
  return { type: "step/start", seq, time: 1700000000000 + seq, data: { turn: 1, step: 1 } };
}

/** Serialize a session header + events into the concatenated-frame artifact. */
export function buildSessionLog({ id = "session-test", events = [] }) {
  const header = {
    type: "session",
    version: 0,
    id,
    createdAt: 1700000000000,
    cwd: "C:\\test",
    delegationDepth: 0,
    agentPreset: "standard"
  };
  const parts = [frame(JSON.stringify(header) + "\n")];
  let chunk = "";
  const flush = () => {
    if (chunk.length > 0) { parts.push(frame(chunk)); chunk = ""; }
  };
  for (const ev of events) {
    chunk += JSON.stringify(ev) + "\n";
    if (chunk.length > 4000) flush();
  }
  flush();
  return Buffer.concat(parts);
}
