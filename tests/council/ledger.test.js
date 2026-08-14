// tests/council/ledger.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildLedgerRows, appendRun, deriveReliability, buildStatsDoc, LEDGER_SCHEMA_VERSION,
  mergeConformance } = require('../../src/council/ledger');
const { tally } = require('../../src/council/tally');
const { debateRunStatsRows } = require('../../src/council/debate');
const { worseConformance } = require('../../src/council/run-assemble');
const { pickFallbackChair } = require('../../src/council/run-chair');
const avInput = require('./fixtures/av-receiver-input');

// A provisional tally-input: 3 findings, judges gpt+qwen adjudicated. Carried
// in verbatim from tests/council/debate.test.js (pre-d279384-fix-wave) as the
// fixture for the ledger-join test below — see that test's own comment.
function debateBaseInput() {
  return {
    meta: { runId: 'r', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek', claudeInCouncil: false },
    findings: [
      { id: 'A1', raiser: 'gemini', severity: 'major', claim: 'infinite retry' },
      { id: 'A2', raiser: 'gemini', severity: 'minor', claim: 'log leak' },
      { id: 'B1', raiser: 'gpt', severity: 'nit', claim: 'typo' },
    ],
    adjudications: [
      { findingId: 'A1', judge: 'gpt', verdict: 'dispute' },
      { findingId: 'A1', judge: 'qwen', verdict: 'dispute' },
      { findingId: 'A2', judge: 'gpt', verdict: 'dispute' },
      { findingId: 'B1', judge: 'gemini', verdict: 'neutral' },
    ],
    rankings: [{ judge: 'gpt', order: ['gemini', 'qwen'] }, { judge: 'qwen', order: ['gemini', 'gpt'] }],
    runStats: [{ model: 'gemini', role: 'seat', status: 'complete', durationMs: 100, usage: null }],
  };
}

// Minimal single-model record shape shared by the #83-pattern guards below
// (extends the pattern to the other three producer classes named in the
// Task-6 review amendment: chair-attempt, repair, and the debate pair).
function singleModelRecord(extraRow) {
  return {
    meta: { runId: 'r1', date: '2026-08-01', runType: 'headless', models: ['alpha'], chair: 'c' },
    findings: [], streetCred: [{ model: 'alpha', withSelf: 1, peersOnly: 1 }],
    judged: true,
    runStats: [
      { model: 'alpha', role: 'seat', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 100, usage: null },
      extraRow,
    ],
  };
}

// Minimal single-model record, same shape as singleModelRecord() above minus
// the extra (non-primary) row — the baseline fixture for the D9 schema-stamp
// and resolvedModel-join tests below. A fresh object literal per call (not a
// tally(avInput) reuse) so mutating record.meta.models / record.runStats in
// one test can never leak into another.
function baseRecord() {
  return {
    meta: { runId: 'r1', date: '2026-08-01', runType: 'headless', models: ['alpha'], chair: 'c' },
    findings: [], streetCred: [{ model: 'alpha', withSelf: 1, peersOnly: 1 }],
    judged: true,
    runStats: [
      { model: 'alpha', role: 'seat', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 100, usage: null },
    ],
  };
}

const record = tally(avInput);

test('buildLedgerRows computes raw rates and carries role/wasChair/conformance', () => {
  const rows = buildLedgerRows(record);
  const gpt = rows.find(r => r.model === 'gpt');
  expect(gpt.findingsRaised).toBe(12);
  expect(gpt.confirmRate).toBeCloseTo(12 / 12);  // raw, not de-duped; lone-peer agrees now count as Confirmed
  expect(gpt.factErrorRate).toBe(0);
  expect(gpt.bySeverity).toEqual({ blocker: 1, major: 5, minor: 5, nit: 1 });
  const ds = rows.find(r => r.model === 'deepseek');
  expect(ds.wasChair).toBe(true);
  expect(ds.judged).toBe(true);
});

test('judged:false record yields null rates and street-cred', () => {
  const single = { ...record, judged: false,
    streetCred: record.streetCred.map(s => ({ ...s, withSelf: null, peersOnly: null })) };
  const rows = buildLedgerRows(single);
  expect(rows[0].confirmRate).toBeNull();
  expect(rows[0].streetCredPeersOnly).toBeNull();
  expect(rows[0].judged).toBe(false);
});

test('appendRun + deriveReliability round-trip; trailing partial line tolerated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  // v4.8 PR4b (R4b-1): `runs` counts DISTINCT runIds, so the second append has
  // to be a genuinely different run — `record` is tally(avInput) and both
  // appends would otherwise carry meta.runId 'av-receiver-council', which is
  // ONE run written twice, not two council appearances.
  appendRun(record, { dir });
  appendRun({ ...record, meta: { ...record.meta, runId: 'av-receiver-council-2' } }, { dir });
  fs.appendFileSync(path.join(dir, 'council-ledger.jsonl'), '{ broken partial');
  const agg = deriveReliability({ dir });
  const gpt = agg.find(a => a.model === 'gpt');
  expect(gpt.runs).toBe(2);
  expect(gpt.lowN).toBe(true);                 // < 3 runs
  expect(gpt.avgStreetCredPeersOnly).toBeCloseTo(1.0);
});

test('peersOnly:null rows are excluded from the average', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const r2 = { ...record, streetCred: record.streetCred.map(s =>
    s.model === 'gpt' ? { ...s, peersOnly: null } : s) };
  appendRun(record, { dir });   // gpt peersOnly 1.0
  appendRun(r2, { dir });       // gpt peersOnly null → ignored
  const gpt = deriveReliability({ dir }).find(a => a.model === 'gpt');
  expect(gpt.avgStreetCredPeersOnly).toBeCloseTo(1.0);
});

test('rows are stamped with the CURRENT schema version (2 after GOA-7 D9)', () => {
  const rows = buildLedgerRows(baseRecord());
  expect(LEDGER_SCHEMA_VERSION).toBe(2);
  for (const row of rows) { expect(row.schemaVersion).toBe(2); }
});

