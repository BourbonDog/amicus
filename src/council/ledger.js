// src/council/ledger.js
'use strict';
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('../utils/config');
// The read/aggregate half lives in ./ledger-stats (v4.8 Phase 3 T3.0 size-gate split).
// readRows/avg/countRuns/deriveReliability/buildStatsDoc/LEDGER_FILE are re-exported
// below — existing consumers keep importing them from here.
const { LEDGER_FILE, readRows, avg, countRuns, deriveReliability,
  buildStatsDoc } = require('./ledger-stats');

// v4.7 GOA-7 D9: v2 rows may carry `resolvedModel` (the executable id that
// served, copied from the joined runStats row, emit-only-when-set). Absent
// resolvedModel ⇒ legacy row, aggregated under its alias (spec R2) — this
// covers ALL pre-v2 history AND leg-less v2 rows (give-up chair, dead seats,
// claude, hand-assembled tally input), whose resolution is genuinely
// unknowable. Legacy-READ only: readers never inspect schemaVersion, rows are
// never migrated.
const LEDGER_SCHEMA_VERSION = 2;

// v4.7 D4/E1/E2/E6 (Task-7, task-6/task-7 adjudications): fail-closed
// ALLOWLIST of runStats roles the ledger join (below) may consume as a
// model's ledger identity. 'council' is the legacy default role (pre-#83
// runs, and the av-receiver golden fixture — errata E2, must stay green).
// 'redteam' is the second-opinion skill's documented primary-seat role
// (skills/second-opinion/MANUAL-ORCHESTRATION.md:147; red-team runs record
// to the ledger per COUNCIL-DESIGN.md:268 — errata E6, task-7 review: without
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
// fs/path/utils-config directly, plus its own two size-gate extractions —
// ./ledger-stats and ./ledger-join (v4.8 T3.0/T3.3) — and neither deepens the
// graph: ./ledger-join is require-free and ./ledger-stats requires only the
// same three, plus a LAZY require('./tally') inside buildStatsDoc that never
// runs at module load. run-assemble pulls findings → anonymize →
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

// v4.8 T3.3: the JOIN SEMANTICS — SI-17 normalise (benchLegs) and the
// seat-aware street-cred join (credFor) — live in ./ledger-join, the same
// one-directional split T3.0 used for ./ledger-stats. Read their docblocks
// there before changing either call site below.
const { benchLegs, credFor } = require('./ledger-join');

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
  // The SEATED street-cred rows only, keyed by seat id. ⚠️ Not `s.seat ||
  // s.model`: an alias key here cannot serve a row whose alias has ONLY seated
  // street cred, which is the fix-round-1 regression — credFor's second lookup
  // filters the array by alias instead. The hazard, the emit rule and both
  // lookups are written out at ledger-join.js :: credFor. Named mutant
  // tests/council/street-cred-mutants.js :: LEDGERALIAS.
  const sc = new Map(streetCred.filter(s => s && s.seat).map(s => [s.seat, s]));
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
    const pairs = byAlias.get(model);
    // An alias with NO joinable runStats row yields exactly ONE row with an
    // empty group — the shape the founding ledger commit (c073995e) wrote as
    // `rs.get(model) || {}`; `rs` itself is gone, replaced by `byAlias`/`pairs`
    // during the R4b-2 pair-group split, but the empty-group fallback is not.
    const groups = pairs ? [...pairs.entries()] : [['', []]];
    groups.forEach(([resolvedKey, group], i) => {
      // R4b-2: within a block exactly ONE row — the FIRST pair group — carries
      // the findings statistics. This comment used to forecast that findings were
      // alias-attributed "until PR4c"; that forecast EXPIRED UNFULFILLED. PR4c
      // (R4c-3) seat-keys the tally's peer filter, its runStats rows and the
      // report matrix, but leaves `findings[].raiser` ALIAS-valued — so this join
      // still has no seat to split on, and R4b-2's concentration stands unchanged.
      // Splitting on the executable would fabricate a per-executable confirmRate.
      // Seat-attributed findings are filed to BACKLOG, not scheduled. The other
      // rows' null rates fall out of the `judged && denom` guards at denom 0.
      // Street cred deliberately does NOT concentrate (§0): stripping it flips
      // the launched name from the alias to the raw executable id. Since v4.8
      // T3.3 it is also per-SEAT rather than per-alias (ledger-join.js :: credFor).
      const mine = i === 0 ? raised : [];
      const denom = mine.length;
      // SI-17's normalise: a chair-synthesis row never decides a bench leg's
      // role or conformance (ledger-join.js :: benchLegs). `group` is unchanged, so
      // `wasChair` below still reads every row.
      const legs = benchLegs(group);
      const last = legs[legs.length - 1] || {};
      const s = credFor(sc, group, model, streetCred);
      rows.push({
        schemaVersion: LEDGER_SCHEMA_VERSION,
        runId: meta.runId, date: meta.date, runType: meta.runType, model,
        // `role`: last row of the PAIR GROUP wins, chair rows excluded while a
        // bench leg is present. No role ordering exists anywhere in src/, so
        // with no principled merge this stays closest to today's last-wins.
        // Lens twins are genuinely undecidable.
        role: last.role || 'council',
        // `wasChair`: any-wins over the WHOLE group. A boolean fact has no
        // last-wins reading, and this is the one field a chair row contributes
        // to a bench seat's row.
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
        // ⚠️ The fold runs over `legs`, not `group` — SI-17's normalise. On
        // every group without a chair row the two arrays ARE the same array's
        // contents, so T13b/T13c and the seed rule above are untouched.
        conformance: legs.length
          ? legs.reduce((acc, r) => mergeConformance(acc, r.conformance || 'clean'),
            legs[0].conformance || 'clean')
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

// ⚠️ CLAUDE.md's AUTO:modules marker truncates at five exports — append new
// ones at the END so the generated table stays stable.
module.exports = {
  buildLedgerRows, appendRun, deriveReliability, buildStatsDoc, LEDGER_FILE,
  LEDGER_SCHEMA_VERSION,
  // Both exported for the drift guard against run-assemble.js's sibling copy.
  mergeConformance, CONFORMANCE_RANK,
  // Re-exported from ./ledger-stats (v4.8 Phase 3 T3.0 split); no import path
  // in the tree moved.
  readRows, avg, countRuns,
};
