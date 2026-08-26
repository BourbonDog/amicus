// tests/council/briefings-stage2-task.test.js — v4.9 W7 T-B: the judge bundle.
//
//
// ── NAMED MUTANT "TASKBUNDLENOBRIEF" ───────────────────────────────────────
// MUTATION: drop the briefing tail from the task bundle — in
// src/council/briefings-stage2-task.js :: buildTaskJudgeBundle, delete the two
// trailing `parts.push` arguments `TASK_BRIEFING_HEADER, brief ||
// NO_BRIEFING_TAIL`. This is the ONE asymmetry collapsing: a task judge asked to
// rank "which response best does the work the briefing asked for" with the
// briefing removed answers on vibes, and nothing else in the run notices.
// MEASURED 2026-08-25, RED SET 8 of 233, applied and reverted BY HAND
// (byte-exact, verified by checksum). Scope — the stage-2 focused scope,
// `npx jest tests/council/briefings-stage2-task.test.js
// tests/council/briefings-stage2.test.js tests/council/briefings.test.js
// tests/council/parse-stage2.test.js tests/council/run-stages.test.js
// --maxWorkers=2` = 5 suites / 233 tests:
//   briefings-stage2-task 5 —
//     "the bundle ENDS with the briefing under its own section header"
//     "the header appears exactly once (one tail, not one per response)"
//     "the briefing sits AFTER the responses, so the judge reads the work first"
//     "an absent briefing is STATED, never papered over with a blank section"
//     "Task A and the briefing tail are untouched by the empty index"
//   briefings-stage2 1 — "the task twin is the ONLY builder that carries the tail"
//   run-stages 2 —
//     "intent 'task' → the -s2 prompt IS the task bundle, briefing tail and all"
//     "the briefing comes off o.briefing — change the field, the tail changes"
// ⚠️ The review-path pins stay GREEN by construction: the tail is the one
// section a review bundle never had, so a mutation that removes it can only be
// caught on the task side plus the absence pin that names the asymmetry.
// ⚠️ RE-RUN, NEVER RENUMBER (house rule, tests/council/chair-packet-seat-mutants.js).
//
// Stage 2's task fork (spec §5.4). Everything structural is the review bundle's,
// verbatim (V11 — one vocabulary): preamble, `Review <letter>` labels, the
// FINDINGS INDEX section header, and the judge output contract bar ONE line.
// Only the frame, the two task wordings, the empty-index twin and that one
// contract line (the ranking bullet — fix round F1, its own describe below)
// speak in claims — plus the ONE asymmetry: a task bundle ends with the
// BRIEFING, a review bundle never does.
'use strict';
const s2 = require('../../src/council/briefings-stage2');
const t = require('../../src/council/briefings-stage2-task');
const { parseJudgeOutput } = require('../../src/council/parse-stage2');

const REVIEWS = [
  { label: 'Review A', text: 'A deliverable.' },
  { label: 'Review B', text: 'B deliverable.' },
];
const CLAIMS = [
  { id: 'A1', severity: 'blocker', claim: 'SMB demand is price-elastic above 10%.' },
  { id: 'B1', severity: 'minor', claim: 'Enterprise contracts renew annually.' },
];
const BRIEFING = 'Size the SMB churn risk of a 12% price increase.';
const ARGS = { reviews: REVIEWS, findings: CLAIMS, date: '2026-08-25', briefing: BRIEFING };
const BRIEFING_HEADER = '--- THE BRIEFING (what every response was asked to do) ---';

describe('task judge bundle — the frame and the two tasks', () => {
  const bundle = t.buildTaskJudgeBundle(ARGS);

  test('the frame judges RESPONSES and points at the briefing tail', () => {
    expect(bundle).toContain('You are judging the anonymized peer responses below. Each was '
      + 'produced independently against the same briefing, which is included at the end.');
    expect(bundle).not.toContain('You are judging the anonymized peer reviews below');
  });

  test('Task A ranks by how well the WORK was done, not how accurate a critique was', () => {
    expect(bundle).toContain('Task A — Rank: order the responses from the one that best does '
      + 'the work the briefing asked for to the one that does it least well.');
    expect(bundle).not.toContain('order the reviews from most to least accurate and insightful');
  });

  test('Task B adjudicates claims over the same three verdicts', () => {
    expect(bundle).toContain('Task B — Adjudicate: for EVERY claim id in the index, judge '
      + 'whether the claim holds: agree / dispute / neutral');
    expect(bundle).not.toContain('for EVERY finding id listed below');
  });

  test('opens with the SHARED no-tools preamble as its FIRST line (V11)', () => {
    expect(bundle.split('\n')[0]).toBe(s2.JUDGE_NO_TOOLS_PREAMBLE);
  });

  test('carries the date line when given, and nothing where there is none', () => {
    expect(bundle).toContain("Today's date is 2026-08-25.");
    expect(t.buildTaskJudgeBundle({ ...ARGS, date: undefined }))
      .not.toContain("Today's date is");
  });

  test('never leaks seats, lenses, critics, or model names', () => {
    for (const word of ['critic', 'lens', 'seat brief', 'deepseek', 'gemini']) {
      expect(bundle.toLowerCase()).not.toContain(word);
    }
  });
});

