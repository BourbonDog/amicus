// src/council/briefings-stage2.js
'use strict';

/**
 * @module council/briefings-stage2
 * Pure Stage-2 (judge bundle) and Stage-3 (chair packet) template builders
 * for the headless council engine (spec §5). Split from ./briefings.js for
 * the 300-line gate. The bundle is identical for every judge and never leaks
 * seat/lens/critic information or model names (skill §5.1 / Stage-2 rule).
 */

// Chair surface lives in ./briefings-chair (v4.8 PR0 size-gate split).
// Every chair name is re-exported below — run-chair.js, run-assemble.js,
// briefings-debate.js and the briefings tests import them from here.
const chair = require('./briefings-chair');
const { dateLine } = chair;

const JUDGE_NO_TOOLS_PREAMBLE =
  'Do NOT use any tools or read any files; everything is in this message; ' +
  'begin immediately with A1:';

/**
 * The review-path ranking bullet — the ONE contract line that forks on intent
 * (v4.9 W7 fix round, review MAJOR F1). It names the REVIEW ranking axis, which
 * is the same axis the review bundle's Task A states three paragraphs above it;
 * a task bundle composing this verbatim would order its judge, in the one
 * machine-readable instruction that actually produces `"ranking"`, to rank by
 * critique accuracy when its own Task A ranks by how well the asked-for work was
 * DONE. Extracted rather than reworded: the review text is unchanged, and the
 * task twin lives beside its own frame in ./briefings-stage2-task.
 */
const REVIEW_RANKING_BULLET =
  '- "ranking": every review label below, ordered most to least accurate and insightful.';

/**
 * Stage-2 headless output contract (spec §5, embedded in the judge bundle),
 * as a template over its ranking bullet — the W6 `briefings.js :: composeWith`
 * precedent. Everything BUT that bullet is ONE text in both modes (V11): the
 * fenced-block shape, the worked example, the ties rule, the adjudication
 * verdicts and the LC-10 empty-index line all read identically to a task judge.
 *
 * ⚠️ LC-10 fast-follow (review minor M1): on a clean bench, JUDGE_TASK_B_NO_FINDINGS
 * tells the judge to emit `"adjudications": []` — but this contract immediately
 * follows it, and its worked example still shows `{"id":"A1"...},{"id":"B2"...}`.
 * "One entry per listed finding id" is satisfied by zero entries, so it is not a
 * contradiction, but the example is the last remaining incentive to invent an id:
 * inventing one fails `UNKNOWN_FINDING_ID` (parse-stage2.js) and buys up to two
 * paid repair solos per judge. The trailing bullet below states the zero case
 * explicitly so the empty findings index has its own answer, not just an example
 * that happens to allow it. It is unconditional (shown on every bench, including
 * the ordinary and repair paths) because it is inert when findings exist and the
 * repair prompt has no findings-state argument to swap on.
 * @param {string} rankingBullet the intent's own `- "ranking": …` line
 */
function judgeOutputContractWith(rankingBullet) {
  return [
    'End your response with a trailing fenced ```json block — no text after it — in',
    'exactly this shape:',
    '',
    '```json',
    '{',
    '  "ranking": ["Review B", "Review A", "Review C"],',
    '  "adjudications": [',
    '    { "id": "A1", "verdict": "agree" },',
    '    { "id": "B2", "verdict": "dispute" }',
    '  ]',
    '}',
    '```',
    '',
    rankingBullet,
    '  Ties: use a nested array for tied labels, e.g. [["Review A", "Review B"], "Review C"].',
    '- "adjudications": one entry per listed finding id; "verdict" is one of:',
    '  agree | dispute | neutral. An "I missed this — it\'s valid" counts as agree.',
    '- If the FINDINGS INDEX below is empty, "adjudications" must be exactly `[]` — do',
    '  not invent a finding id merely to have something to adjudicate.',
  ].join('\n');
}

/** Review-mode contract — delegates, so its bytes are the shipped ones by construction. */
const JUDGE_OUTPUT_CONTRACT = judgeOutputContractWith(REVIEW_RANKING_BULLET);

/** Task B when there is something to adjudicate (the ordinary case). */
const JUDGE_TASK_B =
  'Task B — Adjudicate: for EVERY finding id listed below, state agree, dispute, or ' +
  'neutral with your reasoning in prose.';

