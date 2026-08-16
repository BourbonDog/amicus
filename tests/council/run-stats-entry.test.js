// tests/council/run-stats-entry.test.js
'use strict';

const fs = require('fs');
const path = require('path');

const asm = require('../../src/council/run-assemble');
const rse = require('../../src/council/run-stats-entry');

describe('run-stats-entry — extraction pins (v4.8 Phase 1 T1.1)', () => {
  test('P1 — re-export is the SAME function object, not a copy', () => {
    expect(asm.buildRunStatsEntry).toBe(rse.buildRunStatsEntry);
  });

  test('P2 — a real consumer\'s own require resolves to the same object', () => {
    // P2 used to just re-require './run-assemble' from THIS file a second
    // time — but CommonJS caches by resolved absolute path, so that was the
    // same cache entry P1 already reads via `asm`, not a second import path
    // (why P1 and P2 failed together, as a pair, under MUTANT COPY). Loading
    // run-chair.js first — a real production consumer with its OWN top-level
    // require('./run-assemble') (run-chair.js:23) — and then re-requiring
    // here proves the identity holds for a genuinely separate file's cached
    // reference, not just this file's.
    require('../../src/council/run-chair.js');
    expect(require('../../src/council/run-assemble').buildRunStatsEntry)
      .toBe(require('../../src/council/run-stats-entry').buildRunStatsEntry);
  });

  test('P3 — the module is REQUIRE-FREE, so require-free consumers can import it', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/council/run-stats-entry.js'), 'utf8');
    expect(src.match(/require\(/g)).toBeNull();
  });
});
