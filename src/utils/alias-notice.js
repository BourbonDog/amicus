/**
 * @module utils/alias-notice
 * #238 D5 — the passive alias notice and the opportunistic background catalog
 * refresh, both run from bin/amicus.js's `'exit'` listener through
 * `runExitHook` (the slot the update notice uses, so the line lands AFTER the
 * command's own output and stdout stays byte-clean under every command).
 *
 * Everything here is SYNCHRONOUS — an `'exit'` listener has no event loop —
 * and best-effort: a throw anywhere is swallowed, and nothing but the notice
 * line is ever printed, because an awareness feature must never turn a
 * finished command into a failed or noisier one. The count comes from the
 * catalog CACHE at any age (§5 display gate) through the same engine the list
 * and the pickers use (alias-proposals.js :: buildAliasProposals) over the
 * in-memory normalized aliases — the no-write probe sidecar/aliases.js ::
 * normalizeOnEntry takes with `write: false`. The notice path never networks
 * and writes nothing but `config.aliasReview.lastNotified` (`stampNotified`,
 * the config.js :: markMigrationNotified shape: load, set, save, swallow —
 * and saveConfig's own D6 normalization rides that write, once, visibly).
 *
 * The refresh is `amicus models --refresh` in a detached child of this very
 * binary — keys included, the SAME model-catalog.js :: refreshCatalog (a
 * keyless refresh would overwrite the direct-provider rows setup and doctor
 * rely on) — spawned the way sidecar/workspace-window.js spawns the
 * workspace, so it can neither block nor fail the run: `detached` keeps it
 * out of libuv's kill-on-close job, `windowsHide` keeps a console window from
 * opening on Windows. Its stdin is not a terminal, so the child's own exit
 * hook is silent by `exitHookAllowed`'s first term: no recursion.
 * `refreshDue` also backs off a day after a failed attempt
 * (`lastRefreshAttempt`, model-catalog.js :: writeRefreshFailure) — an
 * offline machine gets one child a day, not one per command.
 */

'use strict';

const path = require('path');
const { exitHookAllowed, catalogInfoFromCache, REFRESH_MAX_AGE_MS } = require('./alias-refresh-state');

const NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;   // Q5: at most once a day
const ATTEMPT_BACKOFF_MS = 24 * 60 * 60 * 1000;   // a failed refresh is retried daily, never per command
const BIN_PATH = path.join(__dirname, '..', '..', 'bin', 'amicus.js');

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
function countProposals(d = loadDeps(), cfg = d.loadConfig()) {
  try {
    const defaults = d.getDefaultAliases();
    const raw = cfg && cfg.aliases && typeof cfg.aliases === 'object' ? cfg.aliases : {};
    const userAliases = d.normalizeAliases(raw, defaults).aliases;
    const { retired, notable } = d.loadCuratedPins();
    const catalogInfo = catalogInfoFromCache(d.readCache());
    return d.buildAliasProposals({ userAliases, defaults, catalogInfo, retired, notable, dismissed: d.readDismissals() }).length;
  } catch { return 0; }
}

/**
 * Q1: a cache exists, is older than a week, and no refresh was attempted in the last day.
 * No cache at all is NOT due: there is nothing to age, and setup/doctor/models create it.
 * @param {{fetchedAt?: number, lastRefreshAttempt?: number|null}|null} doc `readCache()`'s document
 * @param {number} [now]
 * @returns {boolean}
 */
function refreshDue(doc, now = Date.now()) {
  if (!doc || typeof doc.fetchedAt !== 'number') { return false; }
  if (now - doc.fetchedAt <= REFRESH_MAX_AGE_MS) { return false; }   // a future fetchedAt reads as fresh, as getCatalog's rule
  if (typeof doc.lastRefreshAttempt === 'number' && now - doc.lastRefreshAttempt < ATTEMPT_BACKOFF_MS) { return false; }
  return true;
}

/**
 * `amicus models --refresh`, detached, silent, unref'd — the workspace-window.js shape.
 * @param {object} [d] collaborators
 * @returns {boolean} true when the child was spawned (never that it succeeded)
 */
function spawnDetachedRefresh(d = loadDeps()) {
  try {
    const child = d.spawn(d.execPath, [d.binPath, 'models', '--refresh'],
      { detached: true, stdio: 'ignore', windowsHide: true, env: d.env });
    // An unlistened ChildProcess 'error' is an uncaught exception (workspace-window.js's note).
    if (child && typeof child.on === 'function') { child.on('error', () => {}); }
    if (child && typeof child.unref === 'function') { child.unref(); }
    return true;
  } catch { return false; }
}

/** Best-effort `config.aliasReview.lastNotified = now` — the markMigrationNotified shape. */
function stampNotified(now, d) {
  try {
    const cfg = d.loadConfig() || {};
    if (!cfg.aliasReview || typeof cfg.aliasReview !== 'object') { cfg.aliasReview = {}; }
    cfg.aliasReview.lastNotified = now;
    d.saveConfig(cfg);
  } catch { /* a persistence hiccup never touches the command that just finished */ }
}

/**
 * The exit hook. Decides, stamps, prints at most one line, spawns — or does nothing.
 * @param {{code: number, command: string, args: object, stdinIsTTY: boolean}} run the finished command
 * @param {object} [d] collaborators
 * @returns {{notice: boolean, refresh: boolean}} what fired — never throws
 */
function runExitHook({ code, command, args, stdinIsTTY }, d = loadDeps()) {
  const out = { notice: false, refresh: false };
  try {
    const cfg = d.loadConfig();
    if (!exitHookAllowed({ command, args, stdinIsTTY, config: cfg, env: d.env })) { return out; }
    const now = d.now();
    // `amicus aliases` IS the notice's destination and already prints the count — no echo behind it.
    if (command !== 'aliases') {
      const last = cfg && cfg.aliasReview && typeof cfg.aliasReview.lastNotified === 'number' ? cfg.aliasReview.lastNotified : null;
      if (last === null || now - last >= NOTICE_INTERVAL_MS) {
        const n = countProposals(d, cfg);
        if (n > 0) {
          stampNotified(now, d);   // first, so the notice is the last line on stderr (saveConfig may print D6 Notices)
          d.stderr.write(`\n  ${n} alias update${n === 1 ? '' : 's'} available — amicus aliases --review\n`);
          out.notice = true;
        }
      }
    }
    if (code === 0 && refreshDue(d.readCache(), now)) { out.refresh = spawnDetachedRefresh(d); }
  } catch { /* best-effort: an awareness feature never fails a finished command */ }
  return out;
}

module.exports = { runExitHook, countProposals, refreshDue, spawnDetachedRefresh };
