/**
 * @module sidecar/aliases
 * `amicus aliases` (#238 D4) — the user's alias map as a standing command.
 *
 *   amicus aliases            list: following / pinned, grouped by vendor
 *   amicus aliases --review   picker over every proposal (aliases-review.js)
 *   amicus aliases --json     versioned document: rows + proposals
 *   amicus aliases --review --owner   maintainers: the same picker over the SHIPPED pins (aliases-owner.js)
 *   amicus aliases --unpin <name>   remove a pin (aliases-unpin.js)
 *   amicus aliases --ui       open the setup window on the Routing step (the same editor, plus the "Needs review" section)
 *
 * The LIST reads the catalog CACHE at any age and never networks (§5 display
 * gate); the picker refreshes inline when the cache is stale (write gate).
 * Every form normalizes the config on entry (D6), best-effort.
 *
 * #249 r2 C4: `renderAliasList`'s alias names, ids and vendor-group labels
 * (an unmapped vendor's label is `titleCaseVendor` of a config VALUE's
 * segment — still third-party, per review F1), and the typed name in
 * `aliases-unpin.js`'s messages, are quoted onto a terminal and ride `safeFragment`
 * (the house sanitizer, `utils/text-sanitize.js`) — the fragment, never the
 * composed line, per `alias-shadow.js :: formatAliasShadow`'s rule. A caught
 * `err.message` is a sentence, not an id, so it rides `collapseExcerpt` at
 * the house default cap instead (the `describeThrown` precedent).
 */

'use strict';

const { SCHEMA_VERSION } = require('../utils/result-schema-version');
const { DEFAULT_MAX_AGE_MS } = require('../utils/model-catalog');
const { stripGatewayPrefix } = require('../utils/curated-models');
const { safeFragment, collapseExcerpt } = require('../utils/text-sanitize');

/** @returns {object} this module's collaborators, gathered so a caller can override them in tests */
function loadDeps() {
  const config = require('../utils/config');
  return {
    config,
    normalizeAliases: require('../utils/alias-state').normalizeAliases,
    listAliasRows: require('../utils/alias-state').listAliasRows,
    buildAliasProposals: require('../utils/alias-proposals').buildAliasProposals,
    readDismissals: require('../utils/alias-store').readDismissals,
    getCatalogInfo: require('../utils/model-catalog').getCatalogInfo,
    readCache: require('../utils/model-catalog').readCache,
    groupAliases: require('../utils/alias-groups').groupAliases,
    loadCuratedPins: require('../utils/curated-pins').loadCuratedPins,
  };
}

/** @returns {boolean} true when an own value of `aliases` is not a non-empty string -- saveConfig's own stripper would remove it */
function hasStrippableAliasValue(aliases) {
  return Object.keys(aliases).some(k => typeof aliases[k] !== 'string' || aliases[k].length === 0);
}

/**
 * Normalize on entry (D6), best-effort: a read-only config dir never blocks a
 * listing — the in-memory normalized view is used and the failure announced.
 * Also fires on a non-string value (#249 r1 R8a): `normalizeAliases` only
 * drops a value equal to the shipped default, so a garbage value would
 * otherwise sit on disk forever -- `saveConfig`'s own stripper removes it,
 * with its own Notice.
 * @returns {object} the user alias map after normalization
 */
function normalizeOnEntry(d) {
  const cfg = d.config.loadConfig();
  const defaults = d.config.getDefaultAliases();
  if (!cfg || !cfg.aliases || typeof cfg.aliases !== 'object') { return {}; }
  const probe = d.normalizeAliases(cfg.aliases, defaults);
  if (probe.removed.length > 0 || hasStrippableAliasValue(cfg.aliases)) {
    try { d.config.saveConfig(cfg); }                              // saveConfig prints the Notices
    catch (err) { process.stderr.write(`Notice: could not normalize aliases (${collapseExcerpt(err.message)}) — keys left on disk; every alias still resolves to the same id\n`); }
  }
  return probe.aliases;
}

