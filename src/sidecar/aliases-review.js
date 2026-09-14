/**
 * @module sidecar/aliases-review
 * `amicus aliases --review` (#238 §4): a numbered readline picker over the
 * engine's proposals — no copy-paste anywhere. Accept writes the chosen id and
 * the encoding decides the state (Q4): the shipped pin → `removeAlias`
 * (follows); anything else → `addAlias` (pinned). Without a TTY it refuses
 * loudly (Q2): the list, one reason line, exit 1. The §5 WRITE gate lives
 * here: accepting a catalog-vouched id needs a fresh catalog (24 h); `follow`
 * is exempt because it removes a key. Pure screen text lives in
 * aliases-review-render.js (split in fix round 1 to hold the 300-line gate).
 *
 * Fix round 1: a missing cache (`fetchedAt` not a number — first run, or
 * offline) gets its own banner instead of a bogus multi-thousand-day
 * `ageLabel` (never called on a non-number); the banner only ever appears
 * once there is something to review. A readline `close` (Ctrl-C/D) mid-prompt
 * rejects the pending `ask` with a `REVIEW_ABORTED` sentinel instead of
 * silently exiting 0. Every config write (`addAlias`/`removeAlias`/
 * `recordDismissal`) is caught per-call so a write failure reports and
 * re-shows the menu rather than crashing the review. Typing the shipped id
 * into "choose another" follows (Q4's encoding) rather than pinning a
 * redundant copy. A taken notable name gets a numeric suffix against the
 * live effective-alias set, not the free-model `deriveFreeAlias` naming.
 */

'use strict';

const { DEFAULT_MAX_AGE_MS } = require('../utils/model-catalog');
const { stripGatewayPrefix } = require('../utils/curated-models');
const { ageLabel, menuFor, menuLineText, renderScreen } = require('./aliases-review-render');

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
 * The §5 WRITE gate: mirrors doctor-alias-check.js's unexported
 * `isCatalogFresh` (same rule, restated here since it is not exported).
 * @returns {boolean} true when `fetchedAt` is a number no older than 24h
 */
function isFresh(fetchedAt, now) {
  return typeof fetchedAt === 'number' && (now - fetchedAt) <= DEFAULT_MAX_AGE_MS;
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
      d.write(`  ✓ ${p.alias} now follows the shipped recommendation (${c.id})\n`);
      return true;
    }
    if (c.why === 'notable') {
      const name = freeSuffix(p.alias, d.effectiveAliasNames());
      d.addAlias(name, c.id);
      d.write(`  ✓ ${name} → ${c.id} (pinned)\n`);
      return true;
    }
    d.addAlias(p.alias, c.id);
    d.write(`  ✓ ${p.alias} → ${c.id} (pinned)\n`);
    return true;
  } catch (err) {
    d.write(`  could not write: ${err.message}\n`);
    return false;
  }
}

/**
 * The "choose another" sub-flow: a free-text model id, validated against the
 * catalog, gated by the same freshness rule as any other accept. Typing the
 * shipped id (M3) routes to the follow path, never a redundant pin. A write
 * failure (M2) is reported and treated like a cancel/refusal by the caller.
 * @returns {Promise<'accepted'|'cancel'|'refused'|'error'>}
 */
async function chooseAnother(p, ctx) {
  const { d, fresh, view, ask } = ctx;
  const models = (view.catalogInfo && Array.isArray(view.catalogInfo.models)) ? view.catalogInfo.models : [];
  const validIds = new Set(models.map(m => m && m.id).filter(Boolean));
  for (;;) {
    const raw = await ask('  model id (provider/model), blank to cancel: ');
    const ans = String(raw || '').trim();
    if (!ans) { return 'cancel'; }
    if (!ans.includes('/') || !validIds.has(ans)) {
      d.write(`  not in the catalog — try: amicus models --search ${ans.split('/').pop()}\n`);
      continue;
    }
    if (!fresh) {
      d.write('  cannot accept: the catalog is not fresh (see above)\n');
      return 'refused';
    }
    const follows = !!(p.shipped && sameModel(ans, p.shipped));
    try {
      if (follows) {
        d.removeAlias(p.alias);
        d.write(`  ✓ ${p.alias} now follows the shipped recommendation (${ans})\n`);
      } else {
        d.addAlias(p.alias, ans);
        d.write(`  ✓ ${p.alias} → ${ans} (pinned)\n`);
      }
      return 'accepted';
    } catch (err) {
      d.write(`  could not write: ${err.message}\n`);
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
        d.write(`  dismissed ${p.dismissKey}\n`);
        return 'dismissed';
      } catch (err) {
        d.write(`  could not write: ${err.message}\n`);
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
  const d = deps || defaultDeps();
  let rl = null;
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
      const readline = require('readline');
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      let pendingReject = null;
      // M1: Ctrl-C/D closes stdin without rl ever invoking the question
      // callback — reject whatever `ask` call is in flight so the loop below
      // can end the review with a summary instead of the process just
      // exiting 0 with no trace of how far it got.
      rl.on('close', () => {
        if (pendingReject) {
          const reject = pendingReject;
          pendingReject = null;
          const err = new Error('aliases --review interrupted');
          err.code = 'REVIEW_ABORTED';
          reject(err);
        }
      });
      ask = (q) => new Promise((resolve, reject) => {
        pendingReject = reject;
        rl.question(q, (a) => { pendingReject = null; resolve((a || '').trim()); });
      });
    }
    const view = await d.collectAliasView({});
    const now = (d.now || Date.now)();
    const fetchedAt = view.catalogInfo && view.catalogInfo.fetchedAt;
    const fresh = isFresh(fetchedAt, now);
    const proposals = Array.isArray(view.proposals) ? view.proposals : [];
    if (proposals.length === 0) {
      d.write(`  Nothing to review — ${(view.rows || []).length} aliases, all following or up to date.\n`);
      return 0;
    }
    // M5: the stale/no-cache banner only ever prints once there is something
    // to act on — a "nothing to review" run never mentions the catalog.
    if (!fresh) {
      d.write(typeof fetchedAt === 'number'
        ? `  catalog is ${ageLabel(fetchedAt, now)} old and could not be refreshed — proposals are shown, but accepting is disabled until \`amicus models --refresh\` succeeds\n`
        : '  no catalog cache and it could not be fetched — proposals are shown, but accepting is disabled until `amicus models --refresh` succeeds\n');
    }
    let accepted = 0;
    let skipped = 0;
    let dismissed = 0;
    const ctx = { d, fresh, view, ask };
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
    if (rl) { rl.close(); }
  }
}

module.exports = { runReview };
