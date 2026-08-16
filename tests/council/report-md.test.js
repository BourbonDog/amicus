// tests/council/report-md.test.js
'use strict';

const { toModel } = require('../../src/council/report');

describe('report-md — extraction pins (v4.8 Phase 1 T1.2)', () => {
  // P2 ("the exported renderer is a stable single object": expect(require(X)
  // .renderMd).toBe(renderMd), compared against a `renderMd` this file used to
  // import at its own top level) was deleted, and that now-unused top-level
  // import removed with it (v4.8 Phase 1 T1.2 review, MINOR 5) — the identical
  // defect Task 1's own P2 hit. CommonJS caches by resolved path, so two
  // requires of the same path in the same file returning the same object is a
  // property of `require` itself, not of report-md.js; no edit to this file's
  // source could ever turn it red. The one fact worth keeping — that
  // buildReport's md branch and a direct require of report-md.js resolve to the
  // literal same cached `renderMd` function — is exactly the mechanism P1
  // (tests/council/report.test.js) now documents on itself, where that identity
  // is actually load-bearing for what P1 does and doesn't catch.
  test('P3 — the require cycle survives loading report-md FIRST', () => {
    // report-md requires ./report at load for TIER_ORDER/SYMBOL; report requires
    // ./report-md lazily inside buildReport. Measured, not assumed: under MUTANT
    // "EAGER" (report.js's own require of report-md made top-level instead of
    // lazy), THIS load order — report-md required first — is the one that
    // SURVIVES the cycle (report.js finishes its own top-level code and hands
    // back a complete exports object before report-md's `require('./report')`
    // call returns). The order that actually breaks is report.js-first, which
    // throws "TypeError: TIER_ORDER is not iterable" — this pin does not
    // exercise that order at all; it is covered incidentally by every other
    // test file in this family, all of which require report.js before
    // report-md.js. Named mutant: MUTANT "EAGER".
    jest.resetModules();
    const md = require('../../src/council/report-md');
    expect(typeof md.renderMd).toBe('function');
    // Minimal object, verified empirically (not copied from a fixture): toModel's
    // only throw guard is `!verdict || !Array.isArray(verdict.findings)`
    // (report.js) — every other field it reads (council, seats, runStats,
    // tierCounts, streetCred, degrades, runId, date, chair, runType) has a safe
    // fallback or is never dereferenced further, so `{ findings: [] }` alone
    // passes toModel and renderMd without throwing. toModel is pure (no
    // require() of its own), so the pre-reset binding above is safe to reuse
    // here rather than re-requiring a second './report' instance.
    expect(md.renderMd(toModel({ findings: [] }))).toContain('|');
  });
});
