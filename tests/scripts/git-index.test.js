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

const NUL = String.fromCharCode(0);

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

    // FAIL CLOSED. Callers read an absent path as a staged deletion and SKIP it,
    // so any silently-dropped entry makes check-secrets quietly not scan a file
    // — a fail-OPEN on the highest-consequence gate in the repo. Every protocol
    // deviation must throw instead.
    it('THROWS on truncated output rather than returning a partial blob', () => {
      expect(() => parseBatch(Buffer.from('abc123 blob 99\nshort'), ['a.js']))
        .toThrow(/truncated output for a\.js/);
    });

    it('THROWS when git returns fewer entries than were requested', () => {
      expect(() => parseBatch(batchOf([{ content: 'hi\n' }]), ['a.js', 'b.js']))
        .toThrow(/ended after 1 of 2 entries/);
    });

    it('THROWS on an unparseable size header instead of desyncing', () => {
      // Skipping the entry without advancing past its body would read the NEXT
      // body as a header and corrupt everything after it.
      expect(() => parseBatch(Buffer.from('abc blob NOTANUMBER\nbody\n'), ['a.js']))
        .toThrow(/unparseable size in header/);
    });

    it('THROWS on an unterminated header', () => {
      expect(() => parseBatch(Buffer.from('abc blob'), ['a.js']))
        .toThrow(/unterminated header/);
    });

    it('does NOT throw for an explicit `missing` — the one legitimate absence', () => {
      const got = parseBatch(batchOf([{ path: 'gone.js', missing: true }]), ['gone.js']);
      expect(got.size).toBe(0);
    });
  });

  describe('chunking', () => {
    it('splits a large path list across calls, bounding each buffer', () => {
      const calls = [];
      const paths = Array.from({ length: 250 }, (_, i) => `f${i}.js`);
      readIndexContent(paths, input => {
        const want = input.split(NUL).filter(Boolean);
        calls.push(want.length);
        return batchOf(want.map(() => ({ content: 'x\n' })));
      }, 100);
      expect(calls).toEqual([100, 100, 50]);
    });

    it('returns every path across the chunk boundary', () => {
      const paths = Array.from({ length: 30 }, (_, i) => `f${i}.js`);
      const got = readIndexContent(paths, input => {
        const want = input.split(NUL).filter(Boolean);
        return batchOf(want.map(p => ({ content: `body-${p.slice(1)}\n` })));
      }, 7);
      expect(got.size).toBe(30);
      expect(got.get('f0.js')).toBe('body-f0.js\n');
      expect(got.get('f29.js')).toBe('body-f29.js\n');
    });
  });

  describe('readIndexContent', () => {
    it('asks git for :path, NUL-terminated per file', () => {
      // NUL, not newline: a path may contain a newline, and `--batch -z` is what
      // lets such a path round-trip instead of being quoted into something that
      // resolves to nothing and gets silently skipped.
      let asked = null;
      readIndexContent(['src/a.js', 'b.js'], input => {
        asked = input;
        return batchOf([{ content: 'x' }, { content: 'y' }]);
      });
      expect(asked).toBe(`:src/a.js${NUL}:b.js${NUL}`);
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
