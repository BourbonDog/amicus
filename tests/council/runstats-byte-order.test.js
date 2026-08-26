// tests/council/runstats-byte-order.test.js
'use strict';

/**
 * v4.9 W11 (PR1F-2) — BYTE-ORDER goldens for every runStats row builder.
 *
 * ⚠️ Why this file exists at all: every pre-existing pin on these rows is
 * `toEqual`/`toMatchObject`, which is order-INSENSITIVE and undefined-tolerant.
 * `{a:1,b:2}` and `{b:2,a:1}` pass `toEqual`; they are different bytes in
 * run.json, tally-input.json and the spend ledger. PR1F-2's own filing named
 * that gap ("key ORDER differs — mk emits status/durationMs/usage BEFORE its
 * spreads, the entry AFTER"), so these pins compare `JSON.stringify` output
 * with `toBe`: one string, one order, no tolerance.
 *
 * These are PRESERVATION pins — green at HEAD by construction, written BEFORE
 * the folds so the folds' byte diffs are forced into the open rather than
 * discovered later, so they get a NAMED MUTANT rather than a RED-before-GREEN
 * cycle. UNIFYDRIFT = re-introduce one hand-rolled builder verbatim. Red sets
 * MEASURED at the W11 fold (PR #205), at whole-suite scope — `npx jest
 * --no-coverage`, no path filter. The suite SIZE is deliberately not quoted: it
 * is a denominator that moves with every test added (the two numbers this header
 * used to carry, 8632 and 8623, were a total and a passed-only count taken at that
 * tree, and both were stale by W14), and what is load-bearing is the red set, not
 * the size of the green one.
 *   UNIFYDRIFT-mk     (debate.js)            ⇒ 1 red: G1. NOTHING ELSE IN THE
 *       REPO SAW IT — every other test in the suite stayed green, which is
 *       precisely why these goldens had to exist before the fold.
 *   UNIFYDRIFT-legRow (run-debate-revote.js) ⇒ 3 red: G2a, G2b, G2c.
 *   UNIFYDRIFT-claude (run-assemble.js)      ⇒ 0 red — an EQUIVALENT mutant.
 *       That fold is byte-identical by construction, so restoring the literal
 *       cannot be detected and G3 is a preservation pin, not a discriminating
 *       one. Its discriminating mutant is CLAUDENULLLEG (swap the stand-in leg
 *       `{status:'complete'}` for `null`, which calls a valid review dead):
 *       ⇒ 2 red, G3 + run-claude-review.test.js.
 * ⚠️ G6 is an EQUIVALENCE pin (old shape vs new shape through `mk`), so it is
 * green under UNIFYDRIFT-legRow BY DESIGN — the mutant restores the very shape
 * G6 asserts is equivalent. G2a-c are legRow's drift pins; G6 is not.
 *
 * THE STATUS CENSUS behind dropping `mk`'s `|| 'unknown'` (debate.js points
 * here for it), MEASURED at the same W11 tree as the mutants above.
 * Instrumented `mk` over the whole suite: 137 invocations,
 * statuses "complete" x130 / "error" x5 / "timeout" x2 — ZERO falsy, so the
 * default never fired. It structurally cannot: a leg document's `status` is set
 * by result-schema.js :: buildRunResult, which already applies its own
 * `metadata.status || 'unknown'` a layer BELOW, and the two synthetic producers
 * (run-debate.js's `stub`, legRow's leg-absent arm) hard-code 'error'. A third
 * copy of the same default also sits a layer ABOVE, in tally.js's runStats
 * re-projection (`r.status || 'unknown'`) and in workspace/run-detail.js ::
 * costPanel — so the display path keeps its fallback either way. The honest
 * value was therefore neither 'unknown' nor 'error': it was NO default here.
 * Pin: G1c.
 */

