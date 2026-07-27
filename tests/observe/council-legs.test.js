'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Direct unit coverage for src/observe/council-legs.js's buildLegRows, for the
 * two council-review fixes the higher-level buildCouncilStatusPayload fixtures
 * (tests/observe/council-live-legs.test.js) don't isolate cleanly:
 *
 *  - C3: buildLegRow's single try wrapped BOTH readProgress (legitimately
 *    absent early in a leg's life) and enrichLegUsage (pricing resolution).
 *    A pricing failure must be distinguishable from "not billed yet" via a
 *    truthful `usageError` field, not silently swallowed into the same blank
 *    cell — this is exercised here by mocking live-doc's enrichLegUsage to
 *    throw for one leg, since the real pricing module (src/utils/pricing.js)
 *    degrades to `{amount:null, source:'unknown'}` rather than throwing for
 *    any input shape it's ever handed in practice.
 *
 *  - the run-level `stalled` rollup must mean "every still-running leg is
 *    stalled" (the banner's actual claim — "no leg activity... run may be
 *    dead"), not "at least one leg is stalled" (the old max-based bug that
 *    fired while other seats were visibly working).
 */
describe('buildLegRows', () => {
  let projectDir;
  beforeEach(() => { jest.resetModules(); projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-legs-unit-')); });
  afterEach(() => { jest.resetModules(); });

  function legDir(runDir, legId) {
    const dir = path.join(runDir, '.claude', 'amicus_sessions', legId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  const RUN_CTX = { bench: ['gemini', 'gpt'], critic: null, lenses: null, stageName: 'stage1' };

  describe('C3: pricing failures are distinguishable from absent progress', () => {
    afterEach(() => { jest.dontMock('../../src/observe/live-doc'); });

    test('enrichLegUsage throwing surfaces row.usageError, not a silently blank usage cell', () => {
      jest.doMock('../../src/observe/live-doc', () => {
        const actual = jest.requireActual('../../src/observe/live-doc');
        return {
          ...actual,
          enrichLegUsage: (leg, progressUsage) => {
            if (leg.taskId === 'leg-boom') { throw new Error('no pricing entry for model'); }
            return actual.enrichLegUsage(leg, progressUsage);
          },
        };
      });
      const { buildLegRows } = require('../../src/observe/council-legs');
      const { writeProgress } = require('../../src/sidecar/progress');

      const runDir = path.join(projectDir, 'run1');
      const dBoom = legDir(runDir, 'leg-boom');
      fs.writeFileSync(path.join(dBoom, 'metadata.json'), JSON.stringify({
        taskId: 'leg-boom', status: 'running', model: 'unknown/vendor-x', modelInput: 'gemini',
      }));
      writeProgress(dBoom, 'receiving', {
        usage: { tokens: { input: 40, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0 },
      });

      // leg-fresh: metadata written, NO progress.json yet — the ordinary,
      // legitimate "not billed yet" case this fix must stay distinguishable from.
      const dFresh = legDir(runDir, 'leg-fresh');
      fs.writeFileSync(path.join(dFresh, 'metadata.json'), JSON.stringify({
        taskId: 'leg-fresh', status: 'running', model: 'openai/gpt-5', modelInput: 'gpt',
      }));

      const { rows } = buildLegRows(runDir, ['leg-boom', 'leg-fresh'], RUN_CTX);
      const byId = Object.fromEntries(rows.map((r) => [r.taskId, r]));

      expect(byId['leg-boom'].usage).toBeUndefined();
      expect(byId['leg-boom'].usageError).toBe('no pricing entry for model');
      // The leg's own progress fields (readProgress succeeded) must still be
      // on the row — the pricing failure must not blank out data that WAS
      // read successfully.
      expect(byId['leg-boom'].messages).toBe(0);

      expect(byId['leg-fresh'].usage).toBeUndefined();
      expect(byId['leg-fresh'].usageError).toBeUndefined();
    });
  });

  /**
   * v4.4 B3 reader-side belt (diagnosis §7.3). progress.json's `usage` snapshot
   * is stamped only on 'receiving' flushes — i.e. always before OpenCode's
   * finalization stamp — so on real runs 31 of 35 legs ended with an all-zero
   * snapshot while metadata.json held thousands of real tokens. The writer fix
   * (headless.js's terminal progress write) repairs new runs; this makes the
   * READER authoritative for any terminal leg regardless, including every leg
   * already on disk from before the fix.
   */
  describe('B3: a terminal leg reports metadata.json usage, not the stale progress snapshot', () => {
    test('complete leg with real metadata usage + all-zero progress usage reports the real cost', () => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = path.join(projectDir, 'run1');
      const d = legDir(runDir, 'leg-done');
      // The exact shape of council-wsgate01/wsgate01-s1-1 (minimax): a REAL
      // reported cost in metadata, an all-zero 'receiving' snapshot in progress.
      fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({
        taskId: 'leg-done', status: 'complete', model: 'openrouter/minimax/minimax-m2.7',
        modelInput: 'gemini',
        usage: {
          tokens: { input: 39000, output: 1189, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          cost: { amount: 0.01259735, currency: 'USD', source: 'reported' },
        },
      }));
      fs.writeFileSync(path.join(d, 'progress.json'), JSON.stringify({
        schemaVersion: 1, type: 'progress', stage: 'receiving',
        stageLabel: 'Generating response...', updatedAt: new Date().toISOString(),
        usage: { tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0 },
      }));

      const { rows } = buildLegRows(runDir, ['leg-done'], RUN_CTX);
      expect(rows[0].usage.cost).toEqual({ amount: 0.01259735, currency: 'USD', source: 'reported' });
      expect(rows[0].usage.tokens.input).toBe(39000);
      expect(rows[0].usageError).toBeUndefined();
    });

    test('a RUNNING leg still reads the live progress snapshot (metadata has no usage yet)', () => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = path.join(projectDir, 'run1');
      const d = legDir(runDir, 'leg-live');
      fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({
        taskId: 'leg-live', status: 'running', model: 'openrouter/minimax/minimax-m2.7', modelInput: 'gemini',
      }));
      fs.writeFileSync(path.join(d, 'progress.json'), JSON.stringify({
        schemaVersion: 1, type: 'progress', stage: 'receiving',
        stageLabel: 'Generating response...', updatedAt: new Date().toISOString(),
        usage: { tokens: { input: 4000, output: 100, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.0021 },
      }));

      const { rows } = buildLegRows(runDir, ['leg-live'], RUN_CTX);
      expect(rows[0].usage.tokens.input).toBe(4000);
      expect(rows[0].usage.cost.amount).toBeCloseTo(0.0021, 8);
      expect(rows[0].usage.cost.source).toBe('reported');
    });

    test('a terminal leg whose zero-token usage is unknown reports unknown, never $0', () => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = path.join(projectDir, 'run1');
      const d = legDir(runDir, 'leg-unknown');
      // council-wsgate04/wsgate04-p1-1 after the B2 fix.
      fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({
        taskId: 'leg-unknown', status: 'complete', model: 'openrouter/z-ai/glm-5.2', modelInput: 'gpt',
        usage: {
          tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          cost: { amount: null, currency: 'USD', source: 'unknown' },
        },
      }));
      fs.writeFileSync(path.join(d, 'progress.json'), JSON.stringify({
        schemaVersion: 1, type: 'progress', stage: 'complete', stageLabel: 'Complete',
        updatedAt: new Date().toISOString(),
        usage: { tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0 },
      }));

      const { rows } = buildLegRows(runDir, ['leg-unknown'], RUN_CTX);
      expect(rows[0].usage.cost).toEqual({ amount: null, currency: 'USD', source: 'unknown' });
    });
  });

  /**
   * v4.4.1 LC-4. `legRole` is evaluated for every leg on every status poll, and
   * it feeds THREE surfaces off one file: `amicus status`, the amicus_status MCP
   * tool, and `amicus watch`. roleFor's lens branch does
   * `o.models.indexOf(alias)` (src/council/run-stages.js:132), so a run.json
   * with truthy `lenses` and a missing or non-array `bench` threw a TypeError
   * that escaped buildLegRow entirely — it ran outside both of its try blocks.
   * The whole-branch review called it "closest of the deferred set to a real
   * bug"; it was unreachable only because src/council/run.js:72 writes `bench`
   * and `lenses` together, an argument that rests on one writer never changing.
   */
  describe('LC-4: a malformed run.json degrades the Role column, it does not take out three surfaces', () => {
    function oneLeg(runDir) {
      const d = legDir(runDir, 'leg-1');
      fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({
        taskId: 'leg-1', status: 'running', model: 'openai/gpt-5', modelInput: 'gpt',
      }));
      return runDir;
    }

    test('THE HAZARD: roleFor itself still throws on lenses-without-bench (the guard is load-bearing)', () => {
      const { roleFor } = require('../../src/council/run-stages');
      expect(() => roleFor({ models: undefined, critic: null, lenses: ['security'] }, 'gpt'))
        .toThrow(TypeError);
    });

    test.each([
      ['bench undefined', undefined],
      ['bench null', null],
      ['bench a non-array object', { gpt: true }],
      ['bench a string', 'gpt'],
    ])('run.json with lenses and %s does not throw; the role degrades to null', (_name, bench) => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = oneLeg(path.join(projectDir, 'run-lc4'));

      let out;
      expect(() => {
        out = buildLegRows(runDir, ['leg-1'], { bench, critic: null, lenses: ['security'], stageName: 'stage1' });
      }).not.toThrow();

      // Truthful null (an em-dash in the Role column), never a guessed role…
      expect(out.rows[0].role).toBeNull();
      // …and every other field the row could still tell the truth about survives.
      expect(out.rows[0].taskId).toBe('leg-1');
      expect(out.rows[0].status).toBe('running');
      expect(out.rows[0].modelInput).toBe('gpt');
    });

    test('the guard is scoped to the lens branch — a normal run still resolves roles exactly', () => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = oneLeg(path.join(projectDir, 'run-lc4b'));

      // No lenses: roleFor never touches `models`, so a missing bench is harmless
      // and the critic comparison is still exact.
      expect(buildLegRows(runDir, ['leg-1'], {
        bench: undefined, critic: 'gpt', lenses: null, stageName: 'stage1',
      }).rows[0].role).toBe('critic');

      // A well-formed lens run is unchanged.
      expect(buildLegRows(runDir, ['leg-1'], {
        bench: ['gemini', 'gpt'], critic: null, lenses: ['security', 'perf'], stageName: 'stage1',
      }).rows[0].role).toBe('lens:perf');

      // The chair short-circuit still wins before any of it.
      expect(buildLegRows(runDir, ['leg-1'], {
        bench: undefined, critic: null, lenses: ['security'], stageName: 'chair',
      }).rows[0].role).toBe('chair');
    });

    test('a leg with no modelInput is still null, not a guess (pre-existing contract)', () => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = path.join(projectDir, 'run-lc4c');
      const d = legDir(runDir, 'leg-noalias');
      fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({
        taskId: 'leg-noalias', status: 'running', model: 'openai/gpt-5',
      }));
      expect(buildLegRows(runDir, ['leg-noalias'], RUN_CTX).rows[0].role).toBeNull();
    });
  });

  /**
   * v4.4.1 LC-9. Both catches discarded everything, so a corrupt metadata.json,
   * an EACCES on the leg dir, and "the file doesn't exist yet" were
   * indistinguishable and all silent: a leg with corrupt metadata rendered as a
   * just-started leg forever, with nothing in any log to say otherwise.
   *
   * ⚠️ The all-or-nothing catch is a DELIBERATE decision on the record
   * (Appendix A-9) — it mirrors the wave branch. These tests therefore assert
   * BOTH halves: the log now exists, AND the control flow is byte-for-byte the
   * behaviour it was before.
   */
  describe('LC-9: a swallowed read is logged, and ONLY logged', () => {
    let debug;
    beforeEach(() => {
      debug = jest.fn();
      jest.doMock('../../src/utils/logger', () => ({
        logger: { debug, info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      }));
    });
    // Both unmocks live here, NOT at the end of a test body: a failing assertion
    // would skip an in-body dontMock and leak the stubbed module into every test
    // after it (observed while red-checking this suite — the mocked readProgress
    // escaped and broke the unrelated stalled-rollup tests below).
    afterEach(() => {
      jest.dontMock('../../src/utils/logger');
      jest.dontMock('../../src/sidecar/progress');
    });

    test('a CORRUPT metadata.json is logged with its failure code, not silently swallowed', () => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = path.join(projectDir, 'run-lc9a');
      const d = legDir(runDir, 'leg-corrupt');
      fs.writeFileSync(path.join(d, 'metadata.json'), '{ not json at all');

      const { rows } = buildLegRows(runDir, ['leg-corrupt'], RUN_CTX);

      expect(debug).toHaveBeenCalledWith(
        expect.stringMatching(/metadata/i),
        expect.objectContaining({ legId: 'leg-corrupt', error: expect.any(String) }),
      );
      // CONTROL FLOW UNCHANGED: still the all-or-nothing empty-meta row.
      expect(rows[0]).toMatchObject({ taskId: 'leg-corrupt', model: null, status: 'unknown', modelInput: null });
    });

    test('an ABSENT metadata.json is distinguishable from a corrupt one by `code`', () => {
      // The whole point of LC-9: ENOENT is the ordinary just-started leg;
      // anything else is a real fault. Before, both were the same silence.
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = path.join(projectDir, 'run-lc9b');
      legDir(runDir, 'leg-fresh'); // dir exists, no metadata.json

      buildLegRows(runDir, ['leg-fresh'], RUN_CTX);

      const ctx = debug.mock.calls.find((c) => /metadata/i.test(c[0]))[1];
      expect(ctx.code).toBe('ENOENT');
    });

    test('a leg whose PROGRESS read throws is logged, and the row keeps its base fields', () => {
      // readProgress swallows a malformed progress.json itself, so reaching this
      // catch means the leg dir could not be read at all (EACCES, a vanished
      // session dir) — never "hasn't started yet".
      jest.doMock('../../src/sidecar/progress', () => {
        const actual = jest.requireActual('../../src/sidecar/progress');
        return {
          ...actual,
          readProgress: () => { const e = new Error('permission denied'); e.code = 'EACCES'; throw e; },
        };
      });
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = path.join(projectDir, 'run-lc9c');
      const d = legDir(runDir, 'leg-eacces');
      fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({
        taskId: 'leg-eacces', status: 'running', model: 'openai/gpt-5', modelInput: 'gpt',
      }));

      const { rows } = buildLegRows(runDir, ['leg-eacces'], RUN_CTX);

      expect(debug).toHaveBeenCalledWith(
        expect.stringMatching(/progress/i),
        expect.objectContaining({ legId: 'leg-eacces', code: 'EACCES' }),
      );
      // CONTROL FLOW UNCHANGED: base fields only, no progress fields invented.
      expect(rows[0]).toMatchObject({ taskId: 'leg-eacces', status: 'running', role: 'seat' });
      expect(rows[0].stage).toBeUndefined();
      expect(rows[0].messages).toBeUndefined();
      expect(rows[0].stalled).toBeUndefined();
    });

    test('a HEALTHY leg logs nothing (no debug spam on the common path)', () => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const { writeProgress } = require('../../src/sidecar/progress');
      const runDir = path.join(projectDir, 'run-lc9d');
      const d = legDir(runDir, 'leg-ok');
      fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({
        taskId: 'leg-ok', status: 'running', model: 'openai/gpt-5', modelInput: 'gpt',
      }));
      writeProgress(d, 'receiving');

      buildLegRows(runDir, ['leg-ok'], RUN_CTX);
      expect(debug).not.toHaveBeenCalled();
    });
  });

  describe('run-level stalled rollup: "every still-running leg is stalled", not "any leg"', () => {
    function writeStaleProgress(dir, ageMs) {
      const staleTime = new Date(Date.now() - ageMs);
      fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify({
        stage: 'receiving', stageLabel: 'Generating response...', updatedAt: staleTime.toISOString(),
      }));
    }

    test('one stalled leg alongside one ACTIVE running leg does not set the run-level flag', () => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = path.join(projectDir, 'run1');

      // qwen-coder equivalent: running, fresh activity (well under the stall threshold).
      const active = legDir(runDir, 'leg-active');
      fs.writeFileSync(path.join(active, 'metadata.json'), JSON.stringify({
        taskId: 'leg-active', status: 'running', model: 'qwen/coder', modelInput: 'gemini',
      }));
      writeStaleProgress(active, 5000);

      // glm equivalent: running, stale past the stall threshold.
      const stale = legDir(runDir, 'leg-stale');
      fs.writeFileSync(path.join(stale, 'metadata.json'), JSON.stringify({
        taskId: 'leg-stale', status: 'running', model: 'glm/x', modelInput: 'gpt',
      }));
      writeStaleProgress(stale, 95000);

      const out = buildLegRows(runDir, ['leg-active', 'leg-stale'], RUN_CTX);
      const byId = Object.fromEntries(out.rows.map((r) => [r.taskId, r]));

      // Per-leg stalled is unchanged — this is the accurate, per-row signal.
      expect(byId['leg-active'].stalled).toBe(false);
      expect(byId['leg-stale'].stalled).toBe(true);

      // But the run-level rollup must NOT claim the whole run is dead while
      // another seat is visibly active.
      expect(out.stalled).toBeUndefined();
      expect(out.stalledForSeconds).toBeUndefined();
    });

    test('every still-running leg stalled sets the run-level flag, using the SHORTEST idle duration', () => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = path.join(projectDir, 'run1');

      const legA = legDir(runDir, 'leg-a');
      fs.writeFileSync(path.join(legA, 'metadata.json'), JSON.stringify({
        taskId: 'leg-a', status: 'running', model: 'model/a', modelInput: 'gemini',
      }));
      writeStaleProgress(legA, 90000); // ~90s idle

      const legB = legDir(runDir, 'leg-b');
      fs.writeFileSync(path.join(legB, 'metadata.json'), JSON.stringify({
        taskId: 'leg-b', status: 'running', model: 'model/b', modelInput: 'gpt',
      }));
      writeStaleProgress(legB, 300000); // ~300s idle

      const out = buildLegRows(runDir, ['leg-a', 'leg-b'], RUN_CTX);
      expect(out.stalled).toBe(true);
      // Honest reading: how long the WHOLE run has been quiet is the shortest
      // idle duration (leg-a's ~90s), not the longest (leg-b's ~300s) — something
      // happened as recently as leg-a's last activity.
      expect(out.stalledForSeconds).toBeGreaterThanOrEqual(85);
      expect(out.stalledForSeconds).toBeLessThan(150);
    });

    test('a completed leg does not count toward "every still-running leg stalled", and cannot itself force the run stalled', () => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = path.join(projectDir, 'run1');

      // Completed long ago — status 'complete', so this must be excluded from
      // the running-legs population entirely (neither required to be "active"
      // nor allowed to be counted as "stalled").
      const done = legDir(runDir, 'leg-done');
      fs.writeFileSync(path.join(done, 'metadata.json'), JSON.stringify({
        taskId: 'leg-done', status: 'complete', model: 'model/done', modelInput: 'gemini',
      }));
      writeStaleProgress(done, 600000);

      // The only still-running leg is fresh/active.
      const active = legDir(runDir, 'leg-active');
      fs.writeFileSync(path.join(active, 'metadata.json'), JSON.stringify({
        taskId: 'leg-active', status: 'running', model: 'model/active', modelInput: 'gpt',
      }));
      writeStaleProgress(active, 1000);

      const out = buildLegRows(runDir, ['leg-done', 'leg-active'], RUN_CTX);
      expect(out.stalled).toBeUndefined();
    });

    test('no legs are running (all complete, or none started) — run is not "stalled"', () => {
      const { buildLegRows } = require('../../src/observe/council-legs');
      const runDir = path.join(projectDir, 'run1');

      const done = legDir(runDir, 'leg-done');
      fs.writeFileSync(path.join(done, 'metadata.json'), JSON.stringify({
        taskId: 'leg-done', status: 'complete', model: 'model/done', modelInput: 'gemini',
      }));
      writeStaleProgress(done, 600000);

      const out = buildLegRows(runDir, ['leg-done'], RUN_CTX);
      expect(out.stalled).toBeUndefined();
      expect(out.stalledForSeconds).toBeUndefined();
    });
  });
});
