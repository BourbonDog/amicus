// src/council/briefings-stage2-task.js
'use strict';

/**
 * @module council/briefings-stage2-task
 * Stage-2 TASK-intent judge bundle (v4.9 W7; v4.8 design spec §5.4). Mirrors
 * W6's briefings-task.js shape exactly: one task twin per dispatch surface, the
 * review builder in ./briefings-stage2 left byte-identical, and the dispatcher
 * there (`judgeBundleFor`) lazy-requiring this module AT CALL TIME — this one
 * top-requires it for the shared vocabulary, so a top-level require on the other
 * side would be a load cycle.
 *
 * V11 — ONE VOCABULARY. Everything structural is the review bundle's, verbatim:
 * JUDGE_NO_TOOLS_PREAMBLE, the `Review <letter>` labels, the `id [severity]
 * claim` index line, the FINDINGS_INDEX_HEADER section header, and the judge
 * output contract bar ONE line (below). The header in particular stays SHARED
 * rather than becoming a
 * "CLAIMS INDEX": the contract names it in prose ("If the FINDINGS INDEX below is
 * empty…"), so forking the header would leave that line pointing at a section
 * that does not exist in task mode. Only the frame, the two task wordings, the
 * empty-index twin and ONE contract line speak in claims.
 *
 * THE CONTRACT'S ONE FORKED LINE (v4.9 W7 fix round, review MAJOR F1). The
 * contract is composed through the shared template `judgeOutputContractWith`,
 * with only its `- "ranking": …` bullet swapped. That bullet is the single
 * machine-readable statement of what `"ranking"` must ORDER BY, and the review
 * one names the review axis ("most to least accurate and insightful") — which
 * flatly contradicts TASK_JUDGE_A three paragraphs above it. Everything else in
 * the contract stays one text: a diff of the two is exactly one line, pinned.
 *
 * THE ONE ASYMMETRY (spec §5.4): a task bundle ends with the BRIEFING. Task
 * judges are asked to rank "which response best does the work the briefing asked
 * for", which is unanswerable without the ask; review judges rank critiques of
 * material they are deliberately not shown, and widening that would change what
 * a review judge is being asked to do. The review bundle's exclusion is pinned
 * as an ABSENCE in tests/council/briefings-stage2.test.js — it was never written
 * down before this wave.
 *
 * The task repair prompt is that same one-line swap, not a second prompt: it is
 * composed through the shared `judgeRepairPromptWith` skeleton over
 * TASK_JUDGE_OUTPUT_CONTRACT, so a task judge is repaired against the exact
 * shape it was briefed on — everything the review repair prompt says (the
 * verbatim prior judgement, the error list, the do-not-change-your-votes rule)
 * is unchanged text.
 */

const {
  JUDGE_NO_TOOLS_PREAMBLE, FINDINGS_INDEX_HEADER, dateLine,
  judgeOutputContractWith, judgeRepairPromptWith,
} = require('./briefings-stage2');

/** Task twin of the review frame — and the only pointer to the tail below. */
const TASK_JUDGE_FRAME =
  'You are judging the anonymized peer responses below. Each was produced ' +
  'independently against the same briefing, which is included at the end.';

/**
 * Task A, task-worded. Review mode ranks by how ACCURATE a critique was; there
 * is no critique here, so the axis is how well the asked-for work was DONE.
 */
const TASK_JUDGE_A =
  'Task A — Rank: order the responses from the one that best does the work the ' +
  'briefing asked for to the one that does it least well.';

/**
 * The task twin of REVIEW_RANKING_BULLET (F1). It points AT Task A rather than
 * paraphrasing it loosely — one axis, stated once, restated verbatim where the
 * judge reads the output shape — so the prose instruction and the JSON
 * instruction can never disagree about what `"ranking"` orders by. The label
 * vocabulary ("every review label below") stays the shared one: the blocks are
 * still headed `--- Review A ---` in task mode (V11).
 */
const TASK_RANKING_BULLET =
  '- "ranking": every review label below, ordered as Task A specifies — from the '
  + 'response that best does the work the briefing asked for to the one that does it least well.';

/** The task judge output contract: the shared template, one line swapped. */
const TASK_JUDGE_OUTPUT_CONTRACT = judgeOutputContractWith(TASK_RANKING_BULLET);

/** Task B when the bench declared claims to adjudicate (the ordinary case). */
const TASK_JUDGE_B =
  'Task B — Adjudicate: for EVERY claim id in the index, judge whether the claim ' +
  'holds: agree / dispute / neutral, with your reasoning in prose.';

