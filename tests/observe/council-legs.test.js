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
