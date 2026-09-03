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

export default {
  name: "session-doctor-watch",
  apply(ctx, config = {}) {
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
  }
};
