/**
 * @module utils/alias-notice
 * #238 D5 — the passive alias notice and the weekly background catalog refresh, run from bin/amicus.js's exit listener.
 * Both run through `runExitHook` (the slot the update notice uses, so the
 * line lands AFTER the command's own output and stdout stays byte-clean
 * under every command).
 *
 * Everything here is SYNCHRONOUS — an `'exit'` listener has no event loop —
 * and best-effort: a throw anywhere is swallowed, and this module prints
 * nothing but the notice line, because an awareness feature must never turn
 * a finished command into a failed or noisier one. The count comes from the
 * catalog CACHE at any age (§5 display gate) through the same engine the
 * list and the pickers use (alias-proposals.js :: buildAliasProposals) over
 * the in-memory normalized aliases — the same in-memory normalization
 * `sidecar/aliases.js :: normalizeOnEntry` performs with `write: false`. The
 * hook only ever READS `config.json` (aliases, dismissals,
 * `aliasReview.autoRefresh`); it never writes it. Council #254 round 1
 * (A2/D5, A1/D3) moved the two timestamps this hook used to stamp into
 * config.json into their own machine-owned state; round 2 (R-P4-18/19)
 * split that into a directory, `alias-notice-state/` (utils/alias-notice-state.js)
 * — one file per stamp, `last-notified.json` and `last-refresh-spawned.json`,
 * each written atomically — plus `last-refresh.log`, the detached refresh
 * child's own stdout+stderr. No more truncate-and-write of the user's config
 * at the exit of routine commands, no more D6 normalization side effect
 * riding the first stamp, and no read-merge-write across the two stamps.
 * "No receipt, no spawn" (R-P4-11) becomes "no receipt, no notice or spawn"
 * (R-P4-15): a state-file write that fails leaves the command silent rather
 * than nagging on every exit. A missing or unparseable config reads as `{}`
 * (R-P4-20): no pins to review, so the notice stays silent, but the refresh
 * still runs against an aging catalog regardless — a `config.json` problem
 * must not also silence the unrelated background refresh. R-P4-17: the
 * cheap per-invocation and environment terms of the predicate run before
 * `loadConfig` or either file read, so a vetoed exit (no terminal, `--json`,
 * `--quiet`, `mcp`, `update`) touches no file at all.
 *
 * The refresh is `amicus models --refresh` in a detached child of this very
 * binary — keys included, the SAME model-catalog.js :: refreshCatalog (a
 * keyless refresh would overwrite the direct-provider rows setup and doctor
 * rely on) — spawned the way sidecar/workspace-window.js spawns the
 * workspace, so it can neither block nor fail the run: `detached` keeps it
 * out of libuv's kill-on-close job, `windowsHide` keeps a console window from
 * opening on Windows. Its stdin is not a terminal, so the child's own exit
 * hook is silent by `exitHookAllowed`'s first term: no recursion.
 * `runExitHook` writes `lastRefreshSpawned` to its own file in
 * `alias-notice-state/` BEFORE it spawns, and the spawn happens only when
 * that write returned true — no receipt, no spawn (R-P4-11): `refreshCatalog`
 * writes the cache only at its end, so `fetchedAt` alone cannot tell a
 * running refresh from a missing one, and a config dir that cannot be
 * written must not spawn a child on every exit. The child's stdout+stderr
 * are redirected to `alias-notice-state/last-refresh.log` (truncated per
 * run, R-P4-19), so a background refresh can be inspected after the fact;
 * the parent opens that file, hands the descriptor to the child through
 * `stdio`, and closes ITS OWN copy right after the spawn call returns (the
 * child holds its own independent handle) — when the log cannot be opened
 * the child still runs, silently, with `stdio: 'ignore'` (the log is
 * best-effort, never a gate on the refresh itself). A spawn that then fails
 * SYNCHRONOUSLY (R-P4-16) clears the stamp it just wrote, so the next exit
 * retries rather than waiting out a day it never actually started.
 * `refreshDue` separately backs off a day after an attempt that ran and
 * failed (`lastRefreshAttempt`, model-catalog.js :: writeRefreshFailure) — a
 * different case from the unwritable state file the spawn receipt now
 * covers. A future-dated stamp reads as never (a wrong clock self-heals).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { exitHookAllowed, refreshState, catalogInfoFromCache, REFRESH_MAX_AGE_MS } = require('./alias-refresh-state');

const NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;   // Q5: at most once a day
const ATTEMPT_BACKOFF_MS = 24 * 60 * 60 * 1000;   // a failed refresh is retried daily, never per command
const SPAWN_BACKOFF_MS = 24 * 60 * 60 * 1000;   // R-P4-11: at most one background refresh START per day
const BIN_PATH = path.join(__dirname, '..', '..', 'bin', 'amicus.js');

/**
 * @param {number|null|undefined} stamp epoch ms, or absent
 * @param {number} intervalMs
 * @param {number} now
 * @returns {boolean} true when the stamp is absent, at least `intervalMs` old, or in the FUTURE — a wrong clock must not silence anything until that date
 */
