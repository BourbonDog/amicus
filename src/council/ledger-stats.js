// src/council/ledger-stats.js
'use strict';
// The ledger READ/aggregate half: readRows, avg, countRuns, deriveReliability,
// buildStatsDoc, and LEDGER_FILE. Moved verbatim from ledger.js@f207538c:192-274
// (LEDGER_FILE was ledger.js@f207538c:15) — v4.8 Phase 3 T3.0 size-gate split,
// zero behavior. REQUIRE-FREE of ./ledger by design: this is the leaf the WRITE
// half (buildLedgerRows/appendRun, which stay in ledger.js) depends on, so the
// dependency runs one way (ledger.js -> ledger-stats.js) and cannot cycle.
// ledger.js re-exports all six, so no import path in the tree moved.
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('../utils/config');

const LEDGER_FILE = 'council-ledger.jsonl';

function readRows(dir) {
  const file = path.join(dir, LEDGER_FILE);
  if (!fs.existsSync(file)) { return []; }
  return fs.readFileSync(file, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function avg(nums) { return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null; }

/**
 * v4.8 PR4b (R4b-1): `runs` counts distinct council RUNS, not ledger rows. One
 * run on `--models a,a` is one appearance, not two — and that was true of every
 * bench where one executable served more than one seat, pre-PR4b rows included
 * (history self-corrects; the append-only file never blends two counting units).
 *
 * ⚠️ Spell the predicate literally: only a NON-EMPTY STRING runId is an
 * identity. `runId: ''` is persistable and reaches disk verbatim on the
 * hand-assembled tally path, and `runId: 0` is the mirror hazard — under a
 * bare `if (r.runId)` or an `'runId' in r` both would silently collapse a
 * whole history into ONE run, permanently, in a file that is never migrated.
 * Anything that is not a non-empty string counts individually.
 */
function countRuns(rows) {
  const ids = new Set();
  let unkeyed = 0;
  for (const r of rows) {
    if (typeof r.runId === 'string' && r.runId) { ids.add(r.runId); } else { unkeyed += 1; }
  }
  return ids.size + unkeyed;
}

/**
 * Aggregate the ledger per model. peersOnly nulls excluded; lowN flags < 3 runs
 * (v4.8 PR4b R4b-1: `runs` is DISTINCT runIds — see countRuns).
 * v4.7 GOA-7 D10: groups by `row.resolvedModel || row.model` — v2 rows segment
 * by the executable id that actually served; rows without a resolvedModel
 * (pre-v2 history, leg-less rows, hand-assembled tally input) stay alias-keyed
 * with `legacy: true`. `aliases` lists every row-level `model` (alias) observed
 * for the group, most recently observed FIRST — ledger append order is the only
 * recency signal (`date` is day-granular, free-form on the MCP path), so
 * aliases[0] is the launch-preferred name (pickFallbackChair, D11).
 * Version-blind by design: schemaVersion is never read (legacy-read, R2).
 */
function deriveReliability(opts = {}) {
  const dir = opts.dir || getConfigDir();
  const byKey = new Map();
  for (const row of readRows(dir)) {
    const key = row.resolvedModel || row.model;
    if (!byKey.has(key)) { byKey.set(key, []); }
    byKey.get(key).push(row);
  }
  return [...byKey.entries()].map(([model, rows]) => {
    const peers = rows.map(r => r.streetCredPeersOnly).filter(v => typeof v === 'number');
    const confirms = rows.map(r => r.confirmRate).filter(v => typeof v === 'number');
    const facts = rows.map(r => r.factErrorRate).filter(v => typeof v === 'number');
    const conformance = rows.reduce((acc, r) => { acc[r.conformance] = (acc[r.conformance] || 0) + 1; return acc; }, {});
    const lastSeen = new Map();
    rows.forEach((r, i) => { lastSeen.set(r.model, i); });
    const aliases = [...lastSeen.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    const runs = countRuns(rows);
    return {
      model, runs, lowN: runs < 3,
      avgStreetCredPeersOnly: avg(peers),
      lifetimeConfirmRate: avg(confirms),
      lifetimeFactErrorRate: avg(facts),
      conformance,
      aliases,
      ...(rows.every(r => !r.resolvedModel) ? { legacy: true } : {}),
    };
  });
}

/**
 * v4.0 §7: wrap the deriveReliability() rows in the council v2 envelope —
 * THE one sanctioned breaking shape change (`council stats --json` used to
 * emit the bare array). Human rendering keeps consuming the bare rows.
 * @param {Array<object>} models deriveReliability() output
 * @returns {{schemaVersion: number, type: 'council-stats', models: Array<object>}}
 */
function buildStatsDoc(models) {
  const { COUNCIL_SCHEMA_VERSION } = require('./tally');
  return { schemaVersion: COUNCIL_SCHEMA_VERSION, type: 'council-stats', models };
}

module.exports = { LEDGER_FILE, readRows, avg, countRuns, deriveReliability, buildStatsDoc };
