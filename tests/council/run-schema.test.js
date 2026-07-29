// tests/council/run-schema.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const Ajv2020 = require('ajv/dist/2020');
const { runCouncil } = require('../../src/council/run');
const { scriptedLaunchers, happyScript, baseOptions, mkLeg, okWave } =
  require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-schema-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const SCHEMA = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'schemas', 'council-run.schema.json'), 'utf-8'));
const deps = (launchers) => ({
  launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: () => () => {},
});
const validate = new Ajv2020({ strict: false }).compile(SCHEMA);

describe('run.json validates against schemas/council-run.schema.json (Plan A contract)', () => {
  test('happy-path manifest validates', async () => {
    const { run } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(happyScript())));
    const ok = validate(run);
    if (!ok) { throw new Error('schema errors: ' + JSON.stringify(validate.errors, null, 2)); }
    expect(run.schemaVersion).toBe(2);
    expect(run.type).toBe('council-run');
  });

  test('degraded (quorum-error) manifest validates too', async () => {
    const script = {
      'abc123-s1': () => okWave([mkLeg('gemini', '', 'error'), mkLeg('gpt', '', 'error'),
        mkLeg('qwen', '', 'error')], 1, 'error'),
    };
    const { run } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(script)));
    const ok = validate(run);
    if (!ok) { throw new Error('schema errors: ' + JSON.stringify(validate.errors, null, 2)); }
    expect(run.status).toBe('error');
  });

  // v4.5 Wave 2 (post-HOLD chip, task-23-report.md Anomaly 1): a --council
  // preset resolution that drops a catalog-absent member must reach run.json
  // as an additive `droppedMembers` array — the handler (cli-handlers-council-
  // run.js / mcp-council-run.js) computes this BEFORE calling runCouncil and
  // threads it through options.droppedMembers; run-state.js's initCouncilRun
  // seed is the one place that decides whether it lands in the doc.
  test('droppedMembers (Wave 2 chip) survives to the terminal run doc and validates against the bumped schema', async () => {
    const droppedMembers = [
      { member: 'deepseek', reason: 'resolved id is not present in the cached model catalog' },
    ];
    const { run } = await runCouncil(
      baseOptions(tmp, { droppedMembers }), deps(scriptedLaunchers(happyScript())));
    const ok = validate(run);
    if (!ok) { throw new Error('schema errors: ' + JSON.stringify(validate.errors, null, 2)); }
    expect(run.droppedMembers).toEqual(droppedMembers);
  });

  test('droppedMembers is absent (never an empty array) on run.json when nothing was dropped', async () => {
    const { run } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(happyScript())));
    const ok = validate(run);
    if (!ok) { throw new Error('schema errors: ' + JSON.stringify(validate.errors, null, 2)); }
    expect('droppedMembers' in run).toBe(false);
  });

  test('droppedMembers is absent even when options.droppedMembers is explicitly an empty array', async () => {
    const { run } = await runCouncil(
      baseOptions(tmp, { droppedMembers: [] }), deps(scriptedLaunchers(happyScript())));
    expect('droppedMembers' in run).toBe(false);
  });
});
