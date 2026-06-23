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
});
