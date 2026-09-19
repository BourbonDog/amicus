// tests/council/verdict-seat-loss.test.js
'use strict';

/**
 * A lost critic must be visible in verdict.json (v4.5.2).
 *
 * FIELD BUG. When the shared OpenCode server fails to acquire, a council run
 * degrades to one server per wave — and Stage 1 launches the bench wave and the
 * critic wave under a single `Promise.all`, ~20ms apart, racing the same
 * OpenCode SQLite start. In the reported run `dfb6a692` the bench won and the
 * critic lost: the run produced a full `verdict.json`, `tally.json` and chair
 * synthesis, none of which had ever seen the critic's findings.
 *
 * The asymmetry is what makes it dangerous. A dead BENCH wave is loud — it trips
 * the quorum gate and fails the run. A dead CRITIC wave is survivable, so the
 * run sails on to a verdict. The only record was `deadWaves` in run.json, a file
 * nobody reads when the verdict looks clean.
 *
 * A user who typed `--critic` asked for adversarial review. A verdict produced
 * without it has to say so on its own face.
 */

const fs = require('fs');
const path = require('path');
const { buildVerdict, summarizeSeatLoss } = require('../../src/council/verdict');

const RUN_ID = 'dfb6a692';
const CRITIC = 'openrouter/openai/gpt-5.6-terra';
const TIMEOUT = 'Failed to start server: Timeout waiting for server to start after 5000ms';

/** Minimal record of the shape buildVerdict consumes. */
function makeRecord() {
  return {
    meta: {
      runId: RUN_ID, runType: 'council', date: '2026-07-31',
      chair: 'gemini-pro', models: ['deepseek-v4-pro', 'kimi-k2.6', 'glm-5.2', CRITIC],
      claudeInCouncil: false,
    },
    findings: [], streetCred: [], runStats: {}, tierCounts: {},
  };
}

describe('summarizeSeatLoss', () => {
  it('reports the critic as lost when its wave died', () => {
    const s = summarizeSeatLoss({
      runId: RUN_ID, critic: CRITIC,
      deadWaves: [{ waveId: `${RUN_ID}-c1`, models: [CRITIC], reason: TIMEOUT }],
    });
    expect(s.criticRequested).toBe(CRITIC);
    expect(s.criticSeated).toBe(false);
    expect(s.reason).toMatch(/Timeout waiting for server to start/);
  });

  it('reports the critic as seated when no wave died', () => {
    const s = summarizeSeatLoss({ runId: RUN_ID, critic: CRITIC, deadWaves: [] });
    expect(s.criticSeated).toBe(true);
  });

  it('reports the critic as seated when an unrelated bench wave died', () => {
    const s = summarizeSeatLoss({
      runId: RUN_ID, critic: CRITIC,
      deadWaves: [{ waveId: `${RUN_ID}-s1`, models: ['kimi-k2.6'], reason: TIMEOUT }],
    });
    expect(s.criticSeated).toBe(true);
  });

  it('identifies the critic wave by its models, not only by the -c1 id', () => {
    const s = summarizeSeatLoss({
      runId: RUN_ID, critic: CRITIC,
      deadWaves: [{ waveId: 'some-other-id', models: [CRITIC], reason: TIMEOUT }],
    });
    expect(s.criticSeated).toBe(false);
  });

  it('counts dead bench seats separately from the critic', () => {
    const s = summarizeSeatLoss({
      runId: RUN_ID, critic: CRITIC,
      deadWaves: [{ waveId: `${RUN_ID}-s1`, models: ['kimi-k2.6', 'glm-5.2'], reason: TIMEOUT }],
    });
    expect(s.deadBenchSeats).toEqual(['kimi-k2.6', 'glm-5.2']);
  });

  it('returns null when no critic was requested — nothing to report', () => {
    expect(summarizeSeatLoss({ runId: RUN_ID, critic: null, deadWaves: [] })).toBeNull();
  });
});