/**
 * @param {{maxAgeMs?: number}} [opts] `Number.POSITIVE_INFINITY` = cache only
 * @returns {Promise<{rows: Array, proposals: Array, catalogInfo: object, catalogAvailable: boolean, retired: object}>}
 */
async function collectAliasView(opts = {}, d = loadDeps()) {
  const userAliases = normalizeOnEntry(d);
  const defaults = d.config.getDefaultAliases();
  const { retired, notable } = d.loadCuratedPins();
  let catalogInfo = { models: [], fetchedAt: null, providerFailures: [] };
  try {
    if (opts.maxAgeMs === Number.POSITIVE_INFINITY) {
      // Display gate (§5): the LIST never networks, even to fill an empty or
      // v1 cache — read whatever is on disk, verbatim, with no freshness
      // check at all. `getCatalogInfo` cannot be reused here: it always
      // calls `getCatalog`, which refreshes (a real fetch) the moment
      // `readCache()` returns null, regardless of `maxAgeMs`.
      const c = d.readCache();
      catalogInfo = {
        models: (c && Array.isArray(c.models)) ? c.models : [],
        fetchedAt: c && typeof c.fetchedAt === 'number' ? c.fetchedAt : null,
        providerFailures: (c && Array.isArray(c.providerFailures)) ? c.providerFailures : [],
      };
    } else {
      // The picker's default-age path (Task 8): a stale cache refreshes inline.
      catalogInfo = await d.getCatalogInfo(opts.maxAgeMs === undefined ? {} : { maxAgeMs: opts.maxAgeMs });
    }
  } catch (err) { process.stderr.write(`Notice: catalog unavailable (${collapseExcerpt(err.message)}) — no proposals\n`); }
  const rows = d.listAliasRows(userAliases, defaults);
  const proposals = d.buildAliasProposals({ userAliases, defaults, catalogInfo, retired, notable, dismissed: d.readDismissals() });
  return { rows, proposals, catalogInfo, catalogAvailable: (catalogInfo.models || []).length > 0, retired };
}

/**
 * F2: the per-row flag names the SPECIFIC reason a proposal exists, instead
 * of a blanket "newer available" that was wrong for two of the three kinds —
 * an ahead-of-shipped pin with no sibling only differs from the shipped pin,
 * and a stale pin with no catalog match at all is gone from the catalog
 * outright, neither of which is "newer available".
 * @param {string[]} reasons a proposal's `reasons` array
 * @returns {string} the row suffix, or '' when called with no reasons
 */
function rowFlag(reasons) {
  if (!reasons || reasons.length === 0) { return ''; }
  if (reasons.includes('newer-sibling')) { return '   ⚠ newer available'; }
  if (reasons.includes('stale')) { return '   ⚠ gone from catalog'; }
  return '   differs from shipped';
}

/**
 * R4 (#249 r1 C1): a pinned curated row that names the shipped model under a
 * DIFFERENT gateway form gets no proposal at all -- alias-proposals.js's own
 * `sameModel` already treats it as identical to the shipped pin, so it is
 * neither stale nor "differing". Without this note it renders identically
 * to an arbitrary custom pin, losing the fact that it is the shipped
 * recommendation in a different form. Truthful transparency, not a warning.
 * @param {{state:string, curated:boolean, id:string, shipped:string|null}} r
 * @returns {string} the row suffix, or '' when the note does not apply
 */
function sameGatewayNote(r) {
  if (r.state !== 'pinned' || !r.curated || typeof r.id !== 'string' || typeof r.shipped !== 'string') { return ''; }
  if (r.id === r.shipped) { return ''; }
  return stripGatewayPrefix(r.id) === stripGatewayPrefix(r.shipped) ? '   same model as shipped, other gateway' : '';
}

