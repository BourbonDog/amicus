/**
 * Auto-generated CLAUDE.md section tests.
 *
 * Tests for scripts/generate-docs.js which builds directory trees,
 * module indexes, and manages marker-delimited sections in CLAUDE.md.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  buildDirectoryTree,
  buildModuleIndex,
  replaceMarkers,
  validateCrossLinks,
  buildPlansIndex,
  checkMarkersAreCurrent,
  extractJSDocDescription,
  extractExports,
} = require('../../scripts/generate-docs');

/** Create a temp directory for each test, cleaned up after. */
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-docs-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// extractJSDocDescription
// ---------------------------------------------------------------------------
describe('extractJSDocDescription', () => {
  it('extracts the first line of a JSDoc comment', () => {
    const filePath = path.join(tmpDir, 'mod.js');
    fs.writeFileSync(filePath, [
      '/**',
      ' * Context Drift Detection Module',
      ' *',
      ' * More details here.',
      ' */',
      'const x = 1;',
    ].join('\n'));
    expect(extractJSDocDescription(filePath)).toBe('Context Drift Detection Module');
  });

  it('returns empty string when no JSDoc exists', () => {
    const filePath = path.join(tmpDir, 'plain.js');
    fs.writeFileSync(filePath, 'const x = 1;\n');
    expect(extractJSDocDescription(filePath)).toBe('');
  });

  it('handles single-line JSDoc', () => {
    const filePath = path.join(tmpDir, 'one.js');
    fs.writeFileSync(filePath, '/** Short desc */\nmodule.exports = {};\n');
    expect(extractJSDocDescription(filePath)).toBe('Short desc');
  });

  it('ignores non-JSDoc block comments', () => {
    const filePath = path.join(tmpDir, 'block.js');
    fs.writeFileSync(filePath, '/* not jsdoc */\nconst x = 1;\n');
    expect(extractJSDocDescription(filePath)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractExports
// ---------------------------------------------------------------------------
describe('extractExports', () => {
  it('extracts named exports from module.exports object', () => {
    const filePath = path.join(tmpDir, 'exp.js');
    fs.writeFileSync(filePath, [
      'function foo() {}',
      'function bar() {}',
      'module.exports = {',
      '  foo,',
      '  bar,',
      '};',
    ].join('\n'));
    const exports = extractExports(filePath);
    expect(exports).toContain('foo');
    expect(exports).toContain('bar');
  });

  it('extracts exports.name = assignments', () => {
    const filePath = path.join(tmpDir, 'named.js');
    fs.writeFileSync(filePath, [
      'exports.alpha = function() {};',
      'exports.beta = 42;',
    ].join('\n'));
    const exports = extractExports(filePath);
    expect(exports).toContain('alpha');
    expect(exports).toContain('beta');
  });

  it('caps at 5 exports', () => {
    const filePath = path.join(tmpDir, 'many.js');
    fs.writeFileSync(filePath, [
      'module.exports = {',
      '  a, b, c, d, e, f, g,',
      '};',
    ].join('\n'));
    const exports = extractExports(filePath);
    expect(exports.length).toBeLessThanOrEqual(5);
  });

  it('returns empty array for files with no exports', () => {
    const filePath = path.join(tmpDir, 'none.js');
    fs.writeFileSync(filePath, 'const x = 1;\n');
    expect(extractExports(filePath)).toEqual([]);
  });

  it('uses only the key (not the value) for alias: original pairs (review finding)', () => {
    // Regression test: src/index.js re-exports canonical names as
    // `startAmicus: startSidecar` aliases. The exported name is the key
    // (startAmicus); the value (startSidecar) is an internal reference,
    // not itself part of the public API, and must not appear in the table.
    const filePath = path.join(tmpDir, 'idx.js');
    fs.writeFileSync(filePath, [
      'module.exports = {',
      '  // Canonical Amicus public API',
      '  startAmicus: startSidecar,',
      '  listAmicus: listSidecars,',
      '  resumeAmicus: resumeSidecar,',
      '  continueAmicus: continueSidecar,',
      '  readAmicus: readSidecar,',
      '};',
    ].join('\n'));
    const exports = extractExports(filePath);
    expect(exports).toEqual(['startAmicus', 'listAmicus', 'resumeAmicus', 'continueAmicus', 'readAmicus']);
    expect(exports).not.toContain('startSidecar');
    expect(exports).not.toContain('listSidecars');
  });

  it('ignores // comment text inside the exports object body', () => {
    const filePath = path.join(tmpDir, 'commented.js');
    fs.writeFileSync(filePath, [
      'module.exports = {',
      '  // some prose here',
      '  foo,',
      '};',
    ].join('\n'));
    const exports = extractExports(filePath);
    expect(exports).toEqual(['foo']);
  });
});

// ---------------------------------------------------------------------------
// buildDirectoryTree
// ---------------------------------------------------------------------------
describe('buildDirectoryTree', () => {
  it('builds a tree with files and directories', () => {
    // Create structure: root/src/foo.js, root/src/utils/bar.js
    const srcDir = path.join(tmpDir, 'src');
    const utilsDir = path.join(srcDir, 'utils');
    fs.mkdirSync(utilsDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'foo.js'), '/** Foo module */\nmodule.exports = {};\n');
    fs.writeFileSync(path.join(utilsDir, 'bar.js'), '/** Bar util */\nmodule.exports = {};\n');

    const tree = buildDirectoryTree(tmpDir, ['src/']);
    expect(tree).toContain('src/');
    expect(tree).toContain('foo.js');
    expect(tree).toContain('utils/');
    expect(tree).toContain('bar.js');
  });

  it('sorts directories before files', () => {
    const srcDir = path.join(tmpDir, 'src');
    const subDir = path.join(srcDir, 'aaa');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'zzz.js'), '');
    fs.writeFileSync(path.join(subDir, 'inner.js'), '');

    const tree = buildDirectoryTree(tmpDir, ['src/']);
    const lines = tree.split('\n');
    // The subdirectory 'aaa/' should appear before file 'zzz.js'
    const aaaIdx = lines.findIndex(l => l.includes('aaa/'));
    const zzzIdx = lines.findIndex(l => l.includes('zzz.js'));
    expect(aaaIdx).toBeLessThan(zzzIdx);
  });

  it('uses tree connectors', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'a.js'), '');
    fs.writeFileSync(path.join(srcDir, 'b.js'), '');

    const tree = buildDirectoryTree(tmpDir, ['src/']);
    // Should have either ├── or └── connectors
    expect(tree).toMatch(/[├└]──/);
  });

  it('skips directories in SKIP_DIRS', () => {
    const srcDir = path.join(tmpDir, 'src');
    const nodeModules = path.join(srcDir, 'node_modules');
    fs.mkdirSync(nodeModules, { recursive: true });
    fs.writeFileSync(path.join(nodeModules, 'pkg.js'), '');
    fs.writeFileSync(path.join(srcDir, 'real.js'), '');

    const tree = buildDirectoryTree(tmpDir, ['src/']);
    expect(tree).not.toContain('node_modules');
    expect(tree).toContain('real.js');
  });

  it('skips dotfiles', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, '.hidden'), '');
    fs.writeFileSync(path.join(srcDir, 'visible.js'), '');

    const tree = buildDirectoryTree(tmpDir, ['src/']);
    expect(tree).not.toContain('.hidden');
    expect(tree).toContain('visible.js');
  });

  it('includes JSDoc annotations for .js files', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'mod.js'), '/** My Module */\nmodule.exports = {};\n');

    const tree = buildDirectoryTree(tmpDir, ['src/']);
    expect(tree).toContain('mod.js');
    // The annotation should appear on the same line
    const modLine = tree.split('\n').find(l => l.includes('mod.js'));
    expect(modLine).toContain('My Module');
  });

  it('handles multiple top-level dirs', () => {
    fs.mkdirSync(path.join(tmpDir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'bin', 'cli.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.js'), '');

    const tree = buildDirectoryTree(tmpDir, ['bin/', 'src/']);
    expect(tree).toContain('bin/');
    expect(tree).toContain('src/');
    expect(tree).toContain('cli.js');
    expect(tree).toContain('main.js');
  });
});

