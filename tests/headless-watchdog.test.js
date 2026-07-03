'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('idleBackstopTeardown', () => {
  it('marks timed-out, writes summary.md, calls server.close, returns 2', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-tdo-'));
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ status: 'running' }));

    const { idleBackstopTeardown } = require('../src/utils/session-abort');
    const fakeServer = { close: jest.fn() };

    const code = idleBackstopTeardown(dir, fakeServer, false);

    const m = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(m.status).toBe('timed-out');
    expect(fs.existsSync(path.join(dir, 'summary.md'))).toBe(true);
    expect(fakeServer.close).toHaveBeenCalled();
    expect(code).toBe(2);
  });

  it('does NOT call server.close when externalServer=true, still returns 2', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-tdo-ext-'));
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ status: 'running' }));

    const { idleBackstopTeardown } = require('../src/utils/session-abort');
    const fakeServer = { close: jest.fn() };

    const code = idleBackstopTeardown(dir, fakeServer, true);

    expect(fakeServer.close).not.toHaveBeenCalled();
    expect(code).toBe(2);
  });

  // Adversarial-review finding (285903d..b9f0266, minor): close() is async
  // (B06) and can reject (e.g. a throwing sdkServer.close() on double-close).
  // idleBackstopTeardown's caller process.exit()s on the same tick, so this
  // was benign in practice, but the bare call is still a detached rejection
  // if that timing ever changes — pin the same guard as the other sites.
  it('does not produce an unhandled rejection when server.close() rejects', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-tdo-reject-'));
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ status: 'running' }));

    const { idleBackstopTeardown } = require('../src/utils/session-abort');
    const fakeServer = { close: jest.fn().mockRejectedValue(new Error('SDK wrapper already dead')) };

    const unhandled = [];
    const onUnhandledRejection = (reason) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const code = idleBackstopTeardown(dir, fakeServer, false);
      expect(code).toBe(2);
      expect(fakeServer.close).toHaveBeenCalled();

      // Give the detached rejection a macrotask to surface, if it's going to.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandledRejection);
    }
  });
});
