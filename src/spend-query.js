// src/spend-query.js
'use strict';

/**
 * @module spend-query
 * Pure query/rollup helpers for `amicus spend` (spec §7.3 filters/group-by,
 * §6.3/resolved Q6 `wasted`). Split out of src/cli-handlers-spend.js (which
 * re-exports these) to stay under the 300-line size gate — see that file's
 * module docblock. No I/O, no CLI concerns: everything here is rows-in,
 * rows/rollup-out and independently testable.
 */

/**
 * Valid `--group-by`/`groupBy` dimensions — the SINGLE source of truth shared
 * by the CLI's validity check (cli-handlers-spend.js), the MCP `amicus_spend`
 * tool's `groupBy` Zod enum (mcp-tools.js), and rowKey()'s switch below. Do
 * NOT hand-copy this array elsewhere: a 7th dimension added here must reach
 * both surfaces automatically, not just the one someone remembered to edit.
 */
const GROUP_DIMS = ['model', 'wave', 'council', 'project', 'op', 'day', 'tag'];

/** Cap on rows returned when a caller opts into raw rows (CLI --rows / MCP rows:true). */
const ROWS_CAP = 1000;

function emptyTokens() {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function addTokens(into, tokens) {
  if (!tokens) { return; }
  for (const k of Object.keys(into)) { into[k] += tokens[k] || 0; }
}

/** Pure row filter over the additive attribution fields (spec 7.3). */
function filterRows(rows, f = {}) {
  const cutoff = (f.since !== undefined && f.since !== null && f.now !== undefined) ? f.now - f.since * 86400000 : null;
  return rows.filter((r) => {
    if (f.wave && r.waveId !== f.wave) { return false; }
    if (f.council && r.councilRunId !== f.council && r.councilName !== f.council) { return false; }
    if (f.project && r.project !== f.project) { return false; }
    if (f.model && !String(r.model || '').startsWith(f.model)) { return false; }
    if (f.op && r.op !== f.op) { return false; }
    if (f.failed && (r.status === 'complete' || !r.status)) { return false; }
    if (cutoff !== null) { const t = Date.parse(r.ts); if (!Number.isFinite(t) || t < cutoff) { return false; } }
    return true;
  });
}

/** dimension -> row key. null/absent -> '(unattributed)'. `day` = the ISO date. */
function rowKey(row, dimension) {
  switch (dimension) {
    case 'model': return row.model || '(unattributed)';
    case 'wave': return row.waveId || '(unattributed)';
    case 'council': return row.councilRunId || row.councilName || '(unattributed)';
    case 'project': return row.project || '(unattributed)';
    case 'op': return row.op || '(unattributed)';
    case 'day': return typeof row.ts === 'string' ? row.ts.slice(0, 10) : '(unattributed)';
    case 'tag': return row.tag || '(unattributed)';
    default: return '(unattributed)';
  }
}

/**
 * Group rows into {key, amount, tokens, runs, unpricedRows,
 * unattributedSubtreeRows, sourceMix}, most-expensive first.
 *
 * v4.4: `amount` deliberately stays a plain number — the published
 * spend.schema.json pins `groups[].amount` to `type: "number"` — so
 * `unpricedRows` is how a group says "this figure omits N rows we cannot
 * price". Without it, a group of entirely unpriced rows was indistinguishable
 * from a group that genuinely cost $0 (diagnosis §8).
 *
 * v4.4.1 CA-2: `unattributedSubtreeRows` is the SECOND way a figure can be a
 * floor, and `unpricedRows` structurally cannot see it — such a row IS priced,
 * lands in the `r` source bucket, and contributes its own cost to `amount`; what
 * is missing is the child session it spawned. The two counters are incremented
 * BESIDE each other, never instead of: a row can be both.
 */
function groupRows(rows, dimension) {
  const map = new Map();
  for (const r of rows) {
    const key = rowKey(r, dimension);
    if (!map.has(key)) { map.set(key, { key, amount: 0, tokens: emptyTokens(), runs: 0, unpricedRows: 0, unattributedSubtreeRows: 0, sourceMix: { reported: 0, estimated: 0, unknown: 0 } }); }
    const b = map.get(key);
    b.runs += 1;
    addTokens(b.tokens, r.tokens);
    const cost = r.cost || {};
    if (typeof cost.amount === 'number') { b.amount += cost.amount; } else { b.unpricedRows += 1; }
    if (r.subtreeUnknown) { b.unattributedSubtreeRows += 1; }
    const src = (cost.source === 'reported' || cost.source === 'estimated') ? cost.source : 'unknown';
    b.sourceMix[src] += 1;
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/**
 * Wasted spend = every row with an EXPLICIT non-complete status, bucketed by
 * status (spec 6.3, resolved Q6). A row with status null/absent (pre-v4.3,
 * or any row that never reached a terminal status write) is deliberately
 * EXCLUDED here — not "complete" and not "wasted" — because we cannot know
 * whether that historical run actually failed; counting it would fabricate
 * a failure that was never recorded. Contrast with groupRows(), where a null
 * dimension is a first-class '(unattributed)' bucket (grouping never drops
 * a row); computeWasted intentionally drops it instead.
 */
function computeWasted(rows) {
  const out = { amount: 0, tokens: emptyTokens(), runs: 0, unpricedRows: 0, unattributedSubtreeRows: 0, byStatus: {} };
  for (const r of rows) {
    if (r.status === 'complete' || !r.status) { continue; }
    out.runs += 1;
    addTokens(out.tokens, r.tokens);
    // v4.4: null→0 here is arithmetic, not a claim. `unpricedRows` records how
    // many failed rows we could not price so "wasted $X" is never mistaken for
    // the whole loss (see groupRows for why `amount` stays a number).
    // v4.4.1 CA-2: `unattributedSubtreeRows` is the other half of the same
    // understatement — a failed leg that DID resolve its own cost but left a
    // child session unpriced. Counted beside `unpricedRows`, never instead of.
    const priced = r.cost && typeof r.cost.amount === 'number';
    const amt = priced ? r.cost.amount : 0;
    if (!priced) { out.unpricedRows += 1; }
    if (r.subtreeUnknown) { out.unattributedSubtreeRows += 1; }
    out.amount += amt;
    if (!out.byStatus[r.status]) { out.byStatus[r.status] = { amount: 0, runs: 0, unpricedRows: 0, unattributedSubtreeRows: 0 }; }
    out.byStatus[r.status].amount += amt;
    out.byStatus[r.status].runs += 1;
    if (!priced) { out.byStatus[r.status].unpricedRows += 1; }
    if (r.subtreeUnknown) { out.byStatus[r.status].unattributedSubtreeRows += 1; }
  }
  return out;
}

module.exports = { filterRows, groupRows, computeWasted, emptyTokens, addTokens, GROUP_DIMS, ROWS_CAP };
