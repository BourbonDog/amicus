/**
 * @module utils/alias-notice
 * #238 D5 — the passive alias notice and the weekly background catalog refresh, run from bin/amicus.js's exit listener.
 * Both run through `runExitHook` (the slot the update notice uses, so the
 * line lands AFTER the command's own output and stdout stays byte-clean
 * under every command).
 *
 * Everything here is SYNCHRONOUS — an `'exit'` listener has no event loop —
 * and best-effort: a throw anywhere is swallowed, and this module prints
 * nothing but the notice line (the config write goes through config.js ::
 * saveConfig, whose own D6 Notices may precede the line, once), because an
 * awareness feature must never turn a finished command into a failed or
 * noisier one. The count comes from the catalog CACHE at any age (§5 display
 * gate) through the same engine the list and the pickers use
 * (alias-proposals.js :: buildAliasProposals) over the in-memory normalized
 * aliases — the no-write probe sidecar/aliases.js :: normalizeOnEntry takes
 * with `write: false`. The notice path never networks and writes nothing but
 * `config.aliasReview.lastNotified` (`stampAliasReview`, the config.js ::
 * markMigrationNotified shape: load, set, save, swallow — and saveConfig's
 * own D6 normalization rides that write, once, visibly).
 *
 * The refresh is `amicus models --refresh` in a detached child of this very
 * binary — keys included, the SAME model-catalog.js :: refreshCatalog (a
 * keyless refresh would overwrite the direct-provider rows setup and doctor
 * rely on) — spawned the way sidecar/workspace-window.js spawns the
 * workspace, so it can neither block nor fail the run: `detached` keeps it
 * out of libuv's kill-on-close job, `windowsHide` keeps a console window from
 * opening on Windows. Its stdin is not a terminal, so the child's own exit
 * hook is silent by `exitHookAllowed`'s first term: no recursion.
 * `runExitHook` stamps `config.aliasReview.lastRefreshSpawned` before it
 * spawns and never starts another child within a day of it (R-P4-11 —
 * `refreshCatalog` writes the cache only at its end, so `fetchedAt` alone
 * cannot tell a running refresh from a missing one); `refreshDue` also backs
 * off a day after a failed attempt (`lastRefreshAttempt`, model-catalog.js ::
 * writeRefreshFailure) for a config dir that cannot be written. A
 * future-dated stamp reads as never (a wrong clock self-heals).
 */

'use strict';

const path = require('path');
const { exitHookAllowed, catalogInfoFromCache, REFRESH_MAX_AGE_MS } = require('./alias-refresh-state');

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
  return {
    loadConfig: config.loadConfig,
    saveConfig: config.saveConfig,
    getDefaultAliases: config.getDefaultAliases,
    normalizeAliases: require('./alias-state').normalizeAliases,
    buildAliasProposals: require('./alias-proposals').buildAliasProposals,
    readDismissals: require('./alias-store').readDismissals,
    loadCuratedPins: require('./curated-pins').loadCuratedPins,
    readCache: require('./model-catalog').readCache,
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
 * @returns {number} 0 on any failure — a count nobody can verify is not printed
 */
function countProposals(d, cfg) {
  try {
    d = d || loadDeps();
    if (cfg === undefined) { cfg = d.loadConfig(); }
    const defaults = d.getDefaultAliases();
    const raw = cfg && cfg.aliases && typeof cfg.aliases === 'object' ? cfg.aliases : {};
    const userAliases = d.normalizeAliases(raw, defaults).aliases;
    const { retired, notable } = d.loadCuratedPins();
    const catalogInfo = catalogInfoFromCache(d.readCache());
    return d.buildAliasProposals({ userAliases, defaults, catalogInfo, retired, notable, dismissed: d.readDismissals() }).length;
  } catch { return 0; }
}

/**
 * Q1: a cache exists, is older than a week, and no refresh was attempted or started in the last day.
 * No cache at all is NOT due: there is nothing to age, and setup/doctor/models create it.
 * @param {{fetchedAt?: number, lastRefreshAttempt?: number|null}|null} doc `readCache()`'s document
 * @param {number} [now]
 * @param {number|null} [lastSpawned] config.aliasReview.lastRefreshSpawned
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
  try {
    d = d || loadDeps();
    const child = d.spawn(d.execPath, [d.binPath, 'models', '--refresh'],
      { detached: true, stdio: 'ignore', windowsHide: true, env: d.env });
    // An unlistened ChildProcess 'error' is an uncaught exception (workspace-window.js's note).
    if (child && typeof child.on === 'function') { child.on('error', () => {}); }
    if (child && typeof child.unref === 'function') { child.unref(); }
    return true;
  } catch { return false; }
}

/** Best-effort `config.aliasReview[key] = now` — the config.js :: markMigrationNotified shape: load, set, save, swallow. */
function stampAliasReview(key, now, d) {
  try {
    const cfg = d.loadConfig() || {};
    if (!cfg.aliasReview || typeof cfg.aliasReview !== 'object') { cfg.aliasReview = {}; }
    cfg.aliasReview[key] = now;
    d.saveConfig(cfg);
  } catch { /* a persistence hiccup never touches the command that just finished */ }
}

/**
 * The exit hook. Decides, stamps, prints at most one line, spawns — or does nothing.
 * @param {{code: number, command: string, args: object, stdinIsTTY: boolean}} run the finished command
 * @param {object} [d] collaborators
 * @returns {{notice: boolean, refresh: boolean}} what fired — never throws
 */
function runExitHook(run, d) {
  const out = { notice: false, refresh: false };
  try {
    d = d || loadDeps();
    const { code, command, args, stdinIsTTY } = run || {};
    const cfg = d.loadConfig();
    if (!exitHookAllowed({ command, args, stdinIsTTY, config: cfg, env: d.env })) { return out; }
    const now = d.now();
    const ar = cfg && cfg.aliasReview && typeof cfg.aliasReview === 'object' ? cfg.aliasReview : {};
    // `amicus aliases` IS the notice's destination and already prints the count — no echo behind it.
    if (command !== 'aliases' && expired(ar.lastNotified, NOTICE_INTERVAL_MS, now)) {
      const n = countProposals(d, cfg);
      if (n > 0) {
        stampAliasReview('lastNotified', now, d);   // first, so the notice is the last line on stderr (saveConfig may print D6 Notices)
        d.stderr.write(`\n  ${n} alias update${n === 1 ? '' : 's'} available — amicus aliases --review\n`);
        out.notice = true;
      }
    }
    if (code === 0 && refreshDue(d.readCache(), now, ar.lastRefreshSpawned)) {
      stampAliasReview('lastRefreshSpawned', now, d);   // R-P4-11: before the spawn — the child's own writes come only at its end
      out.refresh = spawnDetachedRefresh(d);
    }
  } catch { /* best-effort: an awareness feature never fails a finished command */ }
  return out;
}

module.exports = { runExitHook, countProposals, refreshDue, spawnDetachedRefresh };
