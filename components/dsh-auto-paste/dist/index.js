/**
 * Package entry of 「长文本转附件」 (dsh-auto-paste).
 *
 * The implementation lives in `../lib/host.js` — one zero-dependency module that
 * imports Node builtins only. This file exists because a running Harness caches
 * a bundle row's resolved entry (`dist/index.js` for this package since 2.3.8)
 * and keeps importing it until the process restarts; re-exporting from here lets
 * the rewritten component activate in place, with no restart and no stale code.
 *
 * @module dsh-auto-paste
 */
export * from "../lib/host.js";
