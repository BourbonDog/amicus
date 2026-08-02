// tests/result-schema-doctor.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const { buildDoctorDoc, SCHEMA_VERSION } = require('../src/utils/result-schema');
const { makeDegrade } = require('../src/utils/degrade');

describe('buildDoctorDoc', () => {
  test('ok=true when no error checks', () => {
    const doc = buildDoctorDoc({
      version: '1.1.0', timestamp: '2026-06-23T00:00:00.000Z',
      checks: [{ id: 'node', name: 'Node', status: 'ok', message: 'v20', hint: null }],
    });
    expect(doc).toEqual({
      schemaVersion: SCHEMA_VERSION,
      type: 'doctor',
      ok: true,
      version: '1.1.0',
      timestamp: '2026-06-23T00:00:00.000Z',
      checks: [{ id: 'node', name: 'Node', status: 'ok', message: 'v20', hint: null }],
    });
  });

  test('ok=false when any check is error; warn does not flip ok', () => {
    const warn = buildDoctorDoc({ version: 'x', timestamp: 't', checks: [{ id: 'a', name: 'A', status: 'warn', message: 'm', hint: null }] });
    expect(warn.ok).toBe(true);
    const err = buildDoctorDoc({ version: 'x', timestamp: 't', checks: [{ id: 'b', name: 'B', status: 'error', message: 'm', hint: 'fix' }] });
    expect(err.ok).toBe(false);
  });
});

// v4.6 Plan 3 Task 4: doctor.schema.json gains the optional degrades[] surface
// (mirrors council-run.schema.json's). Real builder output must validate.
describe('buildDoctorDoc output validates against schemas/doctor.schema.json', () => {
  const SCHEMA = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'schemas', 'doctor.schema.json'), 'utf-8'));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(SCHEMA);

  test('a doc with degrades[] (a failure and a heal) validates', () => {
    const degrades = [
      makeDegrade({
        channel: 'doctor-check-failed', what: "the 'A' check failed", why: 'broken',
        effect: 'amicus may not work correctly until this is fixed; doctor exits 1',
        remedy: 'fix it', data: { checkId: 'a' },
      }),
      makeDegrade({
        kind: 'heal', channel: 'doctor-fix', what: "the 'B' check was repaired in place",
        why: 'doctor --fix repaired the thing',
        effect: 'no further action needed; the repair already ran', data: { checkId: 'b' },
      }),
    ];
    const doc = buildDoctorDoc({
      version: '1.1.0', timestamp: '2026-06-23T00:00:00.000Z',
      checks: [
        { id: 'a', name: 'A', status: 'error', message: 'broken', hint: 'fix it' },
        { id: 'b', name: 'B', status: 'ok', message: 'healed', fixed: true, fixDetail: 'repaired the thing' },
      ],
      degrades,
    });
    expect(doc.degrades).toHaveLength(2);
    const ok = validate(doc);
    if (!ok) { throw new Error('schema errors: ' + JSON.stringify(validate.errors, null, 2)); }
    expect(ok).toBe(true);
  });

  test('a doc without degrades (absent, never empty) stays valid', () => {
    const doc = buildDoctorDoc({
      version: '1.1.0', timestamp: '2026-06-23T00:00:00.000Z',
      checks: [{ id: 'node', name: 'Node', status: 'ok', message: 'v20', hint: null }],
    });
    expect('degrades' in doc).toBe(false);
    expect(validate(doc)).toBe(true);
  });
});
