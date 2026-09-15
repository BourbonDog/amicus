/**
 * @module sidecar/aliases-owner
 * `amicus aliases --review --owner` (#238 D3/D4/D8): the SAME picker as
 * `--review` (aliases-review.js :: runReview, unchanged), pointed at the
 * shipped pins in src/utils/curated-pins.json instead of the user's config
 * — the owner's baseline reset (D3).
 *
 * Rows are ROUTES, not aliases, one `runReview` pass per gateway namespace
 * (openrouter first, then each direct namespace in file order; R-P2-1). A
 * namespace with no authoritative catalog row, or in `providerFailures`, is
 * announced and NOT reviewed, never "up to date". Every row is a custom pin:
 * no `follow`, no `never ask again` (R-P2-2), no notable.
 *
 * Gate (D8, split into aliases-owner-gate.js): a git source checkout with a
 * clean tree and a TTY. Refused = one stderr line, exit 1, nothing read or
 * written; a throwing load/catalog fetch is refused the same way (F3).
 *
 * Sink: an accept replaces the route under review via `setPinRoute` scoped
 * to the PASS's namespace — an id from another namespace is refused as the
 * picker's own `could not write: …` line (R-P2-5) — and stamps `verifiedOn`
 * (R-P2-12) through `commit()`'s compare-and-swap (#238 council r1 F1):
 * refused, nothing written, if curated-pins.json changed on disk since this
 * session loaded it. After the last pass each touched pin is prompted for an
 * optional ruling (enter keeps the current text; R-P2-9); `routeDisagreements`
 * names every non-divergent pin whose direct route no longer matches the
 * derived form of its openrouter route (R-P2-10). Review residual: Ctrl-C/EOF
 * in a raw-mode terminal (stdout a TTY) surfaces as the prompt's own
 * REVIEW_ABORTED (aliases-review-prompt.js) — rulings are skipped but the
 * summary still prints; with stdout piped, Ctrl-C is the ordinary process
 * signal instead and nothing further runs. Nothing here spends.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { DIVERGENT_VENDORS, stripGatewayPrefix } = require('../utils/curated-models');
const { loadCuratedPins, saveCuratedPins, setPinRoute, setPinRuling } = require('../utils/curated-pins');
const { refreshingCatalogLine } = require('./aliases-review-render');
const { gatedCatalogIds } = require('../utils/alias-proposals');
const { collapseExcerpt, safeFragment } = require('../utils/text-sanitize');
const { ownerGate } = require('./aliases-owner-gate');

const PKG_ROOT = path.resolve(__dirname, '..', '..');
const DATA_FILE = 'src/utils/curated-pins.json';
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const providerOf = (id) => (typeof id === 'string' ? id.split('/')[0] : '');

/** @returns {object} real collaborators; every one can be overridden through `deps` (tests inject git, the TTY, the prompt, today and the file) */
function defaultDeps() {
  const base = require('./aliases').loadDeps();
  return {
    ...base,
    isTTY: !!process.stdin.isTTY,
    write: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    // stderr ignored: the gate prints its own reason, git's "fatal: …" would double it
    git: (args) => execFileSync('git', args, { cwd: PKG_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    loadCuratedPins,
    saveCuratedPins,
    // F1: the CAS baseline, read through fs (never `require`, which caches) so a concurrent edit is visible; tests inject one bound to a temp file.
    readCuratedPinsBytes: () => fs.readFileSync(path.join(PKG_ROOT, 'src/utils/curated-pins.json'), 'utf8'),
    today: () => new Date().toISOString().slice(0, 10),
    now: () => Date.now(),
    runReview: (args, d) => require('./aliases-review').runReview(args, d),
    createPrompt: () => require('./aliases-review-prompt').createPrompt(),
  };
}

/**
 * @param {object} pins `loadCuratedPins().pins`
 * @returns {Object<string, Object<string,string>>} provider → { alias → id }, both null-prototype;
 *   `openrouter` is always first (seeded before the walk), the rest in first-seen file order
 */
function routesByProvider(pins) {
  const out = { __proto__: null, openrouter: { __proto__: null } };
  for (const alias of Object.keys(pins)) {
    for (const [provider, id] of Object.entries(pins[alias].routes)) {
      if (!own(out, provider)) { out[provider] = { __proto__: null }; }
      out[provider][alias] = id;
    }
  }
  return out;
}

/**
 * @param {object} pins
 * @returns {string[]} one line per NON-divergent pin whose direct route differs from its openrouter route's
 *   derived form (`stripGatewayPrefix`) — divergent vendors (anthropic) author both forms and are never compared
 */
function routeDisagreements(pins) {
  const lines = [];
  for (const alias of Object.keys(pins)) {
    const routes = pins[alias].routes;
    const derived = stripGatewayPrefix(routes.openrouter);
    // Round-1 review Small 5: a vendor stripGatewayPrefix does not recognize
    // (not a registered direct provider) returns the route UNCHANGED, so
    // `derived` would equal `routes.openrouter` itself -- nothing to compare
    // any direct route against, so skip the whole pin rather than manufacture
    // a false disagreement.
    if (derived === routes.openrouter) { continue; }
    for (const [provider, id] of Object.entries(routes)) {
      if (provider === 'openrouter' || DIVERGENT_VENDORS.has(provider)) { continue; }
      if (id !== derived) { lines.push(`  ⚠ ${safeFragment(alias)}: ${provider} route ${safeFragment(id)} ≠ ${safeFragment(derived)} derived from its openrouter route — reconcile by hand in ${DATA_FILE}`); }
    }
  }
  return lines;
}

/**
 * A touched alias whose pin ALSO has a route in a DIVERGENT_VENDORS namespace
 * this session never touched is called out for the owner to verify by hand.
 * @param {object} pins the (possibly updated) document's pins
 * @param {Set<string>} touched alias names touched this session
 * @param {Set<string>} touchedRoutes `<alias>::<provider>` pairs actually written this session
 * @returns {string[]} one ℹ line per such alias/route
 */
function divergentVendorNotices(pins, touched, touchedRoutes) {
  const lines = [];
  for (const alias of touched) {
    for (const [provider, id] of Object.entries(pins[alias].routes)) {
      if (!DIVERGENT_VENDORS.has(provider)) { continue; }
      if (touchedRoutes.has(alias + '::' + provider)) { continue; }
      lines.push(`  ℹ ${safeFragment(alias)}: ${provider} route ${safeFragment(id)} not compared (divergent vendor) — verify it by hand`);
    }
  }
  return lines;
}

/** @returns {string|null} why this namespace cannot be reviewed against this catalog (§5 rules 1–2), or null */
function namespaceGap(provider, catalogInfo) {
  const failures = Array.isArray(catalogInfo.providerFailures) ? catalogInfo.providerFailures : [];
  if (failures.some(f => f && f.provider === provider)) { return 'provider fetch failed this run'; }
  // Reuses the §5 gate's own id set (alias-proposals.js) instead of re-implementing its filter.
  const covered = gatedCatalogIds(catalogInfo).some(id => providerOf(id) === provider);
  return covered ? null : 'no authoritative rows in the catalog (no key?)';
}

/**
 * The picker's view for ONE namespace: every route in `map` is a custom
 * pinned row; proposals carry no dismissKey (R-P2-2). F9: `catalogAvailable`/
 * `retired` match the view CONTRACT (computed, not hardcoded) — harmless
 * today (an owner row can never be retired, disjoint by validateCuratedPins).
 */
function ownerView(map, catalogInfo, doc, d) {
  const rows = Object.keys(map).map(alias => ({ alias, id: map[alias], state: 'pinned', curated: false, shipped: null }));
  const proposals = d.buildAliasProposals({ userAliases: map, defaults: { __proto__: null }, catalogInfo, retired: doc.retired, notable: [], dismissed: {} })
    .map(p => ({ ...p, dismissKey: null }));
  return {
    rows, proposals, catalogInfo,
    catalogAvailable: Array.isArray(catalogInfo.models) && catalogInfo.models.length > 0,
    retired: doc.retired,
  };
}

/**
 * Compare-and-swap write (#238 council r1 F1): refuse (throw, nothing
 * written) when curated-pins.json changed on disk since this session loaded
 * it. On success, advances the in-memory doc and the CAS baseline together,
 * so a later write in the SAME session compares against what THIS write
 * landed. Shared by the sink (`addAlias`) and `askRulings`; both print
 * `could not write: …` on refusal. Mutant NOCAS: drop the comparison.
 * @param {{doc: object, diskBytes: string, casRefused?: boolean}} state mutated in place
 */
function commit(state, next, d) {
  const onDisk = d.readCuratedPinsBytes();
  if (onDisk !== state.diskBytes) {
    state.casRefused = true; // review residual: the closing summary reports this instead of "no pin changed" -- that line is false once the file changed under us
    throw new Error('curated-pins.json changed on disk since this session loaded it — restart the review to pick up the change (nothing was written)');
  }
  d.saveCuratedPins(next);          // Mutant SAVEFIRST: assign state.doc before this line
  state.diskBytes = JSON.stringify(next, null, 2) + '\n';
  state.doc = next;
}

/** After the walk: one optional ruling per touched pin; enter keeps the current text; each answer is written at once. */
async function askRulings(state, ask, d) {
  if (state.touched.size === 0) { return; }
  d.write('  rulings — a sentence on WHY, stored beside the pin (enter keeps the current text):\n');
  for (const alias of state.touched) {
    const pin = state.doc.pins[alias];
    // F5: a ruling is free text from an interactive prompt, rendered back later -- sanitize before showing it.
    d.write(`  ${alias} → ${Object.values(pin.routes).map(safeFragment).join(', ')}\n    current: ${pin.ruling ? collapseExcerpt(pin.ruling) : '(none)'}\n`);
    const ans = String((await ask('    ruling: ')) || '').trim();
    if (!ans) { continue; }
    try {
      commit(state, setPinRuling(state.doc, alias, ans), d);
    } catch (err) { d.write(`    could not write: ${collapseExcerpt(err.message)}\n`); }
  }
}

/** @returns {object} the deps one namespace pass hands to runReview: the owner view and the owner sink */
function passDeps(provider, map, catalogInfo, state, ask, d) {
  return {
    ...d, ask, isTTY: true,
    // The owner module already printed the refreshing-catalog banner once (if
    // stale); a per-namespace runReview must not repeat it on every pass.
    readCache: null,
    collectAliasView: async () => ownerView(map, catalogInfo, state.doc, d),
    renderAliasList: () => '',
    addAlias: (alias, id) => {
      // Mutant PROVREFUSE: pass providerOf(id) here and a typed id from another namespace rewrites THAT route.
      const next = setPinRoute(state.doc, alias, provider, id, d.today());
      commit(state, next, d);         // F1/NOCAS, SAVEFIRST: both guarded inside commit()
      state.touched.add(alias);
      state.touchedRoutes.add(alias + '::' + provider); // keyed on this PASS's namespace, so an untouched divergent sibling namespace can be told apart
    },
    removeAlias: () => { throw new Error('owner mode never unpins — the shipped set has nothing to follow'); },
    recordDismissal: () => { throw new Error('owner mode has no dismissals'); },
    effectiveAliasNames: () => new Set(Object.keys(state.doc.pins)),
  };
}

/**
 * @param {object} args parsed CLI args (the --json/--quiet and --owner-without---review argument errors are aliases.js's)
 * @param {object} [deps] overrides merged onto `defaultDeps()`
 * @returns {Promise<number>} 1 when refused by the gate, the catalog is unavailable, or the review was interrupted; else 0
 */
async function runOwnerReview(args, deps) {
  const d = { ...defaultDeps(), ...(deps || {}) };
  const refusal = ownerGate(d);
  if (refusal) { d.stderr(`Error: ${refusal}\n`); return 1; }
  // F3: loadCuratedPins/getCatalogInfo are real I/O that can throw -- name it and refuse, before any prompt is created.
  let state;
  try {
    state = { doc: d.loadCuratedPins(), touched: new Set(), touchedRoutes: new Set() };
    state.diskBytes = d.readCuratedPinsBytes(); // F1: the CAS baseline this session's writes compare against -- I/O, so it shares the load's guard (review residual: this used to sit AFTER the try, unguarded)
  } catch (err) {
    d.stderr(`Error: ${collapseExcerpt(err.message)}\n`);
    return 1;
  }
  const groups = routesByProvider(state.doc.pins);
  const routeCount = Object.values(groups).reduce((n, g) => n + Object.keys(g).length, 0);
  d.write(`  owner mode — reviewing the shipped pins in ${DATA_FILE} (${Object.keys(state.doc.pins).length} pins, ${routeCount} routes)\n`);
  if (typeof d.readCache === 'function') {
    try { const line = refreshingCatalogLine(d.readCache(), d.now()); if (line) { d.write(line); } } catch { /* banner only */ }
  }
  let catalogInfo;
  try {
    catalogInfo = await d.getCatalogInfo({}); // the §5 write gate's refresh, once, shared by every pass
  } catch (err) {
    d.stderr(`Error: catalog unavailable (${collapseExcerpt(err.message)}) — run amicus models --refresh\n`);
    return 1;
  }
  if (!Array.isArray(catalogInfo.models) || catalogInfo.models.length === 0) {
    d.write('  no catalog — cannot review; run amicus models --refresh\n');
    return 1;
  }
  const prompt = d.ask ? null : d.createPrompt();
  const ask = d.ask || prompt.ask;
  let interrupted = false;
  let reviewed = 0; // F11: namespaces actually reviewed (not gapped) -- see the zero-namespace check below
  try {
    for (const provider of Object.keys(groups)) {
      const n = Object.keys(groups[provider]).length;
      const gap = namespaceGap(provider, catalogInfo);
      if (gap) { d.write(`  ${provider} routes (${n}): ${gap} — not reviewed\n`); continue; }
      reviewed += 1;
      d.write(`  ${provider} routes (${n}):\n`);
      if (await d.runReview(args, passDeps(provider, groups[provider], catalogInfo, state, ask, d)) !== 0) { interrupted = true; d.write('  pass ended early — rulings skipped\n'); break; }
    }
    if (!interrupted) { await askRulings(state, ask, d); }
  } catch (err) {
    if (!err || err.code !== 'REVIEW_ABORTED') { throw err; }
    d.write('  rulings interrupted — edit them by hand\n');
    interrupted = true;
  } finally {
    if (prompt) { prompt.close(); }
  }
  // F11: every namespace gapped is a distinct failure from "reviewed, nothing changed" -- say so and fail.
  if (reviewed === 0) {
    d.write('  nothing could be reviewed — no namespace had catalog coverage (keys? fetch failures above)\n');
    return 1;
  }
  for (const line of routeDisagreements(state.doc.pins)) { d.write(line + '\n'); }
  for (const line of divergentVendorNotices(state.doc.pins, state.touched, state.touchedRoutes)) { d.write(line + '\n'); }
  // review residual: "no pin changed" is false once a CAS refusal proves the file WAS changed externally -- name that instead and fail.
  if (state.casRefused) {
    d.write('  curated-pins.json changed on disk during this session — nothing from this session was written after that point; restart the review\n');
    return 1;
  }
  const k = state.touched.size;
  d.write(k === 0
    ? `  no pin changed — ${DATA_FILE} is untouched\n`
    : `  ${k} pin${k === 1 ? '' : 's'} changed — review with: git diff ${DATA_FILE}   (nothing ships until you commit)\n`);
  return interrupted ? 1 : 0;
}

module.exports = { runOwnerReview, ownerGate, routesByProvider, routeDisagreements, ownerView };
