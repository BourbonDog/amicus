'use strict';
const path = require('path');

// F2 (Task-5 review): the two TEMPLATE_NOT_FOUND "engine never invoked" cases below
// (in the --template describe block) assert that directly rather than just claiming
// it in the title. Real exports pass through via requireActual — only the engine
// entry points the handlers would reach are replaced with spies. Same idiom as
// tests/council/run-single-server.test.js and tests/template/cli-wiring.test.js.
jest.mock('../../src/index', () => ({
  ...jest.requireActual('../../src/index'),
  startAmicus: jest.fn(),
}));
jest.mock('../../src/sidecar/fanout', () => ({
  ...jest.requireActual('../../src/sidecar/fanout'),
  runFanout: jest.fn(),
}));

// Import the bin module's handlers via the new extracted file.
// handleStart/handleFanout live in src/cli-handlers-run.js (extracted from bin/amicus.js).
const { handleStart, handleFanout } = require('../../src/cli-handlers-run');
const { startAmicus } = require('../../src/index');
const { runFanout } = require('../../src/sidecar/fanout');

beforeEach(() => {
  startAmicus.mockClear();
  runFanout.mockClear();
  // T5-m1: bare jest.fn() resolves undefined, which captureStdout's .catch(e => e)
  // silently swallows on any success-path test — give both engines a real shape.
  startAmicus.mockResolvedValue({ exitCode: 0 });
  runFanout.mockResolvedValue({ exitCode: 0 });
});

function captureStdout(fn) {
  const out = [];
  const spyOut = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(s); return true; });
  const spyErr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const spyExit = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });
  return fn().catch(e => e).finally(() => { spyOut.mockRestore(); spyErr.mockRestore(); spyExit.mockRestore(); }).then(() => out.join(''));
}

