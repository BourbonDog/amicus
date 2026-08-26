// tests/council/briefings-stage2.test.js
'use strict';
const s2 = require('../../src/council/briefings-stage2');
const { parseJudgeOutput } = require('../../src/council/parse-stage2');

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

describe('JUDGE_OUTPUT_CONTRACT — review minor M1: the exemplar no longer tempts an invented id', () => {
  // Task B already tells the judge to emit "adjudications": [] on a clean bench
  // (JUDGE_TASK_B_NO_FINDINGS), but the contract that immediately follows it used
  // to show only the ids-present example ({"id":"A1"...},{"id":"B2"...}) — the
  // exact shape a judge with nothing to adjudicate would be tempted to invent.
  // Inventing one fails UNKNOWN_FINDING_ID and buys up to two paid repair solos.
  test('states the empty-index case explicitly, not just via a satisfiable rule', () => {
    expect(s2.JUDGE_OUTPUT_CONTRACT).toMatch(/adjudications.*must be exactly `\[\]`/);
    expect(s2.JUDGE_OUTPUT_CONTRACT).toMatch(/do\s+not invent a finding id/);
  });

  test('the clean-bench bundle carries the line (it sits right below Task B)', () => {
    const bundle = s2.buildJudgeBundle({ reviews: REVIEWS, findings: [] });
    expect(bundle).toContain('"adjudications": []');
    expect(bundle).toContain('must be exactly `[]`');
  });

  test('linkage: the answer the contract now names for a clean bench actually validates', () => {
    // Not a restatement — parse-stage2.parseJudgeOutput is the validator a judge's
    // trailing JSON block is checked against. If the contract's clean-bench line
    // ever drifted from what the validator accepts, this fails.
    const text = 'Ranking done.\n```json\n'
      + '{"ranking":["Review A","Review B"],"adjudications":[]}\n```';
    const result = parseJudgeOutput(text, { labels: ['Review A', 'Review B'], findingIds: [] });
    expect(result.ok).toBe(true);
    expect(result.adjudications).toEqual([]);
  });

  test('an INVENTED id on an empty findings index is exactly what the line guards against', () => {
    // The failure mode the fix removes the incentive for: UNKNOWN_FINDING_ID.
    const text = '```json\n{"ranking":["Review A"],"adjudications":'
      + '[{"id":"A1","verdict":"agree"}]}\n```';
    const result = parseJudgeOutput(text, { labels: ['Review A'], findingIds: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'UNKNOWN_FINDING_ID')).toBe(true);
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

  test('review minor M2: the clean bench SWAPS the directive, matching buildJudgeBundle, ' +
    'rather than appending a correction after an unfollowable one', () => {
    // The un-swapped directive told the chair to "distinguish findings the bench
    // broadly endorsed from contested or singleton claims" — unfollowable when
    // raisedCount is 0. It must not appear at all on a clean bench now; the
    // clean-bench framing must be the ONLY instruction, not a second paragraph
    // patched on after it.
    expect(packet).not.toContain('distinguish findings the bench broadly endorsed');
    expect(packet).not.toContain('peer-validated standing (rank position and adjudication pattern)');
  });

  test('review minor M2: exported constants mirror the judge\'s Task-B pair', () => {
    expect(s2.CHAIR_TASK).toContain('distinguish findings the bench broadly endorsed');
    expect(s2.CHAIR_TASK_NO_FINDINGS).toContain('this bench raised NO findings');
    expect(s2.CHAIR_TASK_NO_FINDINGS).not.toContain('distinguish findings the bench broadly endorsed');
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

describe('review judges never see the briefing — the anonymity narrowing (v4.9 W7 T-B)', () => {
  // Spec §5.4 makes the briefing tail the ONE thing a TASK bundle adds. The
  // converse — that a REVIEW bundle carries no briefing at all — is the half
  // that was never written down: review judges rank critiques of material they
  // are deliberately not shown, and nothing pinned that. Written now, so the
  // review bundle can never be widened by accident under a task-mode edit.
  const BRIEFING = 'Size the SMB churn risk of a 12% price increase.';
  const BRIEFING_HEADER = '--- THE BRIEFING (what every response was asked to do) ---';

  test('the review bundle renders no briefing section, even when handed one', () => {
    const withArg = s2.buildJudgeBundle({ reviews: REVIEWS, findings: FINDINGS, briefing: BRIEFING });
    expect(withArg).not.toContain(BRIEFING_HEADER);
    expect(withArg).not.toContain('THE BRIEFING');
    expect(withArg).not.toContain(BRIEFING);
    expect(withArg).toBe(s2.buildJudgeBundle({ reviews: REVIEWS, findings: FINDINGS }));
  });

  test('it ends on the last labeled review — nothing is appended after the bench', () => {
    const bundle = s2.buildJudgeBundle({ reviews: REVIEWS, findings: FINDINGS });
    expect(bundle.endsWith('--- Review B ---\nB prose review.')).toBe(true);
  });

  test('the task twin is the ONLY builder that carries the tail', () => {
    const task = require('../../src/council/briefings-stage2-task').buildTaskJudgeBundle({
      reviews: REVIEWS, findings: FINDINGS, briefing: BRIEFING,
    });
    expect(task).toContain(BRIEFING_HEADER);
    expect(task).toContain(BRIEFING);
  });
});
