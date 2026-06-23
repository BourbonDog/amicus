const fs = require('fs');
const os = require('os');
const path = require('path');
const { finalizeSession } = require('../src/sidecar/session-utils');

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-fs-'));
  fs.mkdirSync(path.join(dir, 'session'), { recursive: true });
  const sdir = path.join(dir, 'session');
  fs.writeFileSync(path.join(sdir, 'metadata.json'), JSON.stringify({ taskId: 't', status: 'running', createdAt: new Date().toISOString() }));
  return sdir;
}

it('finalizeSession defaults to complete (unchanged)', () => {
  const sdir = tmp();
  finalizeSession(sdir, 'sum', os.tmpdir(), JSON.parse(fs.readFileSync(path.join(sdir, 'metadata.json'), 'utf-8')), { quietStdout: true });
  expect(JSON.parse(fs.readFileSync(path.join(sdir, 'metadata.json'), 'utf-8')).status).toBe('complete');
});

it('finalizeSession honors an explicit status', () => {
  const sdir = tmp();
  finalizeSession(sdir, 'partial', os.tmpdir(), JSON.parse(fs.readFileSync(path.join(sdir, 'metadata.json'), 'utf-8')), { quietStdout: true, status: 'timed-out' });
  expect(JSON.parse(fs.readFileSync(path.join(sdir, 'metadata.json'), 'utf-8')).status).toBe('timed-out');
  expect(fs.readFileSync(path.join(sdir, 'summary.md'), 'utf-8')).toBe('partial');
});
