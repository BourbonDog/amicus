// tests/council/report-md.test.js
'use strict';

const { toModel } = require('../../src/council/report');
const { renderMd } = require('../../src/council/report-md');

describe('report-md — extraction pins (v4.8 Phase 1 T1.2)', () => {
  test('P2 — the exported renderer is a stable single object', () => {
    expect(require('../../src/council/report-md').renderMd).toBe(renderMd);
  });

  test('P3 — the require cycle survives loading report-md FIRST', () => {
    // report-md requires ./report at load for TIER_ORDER/SYMBOL; report requires
    // ./report-md lazily inside buildReport. Loading report-md first is the order
    // that breaks if either side becomes eager. Named mutant: MUTANT "EAGER".
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
