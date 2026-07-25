// src/cli-handlers-spend.js
'use strict';

/**
 * `amicus spend` — cross-run cost rollup over spend-ledger.jsonl (B24).
 * Mirrors cli-handlers-doctor.js's injectable-deps shape (a `depsOverride`
 * parameter tests can use to stub I/O/network) and cli-handlers-council.js's
 * command-file split (kept its own file to stay well under the size gate).
 *
 * buildSpendDoc() lives HERE rather than in src/utils/result-schema.js: that
 * module is at its 300-line size-gate ceiling (filled by a parallel lane in
 * this same phase), so this module defines its own doc builder using the
 * SAME schemaVersion convention (result-schema's SCHEMA_VERSION, imported —
 * not a forked/independent counter) rather than adding to a full file. If
 * result-schema.js is ever split/slimmed, buildSpendDoc is the one to fold
 * back in alongside buildCatalogDoc/buildDoctorDoc.
 *
 * filterRows/groupRows/computeWasted (spec §7.3/§6.3 query layer) live in the
 * sibling ./spend-query.js instead of here: adding them inline pushed this
 * file to 306 lines, over the 300-line size gate. They're re-exported below
 * so existing/brief-specified imports of them from THIS module still resolve.
 * GROUP_DIMS/ROWS_CAP (Task 5) live there too, as the single source shared
 * with the MCP `amicus_spend` tool (src/mcp-tools.js, src/mcp-spend.js) —
 * re-exported below for the same reason.
 */

const { readSpendRows } = require('./utils/spend-ledger');
const { formatCost } = require('./utils/pricing');
const { failJson, ERROR_CODES } = require('./utils/error-doc');
const { filterRows, groupRows, computeWasted, emptyTokens, addTokens, GROUP_DIMS, ROWS_CAP } = require('./spend-query');

const CREDIT_CHECK_TIMEOUT_MS = 5000;

/** @param {string} since e.g. '7d' @returns {number|null} whole days, or null if unparseable */
function parseSinceDays(since) {
  if (typeof since !== 'string') { return null; }
  const m = since.trim().match(/^(\d+)d$/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Aggregate ledger rows into a total + per-model rollup, most-expensive-first.
 * A row with a null cost.amount contributes 0 to totals but is still counted
 * in `runs` and its source bucket — visibility into "how many runs are
 * unpriced" matters as much as the dollar figure.
 * @param {Array<object>} rows
 */
function aggregateSpend(rows) {
  const total = { amount: 0, tokens: emptyTokens(), runs: rows.length, sourceMix: { reported: 0, estimated: 0, unknown: 0 } };
  const byModelMap = new Map();
  for (const r of rows) {
    const model = r.model || 'unknown';
    if (!byModelMap.has(model)) {
      byModelMap.set(model, { model, amount: 0, tokens: emptyTokens(), runs: 0, sourceMix: { reported: 0, estimated: 0, unknown: 0 } });
    }
    const bucket = byModelMap.get(model);
    bucket.runs += 1;
    addTokens(bucket.tokens, r.tokens);
    addTokens(total.tokens, r.tokens);
    const cost = r.cost || {};
    const amount = typeof cost.amount === 'number' ? cost.amount : 0;
    bucket.amount += amount;
    total.amount += amount;
    // Any source string outside {reported,estimated} buckets as unknown —
    // covers 'unknown', a missing/malformed cost block, or a future source.
    const src = (cost.source === 'reported' || cost.source === 'estimated') ? cost.source : 'unknown';
    bucket.sourceMix[src] += 1;
    total.sourceMix[src] += 1;
  }
  const byModel = [...byModelMap.values()].sort((a, b) => b.amount - a.amount);
  return { total, byModel };
}

/**
 * Build the `--json` spend document. schemaVersion reuses result-schema's
 * SCHEMA_VERSION (not a forked counter) — see module docblock for why this
 * builder lives here instead of alongside buildCatalogDoc/buildDoctorDoc.
 * New fields (filters/groupBy/groups/wasted/rows/rowsTruncated, spec §7.3)
 * are all additive and only appear when the caller passes them — byte-compat
 * for callers/tests that only ever passed {total, byModel, windowDays, credit}.
 * @param {{total:object, byModel:Array, windowDays:number|null, credit:object|null,
 *   filters?:object, groupBy?:string, groups?:Array, wasted?:object,
 *   rows?:Array, rowsTruncated?:boolean}} opts
 */
function buildSpendDoc({ total, byModel, windowDays, credit, filters, groupBy, groups, wasted, rows, rowsTruncated }) {
  const { SCHEMA_VERSION } = require('./utils/result-schema');
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    type: 'spend',
    windowDays: windowDays !== undefined ? windowDays : null,
    total,
    byModel,
    credit: credit || null,
  };
  if (filters !== undefined) { doc.filters = filters; }
  if (groupBy !== undefined) { doc.groupBy = groupBy; }
  if (groups !== undefined) { doc.groups = groups; }
  if (wasted !== undefined) { doc.wasted = wasted; }
  if (rows !== undefined) { doc.rows = rows; doc.rowsTruncated = !!rowsTruncated; }
  return doc;
}

/** Real deps; tests override via the second handleSpend arg. */
function realDeps() {
  return {
    dir: undefined, // readSpendRows falls back to getConfigDir() itself
    readApiKeyValues: () => require('./utils/api-key-store').readApiKeyValues(),
    checkOpenRouterCredit: (key) => require('./utils/api-key-validation').checkOpenRouterCredit(key),
    now: () => Date.now(),
  };
}

/** Race a promise against a hard timeout; resolves `fallback` on timeout — never rejects, never hangs the caller. */
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(fallback); } }, ms);
    Promise.resolve(promise).then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(fallback); } },
    );
  });
}

