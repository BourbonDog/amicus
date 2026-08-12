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
        // labelFor() and the already-shipped electron/workspace-ui/live-seats.js:25
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
    // ⚠️ v4.4.1 RN-8 (D1 ruling): the fixture doc still CARRIES legsTotal/legsComplete — the
    // producer really does ship them — but the LiveModel no longer republishes them. They were
    // mapped under a comment promising a UI fallback that was never wired, and nothing in
    // electron/workspace-ui/ ever read either one. This used to assert `.toBe(2)` / `.toBe(0)`.
    expect(m).not.toHaveProperty('legsTotal');
    expect(m).not.toHaveProperty('legsComplete');
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

  // ⚠️ v4.4.1 RN-7: this test used to be "wave-nested legs and legId spellings are tolerated
  // (shape seam)" and asserted the exact opposite of what it now asserts. Both fallbacks were
  // dead code that ASSERTED A SHAPE NO PRODUCER EMITS — the WAVE composed doc
  // (src/mcp-server.js:590-665) carries a TOP-LEVEL `legs` exactly like the council one, and no
  // leg row has ever carried `legId` (council-legs.js stamps `taskId`). This file's own header
  // says "Do NOT copy the WAVE doc's shape", yet these two arms did precisely that, and
  // wsgate01's reviewer read them and believed the wave shape was supported here. The pin now
  // faces the other way so nobody re-adds a fallback without a producer to point at.
  test('a wave-nested `wave.legs` doc yields NO seats — the dead shape fallback is gone (RN-7)', () => {
    const m = normalizeLive({ taskId: 'x', status: 'running', wave: { legs: [{ legId: 'l1', model: 'qwen', status: 'running' }] } });
    expect(m.ok).toBe(true);      // still degrades, never throws
    expect(m.seats).toEqual([]);
  });

  test('a leg carrying only the phantom `legId` gets id:null, not an invented identity (RN-7)', () => {
    const m = normalizeLive({ taskId: 'x', status: 'running', legs: [{ legId: 'l1', model: 'qwen', status: 'running' }] });
    expect(m.seats).toHaveLength(1);
    expect(m.seats[0].id).toBeNull();
    expect(m.seats[0].model).toBe('qwen');   // the rest of the row still maps
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

  // ⚠️ v4.4.1 RN-7 (supersedes PRE-FLIGHT P6). P6 corrected this fallback once — from the
  // phantom `doc.stage` to the real `currentStage` — and its own comment conceded the arm was
  // "harmless today only by coincidence". It is in fact strictly unreachable: the producer
  // writes `stages` as `(run.stages || []).map(…)`, always an array, and derives `currentStage`
  // from the SAME `find(s => s.status === 'running')` predicate normalizeLive uses for `active`
  // (src/mcp-council-awareness.js:155-157) — so the two can never disagree. The arm is deleted;
  // stageName now comes from the running stage or is null. Both phantom keys pinned as inert.
  test('stageName comes from the running stage only — no doc-level fallback (RN-7)', () => {
    const base = { type: 'council-run', taskId: 'x', status: 'running',
      stages: [{ name: 'stage1', status: 'complete' }] };
    expect(normalizeLive({ ...base, currentStage: 'chair' }).stageName).toBeNull();
    expect(normalizeLive({ ...base, stage: 'chair' }).stageName).toBeNull();
    // …and the real path is untouched: a stage actually in `running` still names itself.
    expect(normalizeLive({ ...base, stages: [{ name: 'chair', status: 'running' }] }).stageName).toBe('chair');
  });

  // PR4b Task 1: thread `degrades` through the live spine (Christian's mid-poll
  // ruling on PR #102) — normalizeLive is the ONE defensive mapping layer, so it
  // must pass a well-formed degrades[] through verbatim and degrade absent/junk
  // input to [] rather than undefined or a thrown error.
  test('degrades[] passes through verbatim; absent or non-array degrades normalizes to []', () => {
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat x did not review',
      data: { seat: 'x', retryWaveId: 'w2' },
    }];

    const withDegrades = normalizeLive({ taskId: 'x', status: 'running', legs: [], degrades });
    expect(withDegrades.degrades).toEqual(degrades);

    const absent = normalizeLive({ taskId: 'x', status: 'running', legs: [] });
    expect(absent.degrades).toEqual([]);

    const junk = normalizeLive({ taskId: 'x', status: 'running', legs: [], degrades: 'junk' });
    expect(junk.degrades).toEqual([]);
  });
});
