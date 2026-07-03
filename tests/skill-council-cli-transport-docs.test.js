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

describe('B22 — Stage 1 validate transport', () => {
  const skill = read('skills/second-opinion/SKILL.md');

  it('Stage 1 invokes `amicus council validate` instead of calling validateFindings directly', () => {
    expect(skill).toMatch(/amicus council validate <leg-file> --json/);
  });

  it('documents the tri-state exit contract (0 ok, 2 not-ok, 1 BAD_ARGS)', () => {
    const idx = skill.indexOf('amicus council validate <leg-file>');
    const section = skill.slice(idx, idx + 700);
    expect(section).toMatch(/tri-state/);
    expect(section).toMatch(/`0`.*ok:true/);
    expect(section).toMatch(/`2`.*ok:false/);
    expect(section).toMatch(/`1`.*BAD_ARGS/);
  });

  it('still references the underlying validateFindings unit for provenance', () => {
    const idx = skill.indexOf('amicus council validate <leg-file>');
    const section = skill.slice(idx, idx + 300);
    expect(section).toMatch(/validateFindings/);
    expect(section).toMatch(/src\/council\/findings\.js/);
  });
});

describe('B22 — Stage 2 tally output is persisted for Stage 5 to consume', () => {
  const skill = read('skills/second-opinion/SKILL.md');

  it('the tally call redirects its --json output to <run-folder>/tally.json', () => {
    expect(skill).toMatch(/amicus council tally <run-folder>\/tally-input\.json --json > <run-folder>\/tally\.json/);
  });
});

describe('B22 — Stage 5 verdict transport', () => {
  const skill = read('skills/second-opinion/SKILL.md');
  const stage5 = skill.slice(skill.indexOf('### Stage 5'), skill.indexOf('### Stage 6'));

  it('Stage 5 invokes `amicus council verdict` with --decisions and -o', () => {
    expect(stage5).toMatch(/amicus council verdict <run-folder>\/tally\.json --decisions <run-folder>\/decisions\.json -o <run-folder>\/verdict\.json/);
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

describe('B22 — README + usage.md gain the two new council subcommands', () => {
  const readme = read('README.md');
  const usage = read('docs/usage.md');

  it('README Commands table council row documents validate and verdict', () => {
    const table = readme.match(/## Commands[\s\S]*?(?=\n### )/)[0];
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