function expired(stamp, intervalMs, now) {
  return typeof stamp !== 'number' || stamp > now || now - stamp >= intervalMs;
}

/** @returns {object} this module's collaborators, gathered so a caller can override them in tests */
function loadDeps() {
  const config = require('./config');
  const noticeState = require('./alias-notice-state');
  return {
    loadConfig: config.loadConfig,
    getDefaultAliases: config.getDefaultAliases,
    normalizeAliases: require('./alias-state').normalizeAliases,
    buildAliasProposals: require('./alias-proposals').buildAliasProposals,
    readDismissals: require('./alias-store').readDismissals,
    loadCuratedPins: require('./curated-pins').loadCuratedPins,
    readCache: require('./model-catalog').readCache,
    readNoticeState: noticeState.readNoticeState,
    writeNoticeState: noticeState.writeNoticeState,
    refreshLogPath: noticeState.refreshLogPath,
    openRefreshLog: (p) => { fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); return fs.openSync(p, 'w', 0o600); },
    closeRefreshLog: (fd) => fs.closeSync(fd),
    spawn: require('child_process').spawn,
    execPath: process.execPath,
    binPath: BIN_PATH,
    env: process.env,
    stderr: process.stderr,
    now: Date.now,
  };
}

/**
 * Cache-only proposal count (§5 display gate) over the normalized-in-memory aliases.
 * @param {object} [d] collaborators
 * @param {object|null} [cfg] the loaded config, when the caller already holds it
 * @param {object|null} [doc] the cache document, when the caller already holds it
 * @returns {number} 0 on any failure — a count nobody can verify is not printed
 */
function countProposals(d, cfg, doc) {
  try {
    d = d || loadDeps();
    if (cfg === undefined) { cfg = d.loadConfig(); }
    if (doc === undefined) { doc = d.readCache(); }
    const defaults = d.getDefaultAliases();
    const raw = cfg && cfg.aliases && typeof cfg.aliases === 'object' ? cfg.aliases : {};
    const userAliases = d.normalizeAliases(raw, defaults).aliases;
    const { retired, notable } = d.loadCuratedPins();
    const catalogInfo = catalogInfoFromCache(doc);
    return d.buildAliasProposals({ userAliases, defaults, catalogInfo, retired, notable, dismissed: d.readDismissals() }).length;
  } catch { return 0; }
}

/**
 * Q1: a cache exists, is older than a week, and no refresh was attempted or started in the last day.
 * No cache at all is NOT due: there is nothing to age, and setup/doctor/models create it.
 * @param {{fetchedAt?: number, lastRefreshAttempt?: number|null}|null} doc `readCache()`'s document
 * @param {number} [now]
 * @param {number|null} [lastSpawned] `alias-notice-state/last-refresh-spawned.json`'s `at`
 * @returns {boolean}
 */