// ---------------------------------------------------------------------------
// buildModuleIndex
// ---------------------------------------------------------------------------
describe('buildModuleIndex', () => {
  it('builds a markdown table with module info', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'cli.js'), [
      '/** CLI Argument Parser */',
      'function parseArgs() {}',
      'module.exports = { parseArgs };',
    ].join('\n'));

    const table = buildModuleIndex(tmpDir);
    expect(table).toContain('| Module');
    expect(table).toContain('| Purpose');
    expect(table).toContain('| Key Exports');
    expect(table).toContain('cli.js');
    expect(table).toContain('CLI Argument Parser');
    expect(table).toContain('parseArgs');
  });

  it('includes files in subdirectories', () => {
    const srcDir = path.join(tmpDir, 'src');
    const utilsDir = path.join(srcDir, 'utils');
    fs.mkdirSync(utilsDir, { recursive: true });
    fs.writeFileSync(path.join(utilsDir, 'logger.js'), [
      '/** Structured logging */',
      'exports.logger = {};',
    ].join('\n'));

    const table = buildModuleIndex(tmpDir);
    expect(table).toContain('utils/logger.js');
    expect(table).toContain('Structured logging');
  });

  it('returns header-only table for empty src/', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const table = buildModuleIndex(tmpDir);
    const lines = table.trim().split('\n');
    // Header row + separator row, no data rows
    expect(lines.length).toBe(2);
  });

  it('handles files with no JSDoc gracefully', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'bare.js'), 'const x = 1;\n');

    const table = buildModuleIndex(tmpDir);
    expect(table).toContain('bare.js');
    // Purpose column should still be present (just empty or dash)
    expect(table).toContain('|');
  });
});

