'use strict';
const { tally } = require('../../src/council/tally');
const { buildVerdict } = require('../../src/council/verdict');
const { buildReport } = require('../../src/council/report');
const avInput = require('./fixtures/av-receiver-input');

function verdictFixture() {
  const record = tally(avInput);
  return buildVerdict(record, [{ id: 'C6', decision: 'denied', applied: false }]);
}

describe('buildReport markdown', () => {
  const md = buildReport({ verdict: verdictFixture() }, { format: 'md' });
  test('has a titled header with run metadata', () => {
    expect(md).toContain('# Council Report');
    expect(md).toContain('av-receiver-council');
  });
  test('renders the adjudication matrix with judge columns', () => {
    expect(md).toContain('Adjudication matrix');
    for (const judge of ['deepseek', 'gpt', 'mistral']) { expect(md).toContain(judge); }
  });
  test('renders the tier counts (peers-only, WS-3 golden)', () => {
    expect(md).toContain('Confirmed');
    expect(md).toMatch(/Disputed[^\n]*\|\s*3/);
  });
  test('groups findings by tier, Disputed-first, and shows the decision', () => {
    const disputedIdx = md.indexOf('### Disputed');
    const singletonIdx = md.indexOf('### Singleton');
    expect(disputedIdx).toBeGreaterThan(-1);
    expect(disputedIdx).toBeLessThan(singletonIdx);
    expect(md).toContain('C6'); // a Disputed finding, decided "denied"
    expect(md).toContain('denied');
  });
  test('renders a street-cred table and a cost table (no invented numbers)', () => {
    expect(md).toContain('Street-cred');
    expect(md).toContain('Cost');
    expect(md).toContain('—'); // av-receiver runStats.usage is null → em dash
  });
});

describe('buildReport html', () => {
  const html = buildReport({ verdict: verdictFixture() }, { format: 'html' });
  test('is a self-contained document with inline styles and a table', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<style');
    expect(html).toContain('<table');
    expect(html).toContain('av-receiver-council');
  });
});

describe('buildReport guards', () => {
  test('throws on a verdict missing findings', () => {
    expect(() => buildReport({ verdict: { runId: 'x' } }, { format: 'md' })).toThrow();
  });
});