/**
 * #238 D8: a PINNED row whose name is in the shipped `retired` map gets no
 * proposal at all (alias-proposals.js suppresses retired names before judging
 * them), so without this note a dead pin would render as a plain custom pin
 * with no warning — worse than the `⚠ gone from catalog` any other stale pin
 * gets. The date rides the row; the ruling follows on a continuation line.
 * Provenance (#249 r2 C4 rule; updated #238 council r1 F5): `retired` itself
 * is the shipped data file authored by the owner — house bytes, not
 * third-party. The ruling text is still house bytes, but it is now TYPED
 * through an interactive prompt (aliases-owner.js :: askRulings) and
 * accumulates over sessions, so the render site (below) collapses it like
 * any other terminal-bound value, rather than printing it raw.
 * Mutant RETIREDFLAG: return { flag: '', ruling: null } unconditionally.
 * @param {{alias:string, state:string}} r
 * @param {object|undefined} retired
 * @returns {{flag: string, ruling: string|null}} the row suffix and the ruling line, or empties
 */
function retiredNote(r, retired) {
  if (!retired || !r || r.state !== 'pinned' || !Object.prototype.hasOwnProperty.call(retired, r.alias)) { return { flag: '', ruling: null }; }
  return { flag: `   ⚠ retired ${retired[r.alias].on}`, ruling: retired[r.alias].ruling };
}

/**
 * #238 whole-branch review Minor #5: how many PINNED rows are flagged `⚠
 * retired` above -- when there is nothing to review, the footer's reassuring
 * "nothing to review" is misleading if a row above is still flagged.
 * @param {{rows: Array, retired?: object}} view
 * @returns {number}
 */
function retiredFlaggedCount(view) {
  if (!view.retired) { return 0; }
  return view.rows.filter(r => r.state === 'pinned' && Object.prototype.hasOwnProperty.call(view.retired, r.alias)).length;
}

/** @param {{rows: Array, proposals: Array, retired?: object}} view @param {Function} [groupAliases] injectable for tests; defaults to loadDeps().groupAliases so the published `(view) => string` signature works standalone @returns {string} */
function renderAliasList(view, groupAliases = loadDeps().groupAliases) {
  const byAlias = new Map(view.rows.map(r => [r.alias, r]));
  const proposalByAlias = new Map(view.proposals.map(p => [p.alias, p]));
  const map = { __proto__: null };
  for (const r of view.rows) { map[r.alias] = r.id; }
  // #249 r2 C4: width is computed from the SANITIZED name -- a bidi/ANSI
  // fragment stripped at render time must not skew the column alignment of
  // every other row's padding.
  const width = Math.max(6, ...view.rows.map(r => safeFragment(r.alias).length));
  const lines = [];
  for (const g of groupAliases(map)) {
    // F1 (#249 r2 review, C4 residual): for a vendor NOT in ALIAS_VENDOR_LABELS,
    // `alias-groups.js :: vendorLabel` title-cases the raw vendor segment of a
    // config VALUE (`aliasVendorOf`) rather than mapping it to house text --
    // that is still third-party data, unlike the ~30 mapped labels. Sanitized
    // HERE, not inside `vendorLabel`: that helper also renders into the
    // Electron setup UI's HTML context (`electron/setup-ui-alias-groups.js`),
    // out of scope for this terminal-only house rule.
    lines.push(`  ${safeFragment(g.label)}`);
    for (const key of g.keys) {
      const r = byAlias.get(key);
      const p = proposalByAlias.get(key);
      const dead = p ? { flag: '', ruling: null } : retiredNote(r, view.retired);
      const flag = p ? rowFlag(p.reasons) : (dead.flag || sameGatewayNote(r));
      lines.push(`    ${safeFragment(key).padEnd(width)}  → ${safeFragment(r.id).padEnd(44)} ${r.state}${flag}`);
      // F5 (#238 council r1 A1/B4/D2): the ruling is typed through a prompt now (see retiredNote's docblock) -- collapse before it reaches the terminal.
      if (dead.ruling) { lines.push(`    ${''.padEnd(width)}    ↳ ${collapseExcerpt(dead.ruling)}`); }
    }
  }
  lines.push('');
  // F1: an unavailable catalog cannot be checked for updates at all -- that is
  // a different fact from "checked, nothing found" and must not print the
  // reassuring "nothing to review" line.
  if (!view.catalogAvailable) {
    lines.push('  catalog unavailable — cannot check for updates (amicus models --refresh)');
    return lines.join('\n') + '\n';
  }
  const n = view.proposals.length;
  const retiredCount = n === 0 ? retiredFlaggedCount(view) : 0;
  lines.push(n === 0
    ? (retiredCount > 0
        ? `  nothing to review (${retiredCount} retired pin${retiredCount === 1 ? '' : 's'} flagged above) — amicus aliases --review`
        : '  nothing to review — amicus aliases --review')
    : `  ${n} to review — amicus aliases --review`);
  // F1: the catalog is available but stale -- name its age so a user who
  // never runs --review still learns the background refresh isn't keeping up.
  const fetchedAt = view.catalogInfo && view.catalogInfo.fetchedAt;
  if (typeof fetchedAt === 'number' && (Date.now() - fetchedAt) > DEFAULT_MAX_AGE_MS) {
    const days = Math.floor((Date.now() - fetchedAt) / DEFAULT_MAX_AGE_MS);
    lines.push(`  (catalog is ${days} day${days === 1 ? '' : 's'} old — amicus models --refresh)`);
  }
  return lines.join('\n') + '\n';
}