test('resolvedModel is copied from the JOINED runStats row when present (D9)', () => {
  const rec = baseRecord();
  rec.runStats = [{ model: 'gpt', role: 'seat', wasChair: false, conformance: 'clean',
    resolvedModel: 'openai/gpt-5.2', status: 'complete', durationMs: 5, usage: null }];
  rec.meta.models = ['gpt'];
  const rows = buildLedgerRows(rec);
  expect(rows[0].resolvedModel).toBe('openai/gpt-5.2');
});

test('absent resolvedModel on the joined row ⇒ NO resolvedModel key on the ledger row (legacy-by-absence, R2)', () => {
  const rec = baseRecord();  // its runStats rows carry no resolvedModel
  const rows = buildLedgerRows(rec);
  for (const row of rows) { expect('resolvedModel' in row).toBe(false); }
});

test('a model with NO joining runStats row gets no resolvedModel (the {} join fallback)', () => {
  const rec = baseRecord();
  rec.runStats = [];  // nothing joins; role/conformance fall back
  const rows = buildLedgerRows(rec);
  for (const row of rows) { expect('resolvedModel' in row).toBe(false); }
});

// Final-review consolidated wave (item 2b): the join allowlist (joinsLedger,
// ledger.js) is the ONLY gate for whether a runStats row's fields — including
// resolvedModel — win the model-keyed join. A non-allowlisted role (e.g.
// 'judge', excluded by the #83 overwrite-guard) must not leak resolvedModel
// onto the ledger row even when the row itself carries one — pinning this
// against a refactor that might key the resolvedModel copy on "row carries
// resolvedModel" instead of "row's role passed joinsLedger".
test('a NON-allowlisted role carrying resolvedModel does not join it onto the ledger row (allowlist is the only gate)', () => {
  const rec = baseRecord();
  rec.runStats = [{ model: 'gpt', role: 'judge', wasChair: false, conformance: 'clean',
    resolvedModel: 'openai/gpt-5.2', status: 'complete', durationMs: 5, usage: null }];
  rec.meta.models = ['gpt'];
  const rows = buildLedgerRows(rec);
  expect('resolvedModel' in rows[0]).toBe(false);
});

// ⚠️ There is only ONE appendRun here; the second row is hand-built and
// appended raw. The assertion's job is the version-blind legacy-read contract
// (ledger.js: schemaVersion is never inspected) — `runs: 2` is how it proves
// the unknown-version row was AGGREGATED, so it must stay 2. v4.8 PR4b (R4b-1)
// makes `runs` count distinct runIds and the spread inherits `record`'s, so
// the literal is stamped with its own id: relaxing this to `toBe(1)` instead
// would stay green with the whole future-row block deleted, i.e. with the
// contract under test never exercised at all.
test('aggregates rows written under a FUTURE schemaVersion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  appendRun(record, { dir });
  const gptRow = buildLedgerRows(record).find(r => r.model === 'gpt');
  const future = { ...gptRow, schemaVersion: LEDGER_SCHEMA_VERSION + 1, runId: 'r-future' };
  fs.appendFileSync(path.join(dir, 'council-ledger.jsonl'), JSON.stringify(future) + '\n');
  expect(deriveReliability({ dir }).find(a => a.model === 'gpt').runs).toBe(2);
});

test('buildStatsDoc wraps the reliability rows in the council v2 envelope (v4.0 §7 — breaking)', () => {
  const rows = [{ model: 'gpt', runs: 3, lowN: false, avgStreetCredPeersOnly: 1.4,
    lifetimeConfirmRate: 0.5, lifetimeFactErrorRate: 0, conformance: { clean: 3 } }];
  const doc = buildStatsDoc(rows);
  expect(doc).toEqual({ schemaVersion: 2, type: 'council-stats', models: rows });
});

test('#83 guard: judge rows never shadow seat rows in the reliability join', () => {
  // Two rows, same model: the seat row must win — buildLedgerRows' join (ledger.js:21)
  // is keyed by model, and before this guard the LAST entry for a key wins a JS Map
  // build, so the judge row (listed second, as it is here) would silently overwrite
  // the seat row. buildLedgerRows' output row does not project durationMs (only
  // role/wasChair/conformance survive the join), so `role` is the observable proxy
  // for which source row won: 'seat' proves the seat row (durationMs 100) survived;
  // 'judge' would mean the judge row (durationMs 50) clobbered it.
  const rec = {
    meta: { runId: 'r1', date: '2026-08-01', runType: 'headless', models: ['alpha'], chair: 'c' },
    findings: [], streetCred: [{ model: 'alpha', withSelf: 1, peersOnly: 1 }],
    judged: true,
    runStats: [
      { model: 'alpha', role: 'seat', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 100, usage: null },
      { model: 'alpha', role: 'judge', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 50, usage: null },
    ],
  };
  const rows = buildLedgerRows(rec);
  expect(rows.find(r => r.model === 'alpha').role).toBe('seat');
});

