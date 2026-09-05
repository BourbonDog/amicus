'use strict';

/**
 * #218 PR 2 — startServer hands OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX to the
 * engine spawn, and to nothing else.
 *
 * The pinned SDK spreads process.env into the child inside createOpencodeServer
 * BEFORE its first await, so the flag must be present when the SDK function is
 * CALLED and must already be gone (or back to its ambient value) by the time the
 * function's promise settles. The probe's K6/K12/K13 rows are the wire-side
 * canary for the engine; this file is the unit pin for amicus's side.
 *
 * Harness copied from tests/server-start-duration-log.test.js — the SDK is
 * mocked as a virtual module and startServer is driven through its
 * `_createOpencodeServer` seam. config is mocked PARTIALLY: only getOutputBudget
 * is replaced, so buildServerOptions still runs the real buildProviderModels
 * against jest's hermetic config dir.
 */

const mockCreateOpencodeClient = jest.fn(() => ({ session: {} }));
const seen = [];
let throwOnSpawn = false;
const mockCreateOpencodeServer = jest.fn(async () => {
  const flag = process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX;
  if (throwOnSpawn) { throw new Error('spawn refused'); }
  const entry = { atCall: flag };
  seen.push(entry);
  await new Promise((r) => setImmediate(r));
  entry.afterFirstAwait = process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX;
  return { url: 'http://127.0.0.1:4096', close: jest.fn() };
});

jest.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: mockCreateOpencodeClient,
  createOpencodeServer: mockCreateOpencodeServer,
  __esModule: true,
  default: { createOpencodeClient: mockCreateOpencodeClient, createOpencodeServer: mockCreateOpencodeServer },
}), { virtual: true });

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/utils/config', () => {
  const actual = jest.requireActual('../src/utils/config');
  return { ...actual, getOutputBudget: jest.fn(() => null) };
});

const config = require('../src/utils/config');
const { startServer } = require('../src/opencode-client');
const FLAG = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX';

const OK = {
  _hasOpencodeBinary: () => true,
  _createOpencodeServer: mockCreateOpencodeServer,
  _createClient: mockCreateOpencodeClient,
};

describe('startServer sets the engine output flag around the synchronous spawn', () => {
  const had = Object.prototype.hasOwnProperty.call(process.env, FLAG);
  const ambient = process.env[FLAG];

  beforeEach(() => {
    jest.clearAllMocks();
    seen.length = 0;
    throwOnSpawn = false;
    delete process.env[FLAG];
    config.getOutputBudget.mockReturnValue(null);
  });
  afterAll(() => {
    if (had) { process.env[FLAG] = ambient; } else { delete process.env[FLAG]; }
  });

  it('a configured budget is in process.env when the SDK is called, and gone before its promise settles', async () => {
    config.getOutputBudget.mockReturnValue(40000);
    await startServer(OK);
    // Named mutant "FLAGAFTERAWAIT": set process.env before `await
    // createOpencodeServer(...)` and restore after it — afterFirstAwait reads '40000'.
    // Named mutant "NOFLAG": drop the withOutputTokenFlag wrapper — atCall is undefined.
    expect(seen).toEqual([{ atCall: '40000', afterFirstAwait: undefined }]);
    expect(Object.prototype.hasOwnProperty.call(process.env, FLAG)).toBe(false);
  });

  it('reads the budget from config, the same source buildProviderModels uses', async () => {
    config.getOutputBudget.mockReturnValue(8000);
    await startServer(OK);
    expect(config.getOutputBudget).toHaveBeenCalled();
    expect(seen[0].atCall).toBe('8000');
  });

  it('with no budget, the env is untouched — an ambient flag the user exported reaches the spawn as-is', async () => {
    process.env[FLAG] = '64000';
    await startServer(OK);
    expect(seen).toEqual([{ atCall: '64000', afterFirstAwait: '64000' }]);
    expect(process.env[FLAG]).toBe('64000');
  });

  it('with a budget, an ambient flag is overridden for the spawn and restored afterwards', async () => {
    process.env[FLAG] = '64000';
    config.getOutputBudget.mockReturnValue(40000);
    await startServer(OK);
    expect(seen).toEqual([{ atCall: '40000', afterFirstAwait: '64000' }]);
    expect(process.env[FLAG]).toBe('64000');
  });

  it('a spawn failure still restores the env before the rejection is seen, and the error propagates', async () => {
    config.getOutputBudget.mockReturnValue(40000);
    throwOnSpawn = true;
    await expect(startServer(OK)).rejects.toThrow('spawn refused');
    expect(Object.prototype.hasOwnProperty.call(process.env, FLAG)).toBe(false);
  });

  it('a malformed budget sets nothing (the engine would fall back to 32000 silently)', async () => {
    config.getOutputBudget.mockReturnValue(null); // normalizeOutputBudget already rejected it
    await startServer(OK);
    expect(seen[0].atCall).toBeUndefined();
  });
});
