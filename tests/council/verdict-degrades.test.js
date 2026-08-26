// tests/council/verdict-degrades.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildVerdict, readPriorVerdictSurfaces } = require('../../src/council/verdict');
const { writeVerdictFiles } = require('../../src/council/run-assemble');
const { makeDegrade } = require('../../src/utils/degrade');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-degrades-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const record = () => ({
  meta: { runId: 'r1', runType: 'council', date: '2026-08-01', chair: 'deepseek',
    models: ['alpha', 'beta'], claudeInCouncil: false },
  findings: [], streetCred: [], runStats: [], tierCounts: {},
});

const deadLeg = () => makeDegrade({
  channel: 'dead-leg',
  what: 'seat beta did not review',
  why: "the leg ended 'timeout' with no usable output",
  effect: '1 of 2 seats reviewed; the run continues with the bench that did and will exit degraded (2)',
  data: { seat: 'beta', status: 'timeout', reason: null },
});

describe('verdict.degrades[]', () => {
  test('buildVerdict carries degrades verbatim when non-empty', () => {
    const v = buildVerdict(record(), [], { degrades: [deadLeg()] });
    expect(v.degrades).toHaveLength(1);
    expect(v.degrades[0].channel).toBe('dead-leg');
    expect(v.degrades[0].data.seat).toBe('beta');
    expect(v.schemaVersion).toBe(2);           // additive — version does not move
  });

  test('degrades is ABSENT when empty — absence never has to be interpreted', () => {
    expect(buildVerdict(record(), [], { degrades: [] }).degrades).toBeUndefined();
    expect(buildVerdict(record(), [], {}).degrades).toBeUndefined();
  });

  test('writeVerdictFiles lands degrades on verdict.json', () => {
    const runDir = fs.mkdtempSync(path.join(tmp, 'run-'));
    writeVerdictFiles({ runDir, record: record(), overallVerdict: null, chairText: null,
      critic: null, deadWaves: [], degrades: [deadLeg()] });
    const onDisk = JSON.parse(fs.readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'));
    expect(onDisk.degrades).toHaveLength(1);
    expect(onDisk.degrades[0].what).toBe('seat beta did not review');
  });
});

const { deriveSeatLoss, summarizeSeatLoss } = require('../../src/council/verdict');

const mk = (channel, data, extra = {}) => makeDegrade({
  channel, what: 'w', why: 'y', effect: 'e', data, ...extra,
});

describe('deriveSeatLoss (spec D3 — closes #84)', () => {
  test('wave-only records reproduce summarizeSeatLoss byte-for-byte', () => {
    const degrades = [mk('dead-wave', { waveId: 'r1-c1', models: ['critic-m'], reason: 'server timeout' })];
    const derived = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    const legacy = summarizeSeatLoss({ runId: 'r1', critic: 'critic-m',
      deadWaves: [{ waveId: 'r1-c1', models: ['critic-m'], reason: 'server timeout' }] });
    expect(derived).toEqual(legacy);
  });

  test('#84 pin: a dead CRITIC LEG flips criticSeated — deadWaves never could', () => {
    const degrades = [mk('dead-leg', { seat: 'critic-m', status: 'timeout', reason: 'no first token' })];
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    expect(s.criticSeated).toBe(false);
    expect(s.reason).toBe('no first token');
    // The exact #84 failure: summarizeSeatLoss reads only deadWaves, so the same
    // loss reported as a leg leaves the verdict claiming the critic seated.
    expect(summarizeSeatLoss({ runId: 'r1', critic: 'critic-m', deadWaves: [] }).criticSeated).toBe(true);
  });

  test('#84 pin: a dead BENCH LEG reaches deadBenchSeats', () => {
    const degrades = [mk('dead-leg', { seat: 'beta', status: 'timeout', reason: null })];
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    expect(s.criticSeated).toBe(true);
    expect(s.deadBenchSeats).toEqual(['beta']);
  });

  test('a dead critic leg with no reason falls back to naming the status', () => {
    const degrades = [mk('dead-leg', { seat: 'critic-m', status: 'error', reason: null })];
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    expect(s.reason).toBe("the critic leg ended 'error' with no usable output");
  });

  test('no critic requested → null, exactly like the shipped shape', () => {
    expect(deriveSeatLoss({ runId: 'r1', critic: null,
      degrades: [mk('dead-leg', { seat: 'beta', status: 'timeout', reason: null })] })).toBeNull();
  });

  test('heals and dataless records are ignored by the derivation', () => {
    const degrades = [
      mk('shared-server-unavailable', undefined, { kind: 'heal' }),
      mk('thin-cross-review', undefined),
    ];
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    expect(s.criticSeated).toBe(true);
    expect(s.deadBenchSeats).toEqual([]);
  });

  test('writeVerdictFiles prefers the derivation when degrades is provided', () => {
    const runDir = fs.mkdtempSync(path.join(tmp, 'derive-'));
    writeVerdictFiles({ runDir, record: record(), overallVerdict: null, chairText: null,
      critic: 'critic-m', deadWaves: [],   // legacy input says "all seated"
      degrades: [mk('dead-leg', { seat: 'critic-m', status: 'timeout', reason: 'no first token' })] });
    const onDisk = JSON.parse(fs.readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'));
    expect(onDisk.seatLoss.criticSeated).toBe(false);  // the records win — one source of truth
  });
});

// SL-2 (spec: docs/superpowers/specs/2026-08-03-sl2-stage1-retry-design.md).
// Brief names tests/council/verdict.test.js for this pin, but that file has no
// deriveSeatLoss import or describe conventions at all (grep confirms
// deriveSeatLoss is required only here and by run-retry.test.js) — this file
// is where deriveSeatLoss's actual describe block and `mk` fixture helper
// live, so the pin (and its Task-4-handoff null-status siblings) are appended
// here instead, matching this file's existing conventions rather than the
// brief's mispointed path.
describe('SL-2: heals never count as losses', () => {
  test('a healed critic is SEATED — stage1-retry heal records are ignored by deriveSeatLoss', () => {
    const s = deriveSeatLoss({ runId: 'r1', critic: 'crit', degrades: [
      { kind: 'heal', channel: 'stage1-retry',
        what: 'seat crit reviewed on retry', why: 'w', effect: 'e',
        data: { seat: 'crit', retryWaveId: 'r1-c1r1', retryOfWaveId: 'r1-c1' } },
    ] });
    expect(s).toEqual({ criticRequested: 'crit', criticSeated: true, reason: null, deadBenchSeats: [] });
  });

  // Task-4/5 handoff: a reconciliation note (run-retry-notes.js's
  // missingLegStillDeadNote) carries data.status: null, data.reason: null —
  // the seat's retry produced no leg record at all, so there is no status to
  // name. Pre-fix, verdict.js's fallback rendered the literal string "the
  // critic leg ended 'null' with no usable output".
  test('a critic reconciliation note (status/reason both null) reports "no usable output", never the literal null', () => {
    const degrades = [mk('dead-leg', { seat: 'critic-m', status: null, reason: null })];
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    expect(s.criticSeated).toBe(false);
    expect(s.reason).toBe('the critic leg produced no usable output');
  });

  // Sibling pin, same describe block: a record that DOES carry a real status
  // must keep rendering the original "ended '<status>'" text byte-identically.
  test('a critic dead-leg with a real status (no reason) keeps the old text byte-identical', () => {
    const degrades = [mk('dead-leg', { seat: 'critic-m', status: 'timeout', reason: null })];
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    expect(s.criticSeated).toBe(false);
    expect(s.reason).toBe("the critic leg ended 'timeout' with no usable output");
  });
});

/**
 * v4.9 W9 (SI-02) — `deriveSeatLoss` is the THIRD consumer that was blind to `seat-unbound`,
 * and the one whose output reaches verdict.json. Two changes, one commit with the renderers:
 *   1. the kind predicate names the kinds it EXCLUDES rather than trusting who calls it —
 *      `kind === undefined || kind === 'degrade'`, aligning all three consumers and
 *      future-proofing v4.9's `info` kind. (W9 shipped this as the positive test alone; the
 *      fix round's council C4 widened it to admit a kind-LESS record — see that block below.)
 *   2. the gated `seat-unbound` family joins `dead-leg` as a seat loss.
 * `deadBenchSeats` stays a list of ALIAS strings — `live-dead-seats.js`'s derivative-absorb
 * rule reads it that way, and `data.seat` compares against `o.critic`, an alias.
 *
 * Named mutant GATERAW-C (measured, applied and reverted): drop the retry-family conjunct from
 * `gatedUnbound` — red set (3), all in this block: both ORPHAN-LEG controls and the Stage-2
 * judge-side control. ⚠️ RE-MEASURED at the W9 fix round: it was 4, and R-W9a left the set when
 * that record started being admitted on its own merits, so raw admission no longer changes its
 * answer. The full mutant table for W9, including the two renderer twins and the fix round's
 * five additions, is in `tests/workspace/dead-seat-twins.test.js`'s W9 header.
 */
describe('W9: deriveSeatLoss admits the gated seat-unbound family', () => {
  const unbound = (data) => mk('seat-unbound', data);

  test('a partial-wave seat-unbound loss reaches deadBenchSeats, as an ALIAS', () => {
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      unbound({ waveId: 'r1-s1', models: ['beta'], reason: 'x', retryWaveId: 'r1-s1r1',
        seat: 'beta', seatId: 'beta#2' }),
    ] });
    expect(s.deadBenchSeats).toEqual(['beta']);   // the alias, never the seat id
    expect(s.criticSeated).toBe(true);
  });

  test('a missing-leg seat-unbound loss naming the CRITIC flips criticSeated', () => {
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      unbound({ seat: 'critic-m', status: null, reason: null, retryWaveId: 'r1-c1r1',
        firstFailure: { seat: 'critic-m', seatId: 'critic-m', class: 'missing',
          waveId: 'r1-c1', reason: 'the wave returned 0 of 1 legs' } }),
    ] });
    expect(s.criticSeated).toBe(false);
    expect(s.reason).toBe('the critic leg produced no usable output');
    expect(s.deadBenchSeats).toEqual([]);         // the critic is never also a bench loss
  });

  test('CONTROL (mutant GATERAW): an ORPHAN-LEG note is NOT a lost seat', () => {
    // Its review LANDED and was paid for — counting it would over-report the loss and
    // double-count a rendered review. It carries data.legId and no retry-family field.
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      unbound({ waveId: 'r1-s1', legId: 'leg-7', seat: 'beta' }),
    ] });
    expect(s.deadBenchSeats).toEqual([]);
    expect(s.criticSeated).toBe(true);
  });

  test('CONTROL (mutant GATERAW): an orphan note naming the CRITIC does not unseat it', () => {
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      unbound({ waveId: 'r1-s1', legId: 'leg-7', seat: 'critic-m' }),
    ] });
    expect(s.criticSeated).toBe(true);
  });

  test('CONTROL (mutant GATERAW): a reVoteUnbound note is inert — it names a judge', () => {
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      unbound({ waveId: 'r1-rv', legId: 'leg-9', judge: 'beta', key: 'beta' }),
    ] });
    expect(s.deadBenchSeats).toEqual([]);
  });

  test('CONTROL: a Stage-2 judge-side seat-unbound note is inert — that seat DID review', () => {
    // run-stage2.js's note: {waveId, seat} for a seat that reviewed and failed only to judge.
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      unbound({ waveId: 'r1-s2', seat: 'beta' }),
    ] });
    expect(s.deadBenchSeats).toEqual([]);
  });

  test("CONTROL: the seat conjunct — a retry-family record naming NO seat is not a loss", () => {
    // No shipped `seat-unbound` shape looks like this (every retry-family arm names its
    // alias), so this is the guard's OWN pin, not a regression case. Without it the record
    // reaches `deadBenchSeats` and pushes `undefined`, which every reader of that list —
    // `live-dead-seats.js`'s derivative candidates included — treats as a seat. Measured:
    // dropping the same conjunct from the two RENDERER twins reds nothing, because their
    // `add()`/`if (key)` guards already refuse a nameless candidate. It is kept in all three
    // so one rule keeps one spelling; this is the one place it can be measured.
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      unbound({ waveId: 'r1-s1', reason: 'x', retryWaveId: 'r1-s1r1' }),
    ] });
    expect(s.deadBenchSeats).toEqual([]);
  });

  test('R-W9a (CLOSED): the SKIPPED-path partial note IS a lost seat', () => {
    // Closed at the producer in the W9 fix round (council A1/C1): `run-retry-notes.js ::
    // skippedWaveNote` emits the `firstFailure` fact the record already carried, so this
    // gate admits it UNCHANGED. Mirrors the renderers' flipped pin in dead-seat-twins.test.js.
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      unbound({ waveId: 'r1-s1', models: ['beta'], reason: 'x', seat: 'beta', seatId: 'beta#2',
        firstFailure: { seat: 'beta', class: 'missing', waveId: 'r1-s1', reason: 'x' } }),
    ] });
    expect(s.deadBenchSeats).toEqual(['beta']);
  });

  test('R-W9a: a skipped note naming the CRITIC unseats it', () => {
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      unbound({ waveId: 'r1-c1', models: ['critic-m'], reason: 'over budget', seat: 'critic-m',
        seatId: 'critic-m',
        firstFailure: { seat: 'critic-m', class: 'missing', waveId: 'r1-c1', reason: 'over budget' } }),
    ] });
    expect(s.criticSeated).toBe(false);
    expect(s.deadBenchSeats).toEqual([]);
  });
});

