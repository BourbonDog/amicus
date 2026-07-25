'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { artifactAllowlist, readRunArtifact, MAX_ARTIFACT_BYTES } = require('../../src/workspace/artifact-guard');

const FX = path.join(__dirname, '..', 'fixtures');

// NOTE: the brief's seedProject hardcoded 'aaaa1111' regardless of runDir, which left the
// degraded-fixture test's pointer lookup (queried by 'bbbb2222', the fixture's real run id)
// unable to find its own pointer file. Parameterized with a default so every other call site
// (all against the aaaa1111 complete fixture) is untouched.
function seedProject(runDir, runId = 'aaaa1111') {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-guard-'));
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-guard-escape-'));
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

  test('realpath escape (symlinked artifact) is refused — injected realpath', () => {
    const project = seedProject(path.join(FX, 'council-run-complete'));
    const outside = path.join(os.tmpdir(), 'outside.md');
    const res = readRunArtifact(project, 'aaaa1111', 'chair-output.md', {
      realpathSync: (p) => (p.endsWith('chair-output.md') ? outside : p),
    });
    expect(res.error).toMatch(/escapes run directory/);
  });

  test('oversized artifact is truncated with a flag', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-guard-big-'));
    fs.copyFileSync(path.join(FX, 'council-run-complete', 'run.json'), path.join(runDir, 'run.json'));
    fs.writeFileSync(path.join(runDir, 'bundle-stage2.md'), 'x'.repeat(MAX_ARTIFACT_BYTES + 5000));
    const project = seedProject(runDir);
    const res = readRunArtifact(project, 'aaaa1111', 'bundle-stage2.md');
    expect(res.truncated).toBe(true);
    expect(Buffer.byteLength(res.text, 'utf8')).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);
  });
});
