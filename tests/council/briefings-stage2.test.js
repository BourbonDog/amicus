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

describe('judge bundle — an all-clean bench (LC-10)', () => {
  const bundle = s2.buildJudgeBundle({ reviews: REVIEWS, findings: [], date: '2026-07-26' });

  test('the findings index says it is empty instead of rendering a bare heading', () => {
    expect(bundle).toContain('--- FINDINGS INDEX (run-global ids) ---\n\n'
      + '(none — no review in this bundle raised a finding)');
    // The defect this replaces: heading, blank, blank, straight into Review A.
    expect(bundle).not.toContain('--- FINDINGS INDEX (run-global ids) ---\n\n\n\n');
  });

  test('Task B states the empty case and names the exact output', () => {
    expect(bundle).toContain('there is nothing to adjudicate');
    expect(bundle).toContain('"adjudications": []');
    expect(bundle).toMatch(/do not invent finding ids/);
    // …and never the dangling order to adjudicate ids that are not listed.
    expect(bundle).not.toContain('for EVERY finding id listed below');
  });

  test('Task A is untouched — the ranking is still the point of the wave', () => {
    expect(bundle).toContain('Task A — Rank: order the reviews from most to least '
      + 'accurate and insightful.');
    expect(bundle).toContain('--- Review A ---');
    expect(bundle).toContain('B prose review.');
  });

  test('the ordinary bundle is byte-for-byte unchanged', () => {
    // The empty-index wording must never leak into a run that raised findings.
    const ordinary = s2.buildJudgeBundle({ reviews: REVIEWS, findings: FINDINGS });
    expect(ordinary).toContain('for EVERY finding id listed below');
    expect(ordinary).not.toContain('(none —');
    expect(ordinary).not.toContain('nothing to adjudicate');
  });

  test('still never mentions seats, lenses, critics, or model names', () => {
    for (const word of ['critic', 'lens', 'seat brief', 'deepseek', 'gemini']) {
      expect(bundle.toLowerCase()).not.toContain(word);
    }
  });
});

describe('chair packet — an all-clean bench (LC-10)', () => {
  const packet = s2.buildChairPacket({
    reviews: [{ model: 'deepseek', text: 'DS review.' }, { model: 'gemini', text: 'G review.' }],
    rankings: [{ judge: 'deepseek', order: ['gemini', 'deepseek'] }],
    adjudications: [],
    tierCounts: { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 },
  });

  test('states the clean bench as an outcome rather than asking for findings that do not exist', () => {
    expect(packet).toContain('this bench raised NO findings');
    expect(packet).toMatch(/not a failed run/);
    expect(packet).toMatch(/do not manufacture concerns/);
  });

  test('the adjudications section says WHY it is empty', () => {
    expect(packet).toContain('--- PER-FINDING ADJUDICATIONS ---\n\n'
      + '(none — the bench raised no findings, so there was nothing to adjudicate)');
    expect(packet).not.toContain('--- PER-FINDING ADJUDICATIONS ---\n\n\n\n');
  });

  test('the rankings the judges DID produce still reach the chair', () => {
    expect(packet).toContain('deepseek: ["gemini","deepseek"]');
  });

  test('a bench that raised findings gets none of this wording', () => {
    const ordinary = s2.buildChairPacket({
      reviews: [{ model: 'gemini', text: 'G.' }],
      rankings: [{ judge: 'gemini', order: ['gemini'] }],
      adjudications: [{ findingId: 'A1', judge: 'gemini', verdict: 'agree' }],
      tierCounts: { Confirmed: 1, Contested: 0, Singleton: 0, Disputed: 0 },
    });
    expect(ordinary).not.toContain('raised NO findings');
    expect(ordinary).not.toContain('(none —');
  });

  test('an empty rankings list is distinguished from an empty adjudications list', () => {
    // Same defect class, different cause: no usable judge at all, findings raised.
    const noJudges = s2.buildChairPacket({
      reviews: [{ model: 'gemini', text: 'G.' }], rankings: [], adjudications: [],
      tierCounts: { Confirmed: 0, Contested: 0, Singleton: 1, Disputed: 0 },
    });
    expect(noJudges).toContain('(none — no judge produced a usable ranking)');
    expect(noJudges).toContain('(none — no judge produced a usable adjudication)');
    expect(noJudges).not.toContain('raised NO findings');
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
