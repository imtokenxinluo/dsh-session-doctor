// index.js — public API of dsh-session-doctor.
//
// The package's DEFAULT export is the cordis watch plugin: the profile loader
// imports the package by name, unwraps `default`, and mounts it as a plugin
// row (see cordis.patch.yml). Named exports remain the programmatic API for
// tools/CLI users who import specific modules.

export { scanSessionFile, scanSessionRoot, findArtifacts } from "./scan.js";
export { repairSessionFile, patchToolResultLine } from "./repair.js";
export { validateEvent, validateLog } from "./validate.js";
export { createSessionWatcher, createSessionSentinel } from "./watch.js";
export { scanFrames, decodeFrames, encodeFrames, splitLines } from "./zstd.js";
export { blameSessionFile, blameSessionRoot } from "./blame.js";

import plugin from "./plugin.js";
export default plugin;