/**
 * Task B when the whole bench came back clean (LC-10).
 *
 * ⚠️ Once a well-formed empty findings set is a VALID review, a run in which every
 * seat found nothing reaches Stage 2 with an EMPTY findings index — and the ordinary
 * Task B then orders the judge to adjudicate "EVERY finding id listed below" when
 * none are listed, under a bare heading with nothing beneath it. That is not merely
 * untidy: `parse-stage2` validates every adjudication id against the run-global set,
 * so a judge that answers the dangling instruction by inventing an id fails with
 * UNKNOWN_FINDING_ID and buys up to two PAID repair solos per judge. Stating the
 * empty case and naming the exact output (`"adjudications": []`) is what keeps the
 * clean bench cheap.
 */
const JUDGE_TASK_B_NO_FINDINGS =
  'Task B — Adjudicate: there is nothing to adjudicate on this bundle. No review ' +
  'raised a finding, so the findings index below is empty. Emit "adjudications": [] ' +
  'and do not invent finding ids to fill it — a review that read the material and ' +
  'found nothing is a valid review. Task A still applies in full.';

/** The findings index body when the bench raised nothing — never a bare heading. */
const NO_FINDINGS_INDEX = '(none — no review in this bundle raised a finding)';

/**
 * The index section header — SHARED across both intents (V11, v4.9 W7). It is a
 * constant rather than an inline literal because the contract template names it
 * in prose ("If the FINDINGS INDEX below is empty…") and briefings-stage2-task.js
 * renders the same section over CLAIMS: a second copy is how the two silently
 * drift apart and leave that shared contract line pointing at nothing.
 */
const FINDINGS_INDEX_HEADER = '--- FINDINGS INDEX (run-global ids) ---';

/**
 * The single shared anonymized judge bundle.
 * @param {{reviews: Array<{label: string, text: string}>,
 *   findings: Array<{id: string, severity: string, claim: string}>}} args
 *   `findings` may legitimately be EMPTY (LC-10): every seat reported a clean read.
 *   The bundle then states so explicitly instead of emitting a heading over nothing.
 */
function buildJudgeBundle({ reviews, findings, date }) {
  const raised = Array.isArray(findings) ? findings : [];
  const findingLines = raised.length
    ? raised.map(f => `${f.id} [${f.severity}] ${f.claim}`).join('\n')
    : NO_FINDINGS_INDEX;
  const reviewBlocks = reviews
    .map(r => `--- ${r.label} ---\n${r.text}`)
    .join('\n\n');
  const parts = [JUDGE_NO_TOOLS_PREAMBLE];
  if (date) { parts.push(dateLine(date)); }
  parts.push(
    'You are judging the anonymized peer reviews below. Do two things:',
    'Task A — Rank: order the reviews from most to least accurate and insightful.',
    raised.length ? JUDGE_TASK_B : JUDGE_TASK_B_NO_FINDINGS,
    JUDGE_OUTPUT_CONTRACT,
    FINDINGS_INDEX_HEADER,
    findingLines,
    reviewBlocks,
  );
  return parts.join('\n\n');
}

/**
 * Bounded judge-repair re-prompt (solo; ≤ 2 per judge — spec §5).
 *
 * ⚠️ LC-12: a repair solo is a FRESH session with no memory of the judging turn.
 * Shipping only `errors` asked the model to correct something it had never seen —
 * the identical defect LC-6 fixed one stage earlier, where it cost three of five
 * paid councils a seat. Stage 2 is worse: a refused judge has no `conformance`
 * column, so the tally silently shows fewer votes and basis counts can flip a tier.
 *
 * `judgement` is embedded verbatim and uncapped — a silent truncation would
 * recreate the defect in a subtler form (repairing a judgement the model can only
 * half see) — and the absent case is STATED rather than papered over with an
 * empty block.
 *
 * Templated over the contract for the same reason the bundle is (F1): a repair
 * solo is a FRESH session whose only statement of the required shape is the
 * contract embedded here, so a task judge repaired against the review bullet
 * would be told to re-rank on the wrong axis — on the paid path the run reaches
 * precisely because that judge already got its output wrong once.
 * @param {string} contract the intent's judge output contract
 * @param {{errors?: Array<{code:string,detail:string}>, judgement?: string}} args
 */