const { debateRunStatsRows } = require('../../src/council/debate');
const { legRow } = require('../../src/council/run-debate-revote');
const { claudeRunStatsRow, buildRunStatsEntry } = require('../../src/council/run-assemble');
const { tally } = require('../../src/council/tally');
const { buildLedgerRows } = require('../../src/council/ledger');

/**
 * The four normalized lists debateRunStatsRows maps `mk` over, shaped from the
 * MEASURED corpus census (v4.9 W11, whole suite, 137 mk invocations):
 * `model` is always an alias STRING (137/137 — never null, never undefined),
 * `status` always a non-empty string (complete x130, error x5, timeout x2 —
 * ZERO falsy), `conformance` always clean|unstructured|repaired,
 * `resolvedModel` set on 118/137, `waveId` set on 118 / key-absent on 12 /
 * explicitly-undefined on 7, `durationMs` number on 67 / undefined on 60 /
 * null on 10. A `seat` object rides 59 of them and `mk` must keep ignoring it.
 */
function censusLists() {
  return {
    defenseLegs: [
      { model: 'gemini', status: 'complete', durationMs: 50, usage: { input: 10, output: 20 },
        conformance: 'repaired', summary: 'defended', waveId: 'r1-d1r', resolvedModel: 'google/gemini-3.5-pro' },
      // the no-waveId / no-resolvedModel row: proves both stay ABSENT, not null
      { model: 'gpt', status: 'error', durationMs: null, usage: null, conformance: 'unstructured', summary: '' },
    ],
    revoteLegs: [
      { model: 'deepseek', status: 'complete', durationMs: 60, usage: null, conformance: 'clean',
        summary: 'voted', waveId: 'r1-rv', seat: { id: 'deepseek#1', alias: 'deepseek' },
        resolvedModel: 'deepseek/deepseek-chat' },
    ],
    supersededLegs: [
      { model: 'gemini', status: 'complete', durationMs: 40, usage: null, conformance: 'unstructured',
        summary: 'pre-repair', waveId: 'r1-d1', resolvedModel: 'google/gemini-3.5-pro' },
    ],
    repairLegs: [
      { model: 'qwen', status: 'timeout', durationMs: 5000, usage: null, conformance: 'unstructured',
        summary: '', waveId: 'r1-rv-qwenr' },
    ],
  };
}

