/**
 * @module sidecar/aliases-review
 * `amicus aliases --review` (#238 §4): a numbered readline picker over the
 * engine's proposals — no copy-paste anywhere. Accept writes the chosen id and
 * the encoding decides the state (Q4): the shipped pin → `removeAlias`
 * (follows); anything else → `addAlias` (pinned). Without a TTY it refuses
 * loudly (Q2): the list, one reason line, exit 1. The §5 WRITE gate lives
 * here: accepting a catalog-vouched id needs a fresh catalog (24 h); `follow`
 * is exempt because it removes a key. Screen text is aliases-review-render.js
 * and the readline prompt is aliases-review-prompt.js (both split out to
 * hold the 300-line gate). Every alias/id/key this module writes to the
 * terminal — including a caught `err.message`, via `collapseExcerpt`, since
 * a thrown message is a sentence rather than an id — rides the house
 * sanitizer first (`utils/text-sanitize.js`, #249 r2 C4).
 *
 * Fix round 1: a missing cache reads as its own banner, never a bogus
 * multi-thousand-day `ageLabel`; an aborted prompt — Ctrl-D/EOF (readline's
 * `close`) or Ctrl-C (readline's own `SIGINT`, #249 r2 D1 — two distinct
 * events, see aliases-review-prompt.js) — rejects the pending `ask` with a
 * `REVIEW_ABORTED` sentinel rather than silently exiting 0; every config
 * write is caught per-call so a failure reports and re-shows the menu;
 * typing the shipped id into "choose another" follows unconditionally
 * (Q4's encoding, #249 r2 A1/C2) rather than pinning a redundant copy or
 * consulting either gate; a taken notable name gets a numeric suffix
 * (`freeSuffix`), deliberately not `deriveFreeAlias`'s `free-` naming,
 * which is for free-tier council seeds.
 * Fix round 2 (#249 r1) gate helpers (§5-gated "choose another", clock-skew
 * freshness, a throwing `readCache`) live in aliases-review-gate.js.
 */

'use strict';

const { DEFAULT_MAX_AGE_MS } = require('../utils/model-catalog');
const { stripGatewayPrefix } = require('../utils/curated-models');
const { gatedCatalogIds } = require('../utils/alias-proposals');
const { safeFragment, collapseExcerpt } = require('../utils/text-sanitize');
const { menuFor, menuLineText, renderScreen, refreshingCatalogLine } = require('./aliases-review-render');
const { classifyTypedId, notInCatalogLine, notVerifiedLine, staleCatalogBanner } = require('./aliases-review-gate');

/**
 * Real-CLI collaborators. Requires are lazy/function-scoped (not top-level)
 * because `aliases.js :: handleAliases` requires THIS module to dispatch
 * `--review` — a top-level `require('./aliases')` here would be a load-time
 * cycle.
 * @returns {object} collaborators for `runReview` when the caller supplies none
 */
function defaultDeps() {
  const base = require('./aliases');
  const d = base.loadDeps();
  return {
    ...d,
    isTTY: !!process.stdin.isTTY,
    write: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    collectAliasView: (opts) => base.collectAliasView(opts, d),
    renderAliasList: (view) => base.renderAliasList(view, d.groupAliases),
    addAlias: require('./setup').addAlias,
    removeAlias: require('../utils/alias-store').removeAlias,
    recordDismissal: require('../utils/alias-store').recordDismissal,
    effectiveAliasNames: () => new Set(Object.keys(d.config.getEffectiveAliases())),
    now: () => Date.now(),
  };
}

/**
 * The §5 WRITE gate (mirrors doctor-alias-check.js's unexported
 * `isCatalogFresh`). R3: `age >= 0` is required too, so a future `fetchedAt`
 * (clock skew) is explicitly not fresh rather than indefinitely so.
 * @returns {boolean} true when `fetchedAt` is a number, not in the future, and no older than 24h
 */
function isFresh(fetchedAt, now) {
  return typeof fetchedAt === 'number' && (now - fetchedAt) >= 0 && (now - fetchedAt) <= DEFAULT_MAX_AGE_MS;
}

/** @returns {boolean} true when two ids name the same model once gateway prefixes are normalized */
function sameModel(a, b) {
  return typeof a === 'string' && typeof b === 'string' && stripGatewayPrefix(a) === stripGatewayPrefix(b);
}

/** @returns {string} `base`, or the first `${base}-2`, `${base}-3`, … not already in `taken` */
function freeSuffix(base, taken) {
  if (!taken.has(base)) { return base; }
  let n = 2;
  while (taken.has(`${base}-${n}`)) { n += 1; }
  return `${base}-${n}`;
}

