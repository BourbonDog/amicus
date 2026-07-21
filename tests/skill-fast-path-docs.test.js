// tests/skill-fast-path-docs.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { mustIndexOf } = require('./helpers/docs-extract');

// The working-tree SKILL.md is CRLF; normalise before any ^/\n-anchored regex.
// Repo idiom — see tests/skill-second-opinion-docs.test.js and tests/skill-sidecar-docs.test.js.
const SKILL = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SKILL.md'), 'utf-8').replace(/\r\n/g, '\n');

describe('SKILL.md fast-path pins (spec §4)', () => {
  test('frontmatter name is unchanged (B27 holds)', () => {
    expect(SKILL).toMatch(/^---\nname: second-opinion\n/);
  });
  test('the fast path launches one amicus council run with --out-dir <run-folder>', () => {
    expect(SKILL).toContain('amicus council run');
    expect(SKILL).toContain('--out-dir <run-folder>');
  });
  test('models list is quoted (hardening pin survives)', () => {
    expect(SKILL).toMatch(/--models "<m1,m2,m3>"/);
  });
  test('--claude-review is documented in the Claude-in-council element', () => {
    expect(SKILL).toContain('--claude-review');
    expect(SKILL).toContain('review-claude.md');
  });
  test('--debate is documented in the debate element', () => {
    expect(SKILL).toContain('--debate');
  });
  test('the double-ledger guard: "council tally" appears exactly once in the whole file (the Stage-6 "never run" sentence) — prefix-agnostic, so a bare `council tally` slipped in anywhere (not just `amicus council tally`) fails this', () => {
    const matches = SKILL.match(/council tally/g) || [];
    expect(matches.length).toBe(1);
  });
  test('the double-ledger guard: the engine-run section never mentions council tally at all', () => {
    // Scoped restatement of the guard above: the fast-path launch section is
    // where a "just tally it" instruction would most plausibly creep back in,
    // and the engine's own tally-final stage already appended the ledger row.
    const start = mustIndexOf(SKILL, '### The engine run', 'SKILL.md "### The engine run" heading');
    const end = mustIndexOf(SKILL, '### Stage 4', 'SKILL.md "### Stage 4" heading');
    expect(end).toBeGreaterThan(start);
    expect(SKILL.slice(start, end)).not.toContain('council tally');
  });
  test('Stage 6 states the ledger row is already appended by the engine', () => {
    const start = SKILL.indexOf('### Stage 6');
    expect(start).toBeGreaterThan(-1);
    const stage6 = SKILL.slice(start, SKILL.indexOf('\n## ', start));
    expect(stage6).toMatch(/double-append/i);
    expect(stage6).toMatch(/never run `council tally`/);
  });
  test('Stage 5 uses council verdict with --render', () => {
    expect(SKILL).toContain('amicus council verdict');
    expect(SKILL).toContain('--render');
  });
  test('engine version probe + npx fallback + MANUAL-ORCHESTRATION pointer', () => {
    expect(SKILL).toContain('amicus --version');
    expect(SKILL).toContain('npx -y amicus@latest council run');
    expect(SKILL).toContain('MANUAL-ORCHESTRATION.md');
  });
  test('report.html stays the default artifact; verdict presented inline; never hand over only paths', () => {
    expect(SKILL).toContain('report.html');
    expect(SKILL).toContain('present the verdict inline');
    expect(SKILL).toMatch(/[Nn]ever hand over only file paths/);
  });
  test('Stage-0 retains the temporal-context rule + future-dated anchor (engine stamps the date)', () => {
    expect(SKILL).toContain('future-dated');
    expect(SKILL).toContain('the engine stamps');
  });
  test('the optional-elements menu notes verdict scale is now standard (OQ-5)', () => {
    expect(SKILL).toMatch(/verdict scale is now standard/i);
  });
  test('Cowork transport paragraph names amicus_council_run and amicus_wait (B16 extended)', () => {
    expect(SKILL).toContain('amicus_council_run');
    expect(SKILL).toContain('amicus_wait');
    expect(SKILL.trim().length).toBeGreaterThan(0);
  });
  test('the fast-path artifact set drops the manual-only names (OQ-4)', () => {
    // The engine writes chair-output.md + report.html/report.md; it never
    // produces crossreview-matrix.md or verdict.md. Those names may appear
    // ONCE as a retirement note (so a reader migrating off the ritual is not
    // left hunting for them) but must not be listed as fast-path artifacts.
    const outputSection = SKILL.slice(
      mustIndexOf(SKILL, '## Output & naming', 'SKILL.md "## Output & naming" heading'),
      mustIndexOf(SKILL, '## Files', 'SKILL.md "## Files" heading'));
    expect(outputSection.length).toBeGreaterThan(0);
    expect(outputSection).not.toContain('crossreview-matrix.md');
    expect(outputSection).not.toContain('verdict.md');
    expect(outputSection).toContain('chair-output.md');
  });
  test('engine degradation is keyed on the exit code, not per-stage wave rules (§4.6)', () => {
    const start = mustIndexOf(SKILL, '### The engine run', 'SKILL.md "### The engine run" heading');
    const end = mustIndexOf(SKILL, '### Stage 4', 'SKILL.md "### Stage 4" heading');
    const engineRun = SKILL.slice(start, end);
    expect(engineRun).toContain('run.json');
    expect(engineRun).toMatch(/exit code/i);
    expect(engineRun).toMatch(/\b130\b/);
  });
});
