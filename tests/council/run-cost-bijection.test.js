// tests/council/run-cost-bijection.test.js
'use strict';

/**
 * @module tests/council/run-cost-bijection
 * v4.7 D5 — "the count is the count": the leg-row bijection invariant this
 * whole PR (CA-4) was built toward. Every council leg that gets `ctx.addWave`'d
 * (and therefore counted into run.json's terminal `usage` block, via
 * run-budget.js's usageBlock() -> sumWaveUsage(allLegs)) must appear on
 * EXACTLY ONE tally.json runStats row — no leg silently dropped from the
 * total, no leg double-counted, no row inventing money nobody spent, and no
 * leg's money credited to the wrong seat.
 *
 * Each scenario below drives a FULL `runCouncil` through fake launchers (the
 * same DI seam the other ~19 driver suites use), stamping an explicit
 * `waveId` on every fake leg — happyScript()'s shared fixtures deliberately
 * omit it (their own tests never needed it), but the bijection this suite
 * checks is meaningless against a leg that never carries the id its row is
 * supposed to be keyed on. `sumWaveUsage` (src/utils/pricing.js) is the SAME
 * aggregator on both sides of the identity: run-budget.js's usageBlock() folds
 * it over every addWave'd leg to produce run.json's `usage`; this suite folds
 * it over the "legged" runStats rows (tally.json) to produce the other side.
 * Any drift between them is a real leg that got lost, doubled, or mis-priced
 * somewhere in the row-per-launch machinery Tasks 1-7 built.
 *
 * ---- Why `runStats.filter(r => r.waveId)` is the right bijection filter ----
 * Every row built FROM a billed leg carries `leg.waveId` (Task 2, emit-only-
 * when-set). The rows that carry NO waveId are exactly the leg-LESS rows —
 * they were never going to appear in run.json's usage total in the first
 * place, so excluding them from `legged` is not a gap in the invariant, it is
 * the invariant's other (correct) half:
 *
 * ⚠️ v4.8 council A1 ADDED AN EXCEPTION to the paragraph above, and it is a
 * TRAP for whoever first adds a twin-alias scenario here. A dead seat on a
 * repeated alias can now carry a borrowed retry leg's `usage` with NO waveId
 * (the leg is real and billed, but belongs to a seat the row cannot claim to
 * be, so every per-seat field is withheld). Such a row is NOT leg-less in the
 * accounting sense, yet `filter(r => r.waveId)` drops it. Measured on the two
 * real row shapes: BEFORE A1 the row was in `legged` (amount 0.07); AFTER it
 * is not (0 rows, amount null), so the cross-foot below would come up short by
 * exactly that leg. Nothing is red today only because this suite deliberately
 * does not model twins (see the `${waveId}::${model}` collision note in the
 * bijection helper). ⚠️ **Adding a twin scenario requires changing the filter
 * to `r => r.waveId || r.usage` FIRST** — measured a no-op on every other row
 * class, because the leg-less and `claude` rows carry `usage: null` — and
 * reworking the (waveId, model) key, which cannot separate two seats of one
 * alias. Do not "fix" the resulting red by putting a waveId back on the row:
 * that is the misattribution A1 removed.
 *
 *   - the synthesized `claude` row (run-assemble.js claudeRunStatsRow) — a
 *     file-sourced review with no leg ever launched for it (v4.1 §4.4);
 *   - the give-up chair's error row (errata E3) — `wasChair:false`, and it
 *     exists ONLY when the walk actually happened (chairAttempts non-empty);
 *     a cost-skipped chair (zero attempts) gets no row at all — no leg, no
 *     money, no row, full stop;
 *   - the two SL-2 retry note-classes that never produced a REAL leg for a
 *     seat at all (errata E5's residual half): `srcLegStillDeadNote` (the
 *     retry wave died wholesale — zero legs) and `missingLegStillDeadNote`
 *     (a partial wave return that never named this seat). Both yield
 *     `leg: null` in run-stages.js's primary-error-row loop, on purpose — no
 *     real leg exists to attribute a waveId to, so inventing one would be a
 *     phantom waveId over a leg that was never billed. E5 was AMENDED
 *     (Task-4 review, owner-ruled) for the THIRD retry note-class only —
 *     `retryLegStillDeadNote`, the one case where the retry itself produced a
 *     REAL (if unusable, e.g. timed-out) leg — that leg now rides the
 *     primary error row for real, waveId and usage included (scenario 6).
 *   - errata E4's dead-wave asymmetry: a WAVE-origin seat (the whole Stage-1
 *     wave died before any legs existed) never had a first leg to begin
 *     with, so healing it produces no `superseded` row — there is nothing to
 *     supersede. Only LEG-origin losses (a wave that ran but this seat's own
 *     leg came back unusable) get a superseded row for their first leg. The
 *     scenarios below are all leg-origin for that reason; the wave-origin
 *     half is unit-pinned in run-stages.test.js and doesn't need a second
 *     full-driver fixture here to be true.
 *
 * ---- The one acknowledged residual D1 hole (out of scope, review-adjudicated) ----
 * `run-retry.js :: retryStage1Losses`'s per-leg `if (!ff) { continue; }` guard
 * silently drops a retry response naming a seat which never lost its seat in the
 * first place — or, since T-A4, a leg past its key's LAST minted slot (transport
 * misbehavior: a bogus or duplicate leg riding a retry wave's response for a seat nobody retried).
 * That leg was still `ctx.addWave`'d by the same function, immediately after
 * the retry launch — `ctx.addWave(res.wave)` in `retryStage1Losses`, before
 * this per-leg loop runs — and would count toward run.json's usage total, but
 * there is no ff/firstFailure to key a row off, so it produces no row at all — a
 * genuine, deliberately-not-fixed rowless leg. ⚠️ Both anchors above were once
 * LINE numbers and both rotted: this docblock said `:226` and `:182` while the
 * lines sat at `:216` and `:106` at v4.8 T-A2's base (measured) and `:184`/`:97`
 * after it — then T-A6 grew the file and `:97` rotted again. Both are SYMBOL
 * anchors now: grep the symbol, never the number. No fixture for it here:
 * reproducing it would require a scripted launcher lying about which seats a
 * retry wave covers, which is a transport-honesty assumption every other
 * fixture in this file (and the other ~19 driver suites) already relies on holding.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { sumWaveUsage } = require('../../src/utils/pricing');
const { review, judgeOut, mkLeg, okWave, scriptedLaunchers, baseOptions,
  defenseOut, revoteOut } = require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-bijection-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};

/**
 * A leg carrying an explicit waveId. `mkLeg`'s 5th param has taken waveId
 * since Task 2 (fake-launchers.js, additive); this suite is the first to
 * lean on it for EVERY leg in EVERY fixture, because the invariant under
 * test is exactly about waveId-keyed rows.
 */