/**
 * Accept one candidate. `follow` unpins (`removeAlias` — the encoding IS the
 * state, Q4); `notable` pins under a numeric-suffixed name when its suggested
 * alias is already taken; anything else pins the alias straight to the
 * candidate id. Any write failure is caught here (M2) so the caller can
 * re-show the menu instead of crashing the review.
 * @returns {boolean} true on a successful write
 */
function acceptCandidate(p, c, d) {
  try {
    if (c.why === 'follow') {
      d.removeAlias(p.alias);
      d.write(`  ✓ ${safeFragment(p.alias)} now follows the shipped recommendation (${safeFragment(c.id)})\n`);
      return true;
    }
    if (c.why === 'notable') {
      const name = freeSuffix(p.alias, d.effectiveAliasNames());
      d.addAlias(name, c.id);
      d.write(`  ✓ ${safeFragment(name)} → ${safeFragment(c.id)} (pinned)\n`);
      return true;
    }
    d.addAlias(p.alias, c.id);
    d.write(`  ✓ ${safeFragment(p.alias)} → ${safeFragment(c.id)} (pinned)\n`);
    return true;
  } catch (err) {
    d.write(`  could not write: ${collapseExcerpt(err.message)}\n`);
    return false;
  }
}

/**
 * The "choose another" sub-flow: a free-text model id. Typing the shipped id
 * (M3, #249 r2 A1/C2) IS the menu's `follow` action, checked FIRST and exempt
 * from BOTH gates below, even when the catalog is stale or lacks the shipped
 * id -- the numbered `follow` item is offered regardless of the catalog.
 * Anything else is checked against the §5 display gate (R2 — the SAME
 * `gatedCatalogIds` the menu's own candidates come from) then the freshness
 * gate; a write failure (M2) is a cancel/refusal.
 * @returns {Promise<'accepted'|'cancel'|'refused'|'error'>}
 */
async function chooseAnother(p, ctx) {
  const { d, fresh, allCatalogIds, gatedIds, ask } = ctx;
  for (;;) {
    const raw = await ask('  model id (provider/model), blank to cancel: ');
    const ans = String(raw || '').trim();
    if (!ans) { return 'cancel'; }
    // Mutant GATEFIRST: move this below the two gates and the R1 tests go red.
    const follows = !!(p.shipped && sameModel(ans, p.shipped));
    if (!follows) {
      const status = classifyTypedId(ans, allCatalogIds, gatedIds);
      if (status === 'unknown') { d.write(notInCatalogLine(ans)); continue; }
      if (status === 'ungated') { d.write(notVerifiedLine(ans)); continue; }
      if (!fresh) {
        d.write('  cannot accept: the catalog is not fresh (see above)\n');
        return 'refused';
      }
    }
    try {
      if (follows) {
        d.removeAlias(p.alias);
        d.write(`  ✓ ${safeFragment(p.alias)} now follows the shipped recommendation (${safeFragment(ans)})\n`);
      } else {
        d.addAlias(p.alias, ans);
        d.write(`  ✓ ${safeFragment(p.alias)} → ${safeFragment(ans)} (pinned)\n`);
      }
      return 'accepted';
    } catch (err) {
      d.write(`  could not write: ${collapseExcerpt(err.message)}\n`);
      return 'error';
    }
  }
}

/**
 * Drive one proposal's screen + menu loop until it is accepted, skipped, or
 * dismissed. A refused accept (stale catalog), a write failure, or a
 * cancelled/refused "choose another" redisplays this SAME proposal's menu
 * rather than advancing. A menu answer must be all-digits before it is ever
 * handed to `Number` (M6).
 * @returns {Promise<'accepted'|'skipped'|'dismissed'>}
 */
async function reviewOne(p, i, n, ctx) {
  const { d, fresh, ask } = ctx;
  const items = menuFor(p);
  d.write(renderScreen(p, i, n, items));
  for (;;) {
    const raw = await ask('  > ');
    const trimmed = String(raw || '').trim();
    const choice = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isInteger(choice) || choice < 1 || choice > items.length) {
      d.write(`  choose 1-${items.length}\n`);
      continue;
    }
    const item = items[choice - 1];
    if (item.action === 'skip') { return 'skipped'; }
    if (item.action === 'dismiss') {
      try {
        d.recordDismissal(p.dismissKey);
        d.write(`  dismissed ${safeFragment(p.dismissKey)}\n`);
        return 'dismissed';
      } catch (err) {
        d.write(`  could not write: ${collapseExcerpt(err.message)}\n`);
        d.write(menuLineText(items) + '\n');
        continue;
      }
    }
    if (item.action === 'choose') {
      const outcome = await chooseAnother(p, ctx);
      if (outcome === 'accepted') { return 'accepted'; }
      d.write(menuLineText(items) + '\n'); // 'cancel', 'refused' or 'error': same proposal's menu again
      continue;
    }
    if (!fresh && item.candidate.why !== 'follow') {
      d.write('  cannot accept: the catalog is not fresh (see above)\n');
      d.write(menuLineText(items) + '\n');
      continue;
    }
    if (acceptCandidate(p, item.candidate, d)) { return 'accepted'; }
    d.write(menuLineText(items) + '\n');
  }
}

