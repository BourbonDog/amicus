// tests/models-drift.test.js
'use strict';

const { buildFallbackDriftReport } = require('../src/sidecar/models');

const row = id => ({ id });

describe('buildFallbackDriftReport', () => {
  test('reports families whose pinned openrouter fallback is behind the live pick', () => {
    const catalog = [row('openrouter/google/gemini-9.9-flash')];
    const lines = buildFallbackDriftReport(catalog);
    expect(lines.some(l => l.includes('gemini') && l.includes('openrouter/google/gemini-9.9-flash'))).toBe(true);
  });
  test('silent when fallbacks match the live resolution or catalog is empty', () => {
    expect(buildFallbackDriftReport([])).toEqual([]);
    const { getFamilies } = require('../src/utils/curated-models');
    const current = getFamilies().map(f => row(f.fallback.openrouter));
    expect(buildFallbackDriftReport(current)).toEqual([]);
  });
});
