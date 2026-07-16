'use strict';

// #10 regression: the MCP-spawned Cowork fanout path is
//   amicus_fanout handler -> `node bin/amicus.js fanout --cowork-process <name>`
//   -> handleFanout() -> runFanout() -> buildContext().
// handleFanout() must forward args['cowork-process'] into the runFanout options
// object, otherwise the Cowork parent session is never pinned and the original
// bug reproduces on the real spawned path.

// Mock runFanout so we can inspect the options object handleFanout builds,
// without spinning up an OpenCode server or making any network calls.
jest.mock('../src/sidecar/fanout', () => {
  const actual = jest.requireActual('../src/sidecar/fanout');
  return {
    ...actual,
    runFanout: jest.fn(async () => ({ exitCode: 0 })),
  };
});

const { runFanout } = require('../src/sidecar/fanout');
const { handleFanout } = require('../src/cli-handlers-run');

describe('handleFanout forwards --cowork-process into runFanout', () => {
  beforeEach(() => {
    runFanout.mockClear();
  });

  it('passes args[cowork-process] through as runFanout({ coworkProcess })', async () => {
    await handleFanout({
      prompt: 'hi',
      models: 'opus',
      'cowork-process': 'modest-laughing-goodall',
      'session-id': 'sess-123',
    });

    expect(runFanout).toHaveBeenCalledTimes(1);
    const opts = runFanout.mock.calls[0][0];
    expect(opts.coworkProcess).toBe('modest-laughing-goodall');
    // sanity: the established sibling forwarding still works
    expect(opts.sessionId).toBe('sess-123');
  });

  it('leaves coworkProcess undefined for non-Cowork callers', async () => {
    await handleFanout({ prompt: 'hi', models: 'opus' });

    expect(runFanout).toHaveBeenCalledTimes(1);
    const opts = runFanout.mock.calls[0][0];
    expect(opts.coworkProcess).toBeUndefined();
  });
});

// #61 whole-branch review FIX 4 (cheap parity): handleStart validates
// --gateway via validateStartArgs (cli.js) — fanout never did, so a typo'd
// value silently fell through to resolveGatewayMode's pass-through instead
// of failing fast with a clear error.
describe('handleFanout validates --gateway (#61 whole-branch review FIX 4)', () => {
  beforeEach(() => {
    runFanout.mockClear();
  });

  it('rejects an invalid --gateway value before ever calling runFanout (json mode)', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await expect(handleFanout({
        prompt: 'hi', models: 'opus', gateway: 'bogus', json: true,
      })).rejects.toThrow('exit:1');
      expect(runFanout).not.toHaveBeenCalled();
      const written = outSpy.mock.calls.map((c) => c[0]).join('');
      const doc = JSON.parse(written.trim());
      expect(doc.error).toMatchObject({ code: 'BAD_ARGS' });
      expect(doc.error.message).toContain('--gateway must be one of: auto, direct, openrouter');
    } finally {
      exitSpy.mockRestore();
      outSpy.mockRestore();
    }
  });

  it('rejects an invalid --gateway value before ever calling runFanout (human mode)', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(handleFanout({
        prompt: 'hi', models: 'opus', gateway: 'bogus',
      })).rejects.toThrow('exit:1');
      expect(runFanout).not.toHaveBeenCalled();
      const written = errSpy.mock.calls.map((c) => c[0]).join('');
      expect(written).toContain('--gateway must be one of: auto, direct, openrouter');
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('accepts a valid --gateway value and proceeds to runFanout', async () => {
    await handleFanout({ prompt: 'hi', models: 'opus', gateway: 'direct' });
    expect(runFanout).toHaveBeenCalledTimes(1);
  });
});