/**
 * `amicus aliases --review` entry point.
 * @param {object} args parsed CLI args (the --json/--quiet argument-error
 *   check happens in aliases.js before this is ever called)
 * @param {object} [deps] injectable collaborators — see the module docblock;
 *   defaults to real I/O (readline over stdin/stdout) when omitted
 * @returns {Promise<number>} 1 when refused for lacking a TTY or interrupted, else 0
 */
async function runReview(args, deps) {
  // F4b: merge (not replace), so a test can inject only the members it cares
  // about and let every other collaborator run for real against the hermetic
  // scratch config -- additive, so every existing deps-object test still works.
  const d = { ...defaultDeps(), ...(deps || {}) };
  let prompt = null;
  let ask = d.ask; // M6: kept local, never written back onto `d`
  try {
    const isTTY = d.isTTY ?? !!process.stdin.isTTY;
    if (!isTTY) {
      const view = await d.collectAliasView({ maxAgeMs: Number.POSITIVE_INFINITY });
      d.write(d.renderAliasList(view));
      d.stderr('aliases --review is interactive: run it in a terminal, or use `amicus aliases --json` for machine output\n');
      return 1;
    }
    if (!ask) {
      // Lazy require, same as `./aliases` above -- but for locality, not a
      // cycle: aliases-review-prompt.js has no require edge back to this
      // file, so a top-level require would be equally safe here.
      const { createPrompt } = require('./aliases-review-prompt');
      prompt = createPrompt();
      ask = prompt.ask;
    }
    // Minor (spec §4): name the inline refresh wait so it doesn't read as a
    // hang. R7: a throwing readCache (disk error, corrupt cache) drops this
    // best-effort banner rather than crashing the review.
    if (typeof d.readCache === 'function') {
      try { const line = refreshingCatalogLine(d.readCache(), Date.now()); if (line) { d.write(line); } }
      catch { /* best-effort banner only */ }
    }
    const view = await d.collectAliasView({});
    // F1: no catalog at all means no proposal was ever judged -- that is not
    // the same fact as "judged them all, nothing to review" (below), so it
    // gets its own refusal, before that check ever runs.
    if (!view.catalogAvailable) {
      d.write('  no catalog — cannot review; run amicus models --refresh\n');
      return 1;
    }
    const now = (d.now || Date.now)();
    const fetchedAt = view.catalogInfo && view.catalogInfo.fetchedAt;
    const fresh = isFresh(fetchedAt, now);
    const proposals = Array.isArray(view.proposals) ? view.proposals : [];
    if (proposals.length === 0) {
      d.write(`  Nothing to review — ${(view.rows || []).length} aliases, all following or up to date.\n`);
      return 0;
    }
    // M5: the stale/no-cache/clock-skew banner only ever prints once there is
    // something to act on — a "nothing to review" run never mentions the catalog.
    if (!fresh) { d.write(staleCatalogBanner(fetchedAt, now)); }
    let accepted = 0;
    let skipped = 0;
    let dismissed = 0;
    // R2: computed once for the whole run (the catalog view is fixed for the
    // session) so `chooseAnother` never re-derives them per keystroke.
    const catalogModels = Array.isArray(view.catalogInfo && view.catalogInfo.models) ? view.catalogInfo.models : [];
    const allCatalogIds = new Set(catalogModels.map(m => m && m.id).filter(Boolean));
    const gatedIds = new Set(gatedCatalogIds(view.catalogInfo));
    const ctx = { d, fresh, ask, allCatalogIds, gatedIds };
    try {
      for (let i = 0; i < proposals.length; i++) {
        const outcome = await reviewOne(proposals[i], i, proposals.length, ctx);
        if (outcome === 'accepted') { accepted++; }
        else if (outcome === 'dismissed') { dismissed++; }
        else { skipped++; }
      }
    } catch (err) {
      if (err && err.code === 'REVIEW_ABORTED') {
        d.write(`  review interrupted — ${accepted} accepted, ${skipped} skipped, ${dismissed} dismissed so far\n`);
        return 1;
      }
      throw err;
    }
    const n = proposals.length;
    d.write(`  Reviewed ${n} proposal${n === 1 ? '' : 's'}: ${accepted} accepted, ${skipped} skipped, ${dismissed} dismissed.\n`);
    return 0;
  } finally {
    if (prompt) { prompt.close(); }
  }
}

module.exports = { runReview };
