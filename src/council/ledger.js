// src/council/ledger.js
'use strict';
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('../utils/config');

// v4.7 GOA-7 D9: v2 rows may carry `resolvedModel` (the executable id that
// served, copied from the joined runStats row, emit-only-when-set). Absent
// resolvedModel ⇒ legacy row, aggregated under its alias (spec R2) — this
// covers ALL pre-v2 history AND leg-less v2 rows (give-up chair, dead seats,
// claude, hand-assembled tally input), whose resolution is genuinely
// unknowable. Legacy-READ only: readers never inspect schemaVersion, rows are
// never migrated.
const LEDGER_SCHEMA_VERSION = 2;
const LEDGER_FILE = 'council-ledger.jsonl';

// v4.7 D4/E1/E2/E6 (Task-7, task-6/task-7 adjudications): fail-closed
// ALLOWLIST of runStats roles the ledger join (below) may consume as a
// model's ledger identity. 'council' is the legacy default role (pre-#83
// runs, and the av-receiver golden fixture — errata E2, must stay green).
// 'redteam' is the second-opinion skill's documented primary-seat role
// (skills/second-opinion/MANUAL-ORCHESTRATION.md:147; red-team runs record
// to the ledger per COUNCIL-DESIGN.md:266 — errata E6, task-7 review: without
// it a red-team row's role/wasChair/conformance never join, silently
// fabricating conformance:'clean' via the `|| 'clean'` fallback below).
// 'judge' stays excluded (#83's overwrite-guard: judges ARE bench models, and
// their Stage-2 cost-attribution row must never win over the seat row). Every
// OTHER non-primary row-per-launch producer — 'chair-attempt', 'repair',
// 'superseded', and the debate pair 'rebuttal'/'revote' — shares a model with
// that model's real bench row and must never join either: skipped by
// omission, including any future role never added here (fail-closed, not a
// skip-list that a new producer could silently slip past). This is the E6
// trade, made explicit: any free-form/custom role label a future producer
// invents is rejected BY DESIGN until someone deliberately adds it here —
// the allowlist would rather silently drop a legitimate new role's
// role/wasChair/conformance (falling back to 'council'/false/'clean') than
// ever let an unreviewed role win the model-keyed join.
//
// Final-review consolidated wave (owner-ruled): the ABSENCE of a role
// (null/undefined) is a DIFFERENT case from a NAMED-unknown role and joins
// too — this is the docs/council.md:562-blessed hand-assembled tally-input
// shape ("the legacy default `council` … pre-#83 rows, or hand-assembled
// tally input that never set a role"), and mirrors GOA-7's absent-field⇒
// legacy pattern elsewhere in this codebase: a field that was never set gets
// treated as the oldest/legacy shape, not silently dropped like an
// unreviewed value would be. A NAMED custom label (e.g. 'custom-thing') is
// still rejected exactly as E6 describes — only the missing-field case is
// legacy; an actively wrong or unreviewed one is not.
const LEDGER_JOIN_ROLES = new Set(['seat', 'critic', 'chair', 'claude', 'council', 'redteam']);
function joinsLedger(role) {
  return role === null || role === undefined ||
    LEDGER_JOIN_ROLES.has(role) || (typeof role === 'string' && role.startsWith('lens:'));
}

function countSeverity(findings) {
  const c = { blocker: 0, major: 0, minor: 0, nit: 0 };
  for (const f of findings) { if (c[f.severity] !== undefined) { c[f.severity] += 1; } }
  return c;
}

// v4.8 PR4b (R4b-4): a LOCAL COPY of run-assemble.js's CONFORMANCE_RANK +
// worseConformance. Deliberately copied, not imported: this module requires
// only fs/path/utils-config, while run-assemble pulls findings → anonymize →
// seats, atomic-write, and — since v4.8 PR4c moved writeVerdictFiles out —
// run-verdict-files → verdict → report. The graph is one hop longer than the
// comment PR4b wrote, not one hop shorter. The duplication is paid for
// by a drift guard (tests/council/ledger.test.js T13a) that asserts pairwise
// agreement with the exported original — including an UNKNOWN value, which is
// where the two spellings can silently diverge.
const CONFORMANCE_RANK = { clean: 0, repaired: 1, unstructured: 2 };
/** Worst-wins merge; returns its FIRST argument on a rank tie (mirrors worseConformance). */
function mergeConformance(a, b) {
  return (CONFORMANCE_RANK[a] || 0) >= (CONFORMANCE_RANK[b] || 0) ? a : b;
}

/**
 * One row per distinct (model, resolvedModel) pair on the bench. Rates are over
 * RAW raised findings.
 *
 * v4.8 PR4b (spec §4.7/§4.9): the runStats join is a FAN-OUT, not a last-wins
 * Map. `alias → resolvedKey → row[]`, so a bench where one executable served
 * more than one seat (a twin `--models a,a`, two aliases sharing a resolution,
 * a chair that is also a bench seat) no longer erases the losing rows, emits
 * byte-identical duplicates, or double-weights deriveReliability's averages.
 *
 * EMISSION ORDER: one block per DISTINCT alias, blocks ordered ascending by
 * that alias's LAST index in meta.models (ties impossible — lastIndexOf is
 * unique per alias); within a block, pair groups in first-observed runStats
 * order. ⚠️ `lastIndexOf`, not `indexOf`: deriveReliability builds `aliases[]`
 * most-recently-seen-first, and pickFallbackChair LAUNCHES `aliases[0]`, so
 * first-occurrence anchoring (what a naive `new Map(model+'\0'+resolved)`
 * gives for free) promotes the executable-id-shaped name over the short alias
 * on `--models gpt-5,openai/gpt-5,gpt-5` — the form run-chair.js:48-52 argues
 * against. On a bench where no alias repeats AND no alias has more than one
 * joinable runStats row, lastIndexOf === indexOf and the row set and its order
 * are unchanged from pre-PR4b.
 *
 * ⚠️ `meta.models` stays the row driver. Two of the three appendRun call sites
 * feed hand-assembled input (cli-handlers-council.js, mcp-server.js) where
 * runStats may be empty; a runStats-driven loop would emit zero rows there.
 * The dedup of meta.models is UNCONDITIONAL — `['a','a']` with `runStats: []`
 * is one row, not two.
 */
