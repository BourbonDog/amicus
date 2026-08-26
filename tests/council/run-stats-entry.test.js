// tests/council/run-stats-entry.test.js
'use strict';

const fs = require('fs');
const path = require('path');

const asm = require('../../src/council/run-assemble');
const rse = require('../../src/council/run-stats-entry');

describe('run-stats-entry — extraction pins (v4.8 Phase 1 T1.1)', () => {
  test('P1 — re-export is the SAME function object, not a copy', () => {
    // Every production consumer (run-chair.js:23, run-stage1-rows.js:9,
    // run-stage2.js:26, run-stages.js:27, run-stage1-superseded.js — added by the v4.8 T-A6
    // split, and deliberately carrying NO line number so it cannot rot — run-finish.js
    // via `asm.`) writes
    // require('./run-assemble') — a different specifier string than `asm`
    // above, but CommonJS resolves both to the same absolute path and
    // caches by resolved path: one entry, shared by every requirer, no
    // resetModules in this project's jest config. So this identity check
    // covers every consumer's own spelling of the require — there is no
    // second, independently-testable import path for a separate pin to add.
    expect(asm.buildRunStatsEntry).toBe(rse.buildRunStatsEntry);
  });

  test('P3 — the module is REQUIRE-FREE, so require-free consumers can import it', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/council/run-stats-entry.js'), 'utf8');
    expect(src.match(/require\(/g)).toBeNull();
  });
});

/**
 * v4.9 W13 Task A — the TTFT probe's last hop: the runStats row.
 *
 * `ttftMs` is read off the LEG run document (buildRunResult already carries it
 * when set), exactly the way `waveId` and `resolvedModel` are, so every one of
 * the ten `buildRunStatsEntry({...})` call sites that holds a leg gets it with
 * no caller change and none can be forgotten. See the DEVIATION note on the
 * production side for why that shape was chosen over a threaded parameter.
 *
 * PROBE ONLY: nothing in the engine derives a backstop, a threshold, or a
 * routing decision from this number. It exists so the C2 derivation has real
 * observations to work from later (W13 R12: probe first, derive later).
 *
 * Named mutant TTFTDROP — delete the `ttftMs` emit from
 * `src/headless.js`'s poll loop (the `if (ttftMs === null && substantiveActivity)`
 * line) so the measure never records. Its measured red set is recorded beside
 * the measure itself, in tests/no-output-backstop-wiring.test.js. These rows
 * stay GREEN under it BY DESIGN: they take a leg document as INPUT and never
 * run headless, so they pin the carry, not the measure. Do not "fix" them to
 * red here.
 */
describe('run-stats-entry — the TTFT probe rides the row (v4.9 W13 Task A)', () => {
  const legWith = (extra) => ({ model: 'openrouter/x/y', status: 'complete', durationMs: 42, usage: null, ...extra });

  test('a leg carrying ttftMs stamps it verbatim on the row', () => {
    const row = rse.buildRunStatsEntry({
      leg: legWith({ ttftMs: 1234 }), model: 'alias', role: 'reviewer', wasChair: false,
    });
    expect(row.ttftMs).toBe(1234);
  });

  test('zero survives — a first substantive tick inside the first poll is a real measurement, not an absence', () => {
    const row = rse.buildRunStatsEntry({
      leg: legWith({ ttftMs: 0 }), model: 'alias', role: 'reviewer', wasChair: false,
    });
    expect(row.ttftMs).toBe(0);
    expect('ttftMs' in row).toBe(true);
  });

  // The absence pin. A row built from a leg that produced nothing must be
  // byte-identical to the pre-W13 row — key set and all — so every existing
  // review/task/legacy tally artifact is unchanged when the field is absent.
  test('ABSENCE: a leg with no ttftMs yields a row with NO ttftMs key at all', () => {
    const row = rse.buildRunStatsEntry({
      leg: legWith({}), model: 'alias', role: 'reviewer', wasChair: false,
    });
    expect('ttftMs' in row).toBe(false);
    expect(Object.keys(row)).toEqual([
      'model', 'role', 'wasChair', 'conformance', 'resolvedModel', 'status', 'durationMs', 'usage',
    ]);
  });

  test('ABSENCE: a dead seat (leg: null) carries no ttftMs key', () => {
    const row = rse.buildRunStatsEntry({ leg: null, model: 'alias', role: 'reviewer', wasChair: false });
    expect('ttftMs' in row).toBe(false);
    expect(Object.keys(row)).toEqual(['model', 'role', 'wasChair', 'conformance', 'status', 'durationMs', 'usage']);
  });

  test('ABSENCE: a non-number ttftMs (null / string from a hand-edited artifact) is dropped, never echoed', () => {
    for (const bad of [null, undefined, '1234', {}]) {
      const row = rse.buildRunStatsEntry({
        leg: legWith({ ttftMs: bad }), model: 'alias', role: 'reviewer', wasChair: false,
      });
      expect('ttftMs' in row).toBe(false);
    }
  });
});