/**
 * Task B when no response declared a load-bearing claim — the LC-10 twin.
 *
 * ⚠️ Same defect, same cost, task wording: a well-formed empty claims list is a
 * VALID task response (briefings-task.js :: TASK_FINDINGS_JSON_SHAPE blesses it),
 * so a whole bench can reach Stage 2 with an EMPTY index while the ordinary Task
 * B orders the judge to adjudicate "EVERY claim id in the index" with none
 * listed. parse-stage2 validates every adjudication id against the run-global
 * set, so a judge that answers the dangling instruction by inventing one fails
 * UNKNOWN_FINDING_ID and buys up to two PAID repair solos.
 */
const TASK_JUDGE_B_NO_CLAIMS =
  'Task B — Adjudicate: there is nothing to adjudicate on this bundle. No response ' +
  'declared a load-bearing claim, so the index below is empty. Emit "adjudications": [] ' +
  'and do not invent claim ids to fill it — a response whose reasoning is fully inline, ' +
  'resting on no discrete claim, is a valid response. Task A still applies in full.';

/** The index body when no response declared a claim — never a bare heading. */
const NO_CLAIMS_INDEX = '(none — no response in this bundle declared a load-bearing claim)';

/** The tail section header — the one section a review bundle never carries. */
const TASK_BRIEFING_HEADER = '--- THE BRIEFING (what every response was asked to do) ---';

/**
 * The absent-briefing body. STATED rather than papered over with an empty
 * section, on the LC-6/LC-12 rule: a model asked to judge against an ask it
 * cannot see must be TOLD that, not left to infer it from a blank heading — and
 * the note lands in bundle-stage2.md, so the loss is on the record rather than
 * silently absorbed into the rankings.
 */
const NO_BRIEFING_TAIL =
  '(unavailable — the briefing text did not reach this bundle; rank the responses on ' +
  'their own terms and say so in your ranking rationale)';

/**
 * The single shared anonymized TASK judge bundle.
 * @param {{reviews: Array<{label: string, text: string}>,
 *   findings: Array<{id: string, severity: string, claim: string}>,
 *   date?: string, briefing?: string}} args
 *   `findings` are the load-bearing CLAIMS the responses declared and may
 *   legitimately be EMPTY (LC-10 parity). `briefing` is the run's composed
 *   briefing text (`o.briefing`) — the EXTRA argument review mode has no use
 *   for, threaded from run-stage2.js, never re-read from disk.
 */
function buildTaskJudgeBundle({ reviews, findings, date, briefing }) {
  const raised = Array.isArray(findings) ? findings : [];
  const claimLines = raised.length
    ? raised.map(f => `${f.id} [${f.severity}] ${f.claim}`).join('\n')
    : NO_CLAIMS_INDEX;
  const reviewBlocks = reviews
    .map(r => `--- ${r.label} ---\n${r.text}`)
    .join('\n\n');
  const brief = typeof briefing === 'string' ? briefing.trim() : '';
  const parts = [JUDGE_NO_TOOLS_PREAMBLE];
  if (date) { parts.push(dateLine(date)); }
  parts.push(
    TASK_JUDGE_FRAME,
    TASK_JUDGE_A,
    raised.length ? TASK_JUDGE_B : TASK_JUDGE_B_NO_CLAIMS,
    TASK_JUDGE_OUTPUT_CONTRACT,
    FINDINGS_INDEX_HEADER,
    claimLines,
    reviewBlocks,
    TASK_BRIEFING_HEADER,
    brief || NO_BRIEFING_TAIL,
  );
  return parts.join('\n\n');
}

/**
 * The bounded judge-repair re-prompt a TASK judge receives (F1). Reached only
 * through `briefings-stage2.js :: judgeRepairPromptFor('task', …)`, the twin of
 * the bundle dispatcher; run-stage2.js threads `o.intent` into both.
 * @param {{errors?: Array<{code:string,detail:string}>, judgement?: string}} args
 */
function buildTaskJudgeRepairPrompt(args) {
  return judgeRepairPromptWith(TASK_JUDGE_OUTPUT_CONTRACT, args);
}

module.exports = {
  TASK_JUDGE_FRAME, TASK_JUDGE_A, TASK_JUDGE_B, TASK_JUDGE_B_NO_CLAIMS,
  NO_CLAIMS_INDEX, TASK_BRIEFING_HEADER, NO_BRIEFING_TAIL,
  TASK_RANKING_BULLET, TASK_JUDGE_OUTPUT_CONTRACT,
  buildTaskJudgeBundle, buildTaskJudgeRepairPrompt,
};