describe('buildVerdict surfaces seat loss', () => {
  it('omits the block entirely when nothing was lost and no critic was asked for', () => {
    const v = buildVerdict(makeRecord(), []);
    expect(v.seatLoss).toBeUndefined();
  });

  it('records a lost critic on the verdict itself', () => {
    const v = buildVerdict(makeRecord(), [], {
      seatLoss: summarizeSeatLoss({
        runId: RUN_ID, critic: CRITIC,
        deadWaves: [{ waveId: `${RUN_ID}-c1`, models: [CRITIC], reason: TIMEOUT }],
      }),
    });
    expect(v.seatLoss.criticSeated).toBe(false);
    expect(v.seatLoss.criticRequested).toBe(CRITIC);
  });

  it('records a seated critic too, so silence is never ambiguous', () => {
    const v = buildVerdict(makeRecord(), [], {
      seatLoss: summarizeSeatLoss({ runId: RUN_ID, critic: CRITIC, deadWaves: [] }),
    });
    expect(v.seatLoss.criticSeated).toBe(true);
  });

  it('does not disturb the rest of the verdict', () => {
    const v = buildVerdict(makeRecord(), [], {
      overallVerdict: 'ship',
      seatLoss: summarizeSeatLoss({ runId: RUN_ID, critic: CRITIC, deadWaves: [] }),
    });
    expect(v.overallVerdict).toBe('ship');
    expect(v.runId).toBe(RUN_ID);
    expect(v.type).toBe('council-verdict');
  });
});

/**
 * v4.9 PR #200 fix round 3 — the seat-loss extraction (the W4 chair-fallback
 * shape: pure move + re-export, taken to make room under the 300-line gate for
 * the carried-phrase scale check in readOverallVerdict).
 *
 * The MOVE itself needs no new behavioural coverage: both functions were cut and
 * pasted byte-for-byte and every assertion above (plus
 * tests/council/verdict-degrades.test.js) still imports them THROUGH
 * verdict.js's re-export, so a move that changed anything reds there.
 *
 * What is new is the claim the split makes: ONE implementation, re-exported —
 * never re-implemented. Identity (`toBe` on the function reference), not
 * equivalence: a copy that merely behaves the same today would pass a
 * behavioural check and fail here.
 */
describe('one implementation, re-exported (verdict-seat-loss extraction)', () => {
  const leaf = require('../../src/council/verdict-seat-loss');
  const verdict = require('../../src/council/verdict');

  test('summarizeSeatLoss is the SAME function object at both layers', () => {
    expect(verdict.summarizeSeatLoss).toBe(leaf.summarizeSeatLoss);
  });

  test('deriveSeatLoss is the SAME function object at both layers', () => {
    expect(verdict.deriveSeatLoss).toBe(leaf.deriveSeatLoss);
  });

  test('run-verdict-files.js reaches the same two objects through verdict.js', () => {
    // The only production consumer (run-verdict-files.js :: writeVerdictFiles)
    // imports from ./verdict, which is why the re-export is load-bearing rather
    // than courtesy.
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'council', 'run-verdict-files.js'), 'utf-8');
    expect(src).toContain("require('./verdict')");
  });

  test('the extracted module exports exactly the two functions', () => {
    expect(Object.keys(leaf).sort()).toEqual(['deriveSeatLoss', 'summarizeSeatLoss']);
  });

  test('it stays a LEAF but for ONE pinned-leaf require: ./promoted (#257, R-X15)', () => {
    // A require back into verdict.js would make the split circular; a require of
    // anything BUT a proven leaf would give the seat-loss pair a dependency it
    // never had. `./promoted` is that proven leaf — it is itself require-free
    // (pinned twice: tests/council/promoted.test.js, and again in the test
    // directly below so THIS file's cycle guard does not depend on another suite
    // running), so it can never reach verdict.js and the guard stands. Spec R9
    // requires the reasoning-only clause to come from ONE builder; hand-spelling
    // it here would fork a string whose whole point is byte-identity across five
    // announcement sites. The COUNT is what is pinned: exactly one, and exactly
    // that one, so a second require is still a red test.
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'council', 'verdict-seat-loss.js'), 'utf-8');
    expect(src.match(/require\(/g)).toHaveLength(1);
    expect(src).toContain("require('./promoted')");
  });

  test('its one dependency is itself require-free', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'council', 'promoted.js'), 'utf-8');
    expect(src).not.toContain('require(');
  });
});

