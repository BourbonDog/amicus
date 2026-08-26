// tests/schemas-degrades-lockstep.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const { classifyChairAttempt } = require('../src/council/run-chair');
const { mkLeg } = require('./council/helpers/fake-launchers');

const SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');

function readSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, `${name}.schema.json`), 'utf-8'));
}

/** Recursively strip every `description` key — the per-schema prose legitimately differs. */
function stripDescriptions(node) {
  if (Array.isArray(node)) { return node.map(stripDescriptions); }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k !== 'description') { out[k] = stripDescriptions(v); }
    }
    return out;
  }
  return node;
}

// v4.6 Plan 4 Task 6a: council-run/council-verdict/doctor each publish their
// own degrades[] block, hand-copied into three files — nothing enforces they
// stay the same record shape. STRUCTURE-ONLY: per-file `description` prose
// legitimately differs (e.g. doctor's `data` field names a doctor-flavored
// example), so every description is stripped before comparing.
// v4.9 W5.3 amendment: the two COUNCIL schemas widened `kind` to admit 'info'
// (the ledger-skipped announcement) while doctor keeps the two-kind enum —
// doctor never emits info, and widening it would advertise a value its
// producer cannot produce. The divergence is DELIBERATE and confined to the
// kind vocabulary; everything else stays lockstep across all three.
describe('degrades.items schema lockstep across council-run/council-verdict/doctor (v4.6 Plan 4 Task 6a)', () => {
  const items = (name) => stripDescriptions(readSchema(name).properties.degrades.items);

  test('council-run and council-verdict define the identical record shape, structure-only', () => {
    expect(items('council-run')).toEqual(items('council-verdict'));
  });

  test("kind vocabulary: council carries v4.9 'info'; doctor stays two-kind BY RULING", () => {
    expect(items('council-run').properties.kind).toEqual({ enum: ['degrade', 'heal', 'info'] });
    expect(items('doctor').properties.kind).toEqual({ enum: ['degrade', 'heal'] });
  });

  test('outside the kind vocabulary, doctor stays lockstep with the council shape', () => {
    const dropKind = (i) => ({ ...i, properties: { ...i.properties, kind: null } });
    expect(dropKind(items('council-verdict'))).toEqual(dropKind(items('doctor')));
  });

  // v4.9 W5.3: the widening itself, pinned through the REAL producer — the
  // record the sink stores for a task run's ledger-skipped note must validate
  // against both council degrades.items (run.json carries degrades too), and
  // stay INVALID against doctor's.
  test("a makeDegrade kind:'info' record validates against BOTH council schemas' degrades.items", () => {
    const { makeDegrade } = require('../src/utils/degrade');
    const rec = makeDegrade({ kind: 'info', channel: 'ledger-skipped',
      what: 'task runs write no reliability rows',
      why: 'ledger-driven chair promotion draws only on review-run history',
      effect: 'fallback candidates come from review runs only' });
    for (const name of ['council-run', 'council-verdict']) {
      const validate = new Ajv2020({ strict: false }).compile(readSchema(name).properties.degrades.items);
      const ok = validate(rec);
      if (!ok) { throw new Error(`${name}: ` + JSON.stringify(validate.errors, null, 2)); }
    }
    expect(new Ajv2020({ strict: false })
      .compile(readSchema('doctor').properties.degrades.items)(rec)).toBe(false);
  });
});

// v4.6.2 PR5 (LC-5): chairAttempts[] is council-run-only (no verdict/doctor
// sibling — the fallback walk is a run.json-only concern), so there is no
// cross-file shape to compare. Instead this pins THREE independent sources
// of truth against each other in one test each: the schema's declared item
// shape (schema), the REAL classifyChairAttempt export (producer), and a
// fixture leg built with the same mkLeg helper the chair suite itself uses
// (fixture) — a drift in any one of the three (schema loosens, the
// classifier's outcome taxonomy grows, or the fixture shape changes) fails
// here rather than silently at runtime.
describe('chairAttempts schema <-> producer <-> fixture lockstep (v4.6.2 PR5, LC-5)', () => {
  test('the schema declares the exact chairAttempts array shape', () => {
    const prop = stripDescriptions(readSchema('council-run').properties.chairAttempts);
    expect(prop).toEqual({
      type: 'array',
      items: {
        type: 'object',
        required: ['waveId', 'model', 'outcome'],
        properties: {
          waveId: { type: 'string' },
          model: { type: 'string' },
          outcome: { enum: ['completed', 'error', 'timeout', 'no-output'] },
          reason: { type: ['string', 'null'] },
        },
      },
    });
  });

  test('a producer-shaped sample entry — built from the real classifyChairAttempt on a fixture leg — validates', () => {
    const items = readSchema('council-run').properties.chairAttempts.items;
    const validate = new Ajv2020({ strict: false }).compile(items);
    const fixtureLeg = mkLeg('deepseek', 'Synthesis of the bench.\n\nVERDICT: Ship it', 'complete', 0.03);
    const { outcome, reason } = classifyChairAttempt(fixtureLeg, null);
    const entry = { waveId: 'abc123-ch1', model: 'deepseek', outcome, reason };
    const ok = validate(entry);
    if (!ok) { throw new Error('schema errors: ' + JSON.stringify(validate.errors, null, 2)); }
    expect(entry).toEqual({ waveId: 'abc123-ch1', model: 'deepseek', outcome: 'completed', reason: null });
  });
});