function judgeRepairPromptWith(contract, { errors, judgement }) {
  const lines = (errors || []).map(e => `- ${e.code}: ${e.detail}`).join('\n');
  const text = typeof judgement === 'string' ? judgement.trim() : '';
  const prior = text
    ? ['--- YOUR PREVIOUS JUDGEMENT (verbatim — this is the text to correct) ---',
      text,
      '--- END OF YOUR PREVIOUS JUDGEMENT ---'].join('\n')
    : 'Your previous response was empty — there is no prior judgement to correct. '
      + 'Do not invent rankings or adjudications to satisfy the schema: say so in your output.';
  return [
    'Do NOT use any tools or read any files; everything is in this message; begin '
    + 'immediately with the JSON block.',
    prior,
    'That judging response\'s trailing JSON failed validation with these errors:',
    lines,
    'Re-emit ONLY the corrected JSON block (the same rankings and adjudications, fixed — '
    + 'do not change your votes), as a single fenced ```json block:',
    contract,
  ].join('\n\n');
}

/** Review-mode repair prompt — delegates, so the review path is byte-identical. */
function buildJudgeRepairPrompt(args) {
  return judgeRepairPromptWith(JUDGE_OUTPUT_CONTRACT, args);
}

/**
 * Stage-2 bundle dispatcher (v4.9 W7, mirroring W6's briefings.js :: stage1SeatBriefing).
 * `intent` is the run's task-mode channel (W5 plumbing: `'task'` | absent) — a
 * task run composes the task twin from ./briefings-stage2-task, anything else
 * composes the review bundle byte-identically (fail-closed). The require is lazy
 * AT CALL TIME: briefings-stage2-task top-requires this module for the shared
 * vocabulary, so a top-level require here would be a load cycle.
 *
 * `args` gains one field the review builder ignores: `briefing` (spec §5.4 —
 * task judges see the ask, review judges never do).
 */
function judgeBundleFor(intent, args) {
  return intent === 'task' ? require('./briefings-stage2-task').buildTaskJudgeBundle(args) : buildJudgeBundle(args);
}

/**
 * Repair-prompt twin of `judgeBundleFor` — same channel, same fail-closed rule,
 * same CALL-TIME require for the same load-cycle reason. Both Stage-2 prompts a
 * judge can receive now fork on one value, so a task judge cannot be briefed on
 * one contract and repaired against the other (F1).
 */
function judgeRepairPromptFor(intent, args) {
  return intent === 'task'
    ? require('./briefings-stage2-task').buildTaskJudgeRepairPrompt(args)
    : buildJudgeRepairPrompt(args);
}

module.exports = {
  JUDGE_NO_TOOLS_PREAMBLE, CHAIR_NO_TOOLS_PREAMBLE: chair.CHAIR_NO_TOOLS_PREAMBLE,
  CHAIR_VERDICT_VALUES: chair.CHAIR_VERDICT_VALUES,
  JUDGE_OUTPUT_CONTRACT, VERDICT_SCALE_ADDENDUM: chair.VERDICT_SCALE_ADDENDUM, dateLine,
  JUDGE_TASK_B, JUDGE_TASK_B_NO_FINDINGS, NO_FINDINGS_INDEX, FINDINGS_INDEX_HEADER,
  judgeBundleFor, judgeRepairPromptFor,
  // The two seams the task twin composes through (F1) — never called directly
  // by the run loop, which reaches both surfaces through the dispatchers above.
  judgeOutputContractWith, judgeRepairPromptWith, REVIEW_RANKING_BULLET,
  CHAIR_TASK: chair.CHAIR_TASK, CHAIR_TASK_NO_FINDINGS: chair.CHAIR_TASK_NO_FINDINGS,
  buildJudgeBundle, buildJudgeRepairPrompt,
  buildChairPacket: chair.buildChairPacket, buildChairRepairPrompt: chair.buildChairRepairPrompt,
  // v4.9 W7: run-chair.js reaches the chair surface through this module only.
  chairRepairPromptFor: chair.chairRepairPromptFor,
};
