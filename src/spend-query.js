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
    default: return '(unattributed)';
  }
}

/** Group rows into {key, amount, tokens, runs, sourceMix}, most-expensive first. */
function groupRows(rows, dimension) {
  const map = new Map();
  for (const r of rows) {
    const key = rowKey(r, dimension);
    if (!map.has(key)) { map.set(key, { key, amount: 0, tokens: emptyTokens(), runs: 0, sourceMix: { reported: 0, estimated: 0, unknown: 0 } }); }
    const b = map.get(key);
    b.runs += 1;
    addTokens(b.tokens, r.tokens);
    const cost = r.cost || {};
    if (typeof cost.amount === 'number') { b.amount += cost.amount; }
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
  const out = { amount: 0, tokens: emptyTokens(), runs: 0, byStatus: {} };
  for (const r of rows) {
    if (r.status === 'complete' || !r.status) { continue; }
    out.runs += 1;
    addTokens(out.tokens, r.tokens);
    const amt = (r.cost && typeof r.cost.amount === 'number') ? r.cost.amount : 0;
    out.amount += amt;
    if (!out.byStatus[r.status]) { out.byStatus[r.status] = { amount: 0, runs: 0 }; }
    out.byStatus[r.status].amount += amt;
    out.byStatus[r.status].runs += 1;
  }
  return out;
}

module.exports = { filterRows, groupRows, computeWasted, emptyTokens, addTokens };
