'use strict';
const path = require('path');

// Import the bin module's handlers via the new extracted file.
// handleStart/handleFanout live in src/cli-handlers-run.js (extracted from bin/amicus.js).
const { handleStart, handleFanout } = require('../../src/cli-handlers-run');

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
