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
 * typed id against). `fresh` is the verdict at FETCH time; `freshUntil`
 * (fetchedAt + the catalog's max age) lets the page re-check at ACTION time,
 * so a wizard left open past the gate does not stage a catalog-vouched id on
 * a frozen flag (council review of PR 253, A4). The view is collected with `write: false`: the wizard
 * writes config from Finish ONLY (`sidecar:save-config`), so only the on-entry
 * normalization's SAVE is skipped here — the view itself is still normalized
 * in memory, so the page's labels already show the post-normalization state
 * (setup-ui-alias-state.js). The default catalog age applies, so a stale
 * cache refreshes inline exactly as the picker's does.
 *
 * `applyDismissals` is Finish's "never ask again" step: the page stages
 * dismissKeys and `sidecar:save-config` (ipc-setup.js) stamps them into the
 * SAME config object it then saves ONCE, each key through
 * `alias-store.js :: stampDismissal` (validates `alias@proposedId`, throws
 * otherwise) — so a malformed key rejects BEFORE anything reaches disk and
 * the renderer's catch re-enables Finish with nothing written (council
 * review of PR 253: B1/C4/A5/D3 — the previous after-the-save recording
 * could leave the alias writes persisted while the invoke rejected and the
 * page said the save failed). Nothing here loads or saves config.
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
    maxAgeMs: require('../src/utils/model-catalog').DEFAULT_MAX_AGE_MS,
  };
}

/**
 * @param {object} [deps] see `defaultDeps`
 * @returns {Promise<{proposals: Array<object>, catalogAvailable: boolean, fetchedAt: number|null,
 *   fresh: boolean, freshUntil: number|null, gatedIds: string[], error?: string}>}
 *   `fresh` = the §5 verdict at fetch time; `freshUntil` = the ms timestamp until
 *   which that verdict holds (null when there is no catalog or no timestamp)
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
      fresh: !!view.catalogAvailable && deps.isFresh(fetchedAt, deps.now()),
      freshUntil: (!!view.catalogAvailable && typeof fetchedAt === 'number') ? fetchedAt + deps.maxAgeMs : null,
      gatedIds: deps.gatedCatalogIds(info),
    };
  } catch (err) {
    logger.error('get-alias-review handler error', { error: err && err.message });
    return { proposals: [], catalogAvailable: false, fetchedAt: null, fresh: false, freshUntil: null, gatedIds: [], error: String((err && err.message) || err) };
  }
}

/**
 * Stamp the page's staged dismissals into `cfg` — no load, no save: the caller
 * (sidecar:save-config) saves `cfg` once, after this. The WHOLE batch is
 * validated before the first stamp, so a malformed key leaves `cfg` exactly as
 * it was (council round 2 of PR 253, A2): a caller that catches may reuse it.
 * @param {object} cfg the config object about to be saved (mutated)
 * @param {unknown} keys the page's staged dismissKeys (`alias@proposedId`), or nothing
 * @param {Date} [now]
 * @returns {number} how many were stamped
 * @throws {Error} when `keys` is not an array, or a key is not a valid dismissKey (from `stampDismissal`)
 */
function applyDismissals(cfg, keys, now = new Date()) {
  if (keys === undefined || keys === null) { return 0; }
  if (!Array.isArray(keys)) { throw new Error('dismissals must be an array of alias@proposedId keys'); }
  const { stampDismissal } = require('../src/utils/alias-store');
  for (const key of keys) { stampDismissal({}, key, now); }   // validate all first, against a throwaway: a bad key throws before cfg changes
  let n = 0;
  for (const key of keys) { stampDismissal(cfg, key, now); n += 1; }
  return n;
}

/**
 * @param {{handle: Function}} ipcMain Electron's ipcMain, or a test double exposing `.handle`
 * @param {object} [deps] see `defaultDeps` (omitted in production)
 */
function registerAliasHandlers(ipcMain, deps) {
  ipcMain.handle('sidecar:get-alias-review', () => buildAliasReviewResponse(deps));
}

module.exports = { registerAliasHandlers, buildAliasReviewResponse, applyDismissals };
