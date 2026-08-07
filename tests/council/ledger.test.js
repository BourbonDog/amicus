// tests/council/ledger.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildLedgerRows, appendRun, deriveReliability, buildStatsDoc, LEDGER_SCHEMA_VERSION } = require('../../src/council/ledger');
const { tally } = require('../../src/council/tally');
const { debateRunStatsRows } = require('../../src/council/debate');
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
  appendRun(record, { dir });
  appendRun(record, { dir });
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
  const record = baseRecord();
  record.runStats = [{ model: 'gpt', role: 'seat', wasChair: false, conformance: 'clean',
    resolvedModel: 'openai/gpt-5.2', status: 'complete', durationMs: 5, usage: null }];
  record.meta.models = ['gpt'];
  const rows = buildLedgerRows(record);
  expect(rows[0].resolvedModel).toBe('openai/gpt-5.2');
});

test('absent resolvedModel on the joined row ⇒ NO resolvedModel key on the ledger row (legacy-by-absence, R2)', () => {
  const record = baseRecord();  // its runStats rows carry no resolvedModel
  const rows = buildLedgerRows(record);
  for (const row of rows) { expect('resolvedModel' in row).toBe(false); }
});

test('a model with NO joining runStats row gets no resolvedModel (the {} join fallback)', () => {
  const record = baseRecord();
  record.runStats = [];  // nothing joins; role/conformance fall back
  const rows = buildLedgerRows(record);
  for (const row of rows) { expect('resolvedModel' in row).toBe(false); }
});

test('aggregates rows written under a FUTURE schemaVersion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  appendRun(record, { dir });
  const gptRow = buildLedgerRows(record).find(r => r.model === 'gpt');
  const future = { ...gptRow, schemaVersion: LEDGER_SCHEMA_VERSION + 1 };
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
    expect(agg[0].runs).toBe(2);
    expect(agg[0].aliases).toEqual(['gpt4', 'gpt']);   // most recent FIRST
    expect('legacy' in agg[0]).toBe(false);
  });

  test('rows without resolvedModel stay alias-keyed and marked legacy: true (R2)', () => {
    appendRows([row({ model: 'gemini' }), row({ model: 'gemini' })]);
    const agg = deriveReliability({ dir });
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
    expect(agg[0]).toMatchObject({ model: 'claude', legacy: true });
  });
});