/** @returns {object} the `--json` document (fields only ever ADDED within SCHEMA_VERSION) */
function buildAliasesDoc(view) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'aliases',
    catalogAvailable: view.catalogAvailable,
    catalogFetchedAt: view.catalogInfo.fetchedAt || null,
    aliasCount: view.rows.length,
    aliases: view.rows,
    proposalCount: view.proposals.length,
    proposals: view.proposals,
    retired: view.retired || {},
  };
}

/** @param {object} args parsed CLI args @returns {Promise<number>} exit code */
async function handleAliases(args) {
  if (args.ui) {
    // #238 D4: `--ui` opens the Electron setup window on the Routing step --
    // the same alias editor, with the "Needs review" section (electron/
    // setup-ui-alias-review.js). Interactive-only, so it combines with none
    // of the machine or terminal forms (R-P3-12).
    if (args.json || args.review || args.owner || args.unpin !== undefined) {
      process.stderr.write('Error: --ui opens the setup window at the Routing step; it cannot be combined with --json, --review, --owner or --unpin\n');
      return 1;
    }
    normalizeOnEntry(loadDeps());                     // D6: every `amicus aliases` form normalizes on entry
    const { launchSetupWindow } = require('./setup-window');
    const res = await launchSetupWindow({ pane: 'aliases' });
    if (!res || !res.success) {
      process.stderr.write(`${(res && res.error) || 'Setup window closed without completing'}\n`);
      return 1;
    }
    process.stdout.write('Aliases saved.\n');
    return 0;
  }
  if (args.owner && !args.review) {
    process.stderr.write('Error: --owner requires --review (amicus aliases --review --owner)\n');
    return 1;
  }
  if (args.review && (args.json || args.quiet)) {
    process.stderr.write('Error: --review is interactive; use `amicus aliases --json` for machine output\n');
    return 1;
  }
  if (args.unpin !== undefined) {
    if (args.review || args.json) {
      process.stderr.write('Error: --unpin cannot be combined with --review or --json\n');
      return 1;
    }
    return require('./aliases-unpin').handleUnpin(args.unpin);           // handleUnpin trims/validates (R1): true, 42, '', '  ', 'null' all land the same error
  }
  if (args.review) {
    return args.owner
      ? require('./aliases-owner').runOwnerReview(args)
      : require('./aliases-review').runReview(args);
  }
  const d = loadDeps();
  const view = await collectAliasView({ maxAgeMs: Number.POSITIVE_INFINITY }, d);
  if (args.json) {
    process.stdout.write(JSON.stringify(buildAliasesDoc(view), null, 2) + '\n');
    return 0;
  }
  process.stdout.write(renderAliasList(view, d.groupAliases));
  return 0;
}

module.exports = { handleAliases, collectAliasView, renderAliasList, buildAliasesDoc, loadDeps };
