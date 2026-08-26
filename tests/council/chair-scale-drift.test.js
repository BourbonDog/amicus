// tests/council/chair-scale-drift.test.js
'use strict';

/**
 * v4.9 W7 T-A — THE TWO CHAIR SCALES, AND EVERY SPELLING OF EACH (memo trap 2).
 *
 * The review scale already existed as TWO independent constants — the briefing
 * side (src/council/briefings-chair.js :: CHAIR_VERDICT_VALUES) and the parser
 * side (src/council/parse-stage2.js :: CHAIR_VERDICTS) — with nothing tying
 * them together: skew either one and the chair is asked for a phrase the
 * parser cannot read, which degrades the run to overallVerdict null AFTER the
 * whole bench has been paid for. The ANSWER scale ships with the same two-copy
 * shape, so this suite pins BOTH pairs, plus the two further spellings each
 * scale has in prose (the scale addendum and the repair prompt) and the fifth
 * one in schemas/council-verdict.schema.json's enum.
 *
 * ── NAMED MUTANT "ANSWERSCALEDRIFT" ────────────────────────────────────────
 * MUTATION: skew ONE copy of the ANSWER constants — in
 * src/council/parse-stage2.js, `const CHAIR_ANSWERS = ['Converged', 'Split',
 * 'Insufficient']` becomes `['Converge', 'Split', 'Insufficient']` (the
 * briefing side, the addendum prose and the repair prompt keep saying
 * "Converged"). This is the exact production failure the pins exist for: a
 * task chair emits the phrase it was asked for and the parser reads null.
 * MEASURED red set: recorded at the bottom of this file, with its denominator
 * and the scope it was taken at.
 * ⚠️ RE-RUN, NEVER RENUMBER (house rule, tests/council/chair-packet-seat-mutants.js).
 */

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const chair = require('../../src/council/briefings-chair');
const chairTask = require('../../src/council/briefings-chair-task');
const parse = require('../../src/council/parse-stage2');
const { tally } = require('../../src/council/tally');
const { buildVerdict } = require('../../src/council/verdict');
const avInput = require('./fixtures/av-receiver-input');

const SCHEMA = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'schemas', 'council-verdict.schema.json'), 'utf-8'));
const verdictEnum = () => SCHEMA.properties.overallVerdict.oneOf
  .find(s => Array.isArray(s.enum)).enum;

describe('the two chair scales never drift between their independent copies', () => {
  test('review: the briefing constant and the parser constant are the same list', () => {
    expect(chair.CHAIR_VERDICT_VALUES).toEqual(parse.CHAIR_VERDICTS);
  });

  test('task: the briefing constant and the parser constant are the same list', () => {
    expect(chairTask.CHAIR_ANSWER_VALUES).toEqual(parse.CHAIR_ANSWERS);
  });

  test('the two scales are DISJOINT — no phrase can be read as both', () => {
    const shared = parse.CHAIR_VERDICTS.filter(v => parse.CHAIR_ANSWERS.includes(v));
    expect(shared).toEqual([]);
  });

  test('every review phrase reaches the chair as a VERDICT line and parses back', () => {
    for (const v of parse.CHAIR_VERDICTS) {
      expect(chair.VERDICT_SCALE_ADDENDUM).toContain(`VERDICT: ${v}`);
      expect(chair.buildChairRepairPrompt({ synthesis: 'S.' })).toContain(`VERDICT: ${v}`);
      expect(parse.parseChairVerdict(`VERDICT: ${v}`)).toBe(v);
    }
  });

  test('every task phrase reaches the chair as an ANSWER line and parses back', () => {
    for (const a of parse.CHAIR_ANSWERS) {
      expect(chairTask.ANSWER_SCALE_ADDENDUM).toContain(`ANSWER: ${a}`);
      expect(chairTask.buildTaskChairRepairPrompt({ synthesis: 'S.' })).toContain(`ANSWER: ${a}`);
      expect(parse.parseChairAnswer(`ANSWER: ${a}`)).toBe(a);
    }
  });

  test('neither addendum offers a phrase from the other scale', () => {
    for (const a of parse.CHAIR_ANSWERS) {
      expect(chair.VERDICT_SCALE_ADDENDUM).not.toContain(a);
    }
    for (const v of parse.CHAIR_VERDICTS) {
      expect(chairTask.ANSWER_SCALE_ADDENDUM).not.toContain(v);
    }
  });
});

