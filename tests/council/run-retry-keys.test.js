// tests/council/run-retry-keys.test.js
'use strict';

const fs = require('fs');
const path = require('path');

const grp = require('../../src/council/run-retry-group');
const keys = require('../../src/council/run-retry-keys');

describe('run-retry-keys — extraction pins (v4.8 Phase 2 T-A1)', () => {
  test('P1 — each re-export is the SAME function object as the leaf module\'s, not a copy', () => {
    // The four names moved out of run-retry-group.js byte-for-byte and are required
    // back and re-exported, so no caller's import path changed. Every consumer spells
    // its require differently — run-retry.js:27 and run-stage1-rows.js:14 write
    // './run-retry-group', the suites write '../../src/council/run-retry-group' — but
    // CommonJS resolves all of them to one absolute path and caches by resolved path
    // (this project's jest config sets no resetModules), so one identity check per
    // name covers every consumer's own spelling. There is no second, independently
    // testable import path for a separate pin to add.
    //
    // Named mutant "COPYKEY": in run-retry-group.js, drop one name from the require
    // and re-inline its definition instead (`const seatKey = (s, alias) => (s ? s.id
    // : alias);`) and this goes RED. Behaviour is unchanged under that mutant and
    // every other suite stays green — a duplicated copy is exactly what an identity
    // pin catches and a `typeof === 'function'` check does not.
    expect(grp.seatKey).toBe(keys.seatKey);
    expect(grp.twinAliases).toBe(keys.twinAliases);
    expect(grp.legLossKey).toBe(keys.legLossKey);
    expect(grp.srcLegClaimer).toBe(keys.srcLegClaimer);
  });

  test('P2 — the module\'s source contains no `require(`, so it stays the leaf', () => {
    // Three separate comments now rest their cycle-safety claim on this file being
    // require-free: its own header, run-retry-group.js:5, and run-stage1-rows.js:10-13.
    // A require added here would falsify all three silently, so the property is pinned
    // rather than merely asserted in prose. Same idiom and same rationale as
    // tests/council/run-stats-entry.test.js:23-27.
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/council/run-retry-keys.js'), 'utf8');
    expect(src.match(/require\(/g)).toBeNull();
  });
});