describe('W11 byte-order goldens — debateRunStatsRows (mk)', () => {
  // ⚠️ W11 FOLD DIFF #1 (deliberate, and the only REACHABLE one this fold produces —
  // G1d below records a second that is measured-dead).
  // KEY SET: unchanged on all five rows. VALUES: unchanged on all five rows.
  // No own key with an undefined value is added.
  // KEY ORDER: `waveId` and `resolvedModel` move from AFTER `usage` to BEFORE
  // `status` — the hand-rolled `mk` emitted status/durationMs/usage ahead of its
  // two spreads, buildRunStatsEntry emits its spreads first. What the fold buys is
  // ORDER, not propagation: debate rows now sit in the SAME key order as every
  // primary/superseded/dead-seat row, so an entry field that DOES reach a debate row
  // holds the position it holds everywhere else.
  // ⚠️ It does NOT make new fields reach them, and the claim that once stood here —
  // that a future entry field would land on these rows automatically — was false.
  // `mk` copies an explicit five-field leg (status/durationMs/usage/waveId/model),
  // so every other entry param and every future leg-sourced field needs `mk` itself
  // widened. G1e is the measured proof, using the field that already shipped.
  // Rows carrying NEITHER field (row 2 below) are byte-identical.
  test('G1 — a full debate round\'s rows, byte-exact and order-exact', () => {
    expect(JSON.stringify(debateRunStatsRows(censusLists()))).toBe(
      '[{"model":"gemini","role":"rebuttal","wasChair":false,"conformance":"repaired",'
      + '"waveId":"r1-d1r","resolvedModel":"google/gemini-3.5-pro",'
      + '"status":"complete","durationMs":50,"usage":{"input":10,"output":20}},'
      // neither waveId nor resolvedModel ⇒ BYTE-IDENTICAL to the pre-fold row
      + '{"model":"gpt","role":"rebuttal","wasChair":false,"conformance":"unstructured",'
      + '"status":"error","durationMs":null,"usage":null},'
      + '{"model":"deepseek","role":"revote","wasChair":false,"conformance":"clean",'
      + '"waveId":"r1-rv","resolvedModel":"deepseek/deepseek-chat",'
      + '"status":"complete","durationMs":60,"usage":null},'
      + '{"model":"gemini","role":"superseded","wasChair":false,"conformance":"unstructured",'
      + '"waveId":"r1-d1","resolvedModel":"google/gemini-3.5-pro",'
      + '"status":"complete","durationMs":40,"usage":null},'
      + '{"model":"qwen","role":"repair","wasChair":false,"conformance":"unstructured",'
      + '"waveId":"r1-rv-qwenr","status":"timeout","durationMs":5000,"usage":null}]');
  });

  // The census's own finding, pinned: the `|| 'unknown'` status default `mk`
  // carried was DEAD (0 of 137 measured invocations), and the entry's leg-absent
  // 'error' default is equally unreachable here because `l` is an object literal
  // at all four call sites. A leg's status therefore rides VERBATIM either way.
  test('G1c — every reachable status rides verbatim; no default is interposed', () => {
    const rows = debateRunStatsRows({
      defenseLegs: [{ model: 'a', status: 'complete', durationMs: 1, usage: null, conformance: 'clean' }],
      revoteLegs: [{ model: 'b', status: 'error', durationMs: null, usage: null, conformance: 'clean' }],
      supersededLegs: [{ model: 'c', status: 'timeout', durationMs: 2, usage: null, conformance: 'clean' }],
      repairLegs: [{ model: 'd', status: 'aborted', durationMs: 3, usage: null, conformance: 'clean' }],
    });
    expect(rows.map(r => r.status)).toEqual(['complete', 'error', 'timeout', 'aborted']);
  });

  test('G1b — `summary` and `seat` on the normalized leg NEVER reach a runStats row', () => {
    const rows = debateRunStatsRows(censusLists());
    expect(rows.some(r => 'summary' in r)).toBe(false);
    expect(rows.some(r => 'seat' in r)).toBe(false);
  });

  // The fold's SECOND divergence from the hand-rolled body, disclosed at the fold in
  // debate.js. It is MEASURED-DEAD, not impossible: `mk` re-keys `l.resolvedModel` into
  // the synthetic leg's `model`, and the entry falls back to `leg.model` when its own
  // `model` param is undefined — so a normalized row with NO `model` but a set
  // `resolvedModel` now emits the RESOLVED id in the alias slot, where the hand-rolled
  // body emitted `model: undefined` (own key present, omitted by JSON.stringify).
  // Dead because the W11 census found `l.model` a non-empty alias STRING on 137/137
  // invocations — zero null, zero undefined — so no producer emits this shape. Pinned
  // so the day one does, the change is a failing test rather than a silent relabel.
  test('G1d — a `model`-less row with a resolvedModel emits the RESOLVED id as `model`', () => {
    const rows = debateRunStatsRows({
      defenseLegs: [{ status: 'complete', durationMs: 1, usage: null, conformance: 'clean',
        resolvedModel: 'x/y' }],
      revoteLegs: [], supersededLegs: [], repairLegs: [] });
    expect(rows[0].model).toBe('x/y');
    // the pre-fold bytes, frozen: `model` absent from the JSON entirely
    expect(JSON.stringify(rows[0])).not.toBe(
      '{"role":"rebuttal","wasChair":false,"conformance":"clean",'
      + '"status":"complete","durationMs":1,"usage":null,"resolvedModel":"x/y"}');
  });

  // The corrected claim, MEASURED rather than argued from `mk`'s source: folding onto
  // the shared entry did NOT make entry fields reach debate rows. `ttftMs` is the case
  // that already shipped — W13 sources it off the LEG inside buildRunStatsEntry, which
  // is exactly the "no caller change and none can be forgotten" shape that was supposed
  // to cover every call site. It does not cover this one, because `mk` builds its own
  // five-field leg. If `mk` is ever widened, THIS is the pin that must be re-decided.
  test('G1e — a leg-sourced entry field (`ttftMs`) does NOT reach a debate row', () => {
    const leg = { model: 'gemini', status: 'complete', durationMs: 50, usage: null,
      conformance: 'clean', waveId: 'r1-d1', resolvedModel: 'google/gemini-3.5-pro', ttftMs: 1234 };
    const [row] = debateRunStatsRows({ defenseLegs: [leg], revoteLegs: [], supersededLegs: [],
      repairLegs: [] });
    expect('ttftMs' in row).toBe(false);
    // the discriminator: the SAME leg through the shared entry does carry it, so the
    // absence above is `mk`'s field list, not a property of the entry or of the leg.
    const direct = buildRunStatsEntry({
      leg: { model: 'google/gemini-3.5-pro', status: 'complete', durationMs: 50, usage: null,
        waveId: 'r1-d1', ttftMs: 1234 },
      model: 'gemini', role: 'rebuttal', conformance: 'clean' });
    expect(direct.ttftMs).toBe(1234);
  });
});

