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
      startServer({ _hasOpencodeBinary: () => false })
    ).rejects.toThrow(/OpenCode engine binary not found/i);
  });

  test('the error tells the user how to remediate (doctor / reinstall / AV allow-list)', async () => {
    let err;
    try {
      await startServer({ _hasOpencodeBinary: () => false });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/amicus doctor/i);
    expect(err.message).toMatch(/npm i(nstall)? -g amicus/i);
    expect(err.message).toMatch(/antivirus|quarantin|allow-list/i);
  });

  test('does NOT reach createOpencodeServer when the binary is missing (fails fast)', async () => {
    await expect(
      startServer({ _hasOpencodeBinary: () => false })
    ).rejects.toThrow();
    expect(mockCreateOpencodeServer).not.toHaveBeenCalled();
  });
});
