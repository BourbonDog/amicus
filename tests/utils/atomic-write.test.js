'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('../../src/utils/atomic-write');

describe('writeFileAtomic', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-atomic-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes the exact content to the target path', () => {
    const target = path.join(dir, 'out.json');
    writeFileAtomic(target, '{"a":1}\n', { mode: 0o600 });
    expect(fs.readFileSync(target, 'utf-8')).toBe('{"a":1}\n');
  });

  it('overwrites an existing file', () => {
    const target = path.join(dir, 'out.json');
    fs.writeFileSync(target, 'old');
    writeFileAtomic(target, 'new', { mode: 0o600 });
    expect(fs.readFileSync(target, 'utf-8')).toBe('new');
  });

  it('leaves no temp files behind after a successful write', () => {
    const target = path.join(dir, 'out.json');
    writeFileAtomic(target, 'data', { mode: 0o600 });
    const leftovers = fs.readdirSync(dir).filter(n => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('propagates errors and cleans up the temp file on failure', () => {
    // A directory that does not exist makes the temp write throw.
    const target = path.join(dir, 'missing-subdir', 'out.json');
    expect(() => writeFileAtomic(target, 'data', { mode: 0o600 })).toThrow();
    // The parent dir was never created, so nothing to leak; assert the target dir is clean.
    const leftovers = fs.readdirSync(dir).filter(n => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
