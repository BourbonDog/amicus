/**
 * @module sidecar/aliases-owner
 * `amicus aliases --review --owner` (#238 D3/D4/D8): the SAME picker as
 * `--review` (aliases-review.js :: runReview, unchanged), pointed at the
 * shipped pins in src/utils/curated-pins.json instead of the user's config
 * — the owner's baseline reset (D3).
 *
 * Rows are ROUTES, not aliases (R-P2-1): each route is judged in its own
 * gateway namespace (`openrouter/google/gemini-…` against the openrouter
 * rows, `google/gemini-…` against the google rows), matching how
 * model-id-siblings.js keys a sibling's vendor and alias-proposals.js gates
 * on the id's provider. One `runReview` pass per namespace (openrouter
 * first, then each direct namespace in file order); a namespace with no
 * authoritative catalog row, or listed in `providerFailures`, is announced
 * and NOT reviewed, never "up to date". Every row is a custom pin to the
 * engine (`defaults` empty): no `follow`, no `never ask again` (no
 * dismissal state — `dismissKey` is nulled so a declined sibling returns
 * next session; R-P2-2), no notable (that list is for users to map).
 *
 * Gate (D8): the package root must BE a git work-tree root (`git rev-parse
 * --show-prefix` empty — scripts/setup-hooks.js's guard) with a clean tree
 * (`git status --porcelain --untracked-files=no` empty, so an untracked
 * scratch dir never blocks; R-P2-4) and a TTY. Refused = one stderr line,
 * exit 1, nothing read or written.
 *
 * Sink: an accept replaces the route under review via `setPinRoute` scoped
 * to the PASS's namespace — an id typed from another namespace is refused
 * as the picker's own `could not write: …` line (R-P2-5) — and stamps
 * `verifiedOn` with today's UTC date (R-P2-12); the write is validated and
 * atomic BEFORE the picker's ✓, so only a SUCCESSFUL write replaces the
 * in-memory document. After the last pass each touched pin is prompted for
 * an optional ruling (enter keeps the current text; R-P2-9);
 * `routeDisagreements` then names every non-divergent pin whose direct
 * route no longer matches the derived form of its openrouter route, for the
 * owner to reconcile by hand (R-P2-10). Ctrl-C/EOF skips the rulings but the
 * summary still prints; nothing here spends (the one catalog refresh is the
 * same keyed model-list call the user picker makes, §5 write gate).
 */

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { DIVERGENT_VENDORS, stripGatewayPrefix } = require('../utils/curated-models');
const { loadCuratedPins, saveCuratedPins, setPinRoute, setPinRuling } = require('../utils/curated-pins');
const { refreshingCatalogLine } = require('./aliases-review-render');
const { gatedCatalogIds } = require('../utils/alias-proposals');
const { collapseExcerpt, safeFragment } = require('../utils/text-sanitize');

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
    today: () => new Date().toISOString().slice(0, 10),
    now: () => Date.now(),
    runReview: (args, d) => require('./aliases-review').runReview(args, d),
    createPrompt: () => require('./aliases-review-prompt').createPrompt(),
  };
}

/**
 * @param {{isTTY: boolean, git: (args: string[]) => string}} d
 * @returns {string|null} the refusal reason, or null when owner mode may run
 */
function ownerGate(d) {
  if (!d.isTTY) { return 'aliases --review --owner is interactive: run it in a terminal'; }
  let prefix;
  try { prefix = d.git(['rev-parse', '--show-prefix']); }
  catch { return `owner mode needs the amicus source checkout (${PKG_ROOT} is not inside a git work tree)`; }
  // Mutant GATEPREFIX: drop this check and an npm-installed copy inside a
  // consumer's repo passes (setup-hooks.js documents that exact trap).
  if (prefix !== '') { return `owner mode needs the amicus source checkout, not an installed copy (${PKG_ROOT} sits ${prefix} below its repository root)`; }
  let status;
  try { status = d.git(['status', '--porcelain', '--untracked-files=no']); }
  catch (err) { return `owner mode could not read the working tree (${collapseExcerpt(err.message)})`; }
  // Mutant DIRTYTREE: drop this check and `git diff` stops being a clean review surface.
  if (status !== '') { return `owner mode needs a clean working tree — commit or stash first (git status shows ${status.split('\n').length} changed file(s))`; }
  return null;
}

/**
 * @param {object} pins `loadCuratedPins().pins`
 * @returns {Object<string, Object<string,string>>} provider → { alias → id }, both null-prototype; providers in
 *   first-seen order walking the pins in file order (every pin has an openrouter route, so openrouter is first)
 */
