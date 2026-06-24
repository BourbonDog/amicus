// tests/result-schema-doctor.test.js
'use strict';
const { buildDoctorDoc, SCHEMA_VERSION } = require('../src/utils/result-schema');

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