/**
 * Best-effort OpenRouter credit footer. Never throws; never blocks past
 * ~CREDIT_CHECK_TIMEOUT_MS; skipped (returns null) when no key is configured.
 */
async function fetchCreditFooter(deps) {
  let values = {};
  try { values = deps.readApiKeyValues() || {}; } catch { /* best-effort */ }
  const key = values.openrouter;
  if (!key) { return null; }
  const res = await withTimeout(
    Promise.resolve().then(() => deps.checkOpenRouterCredit(key)),
    CREDIT_CHECK_TIMEOUT_MS,
    null,
  );
  return res || null;
}

function renderHuman({ total, byModel, windowDays, credit, wasted }) {
  if (total.runs === 0) { return 'No spend recorded yet.\n'; }
  let out = windowDays ? `amicus spend (last ${windowDays}d)\n\n` : 'amicus spend (all time)\n\n';
  out += 'model                                            runs  tokens(in/out)      cost      sources\n';
  for (const m of byModel) {
    const mix = `r${m.sourceMix.reported}/e${m.sourceMix.estimated}/u${m.sourceMix.unknown}`;
    const tokCol = `${m.tokens.input}/${m.tokens.output}`;
    out += `${String(m.model).slice(0, 48).padEnd(48)} ${String(m.runs).padStart(4)}  ` +
      `${tokCol.padStart(15)}  ` +
      `${formatCost({ amount: m.amount, source: dominantSource(m.sourceMix) }).padStart(9)}  ${mix}\n`;
  }
  out += `\nTotal: ${formatCost({ amount: total.amount, source: dominantSource(total.sourceMix) })} across ${total.runs} run(s)\n`;
  if (wasted && wasted.runs > 0) {
    out += `Wasted (failed runs): ${formatCost({ amount: wasted.amount, source: 'mixed' })} across ${wasted.runs} rows — see amicus spend --failed\n`;
  }
  if (credit && typeof credit.limitRemaining === 'number') {
    out += `OpenRouter credit remaining: $${credit.limitRemaining}\n`;
  }
  return out;
}

/** Pick a representative source tag for formatCost's ~ prefix: mixed if >1 bucket populated. */
function dominantSource(mix) {
  const populated = Object.entries(mix).filter(([, n]) => n > 0).map(([k]) => k);
  if (populated.length === 0) { return 'unknown'; }
  if (populated.length > 1) { return 'mixed'; }
  return populated[0];
}

/**
 * `amicus spend [--since 7d] [--wave <id>] [--council <runId|name>] [--project <path|.>]
 *   [--model <id-or-prefix>] [--op <op>] [--failed] [--group-by <dim>] [--rows] [--json]`
 * @param {{_:string[], json?:boolean, since?:string, wave?:string, council?:string,
 *   project?:string|boolean, model?:string, op?:string, failed?:boolean,
 *   'group-by'?:string, rows?:boolean}} args
 * @param {object} [depsOverride] test seam
 * @returns {Promise<number>} exit code
 */
async function handleSpend(args, depsOverride = {}) {
  const useJson = !!args.json;
  const deps = { ...realDeps(), ...depsOverride };

  let windowDays = null;
  if (args.since !== undefined) {
    windowDays = parseSinceDays(args.since);
    if (windowDays === null) {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `invalid --since '${args.since}'`,
        hint: "amicus spend --since 7d  (an integer followed by 'd')" });
    }
  }

  const groupBy = args['group-by'] || 'model';
  if (!GROUP_DIMS.includes(groupBy)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `invalid --group-by '${groupBy}'`,
      hint: `--group-by one of: ${GROUP_DIMS.join('|')}` });
  }

  const rows = readSpendRows(deps.dir);
  const filters = {
    wave: args.wave, council: args.council, model: args.model,
    op: args.op, failed: !!args.failed,
    project: args.project === '.' || args.project === true ? process.cwd() : args.project,
  };
  const filtered = filterRows(rows, { ...filters, since: windowDays, now: windowDays !== null ? deps.now() : undefined });

  const { total, byModel } = aggregateSpend(filtered);
  const groups = groupRows(filtered, groupBy);
  const wasted = computeWasted(filtered);
  let rowsOut, rowsTruncated;
  if (args.rows) {
    rowsTruncated = filtered.length > ROWS_CAP;
    rowsOut = filtered.slice(0, ROWS_CAP);
  }

  // Nothing recorded (or nothing survives the filters): skip the network
  // credit probe entirely — there's no rollup to attach it to either way.
  const credit = total.runs === 0 ? null : await fetchCreditFooter(deps).catch(() => null);

  if (useJson) {
    const doc = buildSpendDoc({ total, byModel, windowDays, credit,
      filters, groupBy, groups, wasted, rows: rowsOut, rowsTruncated });
    process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(renderHuman({ total, byModel, windowDays, credit, wasted }));
  return 0;
}

module.exports = {
  handleSpend, aggregateSpend, buildSpendDoc, parseSinceDays,
  filterRows, groupRows, computeWasted, GROUP_DIMS, ROWS_CAP,
};
