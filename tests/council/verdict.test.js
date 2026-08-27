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
// through, or its producer (computeStreetCred) loses it silently — found by
// measurement, filed nowhere before that task (mirrors the §3.4
// raiserSeat/sameModelCorroboration precedent above). These rows stay
// hand-built (same idiom as :90-94 above) so the CARRY-THROUGH is pinned in
// isolation from the producer. ⚠️ That producer SHIPPED at v4.8 T3.3 —
// street-cred.js :: computeStreetCred — so the reason changed even though the
// fixtures did not: the isolation is no longer "it does not exist yet" but
// "buildVerdict is reachable on records it never touched", amicus_verdict's
// `record: z.record(z.any())` being the live path. The END-TO-END half, driven
// through the real runCouncil, is in seat-parity-ondisk.test.js.
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

  // Fix round 1 (review finding): the distinguishing fixture that was
  // missing — a row where seat === model (the UNIQUE-ALIAS shape a real
  // producer emits) must emit NO seat key. Neither test above can tell
  // emit-when-DIFFERENT apart from emit-when-SET: the first has no seat at
  // all, the one above has a seat that already differs from model. This is
  // the one that can — a mutant reverting to emit-when-SET reds THIS test
  // (verified: see the fix-round-1 note in the module docblock above the
  // streetCred literal).
  test('a row whose seat EQUALS its model (unique-alias shape) emits NO seat key', () => {
    const rec = { meta, findings: [], runStats: [], tierCounts: {},
      streetCred: [{ model: 'deepseek', withSelf: 1.5, peersOnly: 1, seat: 'deepseek' }] };
    const v = buildVerdict(rec, []);
    expect(v.streetCred[0]).toEqual({ model: 'deepseek', withSelf: 1.5, peersOnly: 1 });
    expect('seat' in v.streetCred[0]).toBe(false);
  });

  test('the real producer chain (unique-alias fixture at the top of this file) stays byte-identical', () => {
    // `record` is tally(avInput)'s OWN output. ⚠️ The reason it carries no
    // seat MOVED at v4.8 T3.3 and the assertion did not: computeStreetCred
    // emits `seat` now, but avInput is a UNIQUE-ALIAS fixture with no
    // `meta.seats`, so every row's seat id would be its own alias and the
    // emit-when-DIFFERENT guard keeps the field absent. Still the byte-identity
    // control the task is judged on, driven through the real producer rather
    // than a hand-built stand-in — and now a live one rather than a vacuous one.
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

// v4.9 W5.3: buildVerdict forwards the tally record's meta.intent — the same
// emit-when-'task' idiom as run.json and meta (spec §5.3 as amended by the
// W4/W5 plan's §7.5 byte-identity ruling). The verdict literal is a RENAMING
// projection (see T10 above), so without an explicit line the key can never
// arrive; and a review record must never materialize it.
describe("v4.9 W5.3: verdict.intent — emit-when-'task', forwarded from meta", () => {
  const withIntent = (intent) =>
    tally({ ...avInput, meta: { ...avInput.meta, intent } });

  test("record.meta.intent === 'task' → top-level intent:'task' on the VERDICT document", () => {
    expect(buildVerdict(withIntent('task'), []).intent).toBe('task');
  });

  test('a review record (no meta.intent) carries NO intent key — `in`, not toBeUndefined', () => {
    const v = buildVerdict(record, []);
    expect('intent' in v).toBe(false);
    expect(JSON.stringify(v, null, 2)).not.toContain('"intent"');
  });

  test("an explicit meta.intent 'review' (hand-assembled input) is NOT forwarded — emit-when-task only", () => {
    expect('intent' in buildVerdict(withIntent('review'), [])).toBe(false);
  });
});

/**
 * #202 — the honest seat count on the published verdict.
 *
 * MEASURED, CI run 4424218c: a TWO-seat bench published `streetCred` for all
 * four requested models, with the two dead seats rendered as `n/a` — visually
 * indistinguishable from the legend's "neutral". The sticky comment's footer
 * prints `models: ${MODELS}`, which is the bench that was ASKED FOR, and
 * `deriveSeatLoss` returns null whenever no `--critic` was requested
 * (verdict-seat-loss.js), which is every CI run — so `seatLoss` is structurally
 * absent there. Nothing in the artifact said the verdict rested on half a bench.
 *
 * The count is DERIVED, never passed in: `runStats` already carries one
 * `role:'seat'` row per bench seat, post-retry, with the leg's own status. A
 * first attempt that was retried is `role:'superseded'` and must not be counted
 * twice; judges, chair and repairs are not bench seats at all.
 */
describe('#202 — verdict.json publishes seats reviewed of seats benched', () => {
  const meta = { runId: 'r', runType: 'review', date: 'd', models: ['glm', 'qwen', 'gpt'],
    chair: 'deepseek', claudeInCouncil: false };
  const seatRow = (model, status) => ({ model, role: 'seat', wasChair: false,
    conformance: 'clean', status, durationMs: 1, usage: null });
  const build = (runStats) => buildVerdict(tally({
    meta, findings: [], rankings: [], adjudications: [], runStats }));

  test('V1 a full bench reports every seat reviewed', () => {
    const v = build([seatRow('glm', 'complete'), seatRow('qwen', 'complete'),
      seatRow('gpt', 'complete')]);
    expect(v.seatsReviewed).toEqual({ reviewed: 3, of: 3 });
  });

  test('V2 a dead seat is subtracted — this is the number W11 never published', () => {
    const v = build([seatRow('glm', 'error'), seatRow('qwen', 'complete'),
      seatRow('gpt', 'complete')]);
    expect(v.seatsReviewed).toEqual({ reviewed: 2, of: 3 });
  });

  test('V3 only BENCH seats count — superseded, judge, chair and repair rows do not', () => {
    const other = (model, role, status) => ({ model, role, wasChair: false,
      conformance: 'clean', status, durationMs: 1, usage: null });
    const v = build([
      seatRow('glm', 'complete'), seatRow('qwen', 'complete'),
      other('glm', 'superseded', 'error'),   // glm's FIRST attempt, retried and healed
      other('gpt', 'judge', 'complete'),
      other('deepseek', 'chair', 'complete'),
      other('qwen', 'repair', 'complete'),
    ]);
    expect(v.seatsReviewed).toEqual({ reviewed: 2, of: 2 });
  });

  test('V4 a timeout counts as not-reviewed, same as an error', () => {
    const v = build([seatRow('glm', 'timeout'), seatRow('gpt', 'complete')]);
    expect(v.seatsReviewed).toEqual({ reviewed: 1, of: 2 });
  });

  test('V6 a NON-ARRAY runStats is tolerated — buildVerdict takes permissive records', () => {
    // Regression pin. buildVerdict is reachable on externally-supplied records
    // that never touched tally() in-process: mcp-tools.js :: amicus_verdict
    // types `record` as `z.record(z.any())`, and verdict-seat-loss.test.js's own
    // fixture hands it `runStats: {}`. A `runStats || []` guard passes a truthy
    // non-array straight through to `.filter` and throws, so a missing census
    // became a CRASHED verdict build — four reds in that file, none of them
    // about seats.
    for (const bad of [{}, 'runStats', 42, true]) {
      const v = buildVerdict({ meta, findings: [], streetCred: [], tierCounts: {}, runStats: bad });
      expect(`${JSON.stringify(bad)} -> ${'seatsReviewed' in v}`)
        .toBe(`${JSON.stringify(bad)} -> false`);
    }
  });

  test('V5 a run with no bench rows at all emits nothing rather than 0 of 0', () => {
    // `0 of 0` would read as a measurement of an empty bench. Absence keeps its
    // one meaning, matching every other emit-when-set field on this document.
    const v = build([]);
    expect('seatsReviewed' in v).toBe(false);
  });
});