describe('the briefing tail — the ONE asymmetry (spec §5.4)', () => {
  const bundle = t.buildTaskJudgeBundle(ARGS);

  test('the bundle ENDS with the briefing under its own section header', () => {
    expect(bundle.endsWith(`${BRIEFING_HEADER}\n\n${BRIEFING}`)).toBe(true);
  });

  test('the header appears exactly once (one tail, not one per response)', () => {
    expect(bundle.split(BRIEFING_HEADER)).toHaveLength(2);
  });

  test('the briefing sits AFTER the responses, so the judge reads the work first', () => {
    expect(bundle.indexOf('--- Review B ---')).toBeLessThan(bundle.indexOf(BRIEFING_HEADER));
  });

  test('an absent briefing is STATED, never papered over with a blank section', () => {
    // LC-6/LC-12 idiom: a model asked to judge against an ask it cannot see must
    // be told so, not left to infer it from an empty heading.
    const bare = t.buildTaskJudgeBundle({ ...ARGS, briefing: undefined });
    expect(bare).toContain(BRIEFING_HEADER);
    expect(bare).toContain('(unavailable — the briefing text did not reach this bundle');
    expect(bare).not.toContain(`${BRIEFING_HEADER}\n\n\n`);
    expect(t.buildTaskJudgeBundle({ ...ARGS, briefing: '   ' }))
      .toContain('(unavailable — the briefing text did not reach this bundle');
  });
});

describe('V11: the shared Stage-2 vocabulary never forks', () => {
  const bundle = t.buildTaskJudgeBundle(ARGS);

  test('the output contract is the shared template, one line apart (fix round F1)', () => {
    // Was "the SAME object the review bundle embeds" until F1 forked the ranking
    // bullet: what is shared is now the TEMPLATE, and the one-line diff is
    // pinned in its own describe below. Everything the contract says about the
    // JSON block itself is still one text in both modes.
    expect(bundle).toContain(t.TASK_JUDGE_OUTPUT_CONTRACT);
    expect(s2.buildJudgeBundle(ARGS)).toContain(s2.JUDGE_OUTPUT_CONTRACT);
    for (const shared of ['```json', '"adjudications": [', 'Ties: use a nested array',
      'agree | dispute | neutral', 'must be exactly `[]`']) {
      expect(t.TASK_JUDGE_OUTPUT_CONTRACT).toContain(shared);
      expect(s2.JUDGE_OUTPUT_CONTRACT).toContain(shared);
    }
  });

  test('the index section header is shared — the contract names it in prose', () => {
    // The contract says "If the FINDINGS INDEX below is empty…". A task bundle
    // that renamed the header to CLAIMS INDEX would leave that shared line
    // pointing at a section which does not exist. This is why the header stays —
    // and why the F1 fork is one BULLET, not a second contract.
    expect(s2.JUDGE_OUTPUT_CONTRACT).toContain('FINDINGS INDEX');
    expect(t.TASK_JUDGE_OUTPUT_CONTRACT).toContain('FINDINGS INDEX');
    expect(bundle).toContain(s2.FINDINGS_INDEX_HEADER);
    expect(s2.buildJudgeBundle(ARGS)).toContain(s2.FINDINGS_INDEX_HEADER);
  });

  test('the `Review <letter>` label vocabulary is shared', () => {
    expect(bundle).toContain('--- Review A ---\nA deliverable.');
    expect(bundle).toContain('--- Review B ---\nB deliverable.');
  });

  test('the claim index renders id, severity and claim in the shared shape', () => {
    expect(bundle).toContain('A1 [blocker] SMB demand is price-elastic above 10%.');
    expect(bundle).toContain('B1 [minor] Enterprise contracts renew annually.');
  });
});

