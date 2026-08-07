// tests/hermetic-tmp-guard.test.js
'use strict';
/**
 * v4.7 PR3 rider — no test may use a literal `/tmp` path.
 *
 * WHY THIS EXISTS. Found while measuring the `--all` output cap: the dev
 * machine's `C:\tmp\.claude\amicus_sessions` held 28,192 real session
 * directories, oldest 2026-06-08, and one run of tests/mcp-server.test.js added
 * 25 more. Those tests passed the literal `'/tmp'` as the project cwd; on
 * Windows `path.resolve('/tmp')` is `C:\tmp`, a real directory OUTSIDE any
 * sandbox, so every run leaked session dirs onto the developer's filesystem and
 * into the advisory sessions-index. `amicus list --all` then returned 21,145
 * rows in 8.3s — 98% of them this residue.
 *
 * It is the same failure family as the PR #96 doctor-test hermeticity fix: a
 * test that writes outside its sandbox is a test that pollutes whoever runs it.
 *
 * THE RULE. Use `fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-<what>-'))` and
 * remove it in afterEach/afterAll. `os.tmpdir()` is per-user and per-platform;
 * `/tmp` is neither on Windows.
 *
 * This is a static scan rather than a runtime check because the leak is silent
 * at runtime — nothing fails, the residue just accumulates.
 *
 * SCOPE. Only literals that reach the FILESYSTEM are flagged: a bare `'/tmp'`
 * (the cwd/project-root shape) and `path.join('/tmp', …)` / `fs.*Sync('/tmp…`.
 * A `/tmp/...` string used purely as a parse fixture or an expected value
 * (`parseArgs(['--session-dir', '/tmp/sessions'])`, a tool_use `input.path`)
 * never touches disk and is deliberately NOT flagged — rewriting those would
 * be churn, and some of them assert on the literal itself.
 */
const fs = require('fs');
const path = require('path');

const TESTS_ROOT = path.join(__dirname);
const SELF = path.basename(__filename);

/** Recursively collect every .test.js under tests/, excluding this guard. */
function collectTestFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') { continue; }
      out.push(...collectTestFiles(full));
    } else if (entry.name.endsWith('.test.js') && entry.name !== SELF) {
      out.push(full);
    }
  }
  return out;
}

// Shape 1: a bare '/tmp' literal — the cwd/project-root argument shape.
const BARE_TMP = /['"]\/tmp['"]/;
// Shape 2: a /tmp path handed straight to the filesystem.
const FS_TMP = /(?:path\.join\(|fs\.[a-zA-Z]+Sync\()\s*['"]\/tmp/;
// Comments mention '/tmp/x' when explaining this very rule — not code.
const IS_COMMENT = /^\s*(?:\/\/|\*|\/\*)/;

function offendingShape(line) {
  if (IS_COMMENT.test(line)) { return null; }
  if (BARE_TMP.test(line)) { return 'bare /tmp used as a directory root'; }
  if (FS_TMP.test(line)) { return '/tmp path passed to the filesystem'; }
  return null;
}

describe('no test uses a literal /tmp path (hermeticity)', () => {
  it('every test file sandboxes under os.tmpdir() instead', () => {
    const offenders = [];
    for (const file of collectTestFiles(TESTS_ROOT)) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        const shape = offendingShape(line);
        if (shape) {
          offenders.push(`${path.relative(TESTS_ROOT, file)}:${i + 1} (${shape})`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
