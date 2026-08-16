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

  test('P2 — every consumer import path resolves to that same object', () => {
    // Each consumer requires './run-assemble'; identity through that path is
    // what makes the re-export a move rather than a fork.
    expect(require('../../src/council/run-assemble').buildRunStatsEntry)
      .toBe(require('../../src/council/run-stats-entry').buildRunStatsEntry);
  });

  test('P3 — the module is REQUIRE-FREE, so require-free consumers can import it', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/council/run-stats-entry.js'), 'utf8');
    expect(src.match(/require\(/g)).toBeNull();
  });
});
