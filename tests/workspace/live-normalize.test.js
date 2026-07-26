'use strict';

const { normalizeLive } = require('../../src/workspace/live-normalize');
const { labelFor } = require('../../src/workspace/blind-mode');

describe('normalizeLive', () => {
  test('council composed doc: stages, active stage name, seats with live usage', () => {
    const doc = {
      // ⚠️ DE-ROT (F63): no `schemaVersion` — the council live doc is UNVERSIONED.
      // buildCouncilStatusPayload builds a bare object literal and returns markLive(payload); it
      // never goes through stampEnvelope, which is the only thing that stamps schemaVersion.
      type: 'council-run', view: 'live', taskId: 'cccc3333', status: 'running',
      stages: [
        // ⚠️ DE-ROT (F40): no `startedAt` — stage entries are exactly {name, status, waveId}
        // (src/mcp-council-awareness.js:126-128); durable timestamps never reach the live doc.
        { name: 'stage1', status: 'running', waveId: 'cccc3333-s1' },
      ],
      legsTotal: 2, legsComplete: 0,
      legs: [
        // ⚠️ DE-ROT (F34/F36): `model` is the RESOLVED executable id; `modelInput` is the council
        // ALIAS (src/observe/council-legs.js). They are two distinct fields on a real leg row —
        // collapsing them (`leg.model || leg.modelInput`) would drop the alias that blind mode's
        // labelFor() and the already-shipped electron/workspace-ui/live-model.js:55
        // (`seat.modelInput || seat.model`) key on, leaking the real model id.
        // `lastActivityAt` (ISO), not `lastActivity`, is the real field Task 0.5 emits (PRE-FLIGHT P5).
        { taskId: 'dddd0001', model: 'google/gemini-2.5-pro', modelInput: 'gemini', role: 'seat',
          status: 'running', stage: 'receiving', messages: 3,
          lastActivityAt: '2026-07-25T00:00:05.000Z', stalled: false,
          usage: { tokens: { input: 3000, output: 400 }, cost: { amount: 0.02, source: 'estimated' } } },
        { taskId: 'dddd0002', model: 'openai/gpt-5', status: 'running', stalled: true },
      ],
      usage: { cost: { amount: 0.06, source: 'estimated' } },
    };
    const m = normalizeLive(doc);
    expect(m.ok).toBe(true);
    expect(m.view).toBe('live');
    expect(m.runId).toBe('cccc3333');
    expect(m.stageName).toBe('stage1');
    expect(m.terminal).toBe(false);
    expect(m.legsTotal).toBe(2);
    expect(m.legsComplete).toBe(0);
    expect(m.seats).toHaveLength(2);
    expect(m.seats[0]).toMatchObject({
      id: 'dddd0001', model: 'google/gemini-2.5-pro', modelInput: 'gemini', role: 'seat',
      status: 'running', stage: 'receiving', messages: 3, tokensIn: 3000, tokensOut: 400,
      costDisplay: '~$0.0200', lastActivity: '2026-07-25T00:00:05.000Z', stalled: false,
    });
    // A2 degradation: absent live fields → null (renderer paints —), never undefined.
    expect(m.seats[1]).toMatchObject({
      modelInput: null, role: null, tokensIn: null, tokensOut: null, costDisplay: null,
      messages: null, lastActivity: null, stalled: true,
    });
    expect(m.costDisplay).toBe('~$0.0600');  // ⚠️ DE-ROT (F24): formatCost uses 4dp under $1
    expect(m.costAmount).toBeCloseTo(0.06);
  });

  test('wave-nested legs and legId spellings are tolerated (shape seam)', () => {
    const m = normalizeLive({ taskId: 'x', status: 'running', wave: { legs: [{ legId: 'l1', model: 'qwen', status: 'running' }] } });
    expect(m.seats).toHaveLength(1);
    expect(m.seats[0].id).toBe('l1');
  });

  test('data-layer liveness flags pass through; the GUI never invents its own (A4)', () => {
    // ⚠️ DE-ROT (F03): there is no literal `crashed` boolean anywhere on the composed doc — Task
    // 0.5 deliberately did not add one (out of scope). A crashed council instead flips `status` to
    // 'error' and stamps `reason` from run.error (src/mcp-council-awareness.js:110-123). That is
    // the only real signal; deriving `crashed` from a nonexistent `doc.crashed` field would read
    // `undefined` forever against every real run.
    const crashed = normalizeLive({
      taskId: 'x', status: 'error', reason: 'INTERNAL: Council engine process exited unexpectedly',
      stalled: true, stalledForSeconds: 240, legs: [],
    });
    expect(crashed.flags).toEqual({ crashed: true, stalled: true, stalledForSeconds: 240 });

    // A stray `doc.crashed` field (never emitted by real code) is not read directly — proves the
    // seam derives the flag from status+reason rather than trusting a field that does not exist.
    const notCrashed = normalizeLive({ taskId: 'x', status: 'running', crashed: true, legs: [] });
    expect(notCrashed.flags).toEqual({ crashed: false, stalled: false, stalledForSeconds: null });
  });

  test('terminal statuses flip terminal; junk input → {ok:false}', () => {
    expect(normalizeLive({ taskId: 'x', status: 'complete', legs: [] }).terminal).toBe(true);
    expect(normalizeLive(null).ok).toBe(false);
    expect(normalizeLive('nope').ok).toBe(false);
  });

  test('TERMINAL_STATUSES (src/workspace/run-detail.js) matches the real v4.3 source, src/observe/live-doc.js (drift pin)', () => {
    // Task 3 (run-detail.js) is Phase 1 ("zero v4.3") and cannot require() live-doc.js itself — this
    // task is where the v4.3 dependency genuinely lands, so the drift pin against the real source
    // lives here.
    const { TERMINAL_STATUSES } = require('../../src/workspace/run-detail');
    expect(TERMINAL_STATUSES).toEqual(Array.from(require('../../src/observe/live-doc').TERMINAL));
  });

  test('blind-mode identity: Seat.modelInput (the alias) is distinct from Seat.model (the resolved id) — a label lookup keyed on the alias succeeds where keying on the resolved id fails', () => {
    // labelMap values are ALIASES, never resolved ids (src/council/anonymize.js:30 stamps them
    // from the bench alias list).
    const labelMap = { 'Review A': 'gemini' };
    const m = normalizeLive({
      taskId: 'x', status: 'running',
      legs: [{ taskId: 'l1', model: 'google/gemini-2.5-pro-latest', modelInput: 'gemini', status: 'running' }],
    });
    const seat = m.seats[0];
    expect(seat.model).toBe('google/gemini-2.5-pro-latest');
    expect(seat.modelInput).toBe('gemini');
    expect(labelFor(seat.modelInput, labelMap)).toBe('Review A');
    expect(labelFor(seat.model, labelMap)).toBeNull();
  });
});
