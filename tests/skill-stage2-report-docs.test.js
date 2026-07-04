'use strict';
/**
 * Task 17.1 (B28, B29) — second-opinion SKILL.md prose fixes.
 *
 * B28: Task 8.4 inserted the judge-briefing-hardening paragraph AFTER the
 * "two things" sentence in Stage 2, leaving a dangling colon (the sentence
 * promises "two things" but the hardening paragraph, not the two tasks,
 * comes next). The hardening paragraph must precede the "two things"
 * sentence instead, so the colon is immediately followed by Task A / Task B.
 *
 * B29: report.md's definition appeared twice (Stage 5 and Output & naming)
 * with drifting wording ("skeleton" vs "synthesis"), amplified by Task 8.6.
 * There must be exactly ONE full definition; the second mention is a short
 * pointer back to it, not a second definition.
 */
const fs = require('fs');
const path = require('path');
const { mustIndexOf } = require('./helpers/docs-extract');
const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SKILL.md'), 'utf-8');

describe('B28 — Stage 2 hardening paragraph precedes the "two things" sentence', () => {
  const stage2Start = mustIndexOf(skill, '### Stage 2', 'second-opinion SKILL.md "### Stage 2" heading');
  const stage2End = mustIndexOf(skill, '### Stage 3', 'second-opinion SKILL.md "### Stage 3" heading');
  const stage2 = skill.slice(stage2Start, stage2End);

  it('the hardening paragraph appears before "two things on the bundle"', () => {
    const hardenIdx = mustIndexOf(stage2, 'Judge-briefing hardening (required)', 'Stage 2 "Judge-briefing hardening (required)" paragraph');
    const twoThingsIdx = mustIndexOf(stage2, 'two things on the bundle', 'Stage 2 "two things on the bundle" sentence');
    expect(hardenIdx).toBeLessThan(twoThingsIdx);
  });

  it('"two things" is immediately followed by Task A, not the hardening paragraph', () => {
    const twoThingsIdx = mustIndexOf(stage2, 'two things on the bundle', 'Stage 2 "two things on the bundle" sentence');
    const afterColon = stage2.slice(twoThingsIdx, twoThingsIdx + 400);
    expect(afterColon).toMatch(/Task A/);
    expect(afterColon).not.toMatch(/Judge-briefing hardening/);
  });

  it('pinned phrases from the hardening paragraph and the two tasks all survive', () => {
    // Key-phrase anchors for the no-tools preamble, not the full verbatim
    // sentence: the semantic requirements survive prose rewording between them.
    expect(stage2).toMatch(/Do NOT use any tools or read any files/);
    expect(stage2).toMatch(/begin immediately with A1:/);
    expect(stage2).toMatch(/anonymization leak/i);
    expect(stage2).toContain('_scratch/.claude/amicus_sessions/');
    expect(stage2).toMatch(/Task A — Rank\./);
    expect(stage2).toMatch(/Task B — Adjudicate findings\./);
  });
});

