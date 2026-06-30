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
