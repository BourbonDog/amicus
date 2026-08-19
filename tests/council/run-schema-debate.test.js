// tests/council/run-schema-debate.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'schemas');
const load = (name) => JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf-8'));
const ajv = new Ajv({ allErrors: true, strict: false });

const { tally } = require('../../src/council/tally');

describe('council-run schema accepts the debate summary (spec §5.1)', () => {
  const validate = ajv.compile(load('council-run.schema.json'));
  const base = {
    schemaVersion: 2, type: 'council-run', runId: 'aaaa1111', status: 'complete',
    bench: ['gemini', 'gpt', 'qwen'], chair: 'deepseek', critic: null, lenses: null,
    labelMap: { 'Review A': 'gemini' }, options: { timeout: 10, maxCost: 2, gateway: 'auto', outDir: null },
    // The SHIPPED schema pins `usage` to `{"type":"object"}`, so `usage: null` is REJECTED.
    // A finalized run.json carries `usage: {cost}` (run.js `finalize`), not the `usage: null`
    // that `initRun` seeds — `null` here makes every positive case fail for the wrong reason.
    usage: { cost: { amount: 0.42, source: 'reported' } }, createdAt: '2026-07-19T00:00:00.000Z',
    stages: [
      { name: 'stage1', status: 'complete' }, { name: 'stage2', status: 'complete' },
      { name: 'tally-provisional', status: 'complete' }, { name: 'debate-defense', status: 'complete' },
      { name: 'debate-revote', status: 'complete' }, { name: 'tally-final', status: 'complete' },
      { name: 'chair', status: 'complete' }, { name: 'verdict', status: 'complete' },
    ],
    debate: { enabled: true, outcome: 'ran', contested: 1, disputed: 1, defended: 1, amended: 0,
      withdrawn: 1, noResponse: 0, revoteJudges: 2, revoteApplied: 2, verdictChanges: 1 },
  };
  test('valid debate run.json passes', () => {
    expect(validate(base)).toBe(true);
  });
  test('a non-debate run.json (no debate key) still passes', () => {
    // Task 4 writes the `debate` key ONLY when --debate is on, so `debate` must stay OUT of the
    // schema's top-level `required` (spec §5.1: without --debate there is no `debate` key).
    const { debate, ...noDebate } = base;
    expect(validate(noDebate)).toBe(true);
  });
  test('a partially-written debate object (only `enabled`) still passes', () => {
    // Task 4's initRun seed carries `outcome` too, but the schema deliberately requires only
    // `enabled`, so a bare-seed `debate` object left by any partial write still validates —
    // `outcome` must NOT be required (see Step 3).
    expect(validate({ ...base, status: 'aborted', exitCode: 143, debate: { enabled: true } })).toBe(true);
  });
  test('a bad debate.outcome enum is rejected', () => {
    expect(validate({ ...base, debate: { ...base.debate, outcome: 'maybe' } })).toBe(false);
  });
  // 4.1.1 Fix C: run.js now checkpoints debate-revote 'skipped' (not a false
  // 'complete') when the re-vote wave never launched. stages[].status is
  // `{"type":"string"}` with no enum, so this is additive — pinned here so a
  // future tightening of that field to a closed enum can't silently reject it.
  test('a debate-revote stage with status "skipped" still validates (status is not a closed enum)', () => {
    const stages = base.stages.map(s => (s.name === 'debate-revote' ? { name: 'debate-revote', status: 'skipped' } : s));
    expect(validate({ ...base, stages })).toBe(true);
  });
  // M-2 (whole-branch review of 4.1.1): the test above only proved the ACCEPT
  // direction, which `{"type":"string"}` with no enum trivially satisfies for
  // ANY string ('banana' would pass identically) — it stayed green even with
  // the Fix C revert reapplied, so it never actually pinned the validator to
  // this field. This proves the REJECT direction: stages[].status is still
  // typed `string`, so a non-string value must fail validation.
  test('a non-string stages[].status is rejected (proves the validator is actually live on this field)', () => {
    const stages = base.stages.map(s => (s.name === 'debate-revote' ? { name: 'debate-revote', status: 42 } : s));
    expect(validate({ ...base, stages })).toBe(false);
  });
});