describe('W11 byte-order goldens — legRow (run-debate-revote)', () => {
  const legPresent = { model: 'openrouter/z-ai/glm-4.7', status: 'complete', durationMs: 900,
    usage: { input: 1, output: 2 }, summary: 'the pre-repair defense', waveId: 'r1-d1' };
  const legNoSummary = { model: 'x/y', status: 'timeout', durationMs: null, usage: null,
    waveId: 'r1-rv-gptr' };

  // ⚠️ W11 FOLD DIFF #2 (deliberate). `legRow` is an INTERMEDIATE normalizer, not a
  // finished runStats row: its only consumer is `debate.js :: debateRunStatsRows`,
  // whose `mk` copies an explicit field list off it. Folding it onto the shared
  // entry changes its own bytes in exactly three ways, on every case
  // (plus a FOURTH, unreachable today, found by the wave review's independent
  // recomputation: a FALSY conformance would now normalize to 'clean' where the
  // old body dropped the key — all four call sites pass literal 'unstructured',
  // per the census, so no reachable row changes):
  //   (1) ADDED  `wasChair: false` — the entry always emits it; `mk` never read it.
  //   (2) DROPPED `summary` when it was the EMPTY string (G2b, G2c) — the entry's
  //       `summary` is emit-when-set, where the hand-rolled body wrote `|| ''`.
  //       A real summary survives (G2a). `mk` never read this field either.
  //   (3) KEY ORDER: status/durationMs/usage move from positions 2-4 to the END;
  //       conformance/summary/waveId/resolvedModel shift up.
  // VALUES on every shared key: unchanged. One own key with an `undefined` value is
  // added (`role`) — JSON.stringify omits it, `Object.keys` sees it.
  // G6 below is the pin that all three are invisible to the runStats rows.
  test('G2a — leg PRESENT, byte-exact (a real `summary` survives the fold)', () => {
    expect(JSON.stringify(legRow('glm', legPresent, 'unstructured'))).toBe(
      '{"model":"glm","wasChair":false,"conformance":"unstructured",'
      + '"summary":"the pre-repair defense","waveId":"r1-d1",'
      + '"resolvedModel":"openrouter/z-ai/glm-4.7","status":"complete","durationMs":900,'
      + '"usage":{"input":1,"output":2}}');
  });

  test('G2b — leg present with NO summary, byte-exact (no empty-string `summary`)', () => {
    expect(JSON.stringify(legRow('gpt', legNoSummary, 'unstructured'))).toBe(
      '{"model":"gpt","wasChair":false,"conformance":"unstructured",'
      + '"waveId":"r1-rv-gptr","resolvedModel":"x/y","status":"timeout",'
      + '"durationMs":null,"usage":null}');
  });

  test('G2c — leg ABSENT, byte-exact (status still `error`, never invented)', () => {
    expect(JSON.stringify(legRow('gpt', null, 'unstructured'))).toBe(
      '{"model":"gpt","wasChair":false,"conformance":"unstructured",'
      + '"status":"error","durationMs":null,"usage":null}');
  });

  test('G2d — `role` is left for `mk` to stamp, never guessed here', () => {
    expect(legRow('gpt', legPresent, 'unstructured').role).toBeUndefined();
  });

  // The END-TO-END pin, and the whole justification for FOLD DIFF #2: the literals
  // below are legRow's PRE-FOLD bytes, frozen. Feeding them and the post-fold call
  // through debateRunStatsRows must produce the SAME runStats rows — that is
  // MEASURED here, not asserted from `mk`'s field list.
  describe('G6 — fold diff #2 is invisible to the runStats rows it feeds', () => {
    const through = (row, key) => JSON.stringify(debateRunStatsRows({
      defenseLegs: [], revoteLegs: [], supersededLegs: key === 'sup' ? [row] : [],
      repairLegs: key === 'rep' ? [row] : [] }));
    const PRE_FOLD = {
      present: { model: 'glm', status: 'complete', durationMs: 900, usage: { input: 1, output: 2 },
        conformance: 'unstructured', summary: 'the pre-repair defense', waveId: 'r1-d1',
        resolvedModel: 'openrouter/z-ai/glm-4.7' },
      noSummary: { model: 'gpt', status: 'timeout', durationMs: null, usage: null,
        conformance: 'unstructured', summary: '', waveId: 'r1-rv-gptr', resolvedModel: 'x/y' },
      absent: { model: 'gpt', status: 'error', durationMs: null, usage: null,
        conformance: 'unstructured', summary: '' },
    };
    test('superseded row from a present leg', () => {
      expect(through(legRow('glm', legPresent, 'unstructured'), 'sup'))
        .toBe(through(PRE_FOLD.present, 'sup'));
    });
    test('repair row from a leg with no summary', () => {
      expect(through(legRow('gpt', legNoSummary, 'unstructured'), 'rep'))
        .toBe(through(PRE_FOLD.noSummary, 'rep'));
    });
    test('repair row from an ABSENT leg', () => {
      expect(through(legRow('gpt', null, 'unstructured'), 'rep'))
        .toBe(through(PRE_FOLD.absent, 'rep'));
    });
  });
});

