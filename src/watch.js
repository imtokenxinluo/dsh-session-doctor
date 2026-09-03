// watch.js — live sentinel: validate message events as a session appends them.
//
// DSH publishes every accepted event to `ctx` listeners as `session/event`
// (session, event) — see dsh-session-persistence's own subscription. A watcher
// subscribes there and re-runs the loader-mirror shape validation immediately,
// so a contract-violating tool/result is surfaced the moment it is written,
// instead of silently poisoning the log until the NEXT load refuses the whole
// session.
//
// Honest boundary: `session/event` fires AFTER the event entered the session
// log, so watch cannot stop the write (that requires the P0 kernel guard). It
// warns and hands the violation to `onViolation`; for a live session that is
// the right scope — repairing a file the writer still owns would race.

import { validateEvent } from "./validate.js";

/**
 * Create a session watcher.
 * @param {object} [opts]
 * @param {(session: object, violation: object) => void} [opts.onViolation]
 * @returns {{
 *   remember(session, event): void,
 *   check(session, event): object | null,
 *   violations(): number
 * }}
 */
export function createSessionWatcher(opts = {}) {
  const onViolation = opts.onViolation;
  /** per-session callId -> tool name, fed by tool/call events */
  const callTools = new Map();
  let count = 0;

  function sessionKey(session) {
    const id = session?.header?.id ?? session?.id;
    if (typeof id !== "string" || id === "") return "<session>";
    return id;
  }

  return {
    /**
     * Record a durable fact from a non-message event (currently: tool/call →
     * callId→tool name) so later tool/result findings can name the tool.
     */
    remember(session, event) {
      if (event?.type === "tool/call" && event.data && typeof event.data.callId === "string") {
        let map = callTools.get(sessionKey(session));
        if (!map) { map = new Map(); callTools.set(sessionKey(session), map); }
        map.set(event.data.callId, event.data.name);
      }
    },

    /**
     * Validate one freshly-appended event. Returns the violation object
     * (loader-mirror reason, plus tool name when known) or null when clean.
     */
    check(session, event) {
      if (!event || typeof event !== "object") return null;
      const reason = validateEvent(event);
      if (reason === null) return null;
      const violation = { seq: event.seq, type: event.type, reason };
      if (event.type === "tool/result" && event.data?.message?.source?.callId) {
        const callId = event.data.message.source.callId;
        const tool = callTools.get(sessionKey(session))?.get(callId);
        if (tool !== undefined) violation.tool = tool;
      }
      count++;
      if (onViolation) {
        try { onViolation(session, violation); } catch { /* listener containment */ }
      }
      return violation;
    },

    violations() { return count; }
  };
}

/**
 * Convenience: a single watcher that also calls remember() for every event,
 * i.e. drop-in for a ctx.on("session/event", handler) subscription.
 */
export function createSessionSentinel(opts = {}) {
  const watcher = createSessionWatcher(opts);
  return {
    ...watcher,
    handle(session, event) {
      watcher.remember(session, event);
      return watcher.check(session, event);
    }
  };
}
