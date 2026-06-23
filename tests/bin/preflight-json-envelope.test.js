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