describe('council-tally / council-verdict accept findings[].debate (spec §5.6)', () => {
  const vTally = ajv.compile(load('council-tally.schema.json'));
  const vVerdict = ajv.compile(load('council-verdict.schema.json'));
  const tallyDoc = {
    schemaVersion: 2, type: 'council-tally',
    meta: { runId: 'r', runType: 'headless', date: 'd', chair: 'deepseek', models: ['gemini', 'gpt', 'qwen'], claudeInCouncil: true },
    findings: [{ id: 'A1', raiser: 'gemini', severity: 'major', tier: 'Contested', basis: { a: 1, d: 1, n: 0 },
      confidence: 'solid', tierOverride: null, adjudications: [], debate: { action: 'defended', previousTier: 'Disputed' } }],
    rankings: [], streetCred: [], runStats: [], tierCounts: { Confirmed: 0, Contested: 1, Singleton: 0, Disputed: 0 }, judged: true,
  };
  test('claude-in-council + debate-decorated tally validates', () => {
    expect(vTally(tallyDoc)).toBe(true);
  });
  test('verdict with a debate-decorated finding validates', () => {
    const verdict = require('../../src/council/verdict').buildVerdict(tallyDoc, [], { overallVerdict: 'Fix these first' });
    expect(vVerdict(verdict)).toBe(true);
    expect(verdict.findings[0].debate).toEqual({ action: 'defended', previousTier: 'Disputed' });
  });
});

// v4.8 PR3 Task 5: council-tally.schema.json's only `additionalProperties: false`
// is scoped to :62, the `findings[].debate` sub-object — `findings` items and
// `adjudications` (findings[].adjudications items, `{type:'object'}`) are open,
// so `seat`/`raiserSeat` need no schema edit. Pinned here so a future
// tightening of either object fails this test loudly instead of silently
// dropping the fields (the failure mode a plain builder-output check can't see,
// since ajv validate() doesn't strip — it would simply start REJECTING these
// docs, and only a test that puts the fields in the fixture would notice).
describe('council-tally schema genuinely permits seat/raiserSeat (v4.8 PR3 Task 5)', () => {
  // A fresh Ajv instance: the module-level `ajv` above already registered this
  // schema's $id, and ajv rejects re-registering the same $id on one instance.
  const vTally = new Ajv({ allErrors: true, strict: false }).compile(load('council-tally.schema.json'));

  test('a finding carrying raiserSeat and an adjudication carrying seat both validate', () => {
    const tallyDoc = {
      schemaVersion: 2, type: 'council-tally',
      meta: { runId: 'r', runType: 'headless', date: 'd', chair: 'x',
        models: ['deepseek#1', 'deepseek#2'], claudeInCouncil: false },
      findings: [{ id: 'A1', raiser: 'deepseek#1', raiserSeat: 'deepseek#1', severity: 'major',
        tier: 'Contested', basis: { a: 1, d: 1, n: 0 }, confidence: 'solid', tierOverride: null,
        adjudications: [{ judge: 'deepseek#2', verdict: 'agree', seat: 'deepseek#2' }] }],
      rankings: [], streetCred: [], runStats: [],
      tierCounts: { Confirmed: 0, Contested: 1, Singleton: 0, Disputed: 0 }, judged: true,
    };
    expect(vTally(tallyDoc)).toBe(true);
  });
});