// ---------------------------------------------------------------------------
// replaceMarkers
// ---------------------------------------------------------------------------
describe('replaceMarkers', () => {
  it('replaces content between markers', () => {
    const content = [
      '# Header',
      '<!-- AUTO:tree -->',
      'old tree content',
      '<!-- /AUTO:tree -->',
      '# Footer',
    ].join('\n');

    const result = replaceMarkers(content, 'tree', 'new tree content');
    expect(result).toContain('new tree content');
    expect(result).not.toContain('old tree content');
    expect(result).toContain('<!-- AUTO:tree -->');
    expect(result).toContain('<!-- /AUTO:tree -->');
    expect(result).toContain('# Header');
    expect(result).toContain('# Footer');
  });

  it('preserves content outside markers', () => {
    const content = [
      'before',
      '<!-- AUTO:x -->',
      'old',
      '<!-- /AUTO:x -->',
      'after',
    ].join('\n');

    const result = replaceMarkers(content, 'x', 'new');
    expect(result).toContain('before');
    expect(result).toContain('after');
  });

  it('handles multiple different markers', () => {
    const content = [
      '<!-- AUTO:a -->',
      'old-a',
      '<!-- /AUTO:a -->',
      'middle',
      '<!-- AUTO:b -->',
      'old-b',
      '<!-- /AUTO:b -->',
    ].join('\n');

    let result = replaceMarkers(content, 'a', 'new-a');
    result = replaceMarkers(result, 'b', 'new-b');
    expect(result).toContain('new-a');
    expect(result).toContain('new-b');
    expect(result).not.toContain('old-a');
    expect(result).not.toContain('old-b');
    expect(result).toContain('middle');
  });

  it('returns content unchanged if marker not found', () => {
    const content = '# No markers here\nJust text.';
    const result = replaceMarkers(content, 'missing', 'new stuff');
    expect(result).toBe(content);
  });

  it('handles empty new content', () => {
    const content = [
      '<!-- AUTO:x -->',
      'old',
      '<!-- /AUTO:x -->',
    ].join('\n');

    const result = replaceMarkers(content, 'x', '');
    expect(result).toContain('<!-- AUTO:x -->');
    expect(result).toContain('<!-- /AUTO:x -->');
    expect(result).not.toContain('old');
  });
});

