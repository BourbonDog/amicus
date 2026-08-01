// tests/server-start-duration-log.test.js
'use strict';

/**
 * Observability for the v4.5.2 start-timeout fix.
 *
 * The field report that produced the fix could not answer the one question that
 * would have sized it: how long does a HEALTHY start actually take on that box?
 * amicus logged nothing on the success path, so the margin between a good start
 * and the 5000ms cliff was unmeasured — the timeout had to be chosen from the
 * asymmetry of the failure rather than from data.
 *
 * A successful start therefore records its duration AND the ceiling it ran
 * against, so the headroom on a slow Windows box is a log line rather than an
 * inference.
 */

const mockCreateOpencodeClient = jest.fn(() => ({ session: {} }));
let startDelayMs = 0;
const mockCreateOpencodeServer = jest.fn(async () => {
  if (startDelayMs) { await new Promise(r => setTimeout(r, startDelayMs)); }
  return { url: 'http://127.0.0.1:4096', close: jest.fn() };
});

jest.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: mockCreateOpencodeClient,
  createOpencodeServer: mockCreateOpencodeServer,
  __esModule: true,
  default: {
    createOpencodeClient: mockCreateOpencodeClient,
    createOpencodeServer: mockCreateOpencodeServer,
  },
}), { virtual: true });

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
  }
}));

const { logger } = require('../src/utils/logger');
const { startServer, SERVER_START_TIMEOUT_MS } = require('../src/opencode-client');

const OK = {
  _hasOpencodeBinary: () => true,
  _createOpencodeServer: mockCreateOpencodeServer,
  _createClient: mockCreateOpencodeClient,
};

/** Every {msg, meta} pair the code logged at debug level. */
function debugCalls() {
  return logger.debug.mock.calls.map(([msg, meta]) => ({ msg, meta: meta || {} }));
}

describe('startServer logs how long a SUCCESSFUL start took', () => {
  beforeEach(() => { jest.clearAllMocks(); startDelayMs = 0; });

  it('emits a debug line naming the elapsed time', async () => {
    await startServer(OK);
    const hit = debugCalls().find(c => typeof c.meta.startMs === 'number');
    expect(hit).toBeDefined();
    expect(hit.meta.startMs).toBeGreaterThanOrEqual(0);
  });

  it('records the ceiling alongside it, so headroom is readable without arithmetic', async () => {
    await startServer(OK);
    const hit = debugCalls().find(c => typeof c.meta.startMs === 'number');
    expect(hit.meta.timeoutMs).toBe(
      SERVER_START_TIMEOUT_MS[process.platform] || SERVER_START_TIMEOUT_MS.default);
  });

  it('reports the timeout actually in force when one is overridden', async () => {
    await startServer({ ...OK, timeout: 22000 });
    const hit = debugCalls().find(c => typeof c.meta.startMs === 'number');
    expect(hit.meta.timeoutMs).toBe(22000);
  });

  it('measures real elapsed time rather than reporting a constant', async () => {
    startDelayMs = 60;
    await startServer(OK);
    const hit = debugCalls().find(c => typeof c.meta.startMs === 'number');
    // Generous lower bound — this asserts the clock is read, not its precision.
    expect(hit.meta.startMs).toBeGreaterThanOrEqual(40);
  });

  it('stays at debug level — a healthy start must not add console noise', async () => {
    await startServer(OK);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