function refreshDue(doc, now = Date.now(), lastSpawned = null) {
  if (!doc || typeof doc.fetchedAt !== 'number') { return false; }
  if (now - doc.fetchedAt <= REFRESH_MAX_AGE_MS) { return false; }   // a future fetchedAt reads as fresh, as getCatalog's rule
  if (!expired(doc.lastRefreshAttempt, ATTEMPT_BACKOFF_MS, now)) { return false; }
  if (!expired(lastSpawned, SPAWN_BACKOFF_MS, now)) { return false; }   // R-P4-11: the child writes only at its end
  return true;
}

/**
 * `amicus models --refresh`, detached, silent, unref'd — the workspace-window.js shape.
 * @param {object} [d] collaborators
 * @returns {boolean} true when the child was spawned (never that it succeeded)
 */
function spawnDetachedRefresh(d) {
  let fd = null;
  try {
    d = d || loadDeps();
    // R-P4-19: the child's own lines (`Refreshed catalog: N models.` / `refresh failed (…)`) are
    // its trace; when the log cannot be opened the child still runs, silently.
    try { fd = d.openRefreshLog(d.refreshLogPath()); } catch { fd = null; }
    const stdio = fd === null ? 'ignore' : ['ignore', fd, fd];
    const child = d.spawn(d.execPath, [d.binPath, 'models', '--refresh'],
      { detached: true, stdio, windowsHide: true, env: d.env });
    // An unlistened ChildProcess 'error' is an uncaught exception (workspace-window.js's note).
    if (child && typeof child.on === 'function') { child.on('error', () => {}); }
    if (child && typeof child.unref === 'function') { child.unref(); }
    return true;
  } catch { return false; }
  finally { if (fd !== null) { try { d.closeRefreshLog(fd); } catch { /* the child holds its own handle */ } } }
}

/**
 * The exit hook. Decides, prints at most one line, spawns — or does nothing. Never writes config.json.
 * @param {{code: number, command: string, args: object, stdinIsTTY: boolean}} [run] the finished command
 * @param {object} [d] collaborators
 * @returns {{notice: boolean, refresh: boolean}} what fired — never throws
 */
function runExitHook(run, d) {
  const out = { notice: false, refresh: false };
  try {
    d = d || loadDeps();
    const { code, command, args, stdinIsTTY } = run || {};
    // R-P4-17: the per-invocation and environment terms first — a vetoed exit reads no file at all.
    if (!exitHookAllowed({ command, args, stdinIsTTY, config: null, env: d.env })) { return out; }
    // R-P4-20: a missing or unparseable config reads as {} — no pins to review, but the refresh
    // still runs on an aging catalog and the `aliases` footer's `on (weekly)` is then true.
    const cfg = d.loadConfig() || {};
    if (!refreshState({ config: cfg, env: d.env }).enabled) { return out; }
    const now = d.now();
    const doc = d.readCache();          // once per exit — the count and the refresh decision share it
    const state = d.readNoticeState();  // the two stamps live in alias-notice-state/, never in config (R-P4-14)
    // `amicus aliases` IS the notice's destination and already prints the count — no echo behind it.
    if (command !== 'aliases' && expired(state.lastNotified, NOTICE_INTERVAL_MS, now)) {
      const n = countProposals(d, cfg, doc);
      // R-P4-15: no receipt, no notice — an unwritable state dir means silence, not a per-command nag.
      if (n > 0 && d.writeNoticeState({ lastNotified: now })) {
        d.stderr.write(`\n  ${n} alias update${n === 1 ? '' : 's'} available — amicus aliases --review\n`);
        out.notice = true;
      }
    }
    // R-P4-11: the start is stamped BEFORE the spawn and the spawn needs the receipt ("no receipt, no spawn").
    if (code === 0 && refreshDue(doc, now, state.lastRefreshSpawned) && d.writeNoticeState({ lastRefreshSpawned: now })) {
      out.refresh = spawnDetachedRefresh(d);
      // R-P4-16: a spawn that failed synchronously is retried next exit, not masked for a day.
      if (!out.refresh) { d.writeNoticeState({ lastRefreshSpawned: null }); }
    }
  } catch { /* best-effort: an awareness feature never fails a finished command */ }
  return out;
}

module.exports = { runExitHook, countProposals, refreshDue, spawnDetachedRefresh };