describe('W11 byte-order goldens — claudeRunStatsRow (run-assemble)', () => {
  test('G3 — the synthesized null-usage claude row, byte-exact', () => {
    expect(JSON.stringify(claudeRunStatsRow())).toBe(
      '{"model":"claude","role":"claude","wasChair":false,"conformance":"clean",'
      + '"status":"complete","durationMs":null,"usage":null}');
  });
});

describe('W11 byte-order goldens — buildRunStatsEntry (absence pins)', () => {
  test('G4a — a leg-absent entry emits SEVEN keys and nothing else', () => {
    expect(JSON.stringify(buildRunStatsEntry({ leg: null, model: 'gemini', role: 'seat' }))).toBe(
      '{"model":"gemini","role":"seat","wasChair":false,"conformance":"clean",'
      + '"status":"error","durationMs":null,"usage":null}');
  });

  test('G4b — every optional field at once, byte-exact and order-exact', () => {
    expect(JSON.stringify(buildRunStatsEntry({
      leg: { model: 'google/gemini-3.5-pro', status: 'complete', durationMs: 12,
        usage: { input: 3 }, waveId: 'r1-s1', summary: 'ignored' },
      model: 'gemini', role: 'seat', wasChair: true, conformance: 'repaired',
      findingsUnverified: true, repairRefused: { code: 'X', detail: 'd' },
      seat: { id: 'gemini#2', alias: 'gemini' },
    }))).toBe(
      '{"model":"gemini","role":"seat","wasChair":true,"conformance":"repaired",'
      + '"findingsUnverified":true,"repairRefused":{"code":"X","detail":"d"},'
      + '"waveId":"r1-s1","resolvedModel":"google/gemini-3.5-pro","seat":"gemini#2",'
      + '"status":"complete","durationMs":12,"usage":{"input":3}}');
  });

  test('G4c — a leg\'s own `summary` is NEVER copied onto the row by the leg alone', () => {
    const row = buildRunStatsEntry({
      leg: { model: 'x/y', status: 'complete', durationMs: 1, usage: null, summary: 'prose' },
      model: 'x', role: 'seat' });
    expect('summary' in row).toBe(false);
  });

  // ---- W11 Task A: the ONE entry extension the folds need ----
  // `summary` is what `run-debate-revote.js :: legRow` emits and the entry did
  // not. It is EXPLICIT-ONLY (never sourced from `leg.summary` — G4c above is
  // the pin for that) and EMIT-WHEN-SET, so every caller that does not pass it
  // is byte-for-byte unchanged (G4a/G4b are those absence pins).
  test('G5a — an explicit `summary` rides the row, positioned with the other emit-when-set fields', () => {
    expect(JSON.stringify(buildRunStatsEntry({
      leg: { model: 'x/y', status: 'complete', durationMs: 1, usage: null, waveId: 'r1-d1' },
      model: 'x', role: 'superseded', conformance: 'unstructured', summary: 'the pre-repair defense',
    }))).toBe(
      '{"model":"x","role":"superseded","wasChair":false,"conformance":"unstructured",'
      + '"summary":"the pre-repair defense","waveId":"r1-d1","resolvedModel":"x/y",'
      + '"status":"complete","durationMs":1,"usage":null}');
  });

  test('G5b — an EMPTY summary is absent, not an empty string (emit-when-set)', () => {
    const row = buildRunStatsEntry({ leg: null, model: 'x', role: 'repair', summary: '' });
    expect('summary' in row).toBe(false);
  });

  // The containment property that makes the `summary` extension safe to add to a
  // SHARED row builder: even when a caller passes review prose, tally.js's
  // re-projection allowlist does not name `summary`, so it never reaches
  // tally.json, verdict.json (which copies that array verbatim) or the ledger.
  test('G5c — an explicit summary does NOT survive tally\'s re-projection', () => {
    const row = buildRunStatsEntry({
      leg: { model: 'x/y', status: 'complete', durationMs: 1, usage: null },
      model: 'x', role: 'seat', summary: 'SECRET REVIEW PROSE' });
    expect(row.summary).toBe('SECRET REVIEW PROSE');
    const rec = tally({ meta: { runId: 'r', date: 'd', runType: 'headless', models: ['x'],
      chair: 'g', claudeInCouncil: false },
    findings: [], adjudications: [], rankings: [], runStats: [row] });
    expect('summary' in rec.runStats[0]).toBe(false);
    expect(JSON.stringify(buildLedgerRows(rec))).not.toContain('SECRET REVIEW PROSE');
  });
});

