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

// v4.8 PR4c §3.4 — the two finding fields tally() stamps have to survive
// buildVerdict's finding literal, which is CLOSED: it names eleven keys and
// copies nothing else off `f`. Measured at HEAD on a real twin run, both fields
// are present on tally.json's findings and absent from verdict.json's.
//
// Each assertion below names the DOCUMENT it reads, because that is exactly the
// distinction the plan's own coverage gap turned on: every stamp test written
// for §3.3 reads the TALLY record, so deleting the carry-through from
// verdict.js left all of them green.
describe('v4.8 PR4c §3.4: findings[] carry raiserSeat and sameModelCorroboration', () => {
  const meta = { runId: 'r', runType: 'headless', date: 'd',
    models: ['deepseek', 'deepseek', 'gpt'], chair: 'gemini', claudeInCouncil: false };

  // The TALLY document — the SOURCE of both fields, driven through the real
  // tally() rather than hand-stamped, so a change to either emit rule shows up
  // here instead of being papered over by a literal.
  const twin = tally({
    meta, rankings: [], runStats: [],
    findings: [{ id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major', claim: 'c' }],
    adjudications: [{ findingId: 'F1', judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' }],
  });

  // The TALLY document for a unique-alias bench: neither field is emitted, which
  // is the shape every legacy and every non-twin run produces.
  const legacy = tally({
    meta: { ...meta, models: ['gemini', 'gpt'] }, rankings: [], runStats: [],
    findings: [{ id: 'F1', raiser: 'gemini', severity: 'major', claim: 'c' }],
    adjudications: [{ findingId: 'F1', judge: 'gpt', verdict: 'agree' }],
  });

  test('T11a: raiserSeat survives the projection into the VERDICT document', () => {
    expect(twin.findings[0].raiserSeat).toBe('deepseek#1');                 // TALLY document
    expect(buildVerdict(twin, []).findings[0].raiserSeat).toBe('deepseek#1'); // VERDICT document
  });

  test('T6c: sameModelCorroboration survives into the VERDICT document', () => {
    expect(twin.findings[0].sameModelCorroboration).toBe(true);             // TALLY document
    const f = buildVerdict(twin, []).findings[0];                           // VERDICT document
    expect(f.sameModelCorroboration).toBe(true);
    // …and after serialization, which is the form a consumer actually reads.
    expect(JSON.parse(JSON.stringify(buildVerdict(twin, []))).findings[0]
      .sameModelCorroboration).toBe(true);
  });

  test('T11c: absent stays ABSENT — the `|| null` idiom is refused', () => {
    // `JSON.stringify({...f, raiserSeat: null})` still WRITES `"raiserSeat":`,
    // so `|| null` would change the shape of every unique-alias verdict.json.
    // `toBeUndefined()` cannot see the difference; `in` and the serialized text
    // can.
    expect('raiserSeat' in legacy.findings[0]).toBe(false);                 // TALLY document
    const f = buildVerdict(legacy, []).findings[0];                         // VERDICT document
    expect('raiserSeat' in f).toBe(false);
    expect('sameModelCorroboration' in f).toBe(false);
    const text = JSON.stringify(f, null, 2);
    expect(text).not.toContain('"raiserSeat":');
    expect(text).not.toContain('"sameModelCorroboration":');
  });

  test('both are a pure TAIL — the shipped eleven-key finding order is untouched', () => {
    expect(Object.keys(buildVerdict(legacy, []).findings[0])).toEqual(
      ['id', 'raiser', 'severity', 'tier', 'basis', 'confidence', 'tierOverride',
        'duplicateOf', 'adjudications', 'decision', 'applied']);
    expect(Object.keys(buildVerdict(twin, []).findings[0])).toEqual(
      ['id', 'raiser', 'severity', 'tier', 'basis', 'confidence', 'tierOverride',
        'duplicateOf', 'adjudications', 'decision', 'applied',
        'raiserSeat', 'sameModelCorroboration']);
  });
});

// v4.8 T3.2: verdict.js's CLOSED streetCred literal must carry a seat
// through, or a future producer (computeStreetCred, T3.3) loses it silently —
// found by measurement, filed nowhere before this task (mirrors the §3.4
// raiserSeat/sameModelCorroboration precedent above). computeStreetCred does
// not emit `.seat` yet, so these rows are hand-built (same idiom as :90-94
// above) to prove the CARRY-THROUGH in isolation from its future producer.
describe('v4.8 T3.2: streetCred[].seat survives the closed verdict literal', () => {
  const meta = { runId: 'r', runType: 'headless', date: 'd',
    models: ['deepseek', 'deepseek'], chair: 'gemini', claudeInCouncil: false };

  test('a seat-carrying row keeps its seat in the VERDICT document', () => {
    const rec = { meta, findings: [], runStats: [], tierCounts: {},
      streetCred: [{ model: 'deepseek', withSelf: 1.5, peersOnly: 1, seat: 'deepseek#1' }] };
    const v = buildVerdict(rec, []);
    expect(v.streetCred[0]).toEqual({ model: 'deepseek', withSelf: 1.5, peersOnly: 1, seat: 'deepseek#1' });
  });

  test("a row with no seat (today's only shape) emits NO seat key — byte-identity", () => {
    const rec = { meta, findings: [], runStats: [], tierCounts: {},
      streetCred: [{ model: 'deepseek', withSelf: 1.5, peersOnly: 1 }] };
    const v = buildVerdict(rec, []);
    expect(v.streetCred[0]).toEqual({ model: 'deepseek', withSelf: 1.5, peersOnly: 1 });
    expect('seat' in v.streetCred[0]).toBe(false);
  });

  test('the real producer chain (unique-alias fixture at the top of this file) stays byte-identical', () => {
    // `record` is tally(avInput)'s OWN output — computeStreetCred emits no
    // seat yet (T3.3), so this is the byte-identity control the whole task is
    // judged on, driven through the real producer, not a hand-built stand-in.
    const v = buildVerdict(record, []);
    for (const s of v.streetCred) { expect('seat' in s).toBe(false); }
  });
});

test('writeVerdictAtomic writes valid JSON via rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-'));
  const file = path.join(dir, 'verdict.json');
  writeVerdictAtomic(file, buildVerdict(record, []));
  expect(fs.existsSync(file)).toBe(true);
  expect(JSON.parse(fs.readFileSync(file, 'utf-8')).runId).toBe('av-receiver-council');
});
