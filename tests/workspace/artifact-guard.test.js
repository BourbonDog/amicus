'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  artifactAllowlist, readRunArtifact, isRealpathContained,
  FIXED_ARTIFACTS, DEBATE_ARTIFACTS, MAX_ARTIFACT_BYTES,
} = require('../../src/workspace/artifact-guard');

const FX = path.join(__dirname, '..', 'fixtures');

// Every scratch dir created via mkScratchDir is swept in afterAll below, so temp-dir
// litter from this file doesn't accumulate across runs.
const SCRATCH_DIRS = [];
function mkScratchDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  SCRATCH_DIRS.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of SCRATCH_DIRS) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Council review R2 finding A1: readRunArtifact never checked that runDir (which comes
// straight from the pointer file's JSON, validated only for truthiness by
// src/council/run-state.js's readPointer) itself resolves inside project — only that the
// requested artifact resolves inside runDir. A real runDir is ALWAYS nested under project
// in production (src/mcp-council-run.js:109 rejects an outDir outside the project at
// creation time), so these fixtures now model that invariant for real instead of pointing
// project and runDir at two unrelated temp directories: seedProject nests a fresh, empty
// runDir under a fresh scratch project, and seedFromFixture copies a read-only
// tests/fixtures/* run into that nested runDir. A couple of tests below deliberately BREAK
// this invariant (a tampered/stale pointer) to prove the new outer fence refuses them.
function seedProject(runId = 'aaaa1111') {
  const project = mkScratchDir('ws-guard-');
  const sessions = path.join(project, '.claude', 'amicus_sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const runDir = path.join(project, 'runs', `council-${runId}`);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(sessions, `council-${runId}.json`), JSON.stringify({ runId, runDir }));
  return { project, runDir };
}

function seedFromFixture(fixtureName, runId = 'aaaa1111') {
  const seeded = seedProject(runId);
  fs.cpSync(path.join(FX, fixtureName), seeded.runDir, { recursive: true });
  return seeded;
}

/** A pointer whose runDir is NOT nested under project — the tampered/stale-pointer shape. */
function seedProjectWithExternalRunDir(runDir, runId = 'aaaa1111') {
  const project = mkScratchDir('ws-guard-outerfence-');
  const sessions = path.join(project, '.claude', 'amicus_sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, `council-${runId}.json`), JSON.stringify({ runId, runDir }));
  return project;
}

describe('artifactAllowlist', () => {
  test('fixed names plus sanitized review-/judge- files per bench seat', () => {
    const run = { bench: ['gemini', 'openrouter/deepseek/deepseek-chat'] };
    const list = artifactAllowlist(run);
    expect(list).toEqual(expect.arrayContaining([
      'briefing-stage1.md', 'bundle-stage2.md', 'chair-packet.md', 'chair-output.md', 'tally-input.json',
      'review-gemini.md', 'judge-gemini.md',
      'review-openrouter-deepseek-deepseek-chat.md', 'judge-openrouter-deepseek-deepseek-chat.md',
    ]));
    expect(list.some((n) => n.includes('/') || n.includes('\\') || n.includes('..'))).toBe(false);
  });

  test('missing/invalid bench yields fixed names only', () => {
    expect(artifactAllowlist({})).toHaveLength(5);
    expect(artifactAllowlist({ bench: 'nope' })).toHaveLength(5);
  });

  // ⚠️ DE-ROT (F28): v4.1 `--debate` runs write five MORE artifact kinds. They are gated
  // on run.debate, so both `toHaveLength(5)` asserts above stay correct as written.
  test('a --debate run also allows the v4.1 debate artifacts', () => {
    const list = artifactAllowlist({ bench: ['gemini'], debate: { enabled: true, outcome: 'ran' } });
    expect(list).toEqual(expect.arrayContaining([
      'tally-provisional.json', 'revote-bundle.md', 'debate.json', 'rebuttal-gemini.md', 'revote-gemini.md',
    ]));
    expect(artifactAllowlist({ bench: ['gemini'] })).not.toContain('debate.json');
  });

  test('duplicate bench entries do not produce duplicate allowlist rows', () => {
    const list = artifactAllowlist({ bench: ['gemini', 'gemini'] });
    expect(list.filter((n) => n === 'review-gemini.md')).toHaveLength(1);
    expect(list.filter((n) => n === 'judge-gemini.md')).toHaveLength(1);
  });

  // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): sanitizeName maps every
  // character outside [a-zA-Z0-9._-] to '-', so it is NOT injective — 'vendor/a' and 'vendor?a'
  // both become 'vendor-a'. The old code's final `[...new Set(names)]` silently deduped this
  // down to one row, so both models would request/share the SAME on-disk artifact and
  // drillIntoJudge's `[data-artifact="..."]` selector would hand back whichever model's prose
  // happened to match first — a run-integrity defect smoothed into a valid-looking allowlist.
  // The genuinely-identical-entries case (test above) must keep collapsing harmlessly; only a
  // collision between DISTINCT raw bench strings is a defect worth surfacing.
  test('two distinct bench entries that sanitize to the same name are surfaced as a collision, not silently deduped', () => {
    const list = artifactAllowlist({ bench: ['vendor/a', 'vendor?a'] });
    // The run directory cannot hold both models' files under one sanitized name — only one
    // review-/judge- row for it, exactly like the genuinely-duplicate case.
    expect(list.filter((n) => n === 'review-vendor-a.md')).toHaveLength(1);
    expect(list.filter((n) => n === 'judge-vendor-a.md')).toHaveLength(1);
    expect(list.collisions).toEqual([{ sanitized: 'vendor-a', models: ['vendor/a', 'vendor?a'] }]);
  });

  test('no collisions field when every bench entry sanitizes to a distinct name', () => {
    const list = artifactAllowlist({ bench: ['gemini', 'gpt'] });
    expect(list.collisions).toBeUndefined();
  });

  test('genuinely identical bench entries (harmless dedup) do not register as a collision', () => {
    const list = artifactAllowlist({ bench: ['gemini', 'gemini'] });
    expect(list.collisions).toBeUndefined();
  });

  test('a three-way collision groups all three offending models together', () => {
    const list = artifactAllowlist({ bench: ['vendor/a', 'vendor?a', 'vendor a'] });
    expect(list.collisions).toEqual([
      { sanitized: 'vendor-a', models: ['vendor/a', 'vendor?a', 'vendor a'] },
    ]);
    // Sorted raw models -> 'vendor a' (space, U+0020) < 'vendor/a' (slash, U+002F) <
    // 'vendor?a' (question mark, U+003F) by code point, so 'vendor a' keeps the bare
    // sanitized name and the other two get ~2/~3 in that sorted order (Task 18 / RN-1).
    expect(list.artifactsByModel).toEqual({
      'vendor a': {
        review: 'review-vendor-a.md', judge: 'judge-vendor-a.md',
        rebuttal: 'rebuttal-vendor-a.md', revote: 'revote-vendor-a.md',
      },
      'vendor/a': {
        review: 'review-vendor-a~2.md', judge: 'judge-vendor-a~2.md',
        rebuttal: 'rebuttal-vendor-a~2.md', revote: 'revote-vendor-a~2.md',
      },
      'vendor?a': {
        review: 'review-vendor-a~3.md', judge: 'judge-vendor-a~3.md',
        rebuttal: 'rebuttal-vendor-a~3.md', revote: 'revote-vendor-a~3.md',
      },
    });
  });

  // ⚠️ Task 18 (RN-1, R4 council review's own recommendation): the collision above is a real
  // run-integrity defect (the run directory physically holds ONE file for two colliding
  // sanitized names) that no renderer can undo — but a renderer showing model A's prose under
  // model B's name is a SEPARATE, fixable defect. Deterministic disambiguation: per colliding
  // sanitized name, sort the raw models; the first (sorted) keeps the bare sanitized name, the
  // rest get `~2`, `~3`, ... The suffixed names deliberately do not exist on disk — the
  // presence manifest (run-detail.js) marks them absent, so workspace-panels.js's presence
  // filter drops the second model's row entirely instead of rendering an empty state for it or
  // showing the first model's prose; the run-integrity banner (artifactCollisions) is what
  // tells the user why that row is missing.
  test('artifactsByModel suffixes every colliding model but the first (sorted), and the allowlist carries both suffixed rows', () => {
    const list = artifactAllowlist({ bench: ['vendor/a', 'vendor?a'] });
    expect(list).toEqual(expect.arrayContaining([
      'review-vendor-a.md', 'judge-vendor-a.md',
      'review-vendor-a~2.md', 'judge-vendor-a~2.md',
    ]));
    expect(list.collisions).toEqual([{ sanitized: 'vendor-a', models: ['vendor/a', 'vendor?a'] }]);
    expect(list.artifactsByModel).toEqual({
      'vendor/a': {
        review: 'review-vendor-a.md', judge: 'judge-vendor-a.md',
        rebuttal: 'rebuttal-vendor-a.md', revote: 'revote-vendor-a.md',
      },
      'vendor?a': {
        review: 'review-vendor-a~2.md', judge: 'judge-vendor-a~2.md',
        rebuttal: 'rebuttal-vendor-a~2.md', revote: 'revote-vendor-a~2.md',
      },
    });
  });

  test('artifactsByModel is the identity mapping (no suffixes) when no bench entries collide', () => {
    const list = artifactAllowlist({ bench: ['gemini', 'gpt'] });
    expect(list.artifactsByModel).toEqual({
      gemini: { review: 'review-gemini.md', judge: 'judge-gemini.md', rebuttal: 'rebuttal-gemini.md', revote: 'revote-gemini.md' },
      gpt: { review: 'review-gpt.md', judge: 'judge-gpt.md', rebuttal: 'rebuttal-gpt.md', revote: 'revote-gpt.md' },
    });
  });

  test('repeated identical bench entries collapse to one artifactsByModel row with NO suffix', () => {
    const list = artifactAllowlist({ bench: ['gemini', 'gemini'] });
    expect(list.artifactsByModel).toEqual({
      gemini: { review: 'review-gemini.md', judge: 'judge-gemini.md', rebuttal: 'rebuttal-gemini.md', revote: 'revote-gemini.md' },
    });
  });

  // ⚠️ Task 18 fix-wave (review finding 3): a bench mixing a genuine duplicate WITH a colliding
  // distinct entry was untested — duplicates must collapse via the raw-value Set BEFORE the
  // collision scan ever runs (so 'vendor/a' appearing twice never counts as a collision with
  // itself), and the surviving distinct pair must still disambiguate exactly as the two-model
  // collision case above.
  test('a duplicate raw entry alongside a colliding distinct entry: duplicates collapse first, then the collision suffixes normally', () => {
    const list = artifactAllowlist({ bench: ['vendor/a', 'vendor/a', 'vendor?a'] });
    expect(list.collisions).toEqual([{ sanitized: 'vendor-a', models: ['vendor/a', 'vendor?a'] }]);
    expect(list.artifactsByModel).toEqual({
      'vendor/a': {
        review: 'review-vendor-a.md', judge: 'judge-vendor-a.md',
        rebuttal: 'rebuttal-vendor-a.md', revote: 'revote-vendor-a.md',
      },
      'vendor?a': {
        review: 'review-vendor-a~2.md', judge: 'judge-vendor-a~2.md',
        rebuttal: 'rebuttal-vendor-a~2.md', revote: 'revote-vendor-a~2.md',
      },
    });
  });

  test('FIXED_ARTIFACTS and DEBATE_ARTIFACTS are frozen against consumer mutation', () => {
    expect(() => { FIXED_ARTIFACTS.push('evil'); }).toThrow();
    expect(() => { DEBATE_ARTIFACTS.push('evil'); }).toThrow();
  });
});

// Second council review finding A6: isRealpathContained double-separates when
// dirRealPath IS a filesystem root ('/' + path.sep -> '//'; 'C:\\' + path.sep ->
// 'C:\\\\'), so a real path directly under root never matches the startsWith
// check and containment wrongly returns false. Latent because project roots are
// rarely '/' or 'C:\\' themselves, but container/CI environments are exactly
// where a root-ish path shows up, and this primitive now backs BOTH readRunArtifact
// (fence 2) and workspace:open-report (electron/ipc-workspace.js).
//
// Root-form assertions are platform-guarded (mirrors tests/mcp-project-containment.test.js's
// existing `process.platform === 'win32' ? ... : ...` convention) because the function
// under test resolves its separator from the NATIVE `path` module — feeding it the other
// OS's literal separator style would fail regardless of correctness (a real cross-platform
// bug can't be observed by mixing separator conventions). The CI matrix (ci.yml runs both
// ubuntu-latest and windows-latest) exercises both root forms across the two OS legs.
describe('isRealpathContained', () => {
  const ROOT = process.platform === 'win32' ? 'C:\\' : '/';

  test('a direct child of the filesystem root IS contained (regression: double-separator bug)', () => {
    expect(isRealpathContained(ROOT, path.join(ROOT, 'foo'))).toBe(true);
  });

  test('the filesystem root contains itself', () => {
    expect(isRealpathContained(ROOT, ROOT)).toBe(true);
  });

  test('an ordinary (non-root) directory still contains its children and itself', () => {
    const dir = path.join(ROOT, 'a', 'b');
    expect(isRealpathContained(dir, path.join(dir, 'c'))).toBe(true);
    expect(isRealpathContained(dir, dir)).toBe(true);
  });

  test('a sibling directory sharing a name PREFIX is NOT contained (naive startsWith trap)', () => {
    const dir = path.join(ROOT, 'foo');
    const sibling = path.join(ROOT, 'foobar');
    expect(isRealpathContained(dir, sibling)).toBe(false);
  });

  test('an unrelated directory is NOT contained', () => {
    const dir = path.join(ROOT, 'a', 'b');
    const other = path.join(ROOT, 'a', 'c');
    expect(isRealpathContained(dir, other)).toBe(false);
  });
});

/**
 * SEC-3 — the fence's own precondition, checked in debug mode only.
 *
 * isRealpathContained is a pure string-prefix comparison and is sound ONLY if both
 * arguments were already resolved through realpathSync. Nothing enforced that, so a caller
 * who forgot got a silently WEAKER check rather than an error — and "silently weaker
 * security check" is the worst possible failure mode for a primitive four call sites lean on.
 *
 * The remedy has to be a DIAGNOSTIC, not a gate. Turning a forgotten realpathSync into a
 * throw would make the fence itself the outage — exactly the failure it exists to prevent —
 * so it is opt-in via AMICUS_DEBUG_FENCE=1, it only ever warns, and the answer it returns is
 * byte-identical either way. The last two tests here are the ones that matter: the flag can
 * never change the result, and nothing inside the diagnostic can escape as an exception.
 */
describe('isRealpathContained — SEC-3 debug-mode contract check', () => {
  const { logger } = require('../../src/utils/logger');
  // Native separators throughout: the function under test derives its separator from the
  // NATIVE `path` module, so a hand-written 'relative/dir' would answer differently on
  // Windows for reasons that have nothing to do with what is being tested (same convention
  // as the platform-guarded root-form assertions above).
  const REL_DIR = path.join('relative', 'dir');
  const REL_CHILD = path.join('relative', 'dir', 'child');
  let warn;

  beforeEach(() => { warn = jest.spyOn(logger, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); delete process.env.AMICUS_DEBUG_FENCE; });

  /** An absolute path that EXISTS but is not realpath-resolved (unnormalized `..` hop). */
  function unresolvedButReal() {
    // ⚠️ realpathSync is REQUIRED here, not cosmetic. os.tmpdir() is /var/folders/… on
    // macOS and /var is a symlink to /private/var, so a bare mkdtemp path is itself
    // unresolved there. `dir` is passed as dirRealPath, so leaving it unresolved makes
    // assertResolvedArgs — which checks BOTH arguments — fire twice on macOS while the
    // caller below asserts exactly one message about targetRealPath. Green on Windows and
    // Linux, red on macOS: caught by CI on PR #75, not locally.
    // The `..` in `unresolved` is what makes THAT path unresolved on every platform, which
    // is the single contract breach this fixture exists to produce.
    const dir = fs.realpathSync(mkScratchDir('ws-fence-'));
    fs.mkdirSync(path.join(dir, 'sub'));
    return { dir, unresolved: [dir, 'sub', '..', 'sub'].join(path.sep) };
  }

  test('the flag is OFF by default — no diagnostics, no cost, whatever the arguments', () => {
    expect(process.env.AMICUS_DEBUG_FENCE).toBeUndefined();
    isRealpathContained(REL_DIR, REL_CHILD);
    const { dir, unresolved } = unresolvedButReal();
    isRealpathContained(dir, unresolved);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a NON-ABSOLUTE argument is reported (the caller skipped realpathSync entirely)', () => {
    process.env.AMICUS_DEBUG_FENCE = '1';
    isRealpathContained(REL_DIR, REL_CHILD);
    const args = warn.mock.calls.map((c) => [c[0], c[1].arg]);
    expect(args).toEqual([
      ['path-fence: argument is not absolute', 'dirRealPath'],
      ['path-fence: argument is not absolute', 'targetRealPath'],
    ]);
  });

  test('an absolute-but-UNRESOLVED argument is reported (the subtler half)', () => {
    process.env.AMICUS_DEBUG_FENCE = '1';
    const { dir, unresolved } = unresolvedButReal();
    isRealpathContained(dir, unresolved);
    const messages = warn.mock.calls.map((c) => `${c[0]} (${c[1].arg})`);
    expect(messages).toEqual(['path-fence: argument is not realpath-resolved (targetRealPath)']);
  });

  test('a properly resolved pair is silent — no false alarms on the normal path', () => {
    process.env.AMICUS_DEBUG_FENCE = '1';
    const dir = fs.realpathSync(mkScratchDir('ws-fence-'));
    fs.mkdirSync(path.join(dir, 'sub'));
    isRealpathContained(dir, fs.realpathSync(path.join(dir, 'sub')));
    expect(warn).not.toHaveBeenCalled();
  });

  test('a NON-EXISTENT absolute path is not reported — that is a legitimate argument here', () => {
    // Callers fence a path BEFORE probing it; "does not exist yet" is not a contract breach.
    process.env.AMICUS_DEBUG_FENCE = '1';
    const dir = fs.realpathSync(mkScratchDir('ws-fence-'));
    isRealpathContained(dir, path.join(dir, 'never-created', 'report.html'));
    expect(warn).not.toHaveBeenCalled();
  });

  test('the diagnostic NEVER changes the answer', () => {
    const { dir, unresolved } = unresolvedButReal();
    const cases = [
      [dir, path.join(dir, 'sub')],
      [dir, unresolved],
      [REL_DIR, REL_CHILD],
      [path.join(dir, 'foo'), path.join(dir, 'foobar')], // the sibling-prefix trap
      [dir, mkScratchDir('ws-fence-other-')],
    ];
    const off = cases.map(([a, b]) => isRealpathContained(a, b));
    process.env.AMICUS_DEBUG_FENCE = '1';
    const on = cases.map(([a, b]) => isRealpathContained(a, b));
    expect(on).toEqual(off);
    expect(off).toEqual([true, true, true, false, false]);
  });

  test('the fence never becomes the failure it exists to prevent — a throwing logger is swallowed', () => {
    process.env.AMICUS_DEBUG_FENCE = '1';
    warn.mockImplementation(() => { throw new Error('logger exploded'); });
    expect(() => isRealpathContained(REL_DIR, REL_CHILD)).not.toThrow();
    expect(isRealpathContained(REL_DIR, REL_CHILD)).toBe(true);
  });
});

describe('readRunArtifact', () => {
  test('reads an allowlisted artifact from the fixture run', () => {
    const { project } = seedFromFixture('council-run-complete');
    const res = readRunArtifact(project, 'aaaa1111', 'chair-output.md');
    expect(res.text).toContain('VERDICT: Fix these first');
    expect(res.truncated).toBeUndefined();
  });

  test('rejects names not on the allowlist (traversal cannot even be expressed)', () => {
    const { project } = seedFromFixture('council-run-complete');
    for (const bad of ['../secrets.txt', '..\\secrets.txt', 'run.json', 'review-notabench.md', 'report.html']) {
      expect(readRunArtifact(project, 'aaaa1111', bad).error).toBeTruthy();
    }
  });

  // Supplementary to the brief: the '../secrets.txt' cases above target a path where no
  // file actually exists, so they'd still error via plain ENOENT even with both fences
  // deleted — they don't prove traversal is blocked. This test places a REAL file outside
  // runDir (but still inside project, one level up from it) at the exact location a
  // collapsed '..' would resolve to, with no mocking, so a leak would be observable if
  // either fence were removed.
  test('a real file placed at the traversed path is never leaked (unmocked realpath)', () => {
    const { project, runDir } = seedProject();
    fs.copyFileSync(path.join(FX, 'council-run-complete', 'run.json'), path.join(runDir, 'run.json'));
    const secretPath = path.join(path.dirname(runDir), `secret-${path.basename(runDir)}.txt`);
    fs.writeFileSync(secretPath, 'TOP SECRET');
    try {
      const relName = `../${path.basename(secretPath)}`;
      const res = readRunArtifact(project, 'aaaa1111', relName);
      expect(res.error).toBeTruthy();
      expect(res.text).toBeUndefined();
    } finally {
      fs.rmSync(secretPath, { force: true });
    }
  });

  test('not-yet-written artifact reports a friendly error', () => {
    const { project } = seedFromFixture('council-run-degraded', 'bbbb2222');
    const res = readRunArtifact(project, 'bbbb2222', 'chair-output.md');
    expect(res.error).toMatch(/not written yet/);
  });

  // ⚠️ v4.4.1 RN-10. The artifact-realpath catch answered `not written yet: <name>` for ANY
  // failure — ENOENT, EACCES, EPERM, EIO, ELOOP — so a file that exists but cannot be read was
  // reported as one the council had not produced. electron/ipc-workspace.js's workspace:fold
  // reads chair-output.md through here, so on a permission error the fold silently produced a
  // CHAIRLESS fold reporting {ok: true}, and the logger.warn that was added as the mitigation
  // logged this very string — so the operator's one diagnostic said "not written yet" about a
  // file sitting right there. ⚠️ The sanitization stays: round 4 deliberately stopped
  // interpolating err.message, whose text embeds the full resolved path.
  describe('RN-10: a realpath failure that is NOT ENOENT is reported as its own thing', () => {
    const errWithCode = (code) => { const e = new Error(`${code}: permission denied, lstat 'C:\\Users\\someone\\.claude\\x'`); e.code = code; return e; };

    test.each(['EACCES', 'EPERM', 'EIO', 'ELOOP'])('%s is not reported as "not written yet"', (code) => {
      const { project } = seedFromFixture('council-run-complete');
      const res = readRunArtifact(project, 'aaaa1111', 'chair-output.md', {
        realpathSync: (p) => { if (p.endsWith('chair-output.md')) { throw errWithCode(code); } return p; },
      });
      expect(res.text).toBeUndefined();
      expect(res.error).not.toMatch(/not written yet/);
      expect(res.error).toContain(code);          // the bare errno IS the diagnostic
      // …still sanitized: no absolute host path, no err.message text.
      expect(res.error).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//);
      expect(res.error).not.toMatch(/permission denied/);
    });

    test('a genuinely absent artifact (ENOENT) still says "not written yet"', () => {
      const { project } = seedFromFixture('council-run-complete');
      const res = readRunArtifact(project, 'aaaa1111', 'bundle-stage2.md', {
        realpathSync: (p) => { if (p.endsWith('bundle-stage2.md')) { throw errWithCode('ENOENT'); } return p; },
      });
      expect(res.error).toMatch(/not written yet: bundle-stage2\.md/);
    });

    test('an error with no usable code degrades to "unknown" rather than leaking anything', () => {
      const { project } = seedFromFixture('council-run-complete');
      const res = readRunArtifact(project, 'aaaa1111', 'chair-output.md', {
        realpathSync: (p) => { if (p.endsWith('chair-output.md')) { throw new Error('C:\\secret\\path exploded'); } return p; },
      });
      expect(res.error).toBe('artifact unreadable (unknown): chair-output.md');
    });

    test('a hostile err.code cannot ride out through the message (whitelisted character class)', () => {
      const { project } = seedFromFixture('council-run-complete');
      const e = new Error('nope');
      e.code = 'EACCES at C:\\Users\\someone\\.ssh\\id_rsa';   // not an errno
      const res = readRunArtifact(project, 'aaaa1111', 'chair-output.md', {
        realpathSync: (p) => { if (p.endsWith('chair-output.md')) { throw e; } return p; },
      });
      expect(res.error).toBe('artifact unreadable (unknown): chair-output.md');
      expect(res.error).not.toMatch(/id_rsa/);
    });
  });

  // Security regression (Task 4 review finding #1): readRunArtifact forwards runId
  // straight into readPointer, which now rejects traversal shapes before any file access
  // (src/workspace/run-scan.js). Covered at the unit level in run-scan.test.js; this
  // proves the guard's own entry point actually benefits from that fix end-to-end.
  test('a traversal runId is refused, not resolved to a runDir', () => {
    const { project } = seedFromFixture('council-run-complete');
    for (const evil of ['../../../../Users/sendt/.ssh/id', '..\\..\\secrets']) {
      const res = readRunArtifact(project, evil, 'chair-output.md');
      expect(res.error).toBeTruthy();
      expect(res.text).toBeUndefined();
    }
  });

  test('realpath escape (symlinked artifact) is refused — injected realpath', () => {
    const { project } = seedFromFixture('council-run-complete');
    // A real file with known content: if the containment check were removed, this test
    // would see the leaked content in res.text rather than a coincidental ENOENT, so the
    // assertion is load-bearing rather than incidental.
    const outside = path.join(os.tmpdir(), `ws-guard-outside-${process.pid}-${Date.now()}.md`);
    fs.writeFileSync(outside, 'LEAKED CONTENT');
    try {
      const res = readRunArtifact(project, 'aaaa1111', 'chair-output.md', {
        realpathSync: (p) => (p.endsWith('chair-output.md') ? outside : p),
      });
      expect(res.error).toMatch(/escapes run directory/);
      expect(res.text).toBeUndefined();
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test('oversized artifact is truncated with a flag', () => {
    const { project, runDir } = seedProject();
    fs.copyFileSync(path.join(FX, 'council-run-complete', 'run.json'), path.join(runDir, 'run.json'));
    fs.writeFileSync(path.join(runDir, 'bundle-stage2.md'), 'x'.repeat(MAX_ARTIFACT_BYTES + 5000));
    const res = readRunArtifact(project, 'aaaa1111', 'bundle-stage2.md');
    expect(res.truncated).toBe(true);
    expect(Buffer.byteLength(res.text, 'utf8')).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);
  });

  // The 'x'.repeat truncation above is ASCII-only and can't expose a mid-character split.
  // Real artifacts here are prose (em dashes, ⚠️ markers), so a naive byte-slice can cut a
  // multi-byte UTF-8 sequence in half, producing mojibake (U+FFFD) that can even push the
  // encoded result back over the byte cap. Em dash is 3 bytes; MAX_ARTIFACT_BYTES % 3 !== 0,
  // so a plain repeat reliably lands the cut mid-character without any special-casing.
  test('oversized artifact with multi-byte characters truncates on a character boundary', () => {
    const { project, runDir } = seedProject();
    fs.copyFileSync(path.join(FX, 'council-run-complete', 'run.json'), path.join(runDir, 'run.json'));
    const dash = '—'; // em dash, 3 bytes in UTF-8
    const count = Math.ceil((MAX_ARTIFACT_BYTES + 5000) / 3);
    fs.writeFileSync(path.join(runDir, 'bundle-stage2.md'), dash.repeat(count));
    const res = readRunArtifact(project, 'aaaa1111', 'bundle-stage2.md');
    expect(res.truncated).toBe(true);
    const bytes = Buffer.byteLength(res.text, 'utf8');
    expect(bytes).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);
    expect(bytes % 3).toBe(0);
    expect(res.text).not.toMatch(new RegExp(String.fromCharCode(0xfffd)));
  });
});

// Council review R2 finding A1: readRunArtifact checked that the ARTIFACT resolves inside
// runDir (fence 2) but never checked that runDir itself resolves inside project. The
// pointer file's {runId, runDir} JSON is validated only for truthiness
// (src/council/run-state.js:133-139) — a tampered or stale pointer can point runDir at ANY
// readable directory, and as long as the requested NAME happens to exist there (fence 1,
// the allowlist, only constrains the filename, not which directory it is read from), its
// content is handed back. Mirrors electron/ipc-workspace.js's workspace:open-report fence
// (first council review, finding C1) — same isRealpathContained helper, same check, same
// error wording ('run directory escapes project'), now also on the channel that actually
// serves artifact bytes to the renderer (workspace:read-artifact and workspace:fold's
// chair-output.md read both go through this function).
describe('readRunArtifact — outer fence (runDir must resolve inside project)', () => {
  test('a tampered/stale pointer whose runDir resolves outside the project is refused, not read', () => {
    // A real, existing, fully-allowlisted run directory — just not nested under `project`.
    const outsideRunDir = path.join(FX, 'council-run-complete');
    const project = seedProjectWithExternalRunDir(outsideRunDir);

    const res = readRunArtifact(project, 'aaaa1111', 'chair-output.md');

    // Distinguishable from the inner fence's 'artifact escapes run directory' — this is the
    // OUTER fence firing, before the artifact-level check is ever reached.
    expect(res.error).toBe('run directory escapes project');
    expect(res.text).toBeUndefined();
  });

  // Round 4 (third live paid council review, blocker): the test above only asserts the
  // FINAL error, which passes under either ordering — a fence-after-read implementation
  // that reads+parses run.json BEFORE checking containment (the actual shipped bug this
  // proves) still ends up returning the same 'run directory escapes project' string once
  // the fence itself runs, so that assertion alone proves nothing about ORDER. This test
  // additionally spies on the real fs.readFileSync (call-through, mirrors the established
  // pattern in tests/workspace/run-scan.test.js's "rejects a runId ... before any
  // filesystem read" test) and asserts run.json was never opened at all — the fixture
  // directory is real, readable, and contains a genuine run.json, so a read-before-fence
  // implementation WOULD read it (and this assertion would catch that), while a
  // fence-before-read implementation refuses before ever constructing that read.
  test('run.json is never read when the runDir fence would refuse it (proves ordering, not just outcome)', () => {
    const outsideRunDir = path.join(FX, 'council-run-complete');
    const project = seedProjectWithExternalRunDir(outsideRunDir);
    const spy = jest.spyOn(fs, 'readFileSync');
    try {
      const res = readRunArtifact(project, 'aaaa1111', 'chair-output.md');
      expect(res.error).toBe('run directory escapes project');
      const runJsonReads = spy.mock.calls.filter(([p]) => String(p).endsWith('run.json'));
      expect(runJsonReads).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
