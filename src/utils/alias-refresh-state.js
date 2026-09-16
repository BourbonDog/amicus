/**
 * @module utils/alias-refresh-state
 * #238 D5/Q8 — the ONE predicate behind the passive alias notice and the
 * opportunistic background catalog refresh, and the `amicus aliases` footer
 * line that names its standing half.
 *
 * Two layers, one truth. `refreshState` is the STANDING half — what a user
 * can turn off and keep off: `config.aliasReview.autoRefresh: false` (only a
 * literal false), `AMICUS_NO_NETWORK_PROBES=1` (the live-probes escape hatch,
 * utils/live-probes.js :: liveProbesAllowed — the same literal '1'), or a CI
 * environment. `exitHookAllowed` adds the per-invocation half — a terminal on
 * stdin, not `--json`, not `--quiet`, not the `mcp` command — and is what
 * bin/amicus.js's exit hook asks through utils/alias-notice.js. No new
 * environment variable (Q8).
 *
 * The CI signal is `is-in-ci`'s — the check update-notifier honours (MIT,
 * sindresorhus/is-in-ci@1.0.0): `CI` set to anything but `0`/`false`,
 * `CONTINUOUS_INTEGRATION` set, or any `CI_*` variable. Re-stated here
 * because that package is ESM-only and `ci-info` reaches this tree only
 * through jest — a devDependency an installed copy does not have.
 *
 * `catalogInfoFromCache` is the cache-only (§5 display gate) read the list
 * (sidecar/aliases.js :: collectAliasView) and the notice share: whatever is
 * on disk, verbatim, no freshness check.
 */

'use strict';

const { DEFAULT_MAX_AGE_MS } = require('./model-catalog');

/** @type {number} A week in ms — Q1's refresh threshold; also the "on" hint threshold of refreshStateLine (R-P4-8). */
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const DISABLED_REASON = { config: 'aliasReview.autoRefresh: false', env: 'AMICUS_NO_NETWORK_PROBES=1', ci: 'CI' };

/** @param {object} env @returns {boolean} is-in-ci's predicate, verbatim */
function isInCi(env) {
  return env.CI !== '0' && env.CI !== 'false'
    && ('CI' in env || 'CONTINUOUS_INTEGRATION' in env || Object.keys(env).some(k => k.startsWith('CI_')));
}

/**
 * The standing half of the Q8 predicate.
 * @param {{config?: object|null, env?: object}} [input] the loaded config (null = none) and the environment
 * @returns {{enabled: boolean, disabledBy: null|'config'|'env'|'ci'}} the first reason that applies, in that order
 */
function refreshState({ config = null, env = process.env } = {}) {
  const ar = config && config.aliasReview && typeof config.aliasReview === 'object' ? config.aliasReview : null;
  if (ar && ar.autoRefresh === false) { return { enabled: false, disabledBy: 'config' }; }
  if (env.AMICUS_NO_NETWORK_PROBES === '1') { return { enabled: false, disabledBy: 'env' }; }
  if (isInCi(env)) { return { enabled: false, disabledBy: 'ci' }; }
  return { enabled: true, disabledBy: null };
}

/**
 * The whole predicate — the notice and the refresh both hang on it (D5).
 * @param {{command: string, args: object, stdinIsTTY: boolean, config?: object|null, env?: object}} input
 * @returns {boolean}
 */
function exitHookAllowed({ command, args, stdinIsTTY, config = null, env = process.env }) {
  if (!stdinIsTTY || command === 'mcp') { return false; }
  if (args && (args.json || args.quiet)) { return false; }
  return refreshState({ config, env }).enabled;
}

/**
 * `catalog is 3 days old` / `catalog is 1 hour old` — the Electron banner's
 * arithmetic (electron/setup-ui-alias-review-text.js :: reviewBanner), so the
 * two surfaces never disagree on an age.
 * @param {number|null} fetchedAt
 * @param {number} [now]
 * @returns {string}
 */
function catalogAgeText(fetchedAt, now = Date.now()) {
  if (typeof fetchedAt !== 'number') { return 'no catalog'; }
  const ms = Math.max(0, now - fetchedAt);
  const days = Math.floor(ms / 86400000);
  const hours = Math.max(1, Math.floor(ms / 3600000));
  const age = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${hours} hour${hours === 1 ? '' : 's'}`;
  return `catalog is ${age} old`;
}

/**
 * The `amicus aliases` footer line (spec §4). The `amicus models --refresh`
 * hint (Phase 1's F1) rides along exactly when nothing else will refresh the
 * catalog for the user: past 24 h when the background refresh is off, past
 * the weekly threshold when it is on and evidently not keeping up.
 * @param {{enabled: boolean, disabledBy: null|string}} state from `refreshState`
 * @param {number|null} fetchedAt
 * @param {number} [now]
 * @returns {string} two-space indented, no trailing newline
 */
function refreshStateLine(state, fetchedAt, now = Date.now()) {
  const head = state.enabled ? 'on (weekly)' : `off (${DISABLED_REASON[state.disabledBy] || state.disabledBy})`;
  const age = typeof fetchedAt === 'number' ? now - fetchedAt : 0;
  const hint = age > (state.enabled ? REFRESH_MAX_AGE_MS : DEFAULT_MAX_AGE_MS) ? ' — amicus models --refresh' : '';
  return `  background catalog refresh: ${head} — ${catalogAgeText(fetchedAt, now)}${hint}`;
}

/**
 * @param {{models?: Array, fetchedAt?: number, providerFailures?: Array}|null} doc `model-catalog.js :: readCache`'s document
 * @returns {{models: Array, fetchedAt: number|null, providerFailures: Array}} the engine's `catalogInfo` shape
 */
function catalogInfoFromCache(doc) {
  return {
    models: (doc && Array.isArray(doc.models)) ? doc.models : [],
    fetchedAt: doc && typeof doc.fetchedAt === 'number' ? doc.fetchedAt : null,
    providerFailures: (doc && Array.isArray(doc.providerFailures)) ? doc.providerFailures : [],
  };
}

module.exports = { refreshState, exitHookAllowed, refreshStateLine, catalogInfoFromCache, REFRESH_MAX_AGE_MS };
