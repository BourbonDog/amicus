/**
 * @module electron/ipc-aliases
 * IPC for the setup wizard's "Needs review" section (issue 238 D9, Phase 3).
 *
 * `sidecar:get-alias-review` serves ONE document the page renders: the
 * review engine's proposals through `src/sidecar/aliases.js :: collectAliasView`
 * (the same view the CLI list and picker use — spec §2, one engine, two
 * renderers), whether a catalog was available, when it was fetched, whether
 * that is FRESH for the §5 write gate (`aliases-review-gate.js :: isFresh`,
 * 24 h), and the §5-gated id set the page's "choose…" control may offer
 * (`alias-proposals.js :: gatedCatalogIds`, the same set the CLI checks a
 * typed id against). The view is collected with `write: false`: the wizard
 * writes config from Finish ONLY (`sidecar:save-config`), so the on-entry
 * normalization every `amicus aliases` form performs is skipped here — the
 * page's labels already show the post-normalization state
 * (setup-ui-alias-state.js). The default catalog age applies, so a stale
 * cache refreshes inline exactly as the picker's does.
 *
 * `recordDismissals` is Finish's sink for "never ask again": the page stages
 * dismissKeys and `sidecar:save-config` (ipc-setup.js) hands them here after
 * the alias writes landed; each key rides `alias-store.js :: recordDismissal`,
 * which validates it (`alias@proposedId`) and throws otherwise — the
 * renderer's catch re-enables Finish, same as a failed saveConfig.
 *
 * Never rejects: a failed collection resolves to the same shape with an
 * `error` message, so the page can say WHY it cannot check for updates
 * instead of rendering a silent "nothing to review".
 */

'use strict';

const { logger } = require('../src/utils/logger');

/** @returns {object} real collaborators; tests inject their own */
function defaultDeps() {
  return {
    collectAliasView: (opts) => {
      const aliases = require('../src/sidecar/aliases');
      return aliases.collectAliasView(opts, aliases.loadDeps());
    },
    isFresh: require('../src/sidecar/aliases-review-gate').isFresh,
    gatedCatalogIds: require('../src/utils/alias-proposals').gatedCatalogIds,
    now: () => Date.now(),
  };
}

/**
 * @param {object} [deps] see `defaultDeps`
 * @returns {Promise<{proposals: Array<object>, catalogAvailable: boolean, fetchedAt: number|null,
 *   fresh: boolean, gatedIds: string[], error?: string}>}
 */
async function buildAliasReviewResponse(deps = defaultDeps()) {
  try {
    const view = (await deps.collectAliasView({ write: false })) || {};
    const info = (view.catalogInfo && typeof view.catalogInfo === 'object') ? view.catalogInfo : {};
    const fetchedAt = typeof info.fetchedAt === 'number' ? info.fetchedAt : null;
    return {
      proposals: Array.isArray(view.proposals) ? view.proposals : [],
      catalogAvailable: !!view.catalogAvailable,
      fetchedAt,
      fresh: deps.isFresh(fetchedAt, deps.now()),
      gatedIds: deps.gatedCatalogIds(info),
    };
  } catch (err) {
    logger.error('get-alias-review handler error', { error: err && err.message });
    return { proposals: [], catalogAvailable: false, fetchedAt: null, fresh: false, gatedIds: [], error: String((err && err.message) || err) };
  }
}

/**
 * @param {unknown} keys the page's staged dismissKeys (`alias@proposedId`), or nothing
 * @returns {number} how many were recorded
 * @throws {Error} when `keys` is not an array, or a key is not a valid dismissKey (from `recordDismissal`)
 */
function recordDismissals(keys) {
  if (keys === undefined || keys === null) { return 0; }
  if (!Array.isArray(keys)) { throw new Error('dismissals must be an array of alias@proposedId keys'); }
  const { recordDismissal } = require('../src/utils/alias-store');
  let n = 0;
  for (const key of keys) { recordDismissal(key); n += 1; }
  return n;
}

/**
 * @param {{handle: Function}} ipcMain Electron's ipcMain, or a test double exposing `.handle`
 * @param {object} [deps] see `defaultDeps` (omitted in production)
 */
function registerAliasHandlers(ipcMain, deps) {
  ipcMain.handle('sidecar:get-alias-review', () => buildAliasReviewResponse(deps));
}

module.exports = { registerAliasHandlers, buildAliasReviewResponse, recordDismissals };