describe('W9: the kind predicate excludes `heal`/`info` and admits a kind-LESS record', () => {
  test("an `info` record on a loss channel is not a loss (kind !== 'heal' admitted it)", () => {
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      mk('dead-leg', { seat: 'beta', status: 'timeout', reason: null }, { kind: 'info' }),
    ] });
    expect(s.deadBenchSeats).toEqual([]);
  });

  test('heals stay excluded — the property the old spelling existed for', () => {
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      mk('dead-leg', { seat: 'beta', status: 'timeout', reason: null }, { kind: 'heal' }),
    ] });
    expect(s.deadBenchSeats).toEqual([]);
  });

  test('a real degrade is still a loss — the predicate did not close on everything', () => {
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      mk('dead-leg', { seat: 'beta', status: 'timeout', reason: null }),
    ] });
    expect(s.deadBenchSeats).toEqual(['beta']);
  });

  test('C4: a record with NO kind key IS a loss — convention made structural', () => {
    // W9 fix round, council C4. The positive spelling's safety rested on an ASSERTED caller
    // inventory ("every record here comes from makeDegrade, which stamps kind:'degrade'") —
    // true today, unenforced, and one new caller away from a silent drop. `report.js` already
    // learned this the hard way (named mutant LEGACYDROP): a kind-LESS record is a loss, and
    // `utils/degrade.js :: formatDegrade` still renders one as 'Notice'. Same rule here now,
    // so the three consumers agree without depending on who calls them.
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m',
      degrades: [{ channel: 'dead-leg', what: 'w', why: 'y', effect: 'e', data: { seat: 'beta' } }] });
    expect(s.deadBenchSeats).toEqual(['beta']);
  });

  test('C4: a kind-LESS record naming the CRITIC unseats it too', () => {
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m',
      degrades: [{ channel: 'dead-leg', what: 'w', why: 'y', effect: 'e',
        data: { seat: 'critic-m', status: 'timeout' } }] });
    expect(s.criticSeated).toBe(false);
  });

  test('C4 CONTROL: kind-less does not mean kind-blind — an explicit heal is still excluded', () => {
    // The property the positive spelling existed for, restated against the widened predicate:
    // only the ABSENCE of the key is admitted, never a `heal`/`info` that names itself.
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades: [
      mk('dead-leg', { seat: 'beta', status: 'timeout', reason: null }, { kind: 'heal' }),
      mk('dead-leg', { seat: 'gamma', status: 'timeout', reason: null }, { kind: 'info' }),
    ] });
    expect(s.deadBenchSeats).toEqual([]);
  });
});

describe('readPriorVerdictSurfaces (#87)', () => {
  test('#87: readPriorVerdictSurfaces recovers seatLoss and degrades, runId-guarded', () => {
    const runDir = fs.mkdtempSync(path.join(tmp, 'prior-'));
    fs.writeFileSync(path.join(runDir, 'verdict.json'), JSON.stringify({
      runId: 'r1', seatLoss: { criticRequested: 'c', criticSeated: false, reason: 'x', deadBenchSeats: [] },
      degrades: [{ kind: 'degrade', channel: 'dead-leg', what: 'w', why: 'y', effect: 'e' }],
    }));
    const got = readPriorVerdictSurfaces(runDir, 'r1');
    expect(got.seatLoss.criticSeated).toBe(false);
    expect(got.degrades).toHaveLength(1);
    expect(readPriorVerdictSurfaces(runDir, 'OTHER')).toEqual({ seatLoss: null, degrades: null }); // foreign verdict never leaks
    expect(readPriorVerdictSurfaces(fs.mkdtempSync(path.join(tmp, 'empty-')), 'r1'))
      .toEqual({ seatLoss: null, degrades: null });                                               // absent → absent
  });
});
