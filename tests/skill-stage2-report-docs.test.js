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
const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SKILL.md'), 'utf-8');

describe('B28 — Stage 2 hardening paragraph precedes the "two things" sentence', () => {
  const stage2 = skill.slice(skill.indexOf('### Stage 2'), skill.indexOf('### Stage 3'));

  it('the hardening paragraph appears before "two things on the bundle"', () => {
    const hardenIdx = stage2.indexOf('Judge-briefing hardening (required)');
    const twoThingsIdx = stage2.indexOf('two things on the bundle');
    expect(hardenIdx).toBeGreaterThan(-1);
    expect(twoThingsIdx).toBeGreaterThan(-1);
    expect(hardenIdx).toBeLessThan(twoThingsIdx);
  });

  it('"two things" is immediately followed by Task A, not the hardening paragraph', () => {
    const twoThingsIdx = stage2.indexOf('two things on the bundle');
    const afterColon = stage2.slice(twoThingsIdx, twoThingsIdx + 400);
    expect(afterColon).toMatch(/Task A/);
    expect(afterColon).not.toMatch(/Judge-briefing hardening/);
  });

  it('pinned phrases from the hardening paragraph and the two tasks all survive', () => {
    expect(stage2).toContain(
      'Do NOT use any tools or read any files; everything is in this message; begin immediately with A1:'
    );
    expect(stage2).toMatch(/anonymization leak/i);
    expect(stage2).toContain('_scratch/.claude/amicus_sessions/');
    expect(stage2).toMatch(/Task A — Rank\./);
    expect(stage2).toMatch(/Task B — Adjudicate findings\./);
  });
});

describe('B29 — report.md has exactly one full definition', () => {
  it('report.md is mentioned in both Stage 5 and Output & naming', () => {
    const stage5 = skill.slice(skill.indexOf('### Stage 5'), skill.indexOf('### Stage 6'));
    const outputSection = skill.slice(skill.indexOf('## Output & naming'), skill.indexOf('## Files'));
    expect(stage5).toMatch(/report\.md/);
    expect(outputSection).toMatch(/report\.md/);
  });

  it('Output & naming points to Stage 5 instead of restating the full contract', () => {
    const outputSection = skill.slice(skill.indexOf('## Output & naming'), skill.indexOf('## Files'));
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
    const stage5 = skill.slice(skill.indexOf('### Stage 5'), skill.indexOf('### Stage 6'));
    // Written by Claude (not the `amicus council report` renderer, which
    // produces report.html from verdict.json — a separate, deterministic
    // artifact).
    expect(stage5).toMatch(/report\.md/);
    expect(stage5).toMatch(/chair.s synthesis/i);
  });

  it('report.html (the renderer output) stays clearly distinct from report.md (the skill artifact)', () => {
    expect(skill).toMatch(/report\.html/);
    const outputSection = skill.slice(skill.indexOf('## Output & naming'), skill.indexOf('## Files'));
    const reportHtmlLine = outputSection.split('\n').find(l => l.trim().startsWith('- `report.html`'));
    expect(reportHtmlLine).toBeTruthy();
    expect(reportHtmlLine).toMatch(/verdict\.json/);
    expect(reportHtmlLine).toMatch(/deterministic/i);
  });
});