/**
 * G7 — how far FOLD DIFF #1 actually travels. MEASURED, not argued from the
 * consumers' source: `tally.js :: tally` re-projects every runStats row through a
 * fixed allowlist whose key order is ALREADY buildRunStatsEntry's order, and
 * verdict.js :: buildVerdict copies that array verbatim. So the debate rows'
 * order change reaches ONE artifact — tally-input.json — and it moves that file
 * INTO agreement with tally.json and verdict.json, which never saw `mk`'s order.
 *
 * ⚠️ THE FILING'S BLAST RADIUS WAS WRONG, in the direction that overstates it.
 * PR1F-2's recon (BACKLOG, 2026-08-07) says unification "changes `run.json` bytes
 * for every debate row carrying a `waveId`". `run.json` carries NO runStats at all
 * — run-state.js's RUN_FILE never holds the array — and the only site in src/ or
 * electron/ that serializes a raw tallyInput is run-assemble.js :: writeTallyFiles.
 * Measured reach: tally-input.json alone. The ledger is untouched for a second,
 * independent reason (G7c).
 */
describe('W11 — the reach of fold diff #1 (consumer checks)', () => {
  const META = { runId: 'r', date: 'd', runType: 'headless', models: ['gemini'], chair: 'gpt',
    claudeInCouncil: false };
  const legs = { defenseLegs: [{ model: 'gemini', status: 'complete', durationMs: 50, usage: null,
    conformance: 'clean', waveId: 'r1-d1', resolvedModel: 'google/gemini-3.5-pro' }],
  revoteLegs: [], supersededLegs: [], repairLegs: [] };
  // `mk`'s PRE-FOLD bytes for that same leg, frozen.
  const PRE_FOLD_ROW = { model: 'gemini', role: 'rebuttal', wasChair: false, conformance: 'clean',
    status: 'complete', durationMs: 50, usage: null, waveId: 'r1-d1',
    resolvedModel: 'google/gemini-3.5-pro' };
  const record = (rows) => tally({ ...{ meta: META, findings: [], adjudications: [], rankings: [] },
    runStats: rows });

  test('G7a — tally.json (⇒ verdict.json) is BYTE-IDENTICAL pre- vs post-fold', () => {
    expect(JSON.stringify(record(debateRunStatsRows(legs)).runStats))
      .toBe(JSON.stringify(record([PRE_FOLD_ROW]).runStats));
  });

  test('G7b — tally-input rows now sit in the SAME key order tally.json already used', () => {
    const inputRow = debateRunStatsRows(legs)[0];
    expect(Object.keys(inputRow)).toEqual(Object.keys(record([inputRow]).runStats[0]));
  });

  test('G7c — every debate role still stays OUT of the ledger join', () => {
    const rows = debateRunStatsRows({
      defenseLegs: [{ model: 'gemini', status: 'complete', durationMs: 1, usage: null, conformance: 'unstructured' }],
      revoteLegs: [{ model: 'gemini', status: 'complete', durationMs: 2, usage: null, conformance: 'repaired' }],
      supersededLegs: [{ model: 'gemini', status: 'error', durationMs: null, usage: null, conformance: 'unstructured' }],
      repairLegs: [{ model: 'gemini', status: 'error', durationMs: null, usage: null, conformance: 'unstructured' }],
    });
    const seat = { model: 'gemini', role: 'seat', wasChair: false, conformance: 'clean',
      status: 'complete', durationMs: 100, usage: null };
    const ledger = buildLedgerRows(record([seat, ...rows]));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].role).toBe('seat');            // NOT rebuttal/revote/superseded/repair
    expect(ledger[0].conformance).toBe('clean');    // NOT the debate legs' worse values
  });

  // ⚠️ `ledger.js :: joinsLedger` treats an UNDEFINED role as JOINING. The folded
  // legRow leaves `role` undefined for `mk` to stamp, so this pins the one thing
  // that keeps that safe: nothing debateRunStatsRows emits carries an absent role.
  test('G7d — no row debateRunStatsRows emits leaves `role` undefined', () => {
    const rows = debateRunStatsRows({
      defenseLegs: [{ model: 'a', status: 'complete', durationMs: 1, usage: null, conformance: 'clean' }],
      revoteLegs: [{ model: 'b', status: 'complete', durationMs: 1, usage: null, conformance: 'clean' }],
      supersededLegs: [legRow('c', null, 'unstructured')],
      repairLegs: [legRow('d', null, 'unstructured')],
    });
    expect(rows.map(r => r.role)).toEqual(['rebuttal', 'revote', 'superseded', 'repair']);
  });
});