describe('--json pre-flight failures emit an envelope on stdout', () => {
  it('start --json without --no-ui → BAD_ARGS envelope on stdout', async () => {
    const out = await captureStdout(() => handleStart({ json: true, 'no-ui': false, prompt: 'hi' }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
  });

  it('fanout --json with no --models → BAD_ARGS envelope on stdout', async () => {
    const out = await captureStdout(() => handleFanout({ json: true, prompt: 'hi' }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
  });
});

describe('--max-cost validation emits BAD_ARGS envelope on stdout', () => {
  it('start --json --max-cost NaN → BAD_ARGS envelope on stdout', async () => {
    const out = await captureStdout(() => handleStart({ json: true, 'no-ui': true, prompt: 'hi', 'max-cost': NaN }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
    expect(doc.error.message).toMatch(/--max-cost must be a positive number/);
  });

  it('start --json --max-cost true (boolean from missing value) → BAD_ARGS envelope on stdout', async () => {
    const out = await captureStdout(() => handleStart({ json: true, 'no-ui': true, prompt: 'hi', 'max-cost': true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
    expect(doc.error.message).toMatch(/--max-cost must be a positive number/);
  });

  it('fanout --json --max-cost NaN → BAD_ARGS envelope on stdout', async () => {
    const out = await captureStdout(() => handleFanout({ json: true, prompt: 'hi', models: 'opus', 'max-cost': NaN }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
    expect(doc.error.message).toMatch(/--max-cost must be a positive number/);
  });

  it('fanout --json --max-cost true → BAD_ARGS envelope on stdout', async () => {
    const out = await captureStdout(() => handleFanout({ json: true, prompt: 'hi', models: 'opus', 'max-cost': true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
    expect(doc.error.message).toMatch(/--max-cost must be a positive number/);
  });

  it('start --json --max-cost 1.5 (valid) → does NOT emit BAD_ARGS for max-cost', async () => {
    const out = await captureStdout(() => handleStart({ json: true, 'no-ui': true, prompt: 'hi', 'max-cost': 1.5 }));
    // May fail later (model resolution etc.), but must NOT be a BAD_ARGS for max-cost
    let doc;
    try { doc = JSON.parse(out); } catch (_) { doc = null; }
    if (doc && doc.error) {
      expect(doc.error.message).not.toMatch(/--max-cost must be a positive number/);
    }
  });

  it('fanout --json --max-cost 5 (valid) → does NOT emit BAD_ARGS for max-cost', async () => {
    const out = await captureStdout(() => handleFanout({ json: true, prompt: 'hi', models: 'opus', 'max-cost': 5 }));
    let doc;
    try { doc = JSON.parse(out); } catch (_) { doc = null; }
    if (doc && doc.error) {
      expect(doc.error.message).not.toMatch(/--max-cost must be a positive number/);
    }
  });
});

describe('--template pre-flight failures emit an envelope on stdout (v4.5 F9)', () => {
  // A `.md`-suffixed ref takes resolveTemplate's path branch (never touches
  // AMICUS_CONFIG_DIR), so this stays hermetic without any tmp-dir setup.
  it('start --json --template <missing path> → TEMPLATE_NOT_FOUND envelope, engine never invoked', async () => {
    const out = await captureStdout(() => handleStart({
      json: true, 'no-ui': true, prompt: 'hi', template: 'definitely-not-a-real-template-xyz.md',
    }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'TEMPLATE_NOT_FOUND' } });
    expect(startAmicus).not.toHaveBeenCalled();
  });

  it('start --json --artifact without --template → BAD_ARGS envelope', async () => {
    const out = await captureStdout(() => handleStart({ json: true, 'no-ui': true, prompt: 'hi', artifact: __filename }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
    expect(doc.error.message).toMatch(/--artifact\/--var require --template/);
  });

  it('start --json --var without --template → BAD_ARGS envelope', async () => {
    const out = await captureStdout(() => handleStart({ json: true, 'no-ui': true, prompt: 'hi', var: ['a=1'] }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
  });

  it('fanout --json --template <missing path> → TEMPLATE_NOT_FOUND envelope, engine never invoked', async () => {
    const out = await captureStdout(() => handleFanout({
      json: true, models: 'a,b', template: 'definitely-not-a-real-template-xyz.md',
    }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'TEMPLATE_NOT_FOUND' } });
    expect(runFanout).not.toHaveBeenCalled();
  });

  it('fanout --json --artifact without --template → BAD_ARGS envelope', async () => {
    const out = await captureStdout(() => handleFanout({ json: true, prompt: 'hi', models: 'a,b', artifact: __filename }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
    expect(doc.error.message).toMatch(/--artifact\/--var require --template/);
    expect(runFanout).not.toHaveBeenCalled();
  });

  it('fanout --json --var without --template → BAD_ARGS envelope', async () => {
    const out = await captureStdout(() => handleFanout({ json: true, prompt: 'hi', models: 'a,b', var: ['a=1'] }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
    expect(doc.error.message).toMatch(/--artifact\/--var require --template/);
    expect(runFanout).not.toHaveBeenCalled();
  });
});

// v4.7 F8 (D13): --tag is reject-style (unlike sanitizeCouncilName, which
// cleans) — a bad tag must fail fast with the validator's message, engine
// never invoked. (Both handlers validate --tag before the engine is invoked —
// handleStart's rejection case lives in tests/pack/cli-fanout-start-pack.test.js.)
describe('--tag pre-flight validation emits BAD_ARGS envelope on stdout (v4.7 F8)', () => {
  it('fanout --json --tag "bad tag!" → BAD_ARGS envelope, engine never invoked', async () => {
    const out = await captureStdout(() => handleFanout({
      json: true, prompt: 'hi', models: 'a,b', tag: 'bad tag!',
    }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
    expect(doc.error.message).toMatch(/Invalid --tag/);
    expect(runFanout).not.toHaveBeenCalled();
  });

  it('fanout --json --retry-failed <id> --tag x → BAD_ARGS, cannot combine, engine never invoked', async () => {
    const out = await captureStdout(() => handleFanout({
      json: true, 'retry-failed': 'wave-123', tag: 'x',
    }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
    expect(doc.error.message).toMatch(/--tag cannot be combined with --retry-failed/);
    expect(runFanout).not.toHaveBeenCalled();
  });
});