// v4.8 PR4c Task 7: the VERDICT-side twin of the pin above, which had no
// equivalent. PR4c added `seats`, `findings[].raiserSeat` and
// `findings[].sameModelCorroboration` to verdict.json, and documented all three
// in council-verdict.schema.json. The schema edit is DOCUMENTARY — neither the
// top level nor the findings items declares `additionalProperties: false`, so the
// keys already validated — which is exactly why it needs a pin: ajv's validate()
// never strips, so a check that does not put the fields IN its fixture cannot see
// a schema that has started rejecting them. Both halves run through the REAL
// buildVerdict, so the pin also fails if the projection stops carrying a key.
// Three named mutants, all measured against this file:
//   1. verdict `seats` retyped `object`  ⇒ the twin verdict test RED
//   2. tally `sameModelCorroboration` retyped `const: false` ⇒ the twin tally test RED
//   3. a future tightening that FORGETS these keys — close `additionalProperties`
//      on the verdict's top level and findings items AND drop the three new
//      declarations ⇒ the twin verdict test RED.
// Mutant 3 is the one this pin exists for, and note what it implies: a tightening
// that keeps the declarations is SAFE. Declaring the keys is what makes closing
// these objects later a non-event for twin-bench documents.
describe('council-verdict schema genuinely permits seats/raiserSeat/sameModelCorroboration (v4.8 PR4c)', () => {
  // A fresh Ajv instance per the note above: the module-level `ajv` already
  // registered these $ids and rejects re-registering one on the same instance.
  const fresh = () => new Ajv({ allErrors: true, strict: false });
  const twinTally = {
    schemaVersion: 2, type: 'council-tally',
    meta: { runId: 'r', runType: 'headless', date: 'd', chair: 'gpt',
      models: ['deepseek', 'deepseek'], claudeInCouncil: false,
      seats: [{ id: 'deepseek#1', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
        { id: 'deepseek#2', alias: 'deepseek', role: 'seat', lens: null, position: 2 }] },
    findings: [{ id: 'A1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major',
      tier: 'Confirmed', basis: { a: 1, d: 0, n: 0 }, confidence: 'thin', tierOverride: null,
      adjudications: [{ judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' }],
      sameModelCorroboration: true }],
    rankings: [], streetCred: [],
    runStats: [{ model: 'deepseek', role: 'seat', wasChair: false, conformance: 'clean',
      seat: 'deepseek#1', status: 'complete', durationMs: null, usage: null }],
    tierCounts: { Confirmed: 1, Contested: 0, Singleton: 0, Disputed: 0 }, judged: true,
  };

  test('the twin-bench TALLY document validates, seat table and stamp included', () => {
    expect(fresh().compile(load('council-tally.schema.json'))(twinTally)).toBe(true);
  });

  test('the verdict buildVerdict derives from it validates, and really carries all five keys', () => {
    const verdict = require('../../src/council/verdict')
      .buildVerdict(twinTally, [], { overallVerdict: 'Ship it' });
    // Guard against a vacuous pin: assert the fields are PRESENT before asserting
    // the schema accepts them. A projection that dropped them would otherwise
    // leave this test green against a schema that forbids them.
    expect(verdict.seats).toEqual(twinTally.meta.seats);
    expect(verdict.findings[0].raiserSeat).toBe('deepseek#1');
    expect(verdict.findings[0].sameModelCorroboration).toBe(true);
    expect(verdict.findings[0].adjudications[0].seat).toBe('deepseek#2');
    expect(verdict.runStats[0].seat).toBe('deepseek#1');
    expect(fresh().compile(load('council-verdict.schema.json'))(verdict)).toBe(true);
  });

  test('a UNIQUE-alias verdict carries none of the three and still validates', () => {
    const unique = JSON.parse(JSON.stringify(twinTally));
    delete unique.meta.seats;
    delete unique.findings[0].raiserSeat;
    delete unique.findings[0].sameModelCorroboration;
    delete unique.findings[0].adjudications[0].seat;
    delete unique.runStats[0].seat;
    unique.meta.models = ['deepseek', 'gpt'];
    const verdict = require('../../src/council/verdict').buildVerdict(unique, []);
    expect('seats' in verdict).toBe(false);
    expect('raiserSeat' in verdict.findings[0]).toBe(false);
    expect('sameModelCorroboration' in verdict.findings[0]).toBe(false);
    expect(fresh().compile(load('council-verdict.schema.json'))(verdict)).toBe(true);
  });
});
// v4.8 Phase 2 T-B2: the same treatment for `findings[].unattributedPeerDrops`,
// the mark this release adds. The schema edit is DOCUMENTARY — `findings` items
// declare no `additionalProperties: false`, so the key already validated —
// which is exactly why it needs a pin: ajv's validate() never strips, so a check
// that does not put the field IN its fixture cannot see a schema that has
// started rejecting it. MEASURED before declaring: a 5-document corpus (three
// pre-T-B2 shapes carrying no such key, two T-B2 shapes carrying `1`) validated
// identically against the schema BEFORE and AFTER the declaration — 0 of 5
// changed verdict — so the declaration alters nothing for existing documents.
//
// Named mutant "SCHEMADROP": close `additionalProperties` on the findings items
// AND delete the `unattributedPeerDrops` declaration — i.e. exactly the future
// tightening that forgets this key. MEASURED against the corpus above: the three
// pre-T-B2 documents are still accepted and BOTH T-B2 documents are REJECTED.
// Then measured again against the FULL suite with SCHEMADROP written into the
// real schema file: 541 suites, EXACTLY 1 test red — the first test below, and
// nothing else. So "the only thing standing between that tightening and a
// silent rejection of every twin-orphan tally.json" is a measurement, not a
// figure of speech. As with PR4c's mutant 3, note the implication: a tightening
// that KEEPS the declaration is safe.
//
// `minimum: 1` is deliberate and mirrors `sameModelCorroboration`'s `const: true`
// — both state the emit-when-set rule in the schema rather than only describing
// it in prose. The producers never emit 0 (`tally.js` and `debate.js` both spell
// `drops > 0 ? … : {}`, pinned by the ZEROEMIT mutant).
//
// ⚠️ NOT declared in `council-verdict.schema.json`, deliberately: the findings
// literal in verdict.js :: buildVerdict is CLOSED — it names every key it
// copies — and it does not copy this one, so no verdict.json can carry it.
// Declaring it there would be a documentary claim about a field that never
// arrives.
describe('council-tally schema genuinely permits unattributedPeerDrops (v4.8 T-B2)', () => {
  const fresh = () => new Ajv({ allErrors: true, strict: false });
  const meta = { runId: 'r', runType: 'headless', date: 'd',
    models: ['deepseek', 'deepseek', 'gpt'], chair: 'gemini', claudeInCouncil: false };

  test('a REAL tally() document carrying the mark validates, and really carries it', () => {
    const doc = tally({
      meta, rankings: [], runStats: [],
      // SI-22.2's shape: the finding has a raiserSeat, the twin's vote has none.
      findings: [{ id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'F1', judge: 'deepseek', verdict: 'agree' }],
    });
    // Guard against a vacuous pin, matching the PR4c test above: assert the
    // field is PRESENT before asserting the schema accepts it. A producer that
    // stopped emitting it would otherwise leave this green against a schema
    // that forbids it.
    expect(doc.findings[0].unattributedPeerDrops).toBe(1);
    expect(fresh().compile(load('council-tally.schema.json'))(doc)).toBe(true);
  });

  test('a document that does not orphan a twin leg omits the key and still validates', () => {
    const doc = tally({
      meta: { ...meta, models: ['gemini', 'gpt'] }, rankings: [], runStats: [],
      findings: [{ id: 'F1', raiser: 'gemini', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'F1', judge: 'gpt', verdict: 'agree' }],
    });
    expect('unattributedPeerDrops' in doc.findings[0]).toBe(false);
    expect(fresh().compile(load('council-tally.schema.json'))(doc)).toBe(true);
  });

  test('the declared shape REJECTS a zero — the emit rule is stated, not just described', () => {
    // The REJECT direction, so the pin proves the validator is live on this
    // field rather than merely permissive. `minimum: 1` is what makes a
    // present-and-zero document (which no producer writes) fail loudly.
    const doc = tally({
      meta, rankings: [], runStats: [],
      findings: [{ id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'F1', judge: 'deepseek', verdict: 'agree' }],
    });
    doc.findings[0].unattributedPeerDrops = 0;
    expect(fresh().compile(load('council-tally.schema.json'))(doc)).toBe(false);
  });
});