// ---------------------------------------------------------------------------
// validateCrossLinks
// ---------------------------------------------------------------------------
describe('validateCrossLinks', () => {
  it('returns no errors for valid links', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Hi');
    fs.writeFileSync(path.join(tmpDir, 'other.js'), '');
    const md = '[readme](README.md) and [code](other.js)';
    const errors = validateCrossLinks(md, tmpDir);
    expect(errors).toHaveLength(0);
  });

  it('reports broken links', () => {
    const md = '[missing](does-not-exist.md)';
    const errors = validateCrossLinks(md, tmpDir);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('does-not-exist.md');
  });

  it('skips http/https URLs', () => {
    const md = '[site](https://example.com) and [api](http://api.dev)';
    const errors = validateCrossLinks(md, tmpDir);
    expect(errors).toHaveLength(0);
  });

  it('skips anchor-only links', () => {
    const md = '[section](#some-heading)';
    const errors = validateCrossLinks(md, tmpDir);
    expect(errors).toHaveLength(0);
  });

  it('handles links with subdirectory paths', () => {
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'guide.md'), '');
    const md = '[guide](docs/guide.md)';
    const errors = validateCrossLinks(md, tmpDir);
    expect(errors).toHaveLength(0);
  });

  it('strips anchor from file paths before checking', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Hi');
    const md = '[section](README.md#installation)';
    const errors = validateCrossLinks(md, tmpDir);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildPlansIndex
// ---------------------------------------------------------------------------
describe('buildPlansIndex', () => {
  it('lists plan files from docs/plans/', () => {
    const plansDir = path.join(tmpDir, 'docs', 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(path.join(plansDir, '2026-03-06-cool-design.md'), '# Cool Design');
    fs.writeFileSync(path.join(plansDir, '2026-03-06-cool-plan.md'), '# Cool Plan');

    const index = buildPlansIndex(tmpDir);
    expect(index).toContain('2026-03-06-cool-design.md');
    expect(index).toContain('2026-03-06-cool-plan.md');
  });

  it('lists plan files from docs/archive/plans/', () => {
    const archiveDir = path.join(tmpDir, 'docs', 'archive', 'plans');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, '2026-01-01-old-plan.md'), '# Old');

    const index = buildPlansIndex(tmpDir);
    expect(index).toContain('2026-01-01-old-plan.md');
  });

  it('separates active and archived plans', () => {
    const plansDir = path.join(tmpDir, 'docs', 'plans');
    const archiveDir = path.join(tmpDir, 'docs', 'archive', 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(plansDir, 'active.md'), '');
    fs.writeFileSync(path.join(archiveDir, 'archived.md'), '');

    const index = buildPlansIndex(tmpDir);
    expect(index).toContain('Active');
    expect(index).toContain('Archive');
  });

  it('returns empty message when no plans exist', () => {
    // No docs/plans/ directory at all
    const index = buildPlansIndex(tmpDir);
    expect(index).toMatch(/no plan/i);
  });
});

// ---------------------------------------------------------------------------
// checkMarkersAreCurrent
// ---------------------------------------------------------------------------
describe('checkMarkersAreCurrent', () => {
  it('returns empty array when markers match', () => {
    const doc = [
      '<!-- AUTO:tree -->',
      'current tree',
      '<!-- /AUTO:tree -->',
    ].join('\n');
    const generated = { tree: 'current tree' };
    const stale = checkMarkersAreCurrent(doc, generated);
    expect(stale).toHaveLength(0);
  });

  it('reports stale markers', () => {
    const doc = [
      '<!-- AUTO:tree -->',
      'old tree',
      '<!-- /AUTO:tree -->',
    ].join('\n');
    const generated = { tree: 'new tree' };
    const stale = checkMarkersAreCurrent(doc, generated);
    expect(stale).toContain('tree');
  });

  it('checks multiple markers', () => {
    const doc = [
      '<!-- AUTO:tree -->',
      'ok tree',
      '<!-- /AUTO:tree -->',
      '<!-- AUTO:modules -->',
      'stale modules',
      '<!-- /AUTO:modules -->',
    ].join('\n');
    const generated = { tree: 'ok tree', modules: 'new modules' };
    const stale = checkMarkersAreCurrent(doc, generated);
    expect(stale).toContain('modules');
    expect(stale).not.toContain('tree');
  });

  it('reports marker as stale if not found in doc', () => {
    const doc = '# No markers';
    const generated = { tree: 'some content' };
    const stale = checkMarkersAreCurrent(doc, generated);
    expect(stale).toContain('tree');
  });
});