/**
 * #257 (R-X14) — a promoted critic says so in verdict.json.
 *
 * The unswept twin of the five Stage-1 announcement sites: `deriveSeatLoss`
 * builds a SIXTH "no usable output" sentence, and it was the only one that did
 * not learn the clause. It is reachable for a promoted critic that stays dead —
 * `srcLegStillDeadNote`'s `data.reason` is `leg.error || null` = null and its
 * `data.status` is 'complete' — so the verdict's own face carried the bare,
 * true and uninformative sentence while run.json's prose named the cause.
 *
 * This function reads ONLY `record.data`, never the prose fields, which is why
 * the producer had to carry the facts there (R-X14, run-retry-notes.js).
 *
 * Named mutant CRITICCLAUSEDROPPED: delete
 * `${reasoningOnlyClause(criticLeg.data.promoted)}` from verdict-seat-loss.js's
 * status branch. Red set: the first test below.
 *
 * Council r1 (Minor): the sentence has TWO arms and only the status-carrying one
 * learned the clause. The other is the SL-2 reconciliation record
 * (`run-retry-notes.js :: missingLegStillDeadNote`), whose `data.status` is null
 * because the retry produced no leg for the seat at all — and which R-X14 gave
 * `data.promoted` from the FIRST failure's facts, so the facts were sitting in
 * the record the bare sentence was rendered from. Named mutant
 * CRITICNULLARMDROPPED: delete the clause call from the null-status branch. Red
 * set: the third test below.
 */
describe('#257 deriveSeatLoss names the reasoning channel for a promoted critic', () => {
  const { deriveSeatLoss } = require('../../src/council/verdict');
  const { makeDegrade } = require('../../src/utils/degrade');
  const CRITIC_M = 'critic-m';
  const PROMOTED = { reasoning: 40332, output: 1, finish: 'stop' };
  const rec = (data) => makeDegrade({ channel: 'dead-leg', what: 'w', why: 'y', effect: 'e', data });

  test('a still-dead PROMOTED critic carries the clause into seatLoss.reason', () => {
    // The exact shape `srcLegStillDeadNote` emits for a promoted leg whose retry
    // wave produced no legs: no error, so status 'complete' and reason null.
    const degrades = [rec({ seat: CRITIC_M, status: 'complete', reason: null, promoted: PROMOTED })];
    const s = deriveSeatLoss({ runId: 'r1', critic: CRITIC_M, degrades });
    expect(s.criticSeated).toBe(false);
    expect(s.reason).toBe("the critic leg ended 'complete' with no usable output"
      + ' — it answered only in its reasoning channel '
      + "(40332 reasoning / 1 output tokens, finish 'stop'), which is not a review");
  });

  test('a record WITHOUT promoted keeps the shipped sentence byte-identical', () => {
    const degrades = [rec({ seat: CRITIC_M, status: 'error', reason: null })];
    const s = deriveSeatLoss({ runId: 'r1', critic: CRITIC_M, degrades });
    expect(s.reason).toBe("the critic leg ended 'error' with no usable output");
  });

  test('the NULL-STATUS arm names the reasoning channel too (council r1)', () => {
    // The exact shape `missingLegStillDeadNote` emits: no status to name, and
    // `data.promoted` restating the first failure's facts (R-X14).
    const degrades = [rec({ seat: CRITIC_M, status: null, reason: null, promoted: PROMOTED })];
    const s = deriveSeatLoss({ runId: 'r1', critic: CRITIC_M, degrades });
    expect(s.criticSeated).toBe(false);
    expect(s.reason).toBe('the critic leg produced no usable output'
      + ' — it answered only in its reasoning channel '
      + "(40332 reasoning / 1 output tokens, finish 'stop'), which is not a review");
  });

  test('a NULL-STATUS record without promoted keeps the shipped sentence byte-identical', () => {
    const degrades = [rec({ seat: CRITIC_M, status: null, reason: null })];
    const s = deriveSeatLoss({ runId: 'r1', critic: CRITIC_M, degrades });
    expect(s.reason).toBe('the critic leg produced no usable output');
  });
});