function routesByProvider(pins) {
  const out = { __proto__: null };
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
 * @returns {string[]} one line per NON-divergent pin whose authored direct route differs from the derived form
 *   of its openrouter route (`stripGatewayPrefix`) — such a pair routes different models depending on which key
 *   a user holds. Divergent vendors (anthropic) author both forms by ruling and are never compared.
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

/** @returns {string|null} why this namespace cannot be reviewed against this catalog (§5 rules 1–2), or null */
function namespaceGap(provider, catalogInfo) {
  const failures = Array.isArray(catalogInfo.providerFailures) ? catalogInfo.providerFailures : [];
  if (failures.some(f => f && f.provider === provider)) { return 'provider fetch failed this run'; }
  // Round-1 review Small 4: reuse the §5 gate's own id set (alias-proposals.js)
  // instead of re-implementing its authoritative/failure filter here.
  const covered = gatedCatalogIds(catalogInfo).some(id => providerOf(id) === provider);
  return covered ? null : 'no authoritative rows in the catalog (no key?)';
}

/** The picker's view for ONE namespace: every route in `map` is a custom pinned row; proposals carry no dismissKey. */
function ownerView(map, catalogInfo, doc, d) {
  const rows = Object.keys(map).map(alias => ({ alias, id: map[alias], state: 'pinned', curated: false, shipped: null }));
  const proposals = d.buildAliasProposals({ userAliases: map, defaults: { __proto__: null }, catalogInfo, retired: doc.retired, notable: [], dismissed: {} })
    .map(p => ({ ...p, dismissKey: null }));
  return { rows, proposals, catalogInfo, catalogAvailable: true };
}

/** After the walk: one optional ruling per touched pin; enter keeps the current text; each answer is written at once. */
async function askRulings(state, ask, d) {
  if (state.touched.size === 0) { return; }
  d.write('  rulings — a sentence on WHY, stored beside the pin (enter keeps the current text):\n');
  for (const alias of state.touched) {
    const pin = state.doc.pins[alias];
    d.write(`  ${alias} → ${Object.values(pin.routes).map(safeFragment).join(', ')}\n    current: ${pin.ruling || '(none)'}\n`);
    const ans = String((await ask('    ruling: ')) || '').trim();
    if (!ans) { continue; }
    try {
      const next = setPinRuling(state.doc, alias, ans);
      d.saveCuratedPins(next);
      state.doc = next;
    } catch (err) { d.write(`    could not write: ${collapseExcerpt(err.message)}\n`); }
  }
}

/** @returns {object} the deps one namespace pass hands to runReview: the owner view and the owner sink */
function passDeps(provider, map, catalogInfo, state, ask, d) {
  return {
    ...d, ask, isTTY: true,
    // Round-1 review Small 3: the owner module already printed the
    // refreshing-catalog banner once (if stale) before the first pass; a
    // per-namespace runReview must not repeat it on every pass.
    readCache: null,
    collectAliasView: async () => ownerView(map, catalogInfo, state.doc, d),
    renderAliasList: () => '',
    addAlias: (alias, id) => {
      // Mutant PROVREFUSE: pass providerOf(id) here and a typed id from another
      // namespace rewrites THAT route instead of being refused.
      const next = setPinRoute(state.doc, alias, provider, id, d.today());
      d.saveCuratedPins(next);        // Mutant SAVEFIRST: assign state.doc before this line
      state.doc = next;
      state.touched.add(alias);
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
  const state = { doc: d.loadCuratedPins(), touched: new Set() };
  const groups = routesByProvider(state.doc.pins);
  const routeCount = Object.values(groups).reduce((n, g) => n + Object.keys(g).length, 0);
  d.write(`  owner mode — reviewing the shipped pins in ${DATA_FILE} (${Object.keys(state.doc.pins).length} pins, ${routeCount} routes)\n`);
  if (typeof d.readCache === 'function') {
    try { const line = refreshingCatalogLine(d.readCache(), d.now()); if (line) { d.write(line); } } catch { /* banner only */ }
  }
  const catalogInfo = await d.getCatalogInfo({}); // the §5 write gate's refresh, once, shared by every pass
  if (!Array.isArray(catalogInfo.models) || catalogInfo.models.length === 0) {
    d.write('  no catalog — cannot review; run amicus models --refresh\n');
    return 1;
  }
  const prompt = d.ask ? null : d.createPrompt();
  const ask = d.ask || prompt.ask;
  let interrupted = false;
  try {
    for (const provider of Object.keys(groups)) {
      const n = Object.keys(groups[provider]).length;
      const gap = namespaceGap(provider, catalogInfo);
      if (gap) { d.write(`  ${provider} routes (${n}): ${gap} — not reviewed\n`); continue; }
      d.write(`  ${provider} routes (${n}):\n`);
      if (await d.runReview(args, passDeps(provider, groups[provider], catalogInfo, state, ask, d)) !== 0) { interrupted = true; break; }
    }
    if (!interrupted) { await askRulings(state, ask, d); }
  } catch (err) {
    if (!err || err.code !== 'REVIEW_ABORTED') { throw err; }
    d.write('  rulings interrupted — edit them by hand\n');
    interrupted = true;
  } finally {
    if (prompt) { prompt.close(); }
  }
  for (const line of routeDisagreements(state.doc.pins)) { d.write(line + '\n'); }
  const k = state.touched.size;
  d.write(k === 0
    ? `  no pin changed — ${DATA_FILE} is untouched\n`
    : `  ${k} pin${k === 1 ? '' : 's'} changed — review with: git diff ${DATA_FILE}   (nothing ships until you commit)\n`);
  return interrupted ? 1 : 0;
}

module.exports = { runOwnerReview, ownerGate, routesByProvider, routeDisagreements };
