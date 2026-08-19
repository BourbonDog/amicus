/**
 * Cross-file citation gate tests.
 *
 * This file is in check-citations CONFIG.exclude — it carries deliberately
 * broken citations as fixtures, and the gate would otherwise flag its own
 * test data.
 */

const {
  countLines,
  parseCitations,
  resolveTarget,
  checkCitation,
  checkCitations,
  scopeForCommit,
  scanSet,
  buildContext,
  checkAllTracked,
  listTrackedFiles,
  CONFIG,
} = require('../../scripts/check-citations');

/** A tree stub: tracked paths -> content. */
function stubCtx(tree, refs = {}, config = CONFIG, shallow = false) {
  return {
    tracked: Object.keys(tree),
    config,
    shallow,
    skippedRefs: [],
    readFile: p => tree[p],
    readAtRef: (ref, p) => {
      // Mirror the real reader: resolve the cited path against the tracked
      // set first, so a basename citation finds its full-path ref entry.
      const clean = p.replace(/^\.\//, '');
      const tracked = Object.keys(tree);
      const target = tracked.find(f => f === clean || f.endsWith('/' + clean)) || clean;
      const key = `${ref}:${target}`;
      if (!(key in refs)) throw new Error('bad ref');
      return refs[key];
    },
  };
}

const one = (text, container, ctx) => checkCitation(parseCitations(text)[0], container, ctx);

describe('check-citations', () => {
  describe('countLines', () => {
    it('mirrors check-file-sizes: trailing newline is not a line', () => {
      expect(countLines('a\nb\n')).toBe(2);
      expect(countLines('a\nb')).toBe(2);
      expect(countLines('')).toBe(1);
    });
  });

  describe('parseCitations', () => {
    it('parses a plain line citation', () => {
      const [c] = parseCitations('// see tally.js:110');
      expect(c).toMatchObject({ path: 'tally.js', start: 110, end: 110, ref: null, symbol: null });
    });

    it('parses a range, keeping the high line as end', () => {
      const [c] = parseCitations('// see tally.js:151-176');
      expect(c).toMatchObject({ start: 151, end: 176 });
    });

    it('parses a symbol anchor', () => {
      const [c] = parseCitations('// see tally.js :: tally');
      expect(c).toMatchObject({ path: 'tally.js', symbol: 'tally', start: null });
    });

    it('parses the historical @ref form', () => {
      const [c] = parseCitations('// moved from run.js@6b0c3b6b:242-288');
      expect(c).toMatchObject({ path: 'run.js', ref: '6b0c3b6b', start: 242, end: 288 });
    });

    it('keeps a dotted filename as one token', () => {
      // The naive [a-z0-9-]+\.js pattern splits this into "test.js" and
      // silently mis-attributes the citation to a file that does not exist.
      const [c] = parseCitations('// see run-retry.test.js:628');
      expect(c.path).toBe('run-retry.test.js');
    });

    it('finds every citation on one line', () => {
      expect(parseCitations('// tally.js:110 and tally.js:148')).toHaveLength(2);
    });

    it('records the line the citation sits on', () => {
      expect(parseCitations('a\nb\n// tally.js:1')[0].line).toBe(3);
    });

    it('ignores a bare filename with no locator', () => {
      expect(parseCitations('// require("./tally.js")')).toHaveLength(0);
    });
  });

  describe('resolveTarget', () => {
    const tracked = ['src/council/tally.js', 'src/council/run.js', 'electron/ui/run.js'];

    it('resolves an exact tracked path', () => {
      expect(resolveTarget('src/council/tally.js', tracked)).toEqual(['src/council/tally.js']);
    });

    it('resolves by basename when only the filename is cited', () => {
      expect(resolveTarget('tally.js', tracked)).toEqual(['src/council/tally.js']);
    });

    it('strips a leading ./', () => {
      expect(resolveTarget('./tally.js', tracked)).toEqual(['src/council/tally.js']);
    });

    it('falls back to basename when a prose prefix is not a real directory', () => {
      // "deriveSeatLoss/verdict.js:41-47" means the symbol, then the file.
      expect(resolveTarget('deriveSeatLoss/tally.js', tracked)).toEqual(['src/council/tally.js']);
    });

    it('returns every match when a basename is ambiguous', () => {
      expect(resolveTarget('run.js', tracked)).toHaveLength(2);
    });

    it('returns empty for an unknown file', () => {
      expect(resolveTarget('nope.js', tracked)).toEqual([]);
    });
  });

  describe('checkCitation — line form', () => {
    const ctx = stubCtx({ 'src/council/tally.js': 'x\n'.repeat(180) });

    it('passes a line inside the file', () => {
      expect(one('// tally.js:110', 'src/a.js', ctx)).toBeNull();
    });

    it('passes the exact last line', () => {
      expect(one('// tally.js:180', 'src/a.js', ctx)).toBeNull();
    });

    it('fails one line past EOF', () => {
      expect(one('// tally.js:181', 'src/a.js', ctx).reason).toMatch(/past EOF/);
    });

    it('range-checks the high line, not the low one', () => {
      expect(one('// tally.js:1-181', 'src/a.js', ctx).reason).toMatch(/line 181/);
    });

    it('fails when no tracked file matches', () => {
      expect(one('// nope.js:1', 'src/a.js', ctx).reason).toMatch(/no tracked file/);
    });
  });

  describe('checkCitation — symbol anchor', () => {
    const ctx = stubCtx({ 'src/council/tally.js': 'function tally() {}\n' });

    it('passes when the symbol is present', () => {
      expect(one('// tally.js :: tally', 'src/a.js', ctx)).toBeNull();
    });

    it('fails when the symbol is absent', () => {
      expect(one('// tally.js :: nope', 'src/a.js', ctx).reason).toMatch(/symbol 'nope' not found/);
    });

    it('does not match a symbol as a substring of a longer identifier', () => {
      const c = stubCtx({ 'src/council/tally.js': 'function tallyEverything() {}\n' });
      expect(one('// tally.js :: tally', 'src/a.js', c)).not.toBeNull();
    });
  });

  describe('checkCitation — historical @ref form', () => {
    const ctx = stubCtx(
      { 'src/council/run.js': 'x\n'.repeat(281) },
      { 'old:src/council/run.js': 'x\n'.repeat(295) }
    );

    it('passes a range valid at that ref but NOT at HEAD', () => {
      // 288 > 281 (HEAD) but <= 295 (at the ref). This is the whole point of
      // the form: provenance that stays checkable instead of reading as rot.
      expect(one('// run.js@old:242-288', 'src/a.js', ctx)).toBeNull();
      expect(one('// run.js:242-288', 'src/a.js', ctx).reason).toMatch(/past EOF/);
    });

    it('fails a line past EOF even at that ref', () => {
      expect(one('// run.js@old:242-999', 'src/a.js', ctx).reason).toMatch(/past EOF.*at old/);
    });

    it('fails an unresolvable ref', () => {
      expect(one('// run.js@nope:1', 'src/a.js', ctx).reason).toMatch(/does not resolve/);
    });
  });

  describe('checkCitation — shallow clone', () => {
    // actions/checkout defaults to fetch-depth 1, so a historical commit is
    // simply ABSENT — indistinguishable from a bogus ref. Skipping is the only
    // correct call, but it must be reported, never silent.
    const shallow = stubCtx({ 'src/council/run.js': 'x\n' }, {}, CONFIG, true);

    it('skips an unresolvable ref instead of failing', () => {
      expect(one('// run.js@old:242-288', 'src/a.js', shallow)).toBeNull();
    });

    it('records what it skipped, so the skip can be reported', () => {
      const c = stubCtx({ 'src/council/run.js': 'x\n' }, {}, CONFIG, true);
      one('// run.js@old:242-288', 'src/a.js', c);
      expect(c.skippedRefs).toHaveLength(1);
      expect(c.skippedRefs[0]).toContain('run.js@old:242-288');
    });

    it('does NOT skip on a full clone — same input, opposite verdict', () => {
      const full = stubCtx({ 'src/council/run.js': 'x\n' }, {}, CONFIG, false);
      expect(one('// run.js@old:242-288', 'src/a.js', full)).not.toBeNull();
      expect(full.skippedRefs).toHaveLength(0);
    });

    it('still range-checks a ref the shallow clone DOES have', () => {
      const c = stubCtx({ 'src/council/run.js': 'x\n' },
        { 'old:src/council/run.js': 'x\n'.repeat(295) }, CONFIG, true);
      expect(one('// run.js@old:242-999', 'src/a.js', c)).not.toBeNull();
      expect(c.skippedRefs).toHaveLength(0);
    });
  });

  describe('checkCitation — allowlists', () => {
    const config = {
      ...CONFIG,
      external: ['dist/server.js'],
      grandfathered: [{ file: 'tests/a.test.js', cite: 'run.js:999' }],
    };
    const ctx = stubCtx({ 'src/council/run.js': 'x\n' }, {}, config);

    it('skips an external target', () => {
      expect(one('// `dist/server.js:4-8`', 'src/a.js', ctx)).toBeNull();
    });

    it('skips a grandfathered citation in its own file', () => {
      expect(one('// run.js:999', 'tests/a.test.js', ctx)).toBeNull();
    });

    it('still fails the same citation in a different file', () => {
      // Grandfathering is per site, so copying a stale citation elsewhere
      // does not inherit the exemption.
      expect(one('// run.js:999', 'tests/b.test.js', ctx)).not.toBeNull();
    });
  });

  describe('scopeForCommit', () => {
    // The load-bearing design decision. Measured over PR #171: 18 of 84
    // attributable citation corrections were in files the breaking commit
    // never touched, so IN-scope alone is not sufficient.
    const tree = {
      'src/council/run-retry.js': 'code\n',
      'src/headless.js': '// see run-retry.js:54\n',
      'tests/unrelated.test.js': '// nothing to see\n',
    };
    const scanned = Object.keys(tree);
    const read = p => tree[p];

    it('includes the changed file itself (IN)', () => {
      expect(scopeForCommit(['src/council/run-retry.js'], scanned, read))
        .toContain('src/council/run-retry.js');
    });

    it('includes a file that CITES the changed file (TO)', () => {
      expect(scopeForCommit(['src/council/run-retry.js'], scanned, read))
        .toContain('src/headless.js');
    });

    it('excludes files with no relationship to the change', () => {
      expect(scopeForCommit(['src/council/run-retry.js'], scanned, read))
        .not.toContain('tests/unrelated.test.js');
    });

    it('is empty when the commit touches nothing cited and nothing scanned', () => {
      expect(scopeForCommit(['README.md'], scanned, read)).toEqual([]);
    });

    it('picks up a citation written as a full path', () => {
      const t = { ...tree, 'src/headless.js': '// see src/council/run-retry.js:54\n' };
      expect(scopeForCommit(['src/council/run-retry.js'], Object.keys(t), p => t[p]))
        .toContain('src/headless.js');
    });
  });

  describe('scanSet', () => {
    it('covers live code and skips the doc tree', () => {
      const s = scanSet(['src/a.js', 'electron/b.js', 'tests/c.test.js', 'BACKLOG.md', 'docs/d.md']);
      expect(s).toEqual(['src/a.js', 'electron/b.js', 'tests/c.test.js']);
    });

    it('excludes this test file, which carries broken fixtures', () => {
      expect(scanSet(['tests/scripts/check-citations.test.js'])).toEqual([]);
    });
  });

  describe('the real tree', () => {
    it('has no stale citations in live code', () => {
      expect(checkAllTracked()).toEqual([]);
    });

    it('every grandfathered entry still names a live citation', () => {
      // Keeps the burn-down list honest: once a citation is fixed, its entry
      // must be deleted, or this fails and the list quietly rots instead.
      const tracked = listTrackedFiles();
      const ctx = buildContext(tracked);
      const stale = CONFIG.grandfathered.filter(g => {
        let content;
        try { content = ctx.readFile(g.file); } catch { return true; }
        return !parseCitations(content).some(c => c.raw === g.cite);
      });
      expect(stale).toEqual([]);
    });
  });

  describe('checkCitations', () => {
    it('reports the container file and line of each violation', () => {
      const ctx = stubCtx({ 'src/council/tally.js': 'x\n' });
      const v = checkCitations([{ path: 'src/a.js', content: '\n// tally.js:99\n' }], ctx);
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ file: 'src/a.js', line: 2, cite: 'tally.js:99' });
    });
  });
});
