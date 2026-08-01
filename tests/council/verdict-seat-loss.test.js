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
