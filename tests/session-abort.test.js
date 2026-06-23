const fs = require('fs');
const os = require('os');
const path = require('path');
const { markTerminal, markAborted } = require('../src/utils/session-abort');

function tmpSession(meta) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-mt-'));
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(meta || { status: 'running' }));
  return dir;
}

describe('markTerminal', () => {
  it('writes the given status + reason + a timestamp', () => {
    const dir = tmpSession();
    expect(markTerminal(dir, 'timed-out', 'idle backstop')).toBe(true);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(m.status).toBe('timed-out');
    expect(m.reason).toBe('idle backstop');
    expect(typeof m.completedAt).toBe('string');
  });
  it('returns false when metadata.json is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-mt-'));
    expect(markTerminal(dir, 'timed-out', 'x')).toBe(false);
  });
  it('markAborted still writes aborted/Aborted(reason)/abortedAt (unchanged)', () => {
    const dir = tmpSession();
    expect(markAborted(dir, 'SIGINT')).toBe(true);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(m.status).toBe('aborted');
    expect(m.reason).toBe('Aborted (SIGINT)');
    expect(typeof m.abortedAt).toBe('string');
  });
});
