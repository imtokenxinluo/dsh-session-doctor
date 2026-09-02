// index.js — public API of dsh-session-doctor.
export { scanSessionFile, scanSessionRoot, findArtifacts } from "./scan.js";
export { repairSessionFile, patchToolResultLine } from "./repair.js";
export { validateEvent, validateLog } from "./validate.js";
export { scanFrames, decodeFrames, encodeFrames, splitLines } from "./zstd.js";