describe('the ranking bullet is the ONE contract line that forks (fix round F1)', () => {
  // Review MAJOR F1: JUDGE_OUTPUT_CONTRACT's ranking bullet ordered the labels
  // "most to least accurate and insightful" and was composed VERBATIM into the
  // task bundle — the review axis, three paragraphs under a TASK_JUDGE_A that
  // ranks by how well the asked-for work was DONE. The judge's machine-readable
  // instruction and its prose instruction disagreed, and the machine-readable
  // one is the one that produces `"ranking"`.
  const bundle = t.buildTaskJudgeBundle(ARGS);

  test('the composed TASK bundle carries no trace of the review ranking axis', () => {
    expect(bundle).not.toContain('most to least accurate and insightful');
  });

  test("the task ranking bullet restates Task A's axis inside the JSON contract", () => {
    expect(bundle).toContain('- "ranking": every review label below, ordered as Task A '
      + 'specifies — from the response that best does the work the briefing asked for to '
      + 'the one that does it least well.');
  });

  test('the two contracts differ in EXACTLY one line — the ranking bullet (V11)', () => {
    // The seam is a line swap, not a second contract: everything else — the
    // fenced-block shape, the worked example, the ties rule, the adjudications
    // rules and the LC-10 empty-index line — stays one text in two modes.
    const review = s2.JUDGE_OUTPUT_CONTRACT.split('\n');
    const task = t.TASK_JUDGE_OUTPUT_CONTRACT.split('\n');
    expect(task).toHaveLength(review.length);
    const diff = review.map((l, i) => [l, task[i]]).filter(([a, b]) => a !== b);
    expect(diff).toHaveLength(1);
    expect(diff[0][0]).toBe('- "ranking": every review label below, ordered most to least accurate and insightful.');
    expect(diff[0][1]).toMatch(/^- "ranking": every review label below, ordered as Task A specifies/);
  });

  test('the REVIEW contract and bundle keep the review bullet, byte for byte', () => {
    expect(s2.JUDGE_OUTPUT_CONTRACT).toContain(
      '- "ranking": every review label below, ordered most to least accurate and insightful.');
    expect(s2.buildJudgeBundle(ARGS)).toContain(s2.JUDGE_OUTPUT_CONTRACT);
    expect(s2.buildJudgeBundle(ARGS)).not.toContain('best does the work the briefing asked for');
  });

  test('a TASK judge is REPAIRED against the task contract, never the review one', () => {
    // A repair solo is a fresh session (LC-12): the only shape it ever sees is
    // the contract this prompt embeds. Embedding the review bullet there would
    // reintroduce F1 on the paid path the run takes precisely because the judge
    // already got the output wrong once.
    const args = { errors: [{ code: 'BAD_RANKING', detail: 'x' }], judgement: 'prior judgement' };
    const repair = s2.judgeRepairPromptFor('task', args);
    expect(repair).toContain(t.TASK_JUDGE_OUTPUT_CONTRACT);
    expect(repair).not.toContain('most to least accurate and insightful');
    expect(repair).toContain('prior judgement');   // LC-12 carry survives the fork
  });

  test('the repair dispatcher is fail-closed and byte-identical off the task path', () => {
    const args = { errors: [{ code: 'BAD_RANKING', detail: 'x' }], judgement: 'prior judgement' };
    expect(s2.judgeRepairPromptFor(undefined, args)).toBe(s2.buildJudgeRepairPrompt(args));
    expect(s2.judgeRepairPromptFor('review', args)).toBe(s2.buildJudgeRepairPrompt(args));
    expect(s2.judgeRepairPromptFor('bogus', args)).toBe(s2.buildJudgeRepairPrompt(args));
    expect(s2.buildJudgeRepairPrompt(args)).toContain(s2.JUDGE_OUTPUT_CONTRACT);
  });
});

describe('LC-10 parity: a bench that declared no claims', () => {
  const bundle = t.buildTaskJudgeBundle({ ...ARGS, findings: [] });

  test('the index says it is empty instead of rendering a bare heading', () => {
    expect(bundle).toContain(`${s2.FINDINGS_INDEX_HEADER}\n\n`
      + '(none — no response in this bundle declared a load-bearing claim)');
    expect(bundle).not.toContain(`${s2.FINDINGS_INDEX_HEADER}\n\n\n\n`);
  });

  test('Task B states the empty case and names the exact output', () => {
    expect(bundle).toContain('there is nothing to adjudicate');
    expect(bundle).toContain('"adjudications": []');
    expect(bundle).toMatch(/do not invent claim ids/);
    expect(bundle).not.toContain('for EVERY claim id in the index');
  });

  test('Task A and the briefing tail are untouched by the empty index', () => {
    expect(bundle).toContain(t.TASK_JUDGE_A);
    expect(bundle.endsWith(`${BRIEFING_HEADER}\n\n${BRIEFING}`)).toBe(true);
  });

  test('the ordinary task bundle carries none of the empty wording', () => {
    const ordinary = t.buildTaskJudgeBundle(ARGS);
    expect(ordinary).toContain('for EVERY claim id in the index');
    expect(ordinary).not.toContain('(none —');
    expect(ordinary).not.toContain('nothing to adjudicate');
  });
});

