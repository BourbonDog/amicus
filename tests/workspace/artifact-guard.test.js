'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  artifactAllowlist, readRunArtifact, FIXED_ARTIFACTS, DEBATE_ARTIFACTS, MAX_ARTIFACT_BYTES,
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

// NOTE: the brief's seedProject hardcoded 'aaaa1111' regardless of runDir, which left the
// degraded-fixture test's pointer lookup (queried by 'bbbb2222', the fixture's real run id)
// unable to find its own pointer file. Parameterized with a default so every other call site
// (all against the aaaa1111 complete fixture) is untouched.
function seedProject(runDir, runId = 'aaaa1111') {
  const project = mkScratchDir('ws-guard-');
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

  test('FIXED_ARTIFACTS and DEBATE_ARTIFACTS are frozen against consumer mutation', () => {
    expect(() => { FIXED_ARTIFACTS.push('evil'); }).toThrow();
    expect(() => { DEBATE_ARTIFACTS.push('evil'); }).toThrow();
  });
});

describe('readRunArtifact', () => {
  test('reads an allowlisted artifact from the fixture run', () => {
    const project = seedProject(path.join(FX, 'council-run-complete'));
    const res = readRunArtifact(project, 'aaaa1111', 'chair-output.md');
    expect(res.text).toContain('VERDICT: Fix these first');
    expect(res.truncated).toBeUndefined();
  });

  test('rejects names not on the allowlist (traversal cannot even be expressed)', () => {
    const project = seedProject(path.join(FX, 'council-run-complete'));
    for (const bad of ['../secrets.txt', '..\\secrets.txt', 'run.json', 'review-notabench.md', 'report.html']) {
      expect(readRunArtifact(project, 'aaaa1111', bad).error).toBeTruthy();
    }
  });

  // Supplementary to the brief: the '../secrets.txt' cases above target a path where no
  // file actually exists, so they'd still error via plain ENOENT even with both fences
  // deleted — they don't prove traversal is blocked. This test places a REAL file outside
  // runDir at the exact location a collapsed '..' would resolve to, with no mocking, so a
  // leak would be observable if either fence were removed.
  test('a real file placed at the traversed path is never leaked (unmocked realpath)', () => {
    const runDir = mkScratchDir('ws-guard-escape-');
    fs.copyFileSync(path.join(FX, 'council-run-complete', 'run.json'), path.join(runDir, 'run.json'));
    const secretPath = path.join(path.dirname(runDir), `secret-${path.basename(runDir)}.txt`);
    fs.writeFileSync(secretPath, 'TOP SECRET');
    try {
      const project = seedProject(runDir);
      const relName = `../${path.basename(secretPath)}`;
      const res = readRunArtifact(project, 'aaaa1111', relName);
      expect(res.error).toBeTruthy();
      expect(res.text).toBeUndefined();
    } finally {
      fs.rmSync(secretPath, { force: true });
    }
  });

  test('not-yet-written artifact reports a friendly error', () => {
    const project = seedProject(path.join(FX, 'council-run-degraded'), 'bbbb2222');
    const res = readRunArtifact(project, 'bbbb2222', 'chair-output.md');
    expect(res.error).toMatch(/not written yet/);
  });

  // Security regression (Task 4 review finding #1): readRunArtifact forwards runId
  // straight into readPointer, which now rejects traversal shapes before any file access
  // (src/workspace/run-scan.js). Covered at the unit level in run-scan.test.js; this
  // proves the guard's own entry point actually benefits from that fix end-to-end.
  test('a traversal runId is refused, not resolved to a runDir', () => {
    const project = seedProject(path.join(FX, 'council-run-complete'));
    for (const evil of ['../../../../Users/sendt/.ssh/id', '..\\..\\secrets']) {
      const res = readRunArtifact(project, evil, 'chair-output.md');
      expect(res.error).toBeTruthy();
      expect(res.text).toBeUndefined();
    }
  });

  test('realpath escape (symlinked artifact) is refused — injected realpath', () => {
    const project = seedProject(path.join(FX, 'council-run-complete'));
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
    const runDir = mkScratchDir('ws-guard-big-');
    fs.copyFileSync(path.join(FX, 'council-run-complete', 'run.json'), path.join(runDir, 'run.json'));
    fs.writeFileSync(path.join(runDir, 'bundle-stage2.md'), 'x'.repeat(MAX_ARTIFACT_BYTES + 5000));
    const project = seedProject(runDir);
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
    const runDir = mkScratchDir('ws-guard-mb-');
    fs.copyFileSync(path.join(FX, 'council-run-complete', 'run.json'), path.join(runDir, 'run.json'));
    const dash = '—'; // em dash, 3 bytes in UTF-8
    const count = Math.ceil((MAX_ARTIFACT_BYTES + 5000) / 3);
    fs.writeFileSync(path.join(runDir, 'bundle-stage2.md'), dash.repeat(count));
    const project = seedProject(runDir);
    const res = readRunArtifact(project, 'aaaa1111', 'bundle-stage2.md');
    expect(res.truncated).toBe(true);
    const bytes = Buffer.byteLength(res.text, 'utf8');
    expect(bytes).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);
    expect(bytes % 3).toBe(0);
    expect(res.text).not.toMatch(new RegExp(String.fromCharCode(0xfffd)));
  });
});
