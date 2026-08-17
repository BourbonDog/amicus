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
