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
describe('degrades.items schema lockstep across council-run/council-verdict/doctor (v4.6 Plan 4 Task 6a)', () => {
  test('the three schemas define the identical degrade/heal record shape, structure-only', () => {
    const runItems = stripDescriptions(readSchema('council-run').properties.degrades.items);
    const verdictItems = stripDescriptions(readSchema('council-verdict').properties.degrades.items);
    const doctorItems = stripDescriptions(readSchema('doctor').properties.degrades.items);
    expect(runItems).toEqual(verdictItems);
    expect(verdictItems).toEqual(doctorItems);
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
