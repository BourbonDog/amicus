/**
 * Index-content reader tests.
 *
 * The parse is byte-offset based because `git cat-file --batch` reports SIZES
 * IN BYTES. Slicing a JS string by those numbers desyncs on the first
 * multi-byte character, and this repo's comments are full of em-dashes — so the
 * multi-byte cases here are the point of the file, not an edge case.
 */

const { parseBatch, readIndexContent, readIndexFile } = require('../../scripts/git-index');

/** Build a realistic `git cat-file --batch` response. */
function batchOf(entries) {
  const parts = [];
  for (const e of entries) {
    if (e.missing) {
      parts.push(Buffer.from(`:${e.path} missing\n`, 'utf-8'));
      continue;
    }
    const body = Buffer.from(e.content, 'utf-8');
    parts.push(Buffer.from(`abc123 blob ${body.length}\n`, 'utf-8'), body, Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}

describe('git-index', () => {
  describe('parseBatch', () => {
    it('maps each response to its requested path, in order', () => {
      const buf = batchOf([{ content: 'one\n' }, { content: 'two\n' }]);
      const got = parseBatch(buf, ['a.js', 'b.js']);
      expect(got.get('a.js')).toBe('one\n');
      expect(got.get('b.js')).toBe('two\n');
    });

    it('omits a missing path without desyncing the ones after it', () => {
      // A "missing" entry is what a staged DELETION looks like. If the parse
      // consumed it as a body, every later file would get another's content.
      const buf = batchOf([
        { content: 'first\n' },
        { path: 'gone.js', missing: true },
        { content: 'third\n' },
      ]);
      const got = parseBatch(buf, ['a.js', 'gone.js', 'c.js']);
      expect(got.has('gone.js')).toBe(false);
      expect(got.get('a.js')).toBe('first\n');
      expect(got.get('c.js')).toBe('third\n');
    });

    it('reads multi-byte content without truncating it', () => {
      // 'x — y' is 7 bytes but 5 characters. A char-indexed slice would cut it
      // short and silently corrupt every entry after it.
      const content = 'const a = 1; // x — y\n';
      const got = parseBatch(batchOf([{ content }, { content: 'after\n' }]), ['a.js', 'b.js']);
      expect(got.get('a.js')).toBe(content);
      expect(got.get('b.js')).toBe('after\n');
    });

    it('handles an empty blob', () => {
      const got = parseBatch(batchOf([{ content: '' }, { content: 'next\n' }]), ['a.js', 'b.js']);
      expect(got.get('a.js')).toBe('');
      expect(got.get('b.js')).toBe('next\n');
    });

    it('stops cleanly on truncated output rather than throwing', () => {
      expect(parseBatch(Buffer.from('abc123 blob 99\nshort'), ['a.js']).get('a.js'))
        .toBe('short');
    });
  });

  describe('readIndexContent', () => {
    it('asks git for :path, one line per file', () => {
      let asked = null;
      readIndexContent(['src/a.js', 'b.js'], input => {
        asked = input;
        return batchOf([{ content: 'x' }, { content: 'y' }]);
      });
      expect(asked).toBe(':src/a.js\n:b.js\n');
    });

    it('does not spawn git for an empty list', () => {
      let called = false;
      const got = readIndexContent([], () => { called = true; return Buffer.alloc(0); });
      expect(called).toBe(false);
      expect(got.size).toBe(0);
    });
  });

  describe('readIndexFile', () => {
    it('returns the content when the path is in the index', () => {
      expect(readIndexFile('a.js', () => batchOf([{ content: 'hi\n' }]))).toBe('hi\n');
    });

    it('returns null when the path is not in the index', () => {
      expect(readIndexFile('a.js', () => batchOf([{ path: 'a.js', missing: true }]))).toBeNull();
    });
  });

  describe('against the real repository', () => {
    it('reads a real tracked file out of the index', () => {
      const pkg = readIndexFile('package.json');
      expect(pkg).toContain('"name"');
      expect(JSON.parse(pkg).scripts['check:citations']).toBeDefined();
    });

    it('returns null for a path that is not tracked', () => {
      expect(readIndexFile('no/such/file/anywhere.js')).toBeNull();
    });
  });
});
