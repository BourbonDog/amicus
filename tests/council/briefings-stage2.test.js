// tests/council/briefings-stage2.test.js
'use strict';
const s2 = require('../../src/council/briefings-stage2');

const REVIEWS = [
  { label: 'Review A', text: 'A prose review.' },
  { label: 'Review B', text: 'B prose review.' },
];
const FINDINGS = [
  { id: 'A1', severity: 'major', claim: 'The toggle is missing.' },
  { id: 'B1', severity: 'nit', claim: 'Typo in header.' },
];

describe('judge bundle', () => {
  const bundle = s2.buildJudgeBundle({ reviews: REVIEWS, findings: FINDINGS });

  test('opens with the no-tools preamble as its FIRST line (SKILL.md verbatim)', () => {
    expect(bundle.split('\n')[0]).toBe(
      'Do NOT use any tools or read any files; everything is in this message; ' +
      'begin immediately with A1:'
    );
  });

  test('embeds the exact trailing-JSON output contract (spec §5)', () => {
    expect(bundle).toContain('"ranking": ["Review B", "Review A", "Review C"]');
    expect(bundle).toContain('{ "id": "A1", "verdict": "agree" }');
    expect(bundle).toContain('agree | dispute | neutral');
  });

  test('lists every labeled review and every run-global finding id', () => {
    expect(bundle).toContain('--- Review A ---');
    expect(bundle).toContain('B prose review.');
    expect(bundle).toContain('A1 [major] The toggle is missing.');
    expect(bundle).toContain('B1 [nit] Typo in header.');
  });

  test('never mentions seats, lenses, critics, or model names', () => {
    for (const word of ['critic', 'lens', 'seat brief', 'deepseek', 'gemini']) {
      expect(bundle.toLowerCase()).not.toContain(word);
    }
  });
});

describe('chair packet', () => {
  const packet = s2.buildChairPacket({
    reviews: [{ model: 'deepseek', text: 'DS review.' }, { model: 'gemini', text: 'G review.' }],
    rankings: [{ judge: 'deepseek', order: ['gemini', 'deepseek'] }],
    adjudications: [{ findingId: 'A1', judge: 'gemini', verdict: 'agree' }],
    tierCounts: { Confirmed: 1, Contested: 0, Singleton: 1, Disputed: 0 },
  });

  test('opens with the chair no-tools preamble', () => {
    expect(packet.split('\n')[0]).toBe(
      'Do NOT use any tools or read any files; everything is in this message; ' +
      'begin immediately with the verdict.'
    );
  });

  test('is de-anonymized (model attribution restored)', () => {
    expect(packet).toContain('deepseek');
    expect(packet).toContain('gemini');
    expect(packet).toContain('DS review.');
  });

  test('always carries the verdict-scale addendum with the exact VERDICT line contract', () => {
    expect(packet).toContain('HARD QUESTIONS');
    expect(packet).toContain('VERDICT: Ship it');
    expect(packet).toContain('VERDICT: Fix these first');
    expect(packet).toContain('VERDICT: Fundamental rethink');
  });

  test('the addendum tells the chair the VERDICT line carries no trailing rationale', () => {
    expect(s2.VERDICT_SCALE_ADDENDUM).toContain('no rationale');
    expect(s2.VERDICT_SCALE_ADDENDUM.toLowerCase()).toContain('nothing else');
  });
});

describe('repair prompts', () => {
  test('judge repair quotes errors and demands ONLY the JSON block', () => {
    const text = s2.buildJudgeRepairPrompt({
      errors: [{ code: 'UNKNOWN_LABEL', detail: "unknown review label 'Review Z'" }],
    });
    expect(text.startsWith('Do NOT use any tools')).toBe(true);
    expect(text).toContain("UNKNOWN_LABEL: unknown review label 'Review Z'");
    expect(text).toContain('ONLY the corrected JSON block');
  });

  test('chair repair demands the final VERDICT line alone', () => {
    const text = s2.buildChairRepairPrompt();
    expect(text.startsWith('Do NOT use any tools')).toBe(true);
    expect(text).toContain('VERDICT: Ship it');
  });
});