const wLeg = (model, waveId, summary, status = 'complete', cost = 0.01) =>
  mkLeg(model, summary, status, cost, waveId);

/** The clean 3-judge Stage-2 wave + a clean 1-shot chair — shared by the
 *  scenarios that don't themselves exercise Stage-2/chair degradation. */
const cleanStage2 = () => okWave([
  wLeg('gemini', 'abc123-s2', judgeOut(['Review B', 'Review C', 'Review A'],
    [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'neutral' }])),
  wLeg('gpt', 'abc123-s2', judgeOut(['Review A', 'Review C', 'Review B'],
    [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'dispute' }])),
  wLeg('qwen', 'abc123-s2', judgeOut(['Review A', 'Review B', 'Review C'],
    [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }, { id: 'C1', verdict: 'agree' }])),
]);
const cleanChair = () =>
  okWave([wLeg('deepseek', 'abc123-ch1', 'Synthesis of the bench.\n\nVERDICT: Ship it', 'complete', 0.03)]);

/**
 * Wrap scriptedLaunchers(script) so every leg any script function actually
 * hands back is recorded as it's emitted — the GROUND TRUTH for "what model
 * should this leg's row carry" (`leg.modelInput || leg.model`, the alias
 * every fixture in this file passes to `wLeg`), independent of whatever
 * model a row builder (buildRunStatsEntry, debate.js's legRow) actually
 * stamps onto the row it produces. `driveAndAssertBijection` compares this
 * against the row-key multiset to catch a MIS-ATTRIBUTION bug a totals-only
 * check cannot see — for every scenario that uses this helper, not just the
 * ones with their own per-scenario `toMatchObject` pins (review fix wave,
 * Important #2). Instrumenting `launchWave` alone would miss nothing here
 * either — `scriptedLaunchers`'s own `launchSolo` delegates to its own
 * `launchWave` internally — but both are wrapped explicitly so this stays
 * true even if that internal delegation ever changes.
 */
