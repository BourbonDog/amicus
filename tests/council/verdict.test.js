// tests/council/verdict.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildVerdict, writeVerdictAtomic } = require('../../src/council/verdict');
const { tally } = require('../../src/council/tally');
const avInput = require('./fixtures/av-receiver-input');

const record = tally(avInput);

test('buildVerdict lifts meta to top-level and stamps schemaVersion', () => {
  const v = buildVerdict(record, []);
  expect(v.schemaVersion).toBe(1);
  expect(v.runId).toBe('av-receiver-council');
  expect(v.chair).toBe('deepseek');
  expect(v.council).toEqual(['deepseek', 'gpt', 'mistral']);
  expect(v.tierCounts).toEqual(record.tierCounts);
});

test('decisions merge per finding; tierOverride rewrites the tier', () => {
  const decisions = [
    { id: 'A3', decision: 'accepted', applied: true, duplicateOf: null,
      tierOverride: { from: 'Singleton', to: 'Confirmed', reason: 'clearly valid' } },
    { id: 'C15', decision: 'accepted', applied: true, duplicateOf: 'A1', tierOverride: null },
  ];
  const v = buildVerdict(record, decisions);
  const a3 = v.findings.find(f => f.id === 'A3');
  expect(a3.tier).toBe('Confirmed');
  expect(a3.tierOverride).toEqual({ from: 'Singleton', to: 'Confirmed', reason: 'clearly valid' });
  expect(a3.decision).toBe('accepted');
  expect(v.findings.find(f => f.id === 'C15').duplicateOf).toBe('A1');
  // untouched findings default cleanly
  expect(v.findings.find(f => f.id === 'A1').decision).toBeNull();
});

test('writeVerdictAtomic writes valid JSON via rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-'));
  const file = path.join(dir, 'verdict.json');
  writeVerdictAtomic(file, buildVerdict(record, []));
  expect(fs.existsSync(file)).toBe(true);
  expect(JSON.parse(fs.readFileSync(file, 'utf-8')).runId).toBe('av-receiver-council');
});
