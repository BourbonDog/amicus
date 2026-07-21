'use strict';
/**
 * Phase 16 / Task 16a.1 (B22) — deterministic council transport docs.
 * `amicus council validate` and `amicus council verdict` replace the direct
 * `validateFindings` / `buildVerdict` internal-function instructions in
 * SKILL.md with thin CLI-wrapper invocations. Token/regex pins per the
 * Phase-8 docs-test pattern (see plugin-quickstart-docs.test.js).
 */
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');
const { mustSection, mustIndexOf } = require('./helpers/docs-extract');

// Both skill docs are CRLF in the working tree; normalise before any
// \n-anchored or line-bounded matching (repo idiom — see
// tests/skill-second-opinion-docs.test.js and tests/skill-sidecar-docs.test.js).
const readDoc = p => read(p).replace(/\r\n/g, '\n');
// v4.1 §4.9: the engine runs validate/repair and the tally internally, so the
// Stage-1 validate transport and the tally redirect moved out of SKILL.md and
// into the manual fallback. The pins follow the prose.
const MANUAL = readDoc('skills/second-opinion/MANUAL-ORCHESTRATION.md');

describe('B22 — Stage 1 validate transport (manual path)', () => {
  it('the manual Stage 1 invokes `amicus council validate` instead of calling validateFindings directly', () => {
    expect(MANUAL).toMatch(/amicus council validate <leg-file> --json/);
  });

  it('documents the tri-state exit contract (0 ok, 2 not-ok, 1 BAD_ARGS)', () => {
    const idx = MANUAL.indexOf('amicus council validate <leg-file>');
    const section = MANUAL.slice(idx, idx + 700);
    expect(section).toMatch(/tri-state/);
    expect(section).toMatch(/`0`.*ok:true/);
    expect(section).toMatch(/`2`.*ok:false/);
    expect(section).toMatch(/`1`.*BAD_ARGS/);
  });

  it('still references the underlying validateFindings unit for provenance', () => {
    const idx = MANUAL.indexOf('amicus council validate <leg-file>');
    const section = MANUAL.slice(idx, idx + 300);
    expect(section).toMatch(/validateFindings/);
    expect(section).toMatch(/src\/council\/findings\.js/);
  });

  it('the fast-path SKILL.md no longer hand-drives validate (the engine does it internally)', () => {
    expect(readDoc('skills/second-opinion/SKILL.md')).not.toMatch(/amicus council validate/);
  });
});

describe('B22 — Stage 2 tally output is persisted for Stage 5 to consume (manual path)', () => {
  it('the tally call redirects its --json output to <run-folder>/tally.json', () => {
    expect(MANUAL).toMatch(/amicus council tally <run-folder>\/tally-input\.json --json > <run-folder>\/tally\.json/);
  });
});

describe('B22 — Stage 5 verdict transport', () => {
  const skill = readDoc('skills/second-opinion/SKILL.md');
  const stage5 = skill.slice(
    mustIndexOf(skill, '### Stage 5', 'second-opinion SKILL.md "### Stage 5" heading'),
    mustIndexOf(skill, '### Stage 6', 'second-opinion SKILL.md "### Stage 6" heading'));

  it('Stage 5 invokes `amicus council verdict` with --decisions and -o', () => {
    expect(stage5).toMatch(/amicus council verdict <run-folder>\/tally\.json --decisions <run-folder>\/decisions\.json -o <run-folder>\/verdict\.json/);
  });

  it('--render follows the pinned --decisions/-o tail so the decided report.html is refreshed (v4.1 §4.5c)', () => {
    expect(stage5).toMatch(/amicus council verdict <run-folder>\/tally\.json --decisions <run-folder>\/decisions\.json -o <run-folder>\/verdict\.json --render/);
  });

  it('still references buildVerdict + writeVerdictAtomic for provenance and the atomic-write guarantee', () => {
    expect(stage5).toMatch(/buildVerdict\(record, decisions\)/);
    expect(stage5).toMatch(/writeVerdictAtomic/);
    expect(stage5).toMatch(/atomic tmp\+rename/);
  });

  it('output-artifacts summary references the verdict command, not a bare function call', () => {
    const outputSection = skill.slice(skill.indexOf('## Output & naming'), skill.indexOf('## Files'));
    expect(outputSection).toMatch(/written via `amicus council verdict`/);
  });
});

describe('B22 — commands/council.md mentions the new subs', () => {
  const cmd = read('commands/council.md');
  it('mentions both amicus council validate and amicus council verdict', () => {
    expect(cmd).toMatch(/amicus council validate/);
    expect(cmd).toMatch(/amicus council verdict/);
  });
});

describe('B42 — commands/council.md states the pipeline in true order', () => {
  const cmd = read('commands/council.md');
  // Scope to the body paragraph (after $ARGUMENTS) — the frontmatter description
  // and preamble also mention "chair"/"accept/deny" out of pipeline order.
  const bodyIdx = mustIndexOf(cmd, '$ARGUMENTS', 'commands/council.md $ARGUMENTS marker');
  const body = cmd.slice(bodyIdx);

  it('still mentions both amicus council validate and amicus council verdict (hard pin)', () => {
    expect(cmd).toMatch(/amicus council validate/);
    expect(cmd).toMatch(/amicus council verdict/);
  });

  it('validate is tied to the Stage-1/leg review findings, not to a post-wave step', () => {
    const idx = mustIndexOf(body, 'amicus council validate', 'commands/council.md body validate mention');
    const before = body.slice(Math.max(0, idx - 200), idx);
    expect(before).toMatch(/review/i);
  });

  it('tally is mentioned after cross-review and before the chair/synthesis reference', () => {
    const crossReviewIdx = mustIndexOf(body, 'cross-review', 'commands/council.md body cross-review mention');
    const tallyIdx = mustIndexOf(body, 'amicus council tally', 'commands/council.md body tally mention');
    const chairIdx = mustIndexOf(body, 'chair', 'commands/council.md body chair mention');
    expect(tallyIdx).toBeGreaterThan(crossReviewIdx);
    expect(tallyIdx).toBeLessThan(chairIdx);
  });

  it('verdict is mentioned after the accept/deny decision pass', () => {
    const decisionIdx = mustIndexOf(body, 'accept/deny', 'commands/council.md body accept/deny mention');
    const verdictIdx = mustIndexOf(body, 'amicus council verdict', 'commands/council.md body verdict mention');
    expect(verdictIdx).toBeGreaterThan(decisionIdx);
  });
});

describe('B22 — README + usage.md gain the two new council subcommands', () => {
  const readme = read('README.md');
  const usage = read('docs/usage.md');

  it('README Commands table council row documents validate and verdict', () => {
    // Task 17.3 restructure: bounded by the next `## ` section, not a `### `
    // subheading — the per-command `### ` subsections moved to docs/usage.md.
    const table = mustSection(readme, /## Commands[\s\S]*?(?=\n## )/, 'README.md Commands table');
    const councilRow = table.split('\n').find(l => l.includes('`amicus council`'));
    expect(councilRow).toBeTruthy();
    expect(councilRow).toMatch(/validate <file>/);
    expect(councilRow).toMatch(/verdict <tally\.json>/);
  });

  it('usage.md CLI Commands block documents both new subs', () => {
    const cliBlock = usage.slice(usage.indexOf('## CLI Commands'), usage.indexOf('## `amicus start`'));
    expect(cliBlock).toMatch(/amicus council validate <file>/);
    expect(cliBlock).toMatch(/amicus council verdict <tally\.json>/);
  });
});