/**
 * The FIFTH spelling: schemas/council-verdict.schema.json enum-pins
 * overallVerdict, and that field now carries either scale's phrase — a task
 * run's `Converged` is as valid a value as a review run's `Ship it`. An
 * un-widened enum makes every task verdict.json invalid against its own
 * published schema.
 */
describe('the published verdict schema carries BOTH scales', () => {
  test('the enum is exactly the review scale followed by the task scale', () => {
    expect(verdictEnum()).toEqual([...parse.CHAIR_VERDICTS, ...parse.CHAIR_ANSWERS]);
  });

  test('a real task verdict doc carrying an ANSWER phrase validates', () => {
    const record = tally(avInput);
    const taskRecord = { ...record, meta: { ...record.meta, intent: 'task' } };
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(SCHEMA);
    for (const a of parse.CHAIR_ANSWERS) {
      const doc = buildVerdict(taskRecord, [], { overallVerdict: a });
      const ok = validate(doc);
      if (!ok) {
        throw new Error(`schema rejected overallVerdict '${a}':\n`
          + JSON.stringify(validate.errors, null, 2));
      }
      expect(doc.intent).toBe('task');
    }
  });

  test('a review verdict doc still validates for every review phrase, and null', () => {
    const record = tally(avInput);
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(SCHEMA);
    for (const v of [...parse.CHAIR_VERDICTS, null]) {
      expect(validate(buildVerdict(record, [], { overallVerdict: v }))).toBe(true);
    }
  });

  test('a phrase from neither scale is still rejected — widened, not opened', () => {
    const record = tally(avInput);
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(SCHEMA);
    expect(validate(buildVerdict(record, [], { overallVerdict: 'Converge' }))).toBe(false);
  });
});

// ── ANSWERSCALEDRIFT: the measured red set ───────────────────────────────────
//
// DENOMINATOR: tests/council/ plus tests/schemas.test.js — 94 suites / 1756
// tests, `npx jest tests/council tests/schemas.test.js --no-coverage
// --maxWorkers=2`, measured 2026-08-25 at the T-A working tree. NOT a full-tree
// run (T-A was scoped to focused suites); the wave lead's whole-suite gate is
// the place to widen this, and a re-measure there can only ADD suites.
//
// MEASURED red set: 7 suites / 14 tests, out of 94 / 1756. By suite:
//   chair-scale-drift 3 —
//     "task: the briefing constant and the parser constant are the same list"
//     "the enum is exactly the review scale followed by the task scale"
//     "a real task verdict doc carrying an ANSWER phrase validates"
//   parse-stage2 2 · briefings-chair-task 1 · run-chair 3 ·
//   run-stage1-task-dispatch 2 · run-intent 2 · run-finish-ledger-gate 1.
//
// ⚠️ FOUR of those seven suites are not about the scale at all — they are the
// W5/W6 task-run drivers, and they red for the reason that makes this mutant
// worth having: a task chair whose phrase the parser cannot read leaves the run
// with NO terminal line, so it buys a ch4 repair their scripts never expected.
// The skew is not a tidy constant mismatch; it is a paid, degraded run.
//
// ⚠️ The set is 14 rather than ~20 because the mutation skews ONE phrase
// ('Converged' → 'Converge'). Fixtures that answer `ANSWER: Split` stay green
// by construction — including the ch4-repair e2e — which is the honest shape of
// a one-phrase drift and the reason the drift pins compare whole LISTS.