describe('the parse path is untouched (parseJudgeOutput never forked)', () => {
  test('an answer to the TASK bundle validates through the SAME parser', () => {
    const text = 'Ranked.\n```json\n'
      + '{"ranking":["Review B","Review A"],"adjudications":'
      + '[{"id":"A1","verdict":"agree"},{"id":"B1","verdict":"dispute"}]}\n```';
    const res = parseJudgeOutput(text, { labels: ['Review A', 'Review B'], findingIds: ['A1', 'B1'] });
    expect(res.ok).toBe(true);
    expect(res.ranking).toEqual(['Review B', 'Review A']);
  });

  test('the no-claims answer the task twin names actually validates', () => {
    const text = '```json\n{"ranking":["Review A","Review B"],"adjudications":[]}\n```';
    expect(parseJudgeOutput(text, { labels: ['Review A', 'Review B'], findingIds: [] }).ok).toBe(true);
  });

  test('the judge REPAIR prompt rides the SKELETON — everything but the contract is shared', () => {
    // ⚠️ Plan T-B ruled "judge repair prompt rides the shared contract — verify,
    // don't fork", and this test verified exactly that until the F1 fork made it
    // the defect: a task judge briefed on the task contract was repaired against
    // the REVIEW one. What is shared is now the repair SKELETON — the verbatim
    // prior judgement, the error list, the do-not-change-your-votes rule — with
    // the intent's own contract in the tail. `Object.keys(t)` no longer excludes
    // a task repair builder; it names one, reached through judgeRepairPromptFor.
    const args = { errors: [{ code: 'BAD_RANKING', detail: 'x' }], judgement: 'prior' };
    const review = s2.buildJudgeRepairPrompt(args);
    const task = t.buildTaskJudgeRepairPrompt(args);
    for (const shared of ['Do NOT use any tools or read any files',
      '--- YOUR PREVIOUS JUDGEMENT (verbatim — this is the text to correct) ---',
      'BAD_RANKING: x', 'do not change your votes']) {
      expect(review).toContain(shared);
      expect(task).toContain(shared);
    }
    expect(review).toContain(s2.JUDGE_OUTPUT_CONTRACT);
    expect(task).toContain(t.TASK_JUDGE_OUTPUT_CONTRACT);
    expect(s2.judgeRepairPromptFor('task', args)).toBe(task);
  });
});

describe('dispatcher contract (briefings-stage2.judgeBundleFor)', () => {
  test('intent undefined → byte-identical to the review builder', () => {
    expect(s2.judgeBundleFor(undefined, ARGS)).toBe(s2.buildJudgeBundle(ARGS));
  });

  test("intent 'task' → byte-identical to the task builder", () => {
    expect(s2.judgeBundleFor('task', ARGS)).toBe(t.buildTaskJudgeBundle(ARGS));
  });

  test('any other intent value falls back to the review bundle (fail-closed)', () => {
    // The plumbing contract is `o.intent === 'task' | absent`; anything else
    // must compose the review bundle, never throw and never half-fork.
    expect(s2.judgeBundleFor('review', ARGS)).toBe(s2.buildJudgeBundle(ARGS));
    expect(s2.judgeBundleFor('bogus', ARGS)).toBe(s2.buildJudgeBundle(ARGS));
  });

  test('briefings-stage2.js never top-requires briefings-stage2-task (load-acyclic)', () => {
    // The task module top-requires briefings-stage2 for the shared vocabulary;
    // the dispatcher must lazy-require at call time or the cycle deadlocks into
    // a half-initialized module object.
    // ⚠️ v4.9 fix round 2 (council C4): anchored at column 0, not `.test(l.trim())`.
    // The trimming spelling reads an INDENTED call-time require as top-level.
    // MEASURED: that makes it OVER-eager, not blind — both spellings catch a
    // genuine column-0 `const … require`, but the trimming one also counts a
    // legitimate lazy require written in `const` form and REDS on correct code.
    // This module happens to lazy-require in `return … require(…)` form, which
    // neither spelling matches, which is why the loose variant survived here
    // while the briefings-chair-task sibling had to be strict from day one. All
    // three variants of the heuristic now read identically.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'council', 'briefings-stage2.js'), 'utf-8');
    const topLevelRequires = src.split('\n')
      .filter(l => /^(const|let|var)\s.*require\(/.test(l));
    expect(topLevelRequires.filter(l => l.includes('briefings-stage2-task'))).toHaveLength(0);
    expect(topLevelRequires.length).toBeGreaterThan(0);   // non-vacuous: the heuristic still binds
  });
});