function instrumentedLaunchers(script) {
  const emittedLegs = [];
  const base = scriptedLaunchers(script);
  const record = (wave) => {
    for (const leg of ((wave && wave.legs) || [])) {
      if (leg && leg.waveId) { emittedLegs.push(`${leg.waveId}::${leg.modelInput || leg.model}`); }
    }
  };
  return {
    emittedLegs,
    // Item 5(d), final-review consolidated wave: pass `base.calls` (the same
    // array reference scriptedLaunchers records every launch's opts into)
    // through so a caller of instrumentedLaunchers can inspect `.calls`
    // exactly like a bare scriptedLaunchers(...) result — this suite's own
    // helper was silently dropping that surface.
    calls: base.calls,
    launchWave: async (opts) => { const r = await base.launchWave(opts); record(r.wave); return r; },
    launchSolo: async (opts) => { const r = await base.launchSolo(opts); record(r.wave); return r; },
  };
}

/**
 * Drive a full runCouncil, then assert the D5 invariant against its output.
 * @param {object} opts runCouncil options (must carry the real runDir)
 * @param {object} script a `{waveId: (opts) => {wave, exitCode}}` map (the
 *   scriptedLaunchers(...) shape) — wrapped into instrumented launchers here
 *   so every scenario's emitted legs are recorded automatically.
 * @returns {Promise<{run: object, tallyDoc: object, legged: Array, rows: object}>}
 */
async function driveAndAssertBijection(opts, script) {
  const launchers = instrumentedLaunchers(script);
  const { run } = await runCouncil(opts, {
    launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
  });
  const tallyDoc = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'tally.json'), 'utf-8'));
  const legged = tallyDoc.runStats.filter(r => r.waveId);
  const rows = sumWaveUsage(legged);

  // The cross-foot identity: independently summing the "legged" rows must
  // land on EXACTLY the same total run-budget.js already computed by folding
  // sumWaveUsage over every addWave'd leg (run.json's terminal usage block).
  // All FOUR cost axes are checked, not just `amount` (review fix wave,
  // Important #1) — an estimated leg (the shipped free/local-tier class,
  // pricing.js:110-111's `hasObservedTokens` + catalog-pricing branch) or an
  // unknown-cost leg can each leave `amount` untouched (a near-zero estimate,
  // or a null amount that never gets summed either way) while its row
  // silently vanishes or doubles — `estimatedLegs`/`unpricedLegs` are the
  // axes that actually move for those, and scenario 1 exercises both
  // non-vacuously (every OTHER scenario is 'reported'-only, so those two
  // axes would otherwise stay a vacuous 0≡0 everywhere).
  expect(rows.cost.amount).toBeCloseTo(run.usage.cost.amount, 10);
  expect(rows.cost.reportedLegs).toBe(run.usage.cost.reportedLegs);
  expect(rows.cost.estimatedLegs).toBe(run.usage.cost.estimatedLegs);
  expect(rows.cost.unpricedLegs).toBe(run.usage.cost.unpricedLegs);

  // The bijection, literally: every billed leg's (waveId, model) pair
  // appears on EXACTLY one row. Never zero — the FOUR cost/count axes above
  // would already have failed for a leg silently dropped from `legged` while
  // still counted in run.usage (reportedLegs/estimatedLegs/unpricedLegs
  // between them cover every `cost.source` a leg can carry, so nothing can
  // vanish invisibly regardless of source). Never two — a doubled row would
  // inflate `rows` past `run.usage` even if some OTHER leg were dropped to
  // compensate and net the totals out by coincidence.
  const keys = legged.map(r => `${r.waveId}::${r.model}`);
  // Minor (reviewer): this key assumes one leg per (wave, model) pair — the
  // shape every launch site in this codebase actually produces. A council
  // with duplicate `--models` entries (two seats sharing one alias) would
  // collide here; nothing in the bench path dedups that today, so this
  // suite does not attempt to model it.
  expect(new Set(keys).size).toBe(keys.length);

  // Literal bijection against the ACTUAL legs handed out, not just
  // accounting totals (review fix wave, Important #2): compare the multiset
  // of `${waveId}::${model}` keys every script fn's returned legs actually
  // carried (instrumentedLaunchers, above) against the row-key multiset.
  // This closes the mis-attribution seam the totals-only checks above cannot
  // — a row stamped with the WRONG model (buildRunStatsEntry's `model`
  // override, or debate.js's legRow, disagreeing with the leg it actually
  // priced) leaves every total untouched, since the leg's cost is still
  // counted once, just credited to the wrong seat, while this assertion
  // catches it directly — for every future scenario using this helper, not
  // only the six with their own per-scenario `toMatchObject` pins below.
  const emittedKeys = launchers.emittedLegs.slice().sort();
  expect(keys.slice().sort()).toEqual(emittedKeys);

  return { run, tallyDoc, legged, rows };
}