// ---- v4.7 D4/D6/E1/E2 — fail-closed allowlist join (Task-7 amendment) ----
// The skip-set this test file's #83 guard exercised only ever named
// DEBATE_ROLES + 'judge'. v4.7 added three more non-primary runStats
// producers that share a model with that model's real bench (seat) row —
// chair-attempt (run-chair.js), repair (run-stages.js/run-stage2.js/
// run-chair.js) and superseded (run-stages.js + debate.js) — and none of
// them were ever in the skip-set, so each is today's live instance of the
// #83 clobbering bug. These four guards (extending the #83 pattern to the
// remaining two direct producer classes, plus the debate pair which the
// skip-set DID already cover) are the RED the amendment requires for ALL
// FOUR producer classes before ledger.js's skip-set becomes an allowlist.
describe('v4.7 fail-closed ledger join — non-primary rows never overwrite a bench model row', () => {
  test('chair-attempt rows never overwrite a bench model ledger row', () => {
    const rows = buildLedgerRows(singleModelRecord(
      { model: 'alpha', role: 'chair-attempt', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 50, usage: null }));
    expect(rows.find(r => r.model === 'alpha').role).toBe('seat');
  });

  test('repair rows never overwrite a bench model ledger row', () => {
    const rows = buildLedgerRows(singleModelRecord(
      { model: 'alpha', role: 'repair', wasChair: false, conformance: 'unstructured', status: 'timeout', durationMs: 50, usage: null }));
    expect(rows.find(r => r.model === 'alpha').role).toBe('seat');
  });

  // The debate pair was already excluded via DEBATE_ROLES under the OLD
  // skip-set; carried forward as regression pins so the swap to an
  // allowlist mechanism cannot silently drop this existing protection.
  test('rebuttal rows (debate pair) never overwrite a bench model ledger row', () => {
    const rows = buildLedgerRows(singleModelRecord(
      { model: 'alpha', role: 'rebuttal', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 50, usage: null }));
    expect(rows.find(r => r.model === 'alpha').role).toBe('seat');
  });

  test('revote rows (debate pair) never overwrite a bench model ledger row', () => {
    const rows = buildLedgerRows(singleModelRecord(
      { model: 'alpha', role: 'revote', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 50, usage: null }));
    expect(rows.find(r => r.model === 'alpha').role).toBe('seat');
  });

  // Carried in VERBATIM from tests/council/debate.test.js (commit d279384,
  // pre-fix-wave) per Task-6's report ("Review fix wave" §5): the fix wave
  // reverted DEBATE_ROLES and deleted this test because it would fail under
  // the reverted Set by design, forwarding it to Task 7 — this IS Task 7.
  // Same clobbering hazard as the #83 guard above, extended to the two new
  // debate-born roles: a raiser/judge's superseded-original row must never
  // win the ledger join over that model's real bench (seat) row.
  test('superseded/repair rows never overwrite a bench model ledger row either', () => {
    const input = debateBaseInput();
    input.runStats = [
      { model: 'gemini', role: 'seat', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 100, usage: null },
      ...debateRunStatsRows({
        defenseLegs: [{ model: 'gemini', status: 'complete', durationMs: 60, usage: null, conformance: 'repaired', waveId: 'r-d1r' }],
        revoteLegs: [],
        supersededLegs: [{ model: 'gemini', status: 'complete', durationMs: 50, usage: null, conformance: 'unstructured', waveId: 'r-d1' }],
        repairLegs: [],
      }),
    ];
    const rows = buildLedgerRows(tally(input));
    expect(rows).toHaveLength(3);
    const gemini = rows.find(r => r.model === 'gemini');
    expect(gemini.role).toBe('seat');            // NOT 'superseded'
    expect(gemini.conformance).toBe('clean');    // NOT the superseded leg's 'unstructured'
  });

  // Errata E2 (task-7 review IMPORTANT: the original version of this test was
  // vacuous — 'council' and wasChair:false are ledger.js's OWN fallback
  // values (`r.role || 'council'`, `!!r.wasChair`), so it passed identically
  // whether or not the join ever ran. Fixed to assert on deepseek's
  // wasChair:true (av-receiver-input.js: `wasChair: m === 'deepseek'`) — the
  // un-joined default is `!!undefined` === false, so `true` can ONLY survive
  // if the 'council'-role row actually won the join. Mutation-proof: verified
  // by temporarily removing 'council' from LEDGER_JOIN_ROLES (see task-7
  // fix-wave report) — this assertion fails; role's own fallback would not
  // have caught that mutation at all.
  test('council (legacy default role) still joins — errata E2', () => {
    const record = tally(avInput);
    const rows = buildLedgerRows(record);
    const ds = rows.find(r => r.model === 'deepseek');
    expect(ds.role).toBe('council');
    expect(ds.wasChair).toBe(true);
  });

  // Errata E6 (task-7 review CRITICAL): 'redteam' is the second-opinion
  // skill's documented primary-seat role (skills/second-opinion/
  // MANUAL-ORCHESTRATION.md:147; red-team runs record to the ledger per
  // COUNCIL-DESIGN.md:266) and was missing from the allowlist — a redteam
  // row's role/wasChair/conformance never joined, silently fabricating
  // conformance:'clean' via ledger.js's `r.conformance || 'clean'` fallback.
  // Non-vacuous: asserts conformance:'repaired', a value that cannot come
  // from EITHER fallback (`|| 'council'` for role, `|| 'clean'` for
  // conformance) — this only passes if the join actually consumed the
  // redteam row's own data.
  test('redteam rows join the ledger — errata E6', () => {
    const rec = {
      meta: { runId: 'r1', date: '2026-08-01', runType: 'headless', models: ['alpha'], chair: 'c' },
      findings: [], streetCred: [{ model: 'alpha', withSelf: 1, peersOnly: 1 }],
      judged: true,
      runStats: [
        { model: 'alpha', role: 'redteam', wasChair: false, conformance: 'repaired', status: 'complete', durationMs: 80, usage: null },
      ],
    };
    const rows = buildLedgerRows(rec);
    const alpha = rows.find(r => r.model === 'alpha');
    expect(alpha.role).toBe('redteam');
    expect(alpha.conformance).toBe('repaired');
  });

  // Final-review consolidated wave, owner-ruled (item 1): a ROLELESS row
  // (role null/undefined) is the docs/council.md:562-blessed hand-assembled
  // shape — "the legacy default `council` (pre-#83 rows, or hand-assembled
  // tally input that never set a role)" — and must JOIN as legacy, mirroring
  // GOA-7's absent-field⇒legacy pattern elsewhere in this codebase. Distinct
  // from a NAMED custom/unknown role (still rejected — E6 unchanged, pinned
  // right below this test): this is the ABSENCE of a role field, not an
  // unreviewed one. Non-vacuous: asserts wasChair:true and
  // conformance:'repaired', neither of which is reachable via the `rs.get()
  // || {}` non-join fallback (`!!undefined` === false, `undefined ||
  // 'clean'` === 'clean') — this can ONLY pass if the row actually joined.
  test('a roleless row (role undefined) JOINS as legacy — its real conformance/wasChair survive, not the fallback defaults', () => {
    const rec = {
      meta: { runId: 'r1', date: '2026-08-01', runType: 'headless', models: ['alpha'], chair: 'c' },
      findings: [], streetCred: [{ model: 'alpha', withSelf: 1, peersOnly: 1 }],
      judged: true,
      runStats: [
        { model: 'alpha', wasChair: true, conformance: 'repaired', status: 'complete', durationMs: 80, usage: null },
      ],
    };
    const rows = buildLedgerRows(rec);
    const alpha = rows.find(r => r.model === 'alpha');
    expect(alpha.role).toBe('council');        // legacy default label
    expect(alpha.wasChair).toBe(true);          // real value — proves the join happened
    expect(alpha.conformance).toBe('repaired'); // real value — proves the join happened
  });

  // The E6 twin: a NAMED custom/unknown role must still be rejected by the
  // allowlist — only the ABSENCE of a role field joins as legacy, not any
  // string a future producer happens to invent.
  test('a named custom role (e.g. "custom-thing") still does NOT join — E6 unchanged', () => {
    const rec = {
      meta: { runId: 'r1', date: '2026-08-01', runType: 'headless', models: ['alpha'], chair: 'c' },
      findings: [], streetCred: [{ model: 'alpha', withSelf: 1, peersOnly: 1 }],
      judged: true,
      runStats: [
        { model: 'alpha', role: 'custom-thing', wasChair: true, conformance: 'repaired', status: 'complete', durationMs: 80, usage: null },
      ],
    };
    const rows = buildLedgerRows(rec);
    const alpha = rows.find(r => r.model === 'alpha');
    expect(alpha.role).toBe('council');      // fallback default — never joined
    expect(alpha.wasChair).toBe(false);      // the {} fallback, NOT the row's true wasChair
    expect(alpha.conformance).toBe('clean'); // the {} fallback, NOT the row's 'repaired'
  });
});