describe('B29 — report.md has exactly one full definition', () => {
  it('report.md is mentioned in both Stage 5 and Output & naming', () => {
    const stage5 = skill.slice(
      mustIndexOf(skill, '### Stage 5', 'second-opinion SKILL.md "### Stage 5" heading'),
      mustIndexOf(skill, '### Stage 6', 'second-opinion SKILL.md "### Stage 6" heading')
    );
    const outputSection = skill.slice(
      mustIndexOf(skill, '## Output & naming', 'second-opinion SKILL.md "## Output & naming" heading'),
      mustIndexOf(skill, '## Files', 'second-opinion SKILL.md "## Files" heading')
    );
    expect(stage5).toMatch(/report\.md/);
    expect(outputSection).toMatch(/report\.md/);
  });

  it('Output & naming points to Stage 5 instead of restating the full contract', () => {
    const outputSection = skill.slice(
      mustIndexOf(skill, '## Output & naming', 'second-opinion SKILL.md "## Output & naming" heading'),
      mustIndexOf(skill, '## Files', 'second-opinion SKILL.md "## Files" heading')
    );
    const reportMdLine = outputSection.split('\n').find(l => l.trim().startsWith('- `report.md`'));
    expect(reportMdLine).toBeTruthy();
    // Pointer language, not a restated definition: names the artifact and
    // says where the full contract lives, without re-deriving it.
    expect(reportMdLine).toMatch(/defined once/i);
    expect(reportMdLine).toMatch(/Stage 5/);
    // It must NOT re-explain the run-stats table's field-by-field contract
    // (usage.cost.source, durationMs, etc.) — that lives only in Stage 5.
    expect(reportMdLine).not.toMatch(/durationMs/);
    expect(reportMdLine).not.toMatch(/usage\.cost\.source/);
  });

  it('the non-authoritative mention points back to the authoritative one', () => {
    // report.md is never called a "skeleton" (the retired, ambiguous term).
    expect(skill).not.toMatch(/skeleton/i);
  });

  it('report.md is never called a "skeleton" or "template" (the ambiguous term Task 8.6 amplified)', () => {
    expect(skill).not.toMatch(/report\.md[^.]*\bskeleton\b/i);
    expect(skill).not.toMatch(/\bskeleton\b[^.]*report\.md/i);
  });

  it('report.md is defined as the chair-synthesis-plus-decision-log artifact, written by Claude', () => {
    const stage5 = skill.slice(
      mustIndexOf(skill, '### Stage 5', 'second-opinion SKILL.md "### Stage 5" heading'),
      mustIndexOf(skill, '### Stage 6', 'second-opinion SKILL.md "### Stage 6" heading')
    );
    // Written by Claude (not the `amicus council report` renderer, which
    // produces report.html from verdict.json — a separate, deterministic
    // artifact).
    expect(stage5).toMatch(/report\.md/);
    expect(stage5).toMatch(/chair.s synthesis/i);
  });

  it('report.html (the renderer output) stays clearly distinct from report.md (the skill artifact)', () => {
    expect(skill).toMatch(/report\.html/);
    const outputSection = skill.slice(
      mustIndexOf(skill, '## Output & naming', 'second-opinion SKILL.md "## Output & naming" heading'),
      mustIndexOf(skill, '## Files', 'second-opinion SKILL.md "## Files" heading')
    );
    const reportHtmlLine = outputSection.split('\n').find(l => l.trim().startsWith('- `report.html`'));
    expect(reportHtmlLine).toBeTruthy();
    expect(reportHtmlLine).toMatch(/verdict\.json/);
    expect(reportHtmlLine).toMatch(/deterministic/i);
  });

  it('the Stage 5 renderer note never redirects the --md rendering straight onto report.md (adversarial-review Fix 2: that would silently overwrite the Claude-authored artifact with pure renderer output)', () => {
    const stage5 = skill.slice(
      mustIndexOf(skill, '### Stage 5', 'second-opinion SKILL.md "### Stage 5" heading'),
      mustIndexOf(skill, '### Stage 6', 'second-opinion SKILL.md "### Stage 6" heading')
    );
    expect(stage5).not.toMatch(/--md\s*>\s*<run-folder>\/report\.md/);
    expect(stage5).not.toMatch(/--md\s*>\s*\S*report\.md/);
  });

  it('the Stage 5 renderer note documents assembling report.md from the --md rendering\'s stdout (not a redirect) plus the chair/decision-log prose', () => {
    const stage5 = skill.slice(
      mustIndexOf(skill, '### Stage 5', 'second-opinion SKILL.md "### Stage 5" heading'),
      mustIndexOf(skill, '### Stage 6', 'second-opinion SKILL.md "### Stage 6" heading')
    );
    const rendererIdx = mustIndexOf(stage5, '**Renderer:**', 'Stage 5 "**Renderer:**" note');
    const rendererNote = stage5.slice(rendererIdx, rendererIdx + 700);
    expect(rendererNote).toMatch(/--html\s*>\s*<run-folder>\/report\.html/);
    expect(rendererNote).toMatch(/not report\.md itself/i);
    expect(rendererNote).toMatch(/--md/);
    expect(rendererNote).toMatch(/no redirect|read its stdout/i);
  });
});