describe('D5 invariant — the leg-row bijection (v4.7 "the count is the count")', () => {
  test('scenario 1 — clean run: the cross-foot identity holds with no repairs, retries or failures', async () => {
    const script = {
      'abc123-s1': (opts) => okWave(opts.models.map(m => wLeg(m, 'abc123-s1', review(m)))),
      // Cost-source diversity (review fix wave, Important #1/#3): gemini's
      // judge leg is ESTIMATED (tokens observed, catalog-priced — the
      // free/local-tier shape pricing.js's resolveLegCost produces when no
      // reported cost arrives but a catalog price does) and qwen's is
      // UNKNOWN (tokens observed, no catalog price found at all). Every
      // other leg in this suite is 'reported', which left
      // `estimatedLegs`/`unpricedLegs` vacuously 0≡0 everywhere — these two
      // make BOTH axes genuinely non-vacuous, in the one scenario ("clean
      // run") that should hold regardless of cost-source mix.
      'abc123-s2': () => okWave([
        {
          // Item 5(b), final-review consolidated wave: amount:0 is the REAL
          // free/local-tier shape (pricing.js's v4.2 §4.5 carve-out — a local
          // provider with no catalog pricing resolves to `{prompt: 0,
          // completion: 0}`, so an estimated leg with observed tokens but no
          // catalog price is `estimated $0`, never a positive guess). The
          // prior 0.002 stand-in didn't match anything the real resolver
          // produces.
          ...wLeg('gemini', 'abc123-s2', judgeOut(['Review B', 'Review C', 'Review A'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'neutral' }])),
          usage: { tokens: { input: 50, output: 20 }, cost: { amount: 0, source: 'estimated' } },
        },
        wLeg('gpt', 'abc123-s2', judgeOut(['Review A', 'Review C', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'dispute' }])),
        {
          ...wLeg('qwen', 'abc123-s2', judgeOut(['Review A', 'Review B', 'Review C'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }, { id: 'C1', verdict: 'agree' }])),
          usage: { tokens: { input: 100, output: 5 }, cost: { amount: null, source: 'unknown' } },
        },
      ]),
      'abc123-ch1': cleanChair,
    };
    const { run, tallyDoc, legged, rows } = await driveAndAssertBijection(baseOptions(tmp), script);

    expect(run.exitCode).toBe(0);
    // 3 seat rows + 3 judge rows + 1 chair row — the pre-v4.7 #83 shape (run-happy.test.js:69),
    // every one of them now also carrying its waveId. Row COUNT is unaffected
    // by cost source — a leg still gets exactly one row whether its cost
    // resolved reported, estimated, or unknown.
    expect(legged).toHaveLength(7);
    // Item 5(a), final-review consolidated wave: `legged.every(r => r.waveId)`
    // was a tautology — `legged` is ITSELF `tallyDoc.runStats.filter(r =>
    // r.waveId)` (line above), so every element trivially carries a waveId
    // by construction; the assertion could never fail regardless of what
    // buildRunStatsEntry actually did. The real claim for a CLEAN run — every
    // single row on tally.json is legged, none leg-less — is checked against
    // the UNFILTERED source instead.
    expect(tallyDoc.runStats.filter(r => !r.waveId)).toHaveLength(0);
    // Non-vacuous cost-source axes: both sides move off zero together, for
    // the newly-added estimatedLegs axis AND the previously-always-0
    // unpricedLegs axis.
    expect(rows.cost.estimatedLegs).toBe(1);
    expect(run.usage.cost.estimatedLegs).toBe(1);
    expect(rows.cost.unpricedLegs).toBe(1);
    expect(run.usage.cost.unpricedLegs).toBe(1);
    // Item 5(b): the estimated leg's amount is the REAL free/local-tier shape
    // (pricing.js's v4.2 §4.5 carve-out: a local provider with no catalog
    // pricing resolves to `{prompt: 0, completion: 0}`, so an estimated leg
    // is `estimated $0`, never a positive guessed figure) — $0.002 was an
    // unrealistic stand-in. Total: 3×$0.01 seats + $0.01 gpt judge + $0 gemini
    // judge (estimated, free-local) + $0.03 chair = $0.07.
    expect(run.usage.cost.amount).toBeCloseTo(0.07, 4);
    // The tokens half of the identity, exercised through the ROW machinery
    // (reviewer, Minor #3): buildRunStatsEntry copies a leg's `usage`
    // verbatim (never invents or drops fields), so the unknown-cost leg's
    // observed tokens must still be readable off its OWN row, and must still
    // flow into sumWaveUsage's rollup — proof the row, not just the
    // addWave-side total, actually carries them.
    const qwenJudgeRow = legged.find(r => r.model === 'qwen' && r.role === 'judge');
    expect(qwenJudgeRow.usage).toEqual({ tokens: { input: 100, output: 5 }, cost: { amount: null, source: 'unknown' } });
    // Item 5(c): exact, not a floor — every leg's own observed tokens are
    // known in this fixture (gemini judge 50/20, qwen judge 100/5, every
    // other leg carries no `tokens` field and contributes 0), so the rollup
    // total is a precise fact, not merely "at least this much".
    expect(rows.tokens.input).toBe(150);
    expect(rows.tokens.output).toBe(25);
  });

  test('scenario 2 — repair run: a Stage-1 findings-repair leg rides its OWN row, distinct from the seat\'s primary review (E4)', async () => {
    const script = {
      // gpt's first-pass review is malformed prose (no fenced JSON block) — it
      // still MATERIALIZES (status complete, non-empty text), so this is the
      // findings-VALIDATION repair loop, not an SL-2 materialization retry:
      // the seat's primary row keeps this SAME leg (abc123-s1) throughout;
      // only the repair solo (abc123-p1) gets its own extra row.
      'abc123-s1': (opts) => okWave(opts.models.map(m =>
        wLeg(m, 'abc123-s1', m === 'gpt' ? 'prose without any json block at all' : review(m)))),
      'abc123-p1': (opts) => okWave([wLeg('gpt', opts.waveId, review('gpt'))]),
      'abc123-s2': cleanStage2,
      'abc123-ch1': cleanChair,
    };
    const { run, legged } = await driveAndAssertBijection(baseOptions(tmp), script);

    expect(run.exitCode).toBe(0);
    const repairRows = legged.filter(r => r.role === 'repair');
    expect(repairRows).toHaveLength(1);
    expect(repairRows[0]).toMatchObject({ model: 'gpt', waveId: 'abc123-p1' });
    const gptPrimary = legged.find(r => r.model === 'gpt' && r.role === 'seat');
    expect(gptPrimary).toMatchObject({ waveId: 'abc123-s1', conformance: 'repaired' });
    // 3 seat (incl. gpt's ORIGINAL malformed leg) + 1 repair + 3 judge + 1 chair.
    expect(legged).toHaveLength(8);
  });

  test('scenario 3 — chair-walk failure: ch1 fails carrying real usage, ch2 succeeds; ch1\'s spend rides a chair-attempt row', async () => {
    const script = {
      'abc123-s1': (opts) => okWave(opts.models.map(m => wLeg(m, 'abc123-s1', review(m)))),
      'abc123-s2': cleanStage2,
      'abc123-ch1': () => okWave([wLeg('deepseek', 'abc123-ch1', '', 'error', 0.02)], 1, 'error'),
      'abc123-ch2': () =>
        okWave([wLeg('deepseek', 'abc123-ch2', 'Synthesis.\n\nVERDICT: Ship it', 'complete', 0.03)]),
    };
    const { run, legged } = await driveAndAssertBijection(baseOptions(tmp), script);

    expect(run.exitCode).toBe(0);
    const attemptRows = legged.filter(r => r.role === 'chair-attempt');
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0]).toMatchObject({ model: 'deepseek', waveId: 'abc123-ch1', status: 'error' });
    expect(attemptRows[0].usage.cost.amount).toBeCloseTo(0.02);
    expect(legged.find(r => r.wasChair)).toMatchObject({ waveId: 'abc123-ch2' });
    // 3 seat + 3 judge + 1 chair-attempt (ch1) + 1 primary chair (ch2).
    expect(legged).toHaveLength(8);
  });

  test('scenario 4 — debate-repair run: a defense repair replaces a leg; BOTH legs\' money is counted', async () => {
    const e2eOpts = {
      briefing: 'Review X', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
      project: tmp, runId: 'r', runDir: tmp, date: '2026-07-19', debate: true,
    };
    const script = {
      'r-s1': (opts) => okWave(opts.models.map(m => wLeg(m, 'r-s1', review(m)))),
      'r-s2': () => okWave([
        wLeg('gemini', 'r-s2', judgeOut(['Review B', 'Review C', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }])),
        wLeg('gpt', 'r-s2', judgeOut(['Review B', 'Review C', 'Review A'],
          [{ id: 'A1', verdict: 'dispute' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }])),
        wLeg('qwen', 'r-s2', judgeOut(['Review B', 'Review C', 'Review A'],
          [{ id: 'A1', verdict: 'dispute' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }])),
      ]),
      // gemini raised A1 (Disputed by gpt+qwen). Its first defense is bare prose
      // (no parseable {responses:[...]} block) -> ONE repair solo fires at -d1r.
      'r-d1': (opts) => okWave([wLeg('gemini', opts.waveId, 'prose only, no json block at all')]),
      'r-d1r': (opts) => okWave([
        wLeg('gemini', opts.waveId, defenseOut([{ id: 'A1', action: 'defend', argument: 'measured' }])),
      ]),
      'r-rv': () => okWave([
        wLeg('gpt', 'r-rv', revoteOut([{ id: 'A1', verdict: 'agree', reason: 'defense convincing' }])),
        wLeg('qwen', 'r-rv', revoteOut([{ id: 'A1', verdict: 'dispute', reason: 'still unsupported' }])),
      ]),
      'r-ch1': () =>
        okWave([wLeg('deepseek', 'r-ch1', 'Synthesis after debate.\n\nVERDICT: Fix these first', 'complete', 0.03)]),
    };
    const { run, legged } = await driveAndAssertBijection(e2eOpts, script);

    expect(run.exitCode).toBe(0);
    const superseded = legged.find(r => r.role === 'superseded');
    expect(superseded).toMatchObject({ model: 'gemini', waveId: 'r-d1', conformance: 'unstructured' });
    const rebuttal = legged.find(r => r.role === 'rebuttal');
    expect(rebuttal).toMatchObject({ model: 'gemini', waveId: 'r-d1r', conformance: 'repaired' });
    // 3 seat + 3 judge + rebuttal(post-repair) + superseded(pre-repair) + 2 revote + 1 chair.
    expect(legged).toHaveLength(11);
  });

  test('scenario 5 — retry-healed run: the healed seat\'s original dead leg is superseded, the retry leg becomes primary', async () => {
    const script = {
      'abc123-s1': () => okWave([
        wLeg('gemini', 'abc123-s1', review('gemini')),
        wLeg('gpt', 'abc123-s1', review('gpt')),
        { ...wLeg('qwen', 'abc123-s1', '', 'error', 0.01), error: 'boom' },
      ]),
      'abc123-s1r1': (opts) => okWave([wLeg('qwen', opts.waveId, review('qwen'))]),
      'abc123-s2': cleanStage2,
      'abc123-ch1': cleanChair,
    };
    const { run, legged } = await driveAndAssertBijection(baseOptions(tmp), script);

    expect(run.exitCode).toBe(0); // SL-2: a healed seat is NOT a degrade
    const superseded = legged.filter(r => r.role === 'superseded');
    expect(superseded).toHaveLength(1);
    expect(superseded[0]).toMatchObject({ model: 'qwen', waveId: 'abc123-s1' });
    const qwenPrimary = legged.find(r => r.model === 'qwen' && r.role === 'seat');
    expect(qwenPrimary).toMatchObject({ waveId: 'abc123-s1r1' }); // primary carries the RETRY leg
    // 3 seat (gemini, gpt, qwen-retry) + 1 superseded (qwen's original) + 3 judge + 1 chair.
    expect(legged).toHaveLength(8);
  });

  test('scenario 6 — retry-FAILED run: a timed-out retry leg with real usage lands on the primary error row (E5 amendment)', async () => {
    const script = {
      'abc123-s1': () => okWave([
        wLeg('gemini', 'abc123-s1', review('gemini')),
        wLeg('gpt', 'abc123-s1', review('gpt')),
        { ...wLeg('qwen', 'abc123-s1', '', 'error', 0.01), error: 'boom' },
      ]),
      // The retry itself times out — but it IS a real leg (real waveId,
      // status, duration, usage), unlike the wholesale-dead-wave or
      // never-named-this-seat retry classes (see the file docblock's E5
      // paragraph). E5 was amended precisely so this leg's spend lands on a
      // row instead of vanishing behind a phantom `leg: null`.
      'abc123-s1r1': (opts) => okWave([wLeg('qwen', opts.waveId, '', 'timed-out', 0.01)]),
      // Only gemini+gpt survive to Stage 2 — qwen never produced a usable
      // review, so it is neither judged nor a judge.
      'abc123-s2': () => okWave([
        wLeg('gemini', 'abc123-s2', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
        wLeg('gpt', 'abc123-s2', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
      ]),
      'abc123-ch1': cleanChair,
    };
    const { run, legged } = await driveAndAssertBijection(baseOptions(tmp), script);

    expect(run.exitCode).toBe(2); // qwen never recovers a review — the run degrades
    const superseded = legged.find(r => r.role === 'superseded' && r.model === 'qwen');
    expect(superseded).toMatchObject({ waveId: 'abc123-s1' });   // the ORIGINAL leg is what's superseded
    const primaryErr = legged.find(r => r.model === 'qwen' && r.role === 'seat');
    expect(primaryErr).toMatchObject({ waveId: 'abc123-s1r1', status: 'timed-out' }); // FROM THE RETRY leg
    expect(primaryErr.usage.cost.amount).toBeCloseTo(0.01);      // real usage — not nulled out
    // 2 seat (gemini, gpt) + 1 superseded (qwen original) + 1 primary error (qwen retry) + 2 judge + 1 chair.
    expect(legged).toHaveLength(7);
  });
});