describe('deriveReliability — resolved-id grouping (v4.7 GOA-7 D10)', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  });

  // Small local helpers: `row` builds one persisted ledger-row object with
  // the file's standard base-row fields (buildLedgerRows' own output shape,
  // ledger.js:75-87 region); `resolvedModel` is present ONLY when the
  // override supplies it — mirrors production's emit-only-when-set contract
  // (D9), and lets these tests exercise both v1 alias-only rows and v2
  // resolved rows. `appendRows` writes each row as one JSONL line into the
  // describe's fresh tmp dir (closure over `dir`, reset per test above).
  function row(overrides = {}) {
    const base = {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      runId: 'r1', date: '2026-08-01', runType: 'headless',
      model: 'alpha', role: 'seat', wasChair: false, judged: true,
      streetCredWithSelf: 1, streetCredPeersOnly: 1,
      findingsRaised: 0, bySeverity: { blocker: 0, major: 0, minor: 0, nit: 0 },
      confirmRate: 1, factErrorRate: 0, conformance: 'clean',
    };
    const merged = { ...base, ...overrides };
    if (!('resolvedModel' in overrides)) { delete merged.resolvedModel; }
    return merged;
  }

  function appendRows(rows) {
    const file = path.join(dir, 'council-ledger.jsonl');
    for (const r of rows) { fs.appendFileSync(file, JSON.stringify(r) + '\n'); }
  }

  test('v2 rows group by resolvedModel; aliases[] collects row aliases most-recent-first', () => {
    // Append, in order: alias 'gpt' → openai/gpt-5.2; alias 'gpt4' → openai/gpt-5.2
    // (two aliases, one executable id, second observed later)
    appendRows([
      row({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),
      row({ model: 'gpt4', resolvedModel: 'openai/gpt-5.2' }),
    ]);
    const agg = deriveReliability({ dir });
    expect(agg).toHaveLength(1);
    expect(agg[0].model).toBe('openai/gpt-5.2');
    // v4.8 PR4b (R4b-1) — a semantic CORRECTION, not a papered-over failure:
    // both rows carry `runId: 'r1'`, so this is ONE council run in which two
    // aliases were served by the same executable. Counting it as two
    // appearances is exactly the over-count PR4b exists to fix; do NOT
    // "restore" it by giving the second row a different runId.
    expect(agg[0].runs).toBe(1);
    expect(agg[0].aliases).toEqual(['gpt4', 'gpt']);   // most recent FIRST
    expect('legacy' in agg[0]).toBe(false);
  });

  test('rows without resolvedModel stay alias-keyed and marked legacy: true (R2)', () => {
    appendRows([row({ model: 'gemini' }), row({ model: 'gemini' })]);
    const agg = deriveReliability({ dir });
    expect(agg).toHaveLength(1);
    expect(agg[0]).toMatchObject({ model: 'gemini', legacy: true, aliases: ['gemini'] });
  });

  test('history splits at the bump: legacy alias group + resolved group coexist for one lineage', () => {
    appendRows([
      row({ model: 'gpt' }),                                    // pre-v2 history
      row({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),   // post-v2
    ]);
    const agg = deriveReliability({ dir });
    const keys = agg.map(a => a.model).sort();
    expect(keys).toEqual(['gpt', 'openai/gpt-5.2']);
    expect(agg.find(a => a.model === 'gpt').legacy).toBe(true);
    expect('legacy' in agg.find(a => a.model === 'openai/gpt-5.2')).toBe(false);
  });

  test('a mixed group merges honestly when a legacy full-id row equals a v2 key — no legacy mark', () => {
    appendRows([
      row({ model: 'openai/gpt-5.2' }),                                   // old row launched by full id
      row({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),
    ]);
    const agg = deriveReliability({ dir });
    expect(agg).toHaveLength(1);
    expect('legacy' in agg[0]).toBe(false);
    expect(agg[0].aliases).toEqual(['gpt', 'openai/gpt-5.2']);
  });

  test('the claude group is legacy-keyed forever (spec §3.4) — leg-less rows never resolve', () => {
    appendRows([row({ model: 'claude', role: 'claude' })]);
    const agg = deriveReliability({ dir });
    expect(agg).toHaveLength(1);
    expect(agg[0]).toMatchObject({ model: 'claude', legacy: true });
  });

  // T4 review: the four tests above don't distinguish last-seen-index
  // ordering from first-seen-index ordering (each alias only ever appears
  // once, or the repeat isn't interleaved with a third alias), and none of
  // them puts a legacy row LAST in a group that also has resolved rows (so a
  // `!rows[rows.length-1].resolvedModel` shortcut would agree with the real
  // `rows.every(...)` check by coincidence). This test kills both: 'gpt' is
  // observed at non-adjacent positions 0 and 2, so only a true last-seen
  // index (not first-seen, and not merely "seen") puts it ahead of 'gpt4'
  // (seen once, at 1); and the final row is a legacy (no-resolvedModel) row
  // whose bare model equals the group's resolved key, ordered LAST, so only
  // rows.every() — not a last-row-only check — correctly declines to mark
  // the group legacy.
  test('aliases[0] is the LAST-observed alias, and a legacy row ordered last cannot fake a legacy group', () => {
    // gpt observed at positions 0 and 2 (non-adjacent), gpt4 at 1 —
    // last-seen indexing puts gpt first; first-seen indexing would put gpt4 first.
    // The final row is a LEGACY row (no resolvedModel) whose model equals the
    // group key — a rows[rows.length-1] legacy shortcut would mark the group
    // legacy; rows.every() must not.
    appendRows([
      row({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),
      row({ model: 'gpt4', resolvedModel: 'openai/gpt-5.2' }),
      row({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),
      row({ model: 'openai/gpt-5.2' }),   // legacy full-id row, ordered LAST, merges into the same group
    ]);
    const agg = deriveReliability({ dir });
    expect(agg).toHaveLength(1);
    expect(agg[0].aliases).toEqual(['openai/gpt-5.2', 'gpt', 'gpt4']);
    expect('legacy' in agg[0]).toBe(false);
  });
});

// ---- v4.8 PR4b — (model, resolvedModel) grouping (spec §4.7/§4.9) ----------
// HEAD's join is model-keyed and last-wins (`new Map(runStats.filter(...).map(
// r => [r.model, r]))`), so a bench where ONE executable serves more than one
// seat — a twin (`--models a,a`), an alias sharing a resolution with another
// alias, a chair that is also a bench seat — silently erased rows, double-
// weighted every average, and over-counted `runs`. PR4b replaces that join
// with an `alias → resolvedKey → row[]` fan-out and emits one row per
// (model, resolvedModel) pair. Every test below was measured RED-or-GREEN
// against unmutated HEAD before the implementation landed (plan §5); the ones
// that came out GREEN each name the mutant that kills them.
describe('v4.8 PR4b — (model, resolvedModel) grouping', () => {
  function mkLedgerDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-pr4b-')); }

  /** One runStats row in the engine's shape (run-assemble.js buildRunStatsEntry). */
  function rsRow(o) {
    return {
      model: o.model,
      role: 'role' in o ? o.role : 'seat',
      wasChair: !!o.wasChair,
      conformance: o.conformance || 'clean',
      ...(o.resolvedModel ? { resolvedModel: o.resolvedModel } : {}),
      status: o.status || 'complete', durationMs: 1, usage: null,
    };
  }

  /** A tally record with exactly the five keys buildLedgerRows reads. */
  function rec({ models, runStats, findings = [], streetCred = [], judged = true,
    runId = 'r1', chair = 'c' }) {
    return {
      meta: { runId, date: '2026-08-01', runType: 'headless', models, chair,
        claudeInCouncil: false },
      findings, streetCred, judged, runStats,
    };
  }

  /** One PERSISTED ledger row, written raw — bypasses buildLedgerRows on purpose. */
  function persistedRow(overrides = {}) {
    return {
      schemaVersion: LEDGER_SCHEMA_VERSION, runId: 'r1', date: '2026-08-01',
      runType: 'headless', model: 'alpha', role: 'seat', wasChair: false, judged: true,
      streetCredWithSelf: 1, streetCredPeersOnly: 1,
      findingsRaised: 0, bySeverity: { blocker: 0, major: 0, minor: 0, nit: 0 },
      confirmRate: 1, factErrorRate: 0, conformance: 'clean',
      ...overrides,   // `runId: undefined` drops the key — JSON.stringify omits it
    };
  }
  function writeRawRows(dir, rows) {
    const file = path.join(dir, 'council-ledger.jsonl');
    for (const r of rows) { fs.appendFileSync(file, JSON.stringify(r) + '\n'); }
  }

  // The §1.4 forcing bench: `--models gpt-5,openai/gpt-5,gpt-5`, everything
  // resolving to the executable id `openai/gpt-5`. HEAD emits THREE rows
  // (creds [1,2,1] → mean 1.333); PR4b emits TWO (creds [2,1] → mean 1.5).
  function forcingBenchRecord() {
    return rec({
      models: ['gpt-5', 'openai/gpt-5', 'gpt-5'],
      streetCred: [{ model: 'gpt-5', withSelf: 1, peersOnly: 1 },
        { model: 'openai/gpt-5', withSelf: 2, peersOnly: 2 }],
      runStats: [
        rsRow({ model: 'gpt-5', resolvedModel: 'openai/gpt-5' }),
        rsRow({ model: 'openai/gpt-5', resolvedModel: 'openai/gpt-5' }),
      ],
    });
  }

  test('T1 — twin bench, SAME resolution: ONE row, not two byte-identical ones', () => {
    const rows = buildLedgerRows(rec({
      models: ['alpha', 'alpha'],
      runStats: [rsRow({ model: 'alpha', resolvedModel: 'vendor/a' }),
        rsRow({ model: 'alpha', resolvedModel: 'vendor/a' })],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: 'alpha', resolvedModel: 'vendor/a' });
  });

  test('T2 — twin bench, DIVERGENT resolutions: two rows, BOTH executables recorded', () => {
    const rows = buildLedgerRows(rec({
      models: ['alpha', 'alpha'],
      runStats: [rsRow({ model: 'alpha', resolvedModel: 'vendor/x' }),
        rsRow({ model: 'alpha', resolvedModel: 'vendor/y' })],
    }));
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.resolvedModel)).toEqual(['vendor/x', 'vendor/y']);
    expect(rows.map(r => r.model)).toEqual(['alpha', 'alpha']);
  });

  test('T3 — mixed live/dead twin (engine order, live first): the LIVE leg keeps its resolvedModel AND conformance', () => {
    const rows = buildLedgerRows(rec({
      models: ['deepseek', 'deepseek'],
      runStats: [
        rsRow({ model: 'deepseek', conformance: 'repaired', resolvedModel: 'vendor/ds' }),
        // pushDeadSeatRows passes NO conformance, so buildRunStatsEntry defaults 'clean'
        rsRow({ model: 'deepseek', status: 'error' }),
      ],
    }));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ resolvedModel: 'vendor/ds', conformance: 'repaired' });
    expect('resolvedModel' in rows[1]).toBe(false);
    expect(rows[1].conformance).toBe('clean');
  });

  test('T3b — leg-less row ordered FIRST: the stats anchor is the block FIRST pair group', () => {
    const rows = buildLedgerRows(rec({
      models: ['deepseek', 'deepseek'],
      findings: [{ id: 'A1', raiser: 'deepseek', severity: 'major', tier: 'Confirmed' },
        { id: 'A2', raiser: 'deepseek', severity: 'minor', tier: 'Confirmed' }],
      streetCred: [{ model: 'deepseek', withSelf: 1, peersOnly: 1 }],
      runStats: [
        rsRow({ model: 'deepseek', status: 'error' }),
        rsRow({ model: 'deepseek', conformance: 'repaired', resolvedModel: 'vendor/ds' }),
      ],
    }));
    expect(rows).toHaveLength(2);
    expect('resolvedModel' in rows[0]).toBe(false);
    expect(rows[0].findingsRaised).toBe(2);        // the FIRST pair group is the anchor
    expect(rows[0].confirmRate).toBe(1);
    expect(rows[1].resolvedModel).toBe('vendor/ds');
    expect(rows[1].findingsRaised).toBe(0);
    expect(rows[1].bySeverity).toEqual({ blocker: 0, major: 0, minor: 0, nit: 0 });
    expect(rows[1].confirmRate).toBeNull();
    expect(rows[1].factErrorRate).toBeNull();
  });

  test('T4 — two LIVE twins sharing one resolution: conformance is WORST-wins, not last-wins', () => {
    const merged = (first, second) => buildLedgerRows(rec({
      models: ['q', 'q'],
      runStats: [rsRow({ model: 'q', conformance: first, resolvedModel: 'vendor/q' }),
        rsRow({ model: 'q', conformance: second, resolvedModel: 'vendor/q' })],
    }));
    const a = merged('clean', 'unstructured');
    expect(a).toHaveLength(1);
    expect(a[0].conformance).toBe('unstructured');
    const b = merged('unstructured', 'clean');   // last-wins would read 'clean'
    expect(b).toHaveLength(1);
    expect(b[0].conformance).toBe('unstructured');
  });

  test('T5a — the emission anchor is lastIndexOf: the forcing bench promotes the ALIAS, not the executable id', () => {
    const dir = mkLedgerDir();
    appendRun(forcingBenchRecord(), { dir });
    const stats = deriveReliability({ dir });
    const agg = stats.find(a => a.model === 'openai/gpt-5');
    expect(agg).toBeTruthy();
    const launched = pickFallbackChair(stats, ['zeta'], 'zeta-chair');
    expect(launched).not.toBeNull();          // assert non-null FIRST (plan §5)
    expect(launched).toBe('gpt-5');
    expect(agg.aliases).toEqual(['gpt-5', 'openai/gpt-5']);
  });

  test('T5b — collapsing duplicate rows moves avg(), PR4a first sort term, to 1.5 and flips the launch', () => {
    const dir = mkLedgerDir();
    appendRun(forcingBenchRecord(), { dir });
    appendRun(rec({
      runId: 'r-competitor', models: ['kimi'],
      streetCred: [{ model: 'kimi', withSelf: 1.4, peersOnly: 1.4 }],
      runStats: [rsRow({ model: 'kimi', resolvedModel: 'moonshot/kimi' })],
    }), { dir });
    const stats = deriveReliability({ dir });
    expect(stats.find(a => a.model === 'openai/gpt-5').avgStreetCredPeersOnly).toBe(1.5);
    expect(pickFallbackChair(stats, ['zeta'], 'zeta-chair')).toBe('kimi');
  });

  test('T6 — unique-alias benches: the row SET and its order are unchanged', () => {
    const golden = buildLedgerRows(tally(avInput));
    expect(golden).toHaveLength(3);
    expect(golden.map(r => r.model)).toEqual(['deepseek', 'gpt', 'mistral']);
    const rows = buildLedgerRows(rec({
      models: ['alpha', 'beta', 'gamma'],
      runStats: [
        rsRow({ model: 'alpha', resolvedModel: 'v/a' }),
        rsRow({ model: 'beta' }),
        rsRow({ model: 'gamma', role: 'critic', conformance: 'repaired', resolvedModel: 'v/g' }),
      ],
    }));
    expect(rows.map(r => r.model)).toEqual(['alpha', 'beta', 'gamma']);
    expect(rows.map(r => r.resolvedModel)).toEqual(['v/a', undefined, 'v/g']);
    expect(rows[1].conformance).toBe('clean');
    expect(rows[2]).toMatchObject({ role: 'critic', conformance: 'repaired' });
  });

  test('T7 — hand-assembled input, EMPTY runStats and a REPEATED alias: one row, not two', () => {
    const rows = buildLedgerRows(rec({ models: ['a', 'a'], runStats: [] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: 'a', role: 'council', wasChair: false, conformance: 'clean' });
    expect('resolvedModel' in rows[0]).toBe(false);
  });

  test('T8 — a bench alias whose ONLY runStats row has a non-joinable role still gets its row', () => {
    const rows = buildLedgerRows(rec({
      models: ['alpha'],
      runStats: [rsRow({ model: 'alpha', role: 'judge', wasChair: true,
        conformance: 'unstructured', resolvedModel: 'v/a' })],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: 'alpha', role: 'council', wasChair: false, conformance: 'clean' });
    expect('resolvedModel' in rows[0]).toBe(false);
  });

  test('T9 — runs counts DISTINCT runIds; only a NON-EMPTY STRING is an identity', () => {
    const d1 = mkLedgerDir();
    appendRun(rec({ runId: 'run-1', models: ['a', 'a'],
      runStats: [rsRow({ model: 'a', resolvedModel: 'v/a' }),
        rsRow({ model: 'a', resolvedModel: 'v/a' })] }), { dir: d1 });
    const g1 = deriveReliability({ dir: d1 });
    expect(g1).toHaveLength(1);
    expect(g1[0].runs).toBe(1);                              // one council run, not two rows

    const d2 = mkLedgerDir();                                // '' is NOT an identity
    writeRawRows(d2, [persistedRow({ runId: '' }), persistedRow({ runId: '' }), persistedRow({ runId: '' })]);
    expect(deriveReliability({ dir: d2 })[0].runs).toBe(3);

    const d3 = mkLedgerDir();                                // numeric 0 is NOT an identity
    writeRawRows(d3, [persistedRow({ runId: 0 }), persistedRow({ runId: 0 })]);
    expect(deriveReliability({ dir: d3 })[0].runs).toBe(2);

    const d4 = mkLedgerDir();                                // absent runId counts individually
    writeRawRows(d4, [persistedRow({ runId: undefined }), persistedRow({ runId: undefined })]);
    expect(deriveReliability({ dir: d4 })[0].runs).toBe(2);

    const d5 = mkLedgerDir();                                // two distinct ids across three rows
    writeRawRows(d5, [persistedRow({ runId: 'x' }), persistedRow({ runId: 'x' }), persistedRow({ runId: 'y' })]);
    expect(deriveReliability({ dir: d5 })[0].runs).toBe(2);

    // A TRUTHY NON-STRING id: `runId: 7` is not an identity either. Without
    // this row a bare `if (r.runId)` passes every case above — '' and 0 are
    // falsy, so they take the unkeyed branch under both spellings.
    const d6 = mkLedgerDir();
    writeRawRows(d6, [persistedRow({ runId: 7 }), persistedRow({ runId: 7 })]);
    expect(deriveReliability({ dir: d6 })[0].runs).toBe(2);
  });

  test('T10 — lowN follows runs, not rows, across 1/2/3 council runs on a twin bench', () => {
    const dir = mkLedgerDir();
    const twinRun = (runId) => rec({ runId, models: ['a', 'a'],
      runStats: [rsRow({ model: 'a', resolvedModel: 'v/a' }),
        rsRow({ model: 'a', resolvedModel: 'v/a' })] });
    appendRun(twinRun('run-1'), { dir });
    expect(deriveReliability({ dir })[0]).toMatchObject({ runs: 1, lowN: true });
    appendRun(twinRun('run-2'), { dir });
    expect(deriveReliability({ dir })[0]).toMatchObject({ runs: 2, lowN: true });
    appendRun(twinRun('run-3'), { dir });
    expect(deriveReliability({ dir })[0]).toMatchObject({ runs: 3, lowN: false });

    // ⚠️ The twin fixture above keeps rows.length === runs at every step, so the
    // pre-PR4b spelling `lowN: rows.length < 3` survives it. Rows must be able
    // to OUTNUMBER runs and flip the boundary: two DISTINCT aliases sharing one
    // executable give run-1 two rows, and a second run adds a third — THREE
    // rows under TWO runIds, where `rows.length < 3` reads lowN false.
    const dir2 = mkLedgerDir();
    appendRun(rec({ runId: 'run-1', models: ['a', 'b'],
      runStats: [rsRow({ model: 'a', resolvedModel: 'v/x' }),
        rsRow({ model: 'b', resolvedModel: 'v/x' })] }), { dir: dir2 });
    expect(deriveReliability({ dir: dir2 })[0]).toMatchObject({ runs: 1, lowN: true });
    appendRun(rec({ runId: 'run-2', models: ['a'],
      runStats: [rsRow({ model: 'a', resolvedModel: 'v/x' })] }), { dir: dir2 });
    const three = deriveReliability({ dir: dir2 });
    expect(three).toHaveLength(1);
    expect(three[0]).toMatchObject({ runs: 2, lowN: true });
  });

  test('T11 — a split alias concentrates FINDINGS on the anchor: the other row reads 0 and null rates', () => {
    const rows = buildLedgerRows(rec({
      models: ['gpt', 'other'],
      findings: [{ id: 'A1', raiser: 'gpt', severity: 'major', tier: 'Confirmed' },
        { id: 'A2', raiser: 'gpt', severity: 'nit', tier: 'Disputed' }],
      streetCred: [{ model: 'gpt', withSelf: 1, peersOnly: 1 },
        { model: 'other', withSelf: 2, peersOnly: 2 }],
      runStats: [
        rsRow({ model: 'gpt', resolvedModel: 'v/x' }),
        rsRow({ model: 'gpt', resolvedModel: 'v/y' }),
        rsRow({ model: 'other', resolvedModel: 'v/o' }),
      ],
    }));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ model: 'gpt', resolvedModel: 'v/x', findingsRaised: 2,
      confirmRate: 0.5, factErrorRate: 0.5 });
    expect(rows[1]).toMatchObject({ model: 'gpt', resolvedModel: 'v/y', findingsRaised: 0 });
    expect(rows[1].bySeverity).toEqual({ blocker: 0, major: 0, minor: 0, nit: 0 });
    expect(rows[1].confirmRate).toBeNull();
    expect(rows[1].factErrorRate).toBeNull();
    expect(rows[1].streetCredPeersOnly).toBe(1);   // street cred does NOT concentrate
  });

  test('T12 — street cred stays alias-keyed on EVERY row, and the launch stays on the short alias', () => {
    // §0's forcing bench: one twin leg live, one dead. Concentrating street
    // cred onto the anchor would strip the leg-less group's numeric cred, drop
    // it out of candidacy, and flip the launch to the raw executable id.
    const record2 = rec({
      models: ['gpt-5', 'gpt-5', 'openai/gpt-5'],
      streetCred: [{ model: 'gpt-5', withSelf: 1, peersOnly: 1 },
        { model: 'openai/gpt-5', withSelf: 2, peersOnly: 2 }],
      runStats: [
        rsRow({ model: 'gpt-5', resolvedModel: 'openai/gpt-5' }),   // live twin leg
        rsRow({ model: 'gpt-5', status: 'error' }),                  // dead twin leg — leg-less
        rsRow({ model: 'openai/gpt-5', resolvedModel: 'openai/gpt-5' }),
      ],
    });
    const rows = buildLedgerRows(record2);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ model: 'gpt-5', resolvedModel: 'openai/gpt-5' });
    expect(rows[1].model).toBe('gpt-5');
    expect('resolvedModel' in rows[1]).toBe(false);
    expect(rows[1].findingsRaised).toBe(0);
    expect(rows[1].streetCredPeersOnly).toBe(1);   // NOT nulled onto the anchor
    const dir = mkLedgerDir();
    appendRun(record2, { dir });
    expect(pickFallbackChair(deriveReliability({ dir }), ['zeta'], 'zeta-chair')).toBe('gpt-5');
  });

  test('T13a — ledger.js LOCAL conformance rank agrees with run-assemble worseConformance, pairwise', () => {
    const values = ['clean', 'repaired', 'unstructured', 'weird'];
    for (const a of values) {
      for (const b of values) {
        // triple so a failure names the pair, not just the merged value
        expect([a, b, mergeConformance(a, b)]).toEqual([a, b, worseConformance(a, b)]);
      }
    }
  });

  test('T13b — the conformance fold is seeded from the group FIRST row, so an unknown value survives', () => {
    const rows = buildLedgerRows(rec({
      models: ['alpha'],
      runStats: [rsRow({ model: 'alpha', conformance: 'weird', resolvedModel: 'v/a' })],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].conformance).toBe('weird');   // a 'clean' seed would rewrite it
  });

  test('T14 — chair ON the bench, one shared resolution: worst-wins conformance, any-wins wasChair', () => {
    // The documented `amicus council tally` shape (docs/council.md:867-875 — the
    // the golden fixture both put the chair on the bench).
    const rows = buildLedgerRows(rec({
      models: ['deepseek', 'gpt', 'mistral'], chair: 'deepseek',
      runStats: [
        rsRow({ model: 'deepseek', role: 'council', conformance: 'unstructured', resolvedModel: 'v/ds' }),
        rsRow({ model: 'gpt', role: 'council', resolvedModel: 'v/gpt' }),
        rsRow({ model: 'mistral', role: 'council', resolvedModel: 'v/mi' }),
        rsRow({ model: 'deepseek', role: 'chair', wasChair: true, conformance: 'clean', resolvedModel: 'v/ds' }),
      ],
    }));
    expect(rows).toHaveLength(3);
    const ds = rows.find(r => r.model === 'deepseek');
    expect(ds.conformance).toBe('unstructured');   // worst-wins, NOT the chair row's 'clean'
    expect(ds.wasChair).toBe(true);                // any-wins
    expect(ds.role).toBe('chair');                 // last row of the pair group
  });

  test('T15 — wasChair is ANY-wins inside a pair group, not last-wins', () => {
    // T14 cannot separate the two rules: its chair row is the pair group's LAST,
    // so last-wins reads `true` there as well. Order the chair row FIRST and the
    // spellings diverge — last-wins reads the trailing seat row's `false`.
    const rows = buildLedgerRows(rec({
      models: ['ds', 'gpt'], chair: 'ds',
      runStats: [
        rsRow({ model: 'ds', role: 'chair', wasChair: true, resolvedModel: 'v/ds' }),
        rsRow({ model: 'ds', role: 'seat', resolvedModel: 'v/ds' }),
        rsRow({ model: 'gpt', role: 'seat', resolvedModel: 'v/gpt' }),
      ],
    }));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ model: 'ds', resolvedModel: 'v/ds', wasChair: true });
    expect(rows[0].role).toBe('seat');              // role IS last-wins, deliberately
    expect(rows[1]).toMatchObject({ model: 'gpt', wasChair: false, role: 'seat' });
  });

  test('T16 — wasChair and role are scoped to the PAIR GROUP, not to the whole alias', () => {
    // Chair on the bench with its chair leg and seat leg resolved DIFFERENTLY:
    // the alias splits, and each row must describe only its own executable.
    // HEAD wrote ONE row for the `ds` ALIAS here (two rows overall, counting
    // `gpt`) — measured: model 'ds', resolvedModel 'v/ds-turbo', wasChair true,
    // the seat leg's resolution erased. PR4b writes two `ds` rows, three overall.
    const rows = buildLedgerRows(rec({
      models: ['ds', 'gpt'], chair: 'ds',
      runStats: [
        rsRow({ model: 'ds', role: 'seat', resolvedModel: 'v/ds' }),
        rsRow({ model: 'gpt', role: 'seat', resolvedModel: 'v/gpt' }),
        rsRow({ model: 'ds', role: 'chair', wasChair: true, resolvedModel: 'v/ds-turbo' }),
      ],
    }));
    expect(rows).toHaveLength(3);
    // Alias-scoped wasChair would stamp `true` on the seat row; alias-scoped
    // role (last of ALL the alias's joinable rows) would stamp 'chair' on it.
    expect(rows[0]).toMatchObject({ model: 'ds', resolvedModel: 'v/ds', wasChair: false, role: 'seat' });
    expect(rows[1]).toMatchObject({ model: 'ds', resolvedModel: 'v/ds-turbo', wasChair: true, role: 'chair' });
    expect(rows[2]).toMatchObject({ model: 'gpt', resolvedModel: 'v/gpt', wasChair: false, role: 'seat' });
  });
});
