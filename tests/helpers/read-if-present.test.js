// tests/helpers/read-if-present.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { readIfPresent } = require('./read-if-present');

describe('helpers/read-if-present: readIfPresent() contract', () => {
  let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-if-present-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('returns the contents of a file that exists', () => {
    const file = path.join(dir, 'present.js');
    fs.writeFileSync(file, "require('extract-zip');\n");
    expect(readIfPresent(file)).toBe("require('extract-zip');\n");
  });

  test('returns null for a file that vanished between the listing and the read', () => {
    const file = path.join(dir, 'vanished.js');
    fs.writeFileSync(file, 'const x = 1;\n');
    fs.unlinkSync(file); // exactly the race: named by readdirSync, gone by the read
    expect(readIfPresent(file)).toBeNull();
  });

  test('rethrows a non-ENOENT failure instead of swallowing it', () => {
    // Reading a directory fails with EISDIR on POSIX. The assertion pins only
    // "threw, and not as ENOENT" so it holds on Windows dev and Linux CI alike —
    // the point is that absorbing ENOENT did not turn into a blanket catch.
    let caught = null;
    try { readIfPresent(dir); } catch (err) { caught = err; }
    expect(caught).not.toBeNull();
    expect(caught.code).not.toBe('ENOENT');
  });
});