function buildLedgerRows(record) {
  const { meta, findings, streetCred, runStats, judged } = record;
  const sc = new Map(streetCred.map(s => [s.model, s]));
  // Only allowlisted roles (joinsLedger, above) may join, so a non-primary
  // row-per-launch row can never contribute a model's role/conformance.
  const byAlias = new Map();
  for (const r of runStats) {
    if (!joinsLedger(r.role)) { continue; }
    if (!byAlias.has(r.model)) { byAlias.set(r.model, new Map()); }
    const pairs = byAlias.get(r.model);
    const key = r.resolvedModel || '';
    if (!pairs.has(key)) { pairs.set(key, []); }
    pairs.get(key).push(r);
  }
  const aliases = [...new Set(meta.models)]
    .sort((a, b) => meta.models.lastIndexOf(a) - meta.models.lastIndexOf(b));
  const rows = [];
  for (const model of aliases) {
    const raised = findings.filter(f => f.raiser === model);
    const s = sc.get(model) || {};
    const pairs = byAlias.get(model);
    // An alias with NO joinable runStats row yields exactly ONE row with an
    // empty group — today's `rs.get(model) || {}` fallback, preserved.
    const groups = pairs ? [...pairs.entries()] : [['', []]];
    groups.forEach(([resolvedKey, group], i) => {
      // R4b-2: within a block exactly ONE row — the FIRST pair group — carries
      // the findings statistics; findings are alias-attributed until PR4c, so
      // splitting them would fabricate a per-executable confirmRate. The other
      // rows' null rates fall out of the `judged && denom` guards at denom 0.
      // Street cred deliberately does NOT concentrate (§0): stripping it flips
      // the launched name from the alias to the raw executable id.
      const mine = i === 0 ? raised : [];
      const denom = mine.length;
      const last = group[group.length - 1] || {};
      rows.push({
        schemaVersion: LEDGER_SCHEMA_VERSION,
        runId: meta.runId, date: meta.date, runType: meta.runType, model,
        // `role`: last row of the PAIR GROUP wins. No role ordering exists
        // anywhere in src/, so with no principled merge this stays closest to
        // today's last-wins. Lens twins are genuinely undecidable.
        role: last.role || 'council',
        // `wasChair`: any-wins. A boolean fact has no last-wins reading.
        wasChair: group.some(r => !!r.wasChair),
        judged: judged === true,
        streetCredWithSelf: judged ? (s.withSelf ?? null) : null,
        streetCredPeersOnly: judged ? (s.peersOnly ?? null) : null,
        findingsRaised: denom,
        bySeverity: countSeverity(mine),
        confirmRate: judged && denom ? mine.filter(f => f.tier === 'Confirmed').length / denom : null,
        factErrorRate: judged && denom ? mine.filter(f => f.tier === 'Disputed').length / denom : null,
        // ⚠️ SEED THE FOLD FROM THE GROUP'S FIRST ROW, never from 'clean':
        // mergeConformance returns its first argument on a rank tie and an
        // unknown value ranks 0, so a 'clean' seed would rewrite an unknown
        // conformance to 'clean' on a SINGLE-row group — i.e. on an ordinary
        // unique-alias bench, where today emits it verbatim. T13b is the pin.
        // The seed means group[0] is folded twice (once as seed, once as the
        // first element); that is deliberate and a no-op, because
        // mergeConformance(x, x) === x. Do NOT "simplify" it away.
        // ⚠️ Consequence, inherited from worseConformance's own tie rule and
        // NOT introduced here: an unknown value survives only in position 0.
        // ['weird','clean'] folds to 'weird', ['clean','weird'] to 'clean',
        // because unknown and 'clean' both rank 0 and the accumulator wins the
        // tie. T13c pins it so nobody "fixes" it into a divergence.
        conformance: group.length
          ? group.reduce((acc, r) => mergeConformance(acc, r.conformance || 'clean'),
            group[0].conformance || 'clean')
          : 'clean',
        ...(resolvedKey ? { resolvedModel: resolvedKey } : {}),
      });
    });
  }
  return rows;
}

function appendRun(record, opts = {}) {
  const dir = opts.dir || getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, LEDGER_FILE);
  const rows = buildLedgerRows(record);
  for (const row of rows) { fs.appendFileSync(file, JSON.stringify(row) + '\n'); }
  return rows;
}

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

// ⚠️ CLAUDE.md's AUTO:modules marker truncates at five exports — append new
// ones at the END so the generated table stays stable.
module.exports = {
  buildLedgerRows, appendRun, deriveReliability, buildStatsDoc, LEDGER_FILE,
  LEDGER_SCHEMA_VERSION,
  // Both exported for the drift guard against run-assemble.js's sibling copy.
  mergeConformance, CONFORMANCE_RANK,
};
