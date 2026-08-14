// tests/council/verdict.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildVerdict, writeVerdictAtomic } = require('../../src/council/verdict');
const { tally } = require('../../src/council/tally');
const asm = require('../../src/council/run-assemble');
const { buildSeats } = require('../../src/council/seats');
const avInput = require('./fixtures/av-receiver-input');

const record = tally(avInput);

test('buildVerdict lifts meta to top-level and stamps the v2 envelope (v4.0 §7)', () => {
  const v = buildVerdict(record, []);
  expect(v.schemaVersion).toBe(2);
  expect(v.type).toBe('council-verdict');
  expect(v.overallVerdict).toBeNull();
  expect(v.runId).toBe('av-receiver-council');
  expect(v.chair).toBe('deepseek');
  expect(v.council).toEqual(['deepseek', 'gpt', 'mistral']);
  expect(v.tierCounts).toEqual(record.tierCounts);
});

test('opts.overallVerdict populates the chair verdict (Plan-B engine hook)', () => {
  const v = buildVerdict(record, [], { overallVerdict: 'Ship it' });
  expect(v.overallVerdict).toBe('Ship it');
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

// T10 (v4.8 PR4c §3.2) — buildVerdict's return literal is an explicit RENAMING projection
// (meta.models → council), so nothing from meta arrives that is not named
// there. Driven end-to-end through the real producer chain
// buildTallyInput → tally → buildVerdict, because that is where the key has to
// survive: tally copies meta by reference, verdict re-projects it.
// ⚠️ The absent half MUST use `in`. Measured: `expect(v.seats).toBeUndefined()`
// and a JSON.stringify needle are BOTH green against an unconditional
// `seats: record.meta.seats`, which writes `"seats": undefined` — a key that
// vanishes from the JSON and reads as undefined, while `'seats' in v` is true.
describe('v4.8 PR4c T10: verdict.seats', () => {
  const mk = (bench) => buildVerdict(tally(asm.buildTallyInput({
    runId: 'r', date: 'd', bench, chair: 'x', reviews: [], judgeResults: [],
    chairStats: null, seats: buildSeats(bench, null, null),
  })), []);

  test('a twin bench carries the seat table, immediately after council', () => {
    const v = mk(['deepseek', 'deepseek', 'gpt']);
    expect(v.seats).toEqual(buildSeats(['deepseek', 'deepseek', 'gpt'], null, null));
    const keys = Object.keys(v);
    expect(keys[keys.indexOf('council') + 1]).toBe('seats');
    expect(keys[keys.indexOf('seats') + 1]).toBe('claudeInCouncil');
  });

  test('a unique-alias bench carries NO seats key at all', () => {
    expect('seats' in mk(['deepseek', 'gpt'])).toBe(false);
  });
});

test('writeVerdictAtomic writes valid JSON via rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-'));
  const file = path.join(dir, 'verdict.json');
  writeVerdictAtomic(file, buildVerdict(record, []));
  expect(fs.existsSync(file)).toBe(true);
  expect(JSON.parse(fs.readFileSync(file, 'utf-8')).runId).toBe('av-receiver-council');
});
