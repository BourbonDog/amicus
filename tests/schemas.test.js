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

  // v4.5 Task 13: additive — present only when the solo session was launched via --pack.
  test('run.schema.json accepts buildRunResult output with a recorded pack', () => {
    const doc = buildRunResult({
      taskId: 'sch-run-2',
      metadata: {
        model: 'openrouter/deepseek/deepseek-v4', status: 'complete',
        pack: { name: 'quick-check', version: '1.0.0', hash: 'abc123def456', source: 'dir' },
      },
    });
    expectValid(compile('run'), doc);
  });

  // v4.7 F8 (D13): additive — present only when the solo session was launched via --tag.
  test('run.schema.json accepts buildRunResult output with a recorded tag', () => {
    const doc = buildRunResult({
      taskId: 'sch-run-2b',
      metadata: { model: 'openrouter/deepseek/deepseek-v4', status: 'complete', tag: 'sprint-42' },
    });
    expectValid(compile('run'), doc);
  });

  test('wave.schema.json accepts buildWaveResult output', () => {
    const doc = buildWaveResult({
      waveId: 'sch-wave-1', legs: [runDoc],
      promptMeta: { source: 'file', file: 'briefing.md', chars: 42 },
      createdAt: '2026-07-19T10:00:00.000Z', completedAt: '2026-07-19T10:05:00.000Z',
    });
    expectValid(compile('wave'), doc);
  });

  // v4.5 Task 13: additive — present only when the wave was launched via --pack.
  test('wave.schema.json accepts buildWaveResult output with a recorded pack', () => {
    const doc = buildWaveResult({
      waveId: 'sch-wave-2', legs: [runDoc],
      promptMeta: { source: 'file', file: 'briefing.md', chars: 42 },
      pack: { name: 'fanout-review', version: '1.0.0', hash: 'abc123def456', source: 'dir' },
      createdAt: '2026-07-19T10:00:00.000Z', completedAt: '2026-07-19T10:05:00.000Z',
    });
    expectValid(compile('wave'), doc);
  });

  // v4.5 final-review F5: wave.schema.json's pack was typed ["object","null"]
  // — the only nullable-pack schema among the three siblings (run.schema.json/
  // council-run.schema.json are both object-only) — but every emitter uses
  // the absent-not-null idiom (never emits pack:null), so the "null" branch
  // was dead. Tightened to object-only; this locks it against regression.
  test('wave.schema.json rejects an explicit pack:null (every emitter is absent-not-null, matching run/council-run siblings)', () => {
    const doc = buildWaveResult({
      waveId: 'sch-wave-3', legs: [runDoc],
      promptMeta: { source: 'file', file: 'briefing.md', chars: 42 },
      createdAt: '2026-07-19T10:00:00.000Z', completedAt: '2026-07-19T10:05:00.000Z',
    });
    doc.pack = null; // simulates a hand-rolled/legacy doc; buildWaveResult itself never does this
    expect(compile('wave')(doc)).toBe(false);
  });

  // v4.7 F8 (D13): additive — present only when the wave was launched via --tag.
  test('wave.schema.json accepts buildWaveResult output with a recorded tag', () => {
    const doc = buildWaveResult({
      waveId: 'sch-wave-4', legs: [runDoc],
      promptMeta: { source: 'file', file: 'briefing.md', chars: 42 },
      tag: 'sprint-42',
      createdAt: '2026-07-19T10:00:00.000Z', completedAt: '2026-07-19T10:05:00.000Z',
    });
    expectValid(compile('wave'), doc);
  });

  // tag is a plain string (schemas.test.js:94-102 pack:null-rejection
  // precedent): never ["string","null"], so an explicit tag:null must reject
  // exactly like pack:null does above.
  test('wave.schema.json rejects an explicit tag:null (absent-not-null, same rule as pack)', () => {
    const doc = buildWaveResult({
      waveId: 'sch-wave-5', legs: [runDoc],
      promptMeta: { source: 'file', file: 'briefing.md', chars: 42 },
      createdAt: '2026-07-19T10:00:00.000Z', completedAt: '2026-07-19T10:05:00.000Z',
    });
    doc.tag = null;
    expect(compile('wave')(doc)).toBe(false);
  });

  test('abort.schema.json accepts buildAbortResult output', () => {
    expectValid(compile('abort'), buildAbortResult({ scope: 'session', taskId: 't1', aborted: ['t1'] }));
    expectValid(compile('abort'), buildAbortResult({ scope: 'all', taskId: null, aborted: [] }));
    expectValid(compile('abort'), buildAbortResult({ scope: 'council-run', taskId: 'c1', aborted: ['c1'] }));
  });

  test('error.schema.json accepts buildErrorDoc output', () => {
    expectValid(compile('error'), buildErrorDoc({ code: ERROR_CODES.BAD_ARGS, message: 'bad flag' }));
    expectValid(compile('error'), buildErrorDoc({
      code: ERROR_CODES.MISSING_KEY, message: 'no key', hint: 'amicus key openai <key>', command: 'start',
    }));
  });

  // Finding 2 regression guard: data-driven over the EXPORTED ERROR_CODES object
  // (not a hardcoded list) so a future code added to error-doc.js without a
  // matching schema enum entry fails this test immediately, the way
  // COUNCIL_QUORUM/COST_EXCEEDED/COUNCIL_CLAUDE_REVIEW_INVALID silently didn't.
  test('every ERROR_CODES value round-trips through buildErrorDoc and validates', () => {
    const validate = compile('error');
    for (const code of Object.values(ERROR_CODES)) {
      expectValid(validate, buildErrorDoc({ code, message: `test message for ${code}` }));
    }
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

describe('published council-family schemas validate real builder output (v4.0 §7)', () => {
  const avInput = require('./council/fixtures/av-receiver-input');
  const { tally } = require('../src/council/tally');
  const { buildVerdict } = require('../src/council/verdict');
  const { buildStatsDoc } = require('../src/council/ledger');
  const { validateFindings, buildValidateDoc } = require('../src/council/findings');

  const record = tally(avInput);

  test('council-tally.schema.json accepts tally() output', () => {
    expectValid(compile('council-tally'), record);
  });

  test('council-verdict.schema.json accepts buildVerdict output (null and set overallVerdict)', () => {
    expectValid(compile('council-verdict'), buildVerdict(record, []));
    expectValid(compile('council-verdict'), buildVerdict(record, [], { overallVerdict: 'Ship it' }));
  });

  test('council-stats.schema.json accepts buildStatsDoc output', () => {
    // v4.7 GOA-7 D10: documentation pin — the fixture rows carry `aliases`
    // and `legacy` (additive row properties) so the schema exercise actually
    // covers them, not just the pre-D10 shape.
    const doc = buildStatsDoc([{
      model: 'gpt', runs: 3, lowN: false, avgStreetCredPeersOnly: 1.4,
      lifetimeConfirmRate: 0.5, lifetimeFactErrorRate: 0, conformance: { clean: 3 },
      aliases: ['gpt'],
    }, {
      model: 'gemini', runs: 2, lowN: true, avgStreetCredPeersOnly: null,
      lifetimeConfirmRate: null, lifetimeFactErrorRate: null, conformance: { clean: 2 },
      aliases: ['gemini'], legacy: true,
    }]);
    expectValid(compile('council-stats'), doc);
    expectValid(compile('council-stats'), buildStatsDoc([]));
  });

  test('council-validate.schema.json accepts buildValidateDoc output (ok and invalid)', () => {
    const good = buildValidateDoc(validateFindings(
      'prose\n```json\n{"findings":[{"id":1,"severity":"minor","claim":"c","location":"l","rationale":"r"}]}\n```'));
    expectValid(compile('council-validate'), good);
    const bad = buildValidateDoc(validateFindings('no block here'));
    expectValid(compile('council-validate'), bad);
  });

  test('council-run.schema.json accepts the spec-§4 run.json shape (Plan-B emitter pending)', () => {
    // Hand-built fixture matching spec §4's run.json manifest. The Plan-B
    // engine's run-state writer MUST keep satisfying this schema.
    const fixture = {
      schemaVersion: 2,
      type: 'council-run',
      runId: 'council-20260719-abc123',
      status: 'complete',
      stages: [
        { name: 'stage1', status: 'complete', startedAt: '2026-07-19T10:00:00.000Z',
          completedAt: '2026-07-19T10:08:00.000Z', waveId: 'wv-1', taskIds: ['wv-1-1', 'wv-1-2'] },
        { name: 'stage2', status: 'complete', startedAt: '2026-07-19T10:08:00.000Z',
          completedAt: '2026-07-19T10:15:00.000Z', waveId: 'wv-2' },
        { name: 'chair', status: 'complete', startedAt: '2026-07-19T10:15:00.000Z',
          completedAt: '2026-07-19T10:18:00.000Z', taskIds: ['solo-chair'] }
      ],
      bench: ['gemini', 'gpt', 'mistral'],
      chair: 'deepseek',
      critic: null,
      lenses: null,
      labelMap: { 'Review A': 'gemini', 'Review B': 'gpt', 'Review C': 'mistral' },
      options: { maxCost: 2, timeoutMinutes: 10, gateway: 'auto' },
      // v4.5 Task 12 (B7/F5): additive — present only when the run was launched via --pack.
      pack: { name: 'sec-review', version: '1.0.0', hash: 'abc123def456', source: 'dir' },
      // v4.5 Task 5 (F3): template metadata — present only when the run was launched via --template.
      template: { name: 'x', hash: 'abcdef123456' },
      // v4.7 F8 (D13): additive — present only when the run was launched via --tag.
      tag: 'sprint-42',
      usage: { cost: { amount: 1.1, source: 'reported' } },
      exitCode: 0
    };
    expectValid(compile('council-run'), fixture);
  });
});

describe('published pack-family schemas validate policy packs (v4.5)', () => {
  test('pack.schema.json accepts council pack shape', () => {
    const validate = compile('pack');
    const councilPack = {
      schemaVersion: 1,
      type: 'pack',
      name: 'sec-review',
      version: '1.0.0',
      kind: 'council',
      description: 'x',
      bench: ['deepseek', 'qwen-coder'],
      chair: 'gpt',
      critic: null,
      lenses: null,
      options: { timeout: 10 },
      briefing: { template: 'review' },
    };
    expectValid(validate, councilPack);
  });

  test('pack.schema.json accepts solo pack shape', () => {
    const validate = compile('pack');
    const soloPack = {
      schemaVersion: 1,
      type: 'pack',
      name: 'quick-check',
      version: '1.0.0',
      kind: 'solo',
      model: 'gpt-4o',
    };
    expectValid(validate, soloPack);
  });

  test('pack.schema.json rejects invalid kind', () => {
    const validate = compile('pack');
    const invalid = {
      schemaVersion: 1,
      type: 'pack',
      name: 'bad-pack',
      version: '1.0.0',
      kind: 'nope',
    };
    expect(validate(invalid)).toBe(false);
  });

  test('pack.schema.json rejects bench array with fewer than 2 items', () => {
    const validate = compile('pack');
    const invalid = {
      schemaVersion: 1,
      type: 'pack',
      name: 'single-bench',
      version: '1.0.0',
      kind: 'council',
      bench: ['only-one'],
    };
    expect(validate(invalid)).toBe(false);
  });
});

describe('schema publishing (v4.0 §7)', () => {
  test('exactly the 19 published schema files exist', () => {
    const files = fs.readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json')).sort();
    // Lexicographic sort: '-' (0x2D) < '.' (0x2E), so every "-live" variant
    // sorts BEFORE its base name (council-run-live < council-run, etc.) —
    // verified against readdirSync(...).sort() output, not hand-guessed.
    expect(files).toEqual([
      'abort.schema.json', 'alias-audit.schema.json',
      'council-run-live.schema.json', 'council-run.schema.json',
      'council-stats.schema.json', 'council-tally.schema.json',
      'council-validate.schema.json', 'council-verdict.schema.json',
      'doctor.schema.json', 'error.schema.json', 'event.schema.json',
      'model-catalog.schema.json', 'pack.schema.json', 'progress.schema.json',
      'run-live.schema.json', 'run.schema.json', 'spend.schema.json',
      'wave-live.schema.json', 'wave.schema.json',
    ]);
  });

  test('schemas/ ships in the npm tarball (package.json files entry)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    expect(pkg.files).toContain('schemas/');
    expect(pkg.devDependencies.ajv).toBeDefined();
    expect(pkg.dependencies.ajv).toBeUndefined();
  });

  test('docs/schemas.md exists and indexes every schema file', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'schemas.md'), 'utf-8');
    for (const f of fs.readdirSync(SCHEMAS_DIR).filter((x) => x.endsWith('.schema.json'))) {
      expect(doc).toContain(f);
    }
    expect(doc).toContain('council stats');
    expect(doc).toContain('ledger');
  });
});
