// tests/opencode-client-engine-missing.test.js
'use strict';

// Mock the SDK so that if startServer ever reaches createOpencodeServer we can
// detect it. The whole point of the fix is that a MISSING engine binary throws
// a clear error BEFORE the SDK server is created — so this mock must NOT be
// called in the missing-binary path.
const mockCreateOpencodeServer = jest.fn(() => {
  throw new Error('spawn opencode ENOENT'); // the opaque failure we are replacing
});
const mockCreateOpencodeClient = jest.fn();

jest.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: mockCreateOpencodeClient,
  createOpencodeServer: mockCreateOpencodeServer,
  __esModule: true,
  default: {
    createOpencodeClient: mockCreateOpencodeClient,
    createOpencodeServer: mockCreateOpencodeServer,
  },
}), { virtual: true });

const { startServer } = require('../src/opencode-client');

describe('startServer — missing opencode engine binary', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('throws a CLEAR actionable error (not a bare ENOENT) when the binary is absent', async () => {
    await expect(
      startServer({ _hasOpencodeBinary: () => false, _ensureEngine: async () => ({ ok: false }) })
    ).rejects.toThrow(/OpenCode engine binary not found/i);
  });

  test('the error tells the user how to remediate (doctor / reinstall / AV allow-list)', async () => {
    let err;
    try {
      await startServer({ _hasOpencodeBinary: () => false, _ensureEngine: async () => ({ ok: false }) });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/amicus doctor/i);
    expect(err.message).toMatch(/npm i(nstall)? -g amicus/i);
    expect(err.message).toMatch(/antivirus|quarantin|allow-list/i);
  });

  test('does NOT reach createOpencodeServer when the binary is missing (fails fast)', async () => {
    await expect(
      startServer({ _hasOpencodeBinary: () => false, _ensureEngine: async () => ({ ok: false }) })
    ).rejects.toThrow();
    expect(mockCreateOpencodeServer).not.toHaveBeenCalled();
  });

  test('the error names the roots it searched, so the npx-vs-global divergence is visible (report #4)', async () => {
    let err;
    try {
      await startServer({
        _hasOpencodeBinary: () => false,
        _ensureEngine: async () => ({ ok: false }),
        _opencodeRoots: () => ['C:\\npx\\_npx\\h1\\node_modules', 'C:\\npx\\_npx\\h1'],
      });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/searched:/i);
    expect(err.message).toContain('C:\\npx\\_npx\\h1\\node_modules');
  });
});

describe('startServer — engine self-heal', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('when self-heal succeeds, the missing-binary guard is passed (no engine-missing throw)', async () => {
    const ensureEngine = jest.fn(async () => ({ ok: true }));
    let err;
    try {
      await startServer({ _hasOpencodeBinary: () => false, _ensureEngine: ensureEngine });
    } catch (e) { err = e; }
    expect(ensureEngine).toHaveBeenCalledTimes(1);
    // Past the guard: whatever happens next belongs to the real SDK's dynamic
    // import() — Jest cannot route dynamic import() through jest.mock()
    // without --experimental-vm-modules (see tests/opencode-client.test.js's
    // createClient describe block for the same limitation), so
    // mockCreateOpencodeServer is unreachable here and is not asserted on.
    // What IS provable, and is the actual contract under test: the guard did
    // NOT throw the engineMissing error, i.e. self-heal succeeding lets
    // startServer proceed past the missing-binary check.
    expect(err).toBeDefined();
    expect(err && err.message).not.toMatch(/OpenCode engine binary not found/i);
  });

  test('when self-heal fails, the thrown error carries the self-heal reason', async () => {
    let err;
    try {
      await startServer({
        _hasOpencodeBinary: () => false,
        _ensureEngine: async () => ({ ok: false, reason: 'no healthy sibling install to copy the engine from' }),
        _opencodeRoots: () => [require('path').join('C:', 'npx', '_npx', 'h1', 'node_modules')],
      });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/OpenCode engine binary not found/i);
    expect(err.message).toMatch(/self-heal: no healthy sibling/i);
  });

  test('a THROWN self-heal still degrades to the missing-binary error (never an unhandled rejection)', async () => {
    let err;
    try {
      await startServer({
        _hasOpencodeBinary: () => false,
        _ensureEngine: async () => { throw new Error('boom'); },
      });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/OpenCode engine binary not found/i);
    expect(err.message).not.toMatch(/boom/);
  });
});
