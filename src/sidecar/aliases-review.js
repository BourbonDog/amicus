/**
 * @module sidecar/aliases-review
 * `amicus aliases --review` (#238 §4): a numbered readline picker over the
 * engine's proposals — no copy-paste anywhere. Accept writes the chosen id and
 * the encoding decides the state (Q4): the shipped pin → `removeAlias`
 * (follows); anything else → `addAlias` (pinned). Without a TTY it refuses
 * loudly (Q2): the list, one reason line, exit 1. The §5 WRITE gate lives
 * here: accepting a catalog-vouched id needs a fresh catalog (24 h); `follow`
 * is exempt because it removes a key.
 */

'use strict';

const { DEFAULT_MAX_AGE_MS } = require('../utils/model-catalog');

const LABEL_WIDTH = 11; // 'currently' / 'shipped' / 'proposed', each padded flush with the others

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
    deriveFreeAlias: require('./setup').deriveFreeAlias,
    removeAlias: require('../utils/alias-store').removeAlias,
    recordDismissal: require('../utils/alias-store').recordDismissal,
    effectiveAliasNames: () => new Set(Object.keys(d.config.getEffectiveAliases())),
    now: () => Date.now(),
  };
}

/** @returns {string} e.g. '3 days' / '1 day' / '5 hours' / '1 hour' */
function ageLabel(fetchedAt, now) {
  const ms = now - fetchedAt;
  const days = Math.floor(ms / DEFAULT_MAX_AGE_MS);
  if (days >= 1) { return `${days} day${days === 1 ? '' : 's'}`; }
  const hours = Math.max(1, Math.floor(ms / 3600000));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * The §5 WRITE gate: mirrors doctor-alias-check.js's unexported
 * `isCatalogFresh` (same rule, restated here since it is not exported).
 * @returns {boolean} true when `fetchedAt` is a number no older than 24h
 */
function isFresh(fetchedAt, now) {
  return typeof fetchedAt === 'number' && (now - fetchedAt) <= DEFAULT_MAX_AGE_MS;
}

/** @returns {string} the reason phrase shown on the 'proposed' line for one candidate */
function reasonPhrase(c) {
  if (c.why === 'newer-sibling') { return 'newer sibling, same tier'; }
  if (c.why === 'replacement') { return 'replacement (current id is gone from the catalog)'; }
  if (c.why === 'follow') { return 'the shipped recommendation'; }
  return (c.evidence && c.evidence.note) || 'notable model';
}

/**
 * @returns {Array<{label: string, action: 'accept'|'choose'|'skip'|'dismiss', candidate?: object}>}
 *   one entry per candidate in the engine's order (never re-sorted), then the
 *   three standing options
 */
function menuFor(p) {
  const items = p.candidates.map(c => ({
    label: c.why === 'follow' ? `follow the shipped pin (${c.id})` : (c.why === 'notable' ? `add ${p.alias} → ${c.id}` : `accept ${c.id}`),
    action: 'accept',
    candidate: c,
  }));
  items.push({ label: 'choose another', action: 'choose' });
  items.push({ label: 'skip', action: 'skip' });
  items.push({ label: 'never ask again', action: 'dismiss' });
  return items;
}

/** @returns {string} the numbered menu line alone, no trailing newline */
function menuLineText(items) {
  return '    ' + items.map((it, idx) => `[${idx + 1}] ${it.label}`).join('   ');
}

/** @returns {string} the full screen for one proposal — header, state block and menu — trailing newline included */
function renderScreen(p, i, n, items) {
  const lines = [`  [${i + 1}/${n}] ${p.alias}`];
  lines.push(p.current
    ? `    ${'currently'.padEnd(LABEL_WIDTH)}${p.current}      (pinned by you)`
    : '    not mapped yet');
  if (p.curated) { lines.push(`    ${'shipped'.padEnd(LABEL_WIDTH)}${p.shipped}`); }
  const top = p.candidates[0];
  if (top) { lines.push(`    ${'proposed'.padEnd(LABEL_WIDTH)}${top.id}   ${reasonPhrase(top)}`); }
  lines.push('');
  lines.push(menuLineText(items));
  return lines.join('\n') + '\n';
}

/**
 * Accept one candidate. `follow` unpins (`removeAlias` — the encoding IS the
 * state, Q4); `notable` pins under a free name when its suggested alias is
 * already taken; anything else pins the alias straight to the candidate id.
 */
function acceptCandidate(p, c, d) {
  if (c.why === 'follow') {
    d.removeAlias(p.alias);
    d.write(`  ✓ ${p.alias} now follows the shipped recommendation (${c.id})\n`);
    return;
  }
  if (c.why === 'notable') {
    const names = d.effectiveAliasNames();
    const name = names.has(p.alias) ? d.deriveFreeAlias(c.id, names) : p.alias;
    d.addAlias(name, c.id);
    d.write(`  ✓ ${name} → ${c.id} (pinned)\n`);
    return;
  }
  d.addAlias(p.alias, c.id);
  d.write(`  ✓ ${p.alias} → ${c.id} (pinned)\n`);
}

/**
 * The "choose another" sub-flow: a free-text model id, validated against the
 * catalog, gated by the same freshness rule as any other accept.
 * @returns {Promise<'accepted'|'cancel'|'refused'>}
 */
async function chooseAnother(p, ctx) {
  const { d, fresh, view } = ctx;
  const models = (view.catalogInfo && Array.isArray(view.catalogInfo.models)) ? view.catalogInfo.models : [];
  const validIds = new Set(models.map(m => m && m.id).filter(Boolean));
  for (;;) {
    const raw = await d.ask('  model id (provider/model), blank to cancel: ');
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
    d.addAlias(p.alias, ans);
    d.write(`  ✓ ${p.alias} → ${ans} (pinned)\n`);
    return 'accepted';
  }
}

/**
 * Drive one proposal's screen + menu loop until it is accepted, skipped, or
 * dismissed. A refused accept (stale catalog) or a cancelled/refused "choose
 * another" redisplays this SAME proposal's menu rather than advancing.
 * @returns {Promise<'accepted'|'skipped'|'dismissed'>}
 */
async function reviewOne(p, i, n, ctx) {
  const { d, fresh } = ctx;
  const items = menuFor(p);
  d.write(renderScreen(p, i, n, items));
  for (;;) {
    const raw = await d.ask('  > ');
    const choice = Number(String(raw || '').trim());
    if (!Number.isInteger(choice) || choice < 1 || choice > items.length) {
      d.write(`  choose 1-${items.length}\n`);
      continue;
    }
    const item = items[choice - 1];
    if (item.action === 'skip') { return 'skipped'; }
    if (item.action === 'dismiss') {
      d.recordDismissal(p.dismissKey);
      d.write(`  dismissed ${p.dismissKey}\n`);
      return 'dismissed';
    }
    if (item.action === 'choose') {
      const outcome = await chooseAnother(p, ctx);
      if (outcome === 'accepted') { return 'accepted'; }
      d.write(menuLineText(items) + '\n'); // 'cancel' or 'refused': same proposal's menu again
      continue;
    }
    if (!fresh && item.candidate.why !== 'follow') {
      d.write('  cannot accept: the catalog is not fresh (see above)\n');
      d.write(menuLineText(items) + '\n');
      continue;
    }
    acceptCandidate(p, item.candidate, d);
    return 'accepted';
  }
}

/**
 * `amicus aliases --review` entry point.
 * @param {object} args parsed CLI args (the --json/--quiet argument-error
 *   check happens in aliases.js before this is ever called)
 * @param {object} [deps] injectable collaborators — see the module docblock;
 *   defaults to real I/O (readline over stdin/stdout) when omitted
 * @returns {Promise<number>} 1 when refused for lacking a TTY, else 0
 */
async function runReview(args, deps) {
  const d = deps || defaultDeps();
  let rl = null;
  try {
    const isTTY = d.isTTY ?? !!process.stdin.isTTY;
    if (!isTTY) {
      const view = await d.collectAliasView({ maxAgeMs: Number.POSITIVE_INFINITY });
      d.write(d.renderAliasList(view));
      d.stderr('aliases --review is interactive: run it in a terminal, or use `amicus aliases --json` for machine output\n');
      return 1;
    }
    if (!d.ask) {
      const readline = require('readline');
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      d.ask = (q) => new Promise((resolve) => rl.question(q, (a) => resolve((a || '').trim())));
    }
    const view = await d.collectAliasView({});
    const now = (d.now || Date.now)();
    const fetchedAt = view.catalogInfo && view.catalogInfo.fetchedAt;
    const fresh = isFresh(fetchedAt, now);
    if (!fresh) {
      d.write(`  catalog is ${ageLabel(fetchedAt, now)} old and could not be refreshed — proposals are shown, but accepting is disabled until \`amicus models --refresh\` succeeds\n`);
    }
    const proposals = Array.isArray(view.proposals) ? view.proposals : [];
    if (proposals.length === 0) {
      d.write(`  Nothing to review — ${(view.rows || []).length} aliases, all following or up to date.\n`);
      return 0;
    }
    let accepted = 0;
    let skipped = 0;
    let dismissed = 0;
    const ctx = { d, fresh, view };
    for (let i = 0; i < proposals.length; i++) {
      const outcome = await reviewOne(proposals[i], i, proposals.length, ctx);
      if (outcome === 'accepted') { accepted++; }
      else if (outcome === 'dismissed') { dismissed++; }
      else { skipped++; }
    }
    const n = proposals.length;
    d.write(`  Reviewed ${n} proposal${n === 1 ? '' : 's'}: ${accepted} accepted, ${skipped} skipped, ${dismissed} dismissed.\n`);
    return 0;
  } finally {
    if (rl) { rl.close(); }
  }
}

module.exports = { runReview };
