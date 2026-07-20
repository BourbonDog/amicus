// tests/schemas.test.js
'use strict';

/**
 * v4.0 §7 Publishing — every emitted --json doc family has a published JSON
 * Schema (draft 2020-12) under schemas/, and every builder's REAL output must
 * validate against its schema. ajv is a devDependency ONLY (ajv/dist/2020).
 * council-run.schema.json is validated against a spec-§4 fixture until the
 * Plan-B engine lands its emitter.
 */
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

const SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');

function compile(name) {
  const schemaPath = path.join(SCHEMAS_DIR, `${name}.schema.json`);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return ajv.compile(schema);
}

function expectValid(validate, doc) {
  const ok = validate(doc);
  if (!ok) {
    throw new Error(`schema validation failed:\n${JSON.stringify(validate.errors, null, 2)}\ndoc:\n${JSON.stringify(doc, null, 2)}`);
  }
  expect(ok).toBe(true);
}

describe('published result-family schemas validate real builder output (v4.0 §7)', () => {
  const {
    buildRunResult, buildWaveResult, buildCatalogDoc, buildAuditDoc,
    buildDoctorDoc, buildAbortResult,
  } = require('../src/utils/result-schema');
  const { buildErrorDoc, ERROR_CODES } = require('../src/utils/error-doc');
  const { buildSpendDoc } = require('../src/cli-handlers-spend');

  const runDoc = buildRunResult({
    taskId: 'sch-run-1',
    metadata: {
      model: 'openrouter/deepseek/deepseek-v4', agent: 'plan',
      createdAt: '2026-07-19T10:00:00.000Z', completedAt: '2026-07-19T10:03:04.211Z',
      status: 'complete', opencodeSessionId: 'ses_123',
    },
    result: { completed: true, timedOut: false, aborted: false },
    summary: 'all good',
    modelInput: 'deepseek',
    sessionDir: 'C:\\x\\sch-run-1',
  });

  test('run.schema.json accepts buildRunResult output', () => {
    expectValid(compile('run'), runDoc);
  });

  test('wave.schema.json accepts buildWaveResult output', () => {
    const doc = buildWaveResult({
      waveId: 'sch-wave-1', legs: [runDoc],
      promptMeta: { source: 'file', file: 'briefing.md', chars: 42 },
      createdAt: '2026-07-19T10:00:00.000Z', completedAt: '2026-07-19T10:05:00.000Z',
    });
    expectValid(compile('wave'), doc);
  });

  test('abort.schema.json accepts buildAbortResult output', () => {
    expectValid(compile('abort'), buildAbortResult({ scope: 'session', taskId: 't1', aborted: ['t1'] }));
    expectValid(compile('abort'), buildAbortResult({ scope: 'all', taskId: null, aborted: [] }));
  });

  test('error.schema.json accepts buildErrorDoc output', () => {
    expectValid(compile('error'), buildErrorDoc({ code: ERROR_CODES.BAD_ARGS, message: 'bad flag' }));
    expectValid(compile('error'), buildErrorDoc({
      code: ERROR_CODES.MISSING_KEY, message: 'no key', hint: 'amicus key openai <key>', command: 'start',
    }));
  });

  test('spend.schema.json accepts buildSpendDoc output', () => {
    const total = { amount: 1.23, sourceMix: { reported: 1, estimated: 0, unknown: 0 } };
    const doc = buildSpendDoc({
      total,
      byModel: [{ model: 'openai/gpt-5.5', amount: 1.23, sourceMix: { reported: 1, estimated: 0, unknown: 0 } }],
      windowDays: 30,
      credit: null,
    });
    expectValid(compile('spend'), doc);
  });

  test('model-catalog.schema.json accepts buildCatalogDoc output', () => {
    const doc = buildCatalogDoc({ models: [{ id: 'openai/gpt-5.5' }], fetchedAt: 1752900000000, refreshed: true, search: null });
    expectValid(compile('model-catalog'), doc);
  });

  test('alias-audit.schema.json accepts buildAuditDoc output', () => {
    const doc = buildAuditDoc({
      stale: [{ alias: 'gpt', model: 'openai/gpt-4o', source: 'default', suggestions: ['openai/gpt-5.5'] }],
      catalogAvailable: true,
    });
    expectValid(compile('alias-audit'), doc);
  });

  test('doctor.schema.json accepts buildDoctorDoc output', () => {
    const doc = buildDoctorDoc({
      version: '4.0.0', timestamp: '2026-07-19T10:00:00.000Z',
      checks: [{ id: 'keys', name: 'API keys', status: 'ok', message: 'found', hint: null }],
    });
    expectValid(compile('doctor'), doc);
  });
});
