// src/council/briefings-stage2.js
'use strict';

/**
 * @module council/briefings-stage2
 * Pure Stage-2 (judge bundle) and Stage-3 (chair packet) template builders
 * for the headless council engine (spec §5). Split from ./briefings.js for
 * the 300-line gate. The bundle is identical for every judge and never leaks
 * seat/lens/critic information or model names (skill §5.1 / Stage-2 rule).
 */

const JUDGE_NO_TOOLS_PREAMBLE =
  'Do NOT use any tools or read any files; everything is in this message; ' +
  'begin immediately with A1:';

const CHAIR_NO_TOOLS_PREAMBLE =
  'Do NOT use any tools or read any files; everything is in this message; ' +
  'begin immediately with the verdict.';

const CHAIR_VERDICT_VALUES = ['Ship it', 'Fix these first', 'Fundamental rethink'];

/** Shared date line (spec §4.3) — prepended to every model-facing briefing. */
function dateLine(date) { return `Today's date is ${date}.`; }

/**
 * Stage-2 headless output contract (spec §5, embedded in the judge bundle).
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
 */
const JUDGE_OUTPUT_CONTRACT = [
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
  '- "ranking": every review label below, ordered most to least accurate and insightful.',
  '  Ties: use a nested array for tied labels, e.g. [["Review A", "Review B"], "Review C"].',
  '- "adjudications": one entry per listed finding id; "verdict" is one of:',
  '  agree | dispute | neutral. An "I missed this — it\'s valid" counts as agree.',
  '- If the FINDINGS INDEX below is empty, "adjudications" must be exactly `[]` — do',
  '  not invent a finding id merely to have something to adjudicate.',
].join('\n');

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
    '--- FINDINGS INDEX (run-global ids) ---',
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
 * @param {{errors?: Array<{code:string,detail:string}>, judgement?: string}} args
 */
function buildJudgeRepairPrompt({ errors, judgement }) {
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
    JUDGE_OUTPUT_CONTRACT,
  ].join('\n\n');
}

/** Verdict-scale addendum (SEAT-BRIEFS.md § Chair verdict-scale addendum; always on headless). */
const VERDICT_SCALE_ADDENDUM = [
  'After your synthesis, add two closing sections:',
  '',
  '1. HARD QUESTIONS — three to five questions the material\'s author has probably not',
  '   asked themselves, chosen so that an unanswerable question reveals a structural gap',
  '   (not gotchas — questions whose answers should exist).',
  '2. A final line, alone on the last line, containing ONLY the phrase — no rationale, no',
  '   dash, no trailing text of any kind — exactly one of:',
  '',
  '   VERDICT: Ship it',
  '   VERDICT: Fix these first',
  '   VERDICT: Fundamental rethink',
  '',
  '   Pick one. "Ship it" = solid, nothing blocking. "Fix these first" = specific gaps',
  '   must be resolved first. "Fundamental rethink" = structural problems that cannot be',
  '   patched. Name the gaps or the structural problems in the synthesis ABOVE, not on the',
  '   VERDICT line itself — that line carries the phrase and nothing else.',
].join('\n');

/** The chair's opening instruction when there is something to weigh (the ordinary case). */
const CHAIR_TASK =
  'You are the council chair. Write the synthesized verdict across the reviews, ' +
  'rankings, and adjudications below. Weigh each reviewer\'s findings by their ' +
  'peer-validated standing (rank position and adjudication pattern), distinguish ' +
  'findings the bench broadly endorsed from contested or singleton claims, and ' +
  'arrive at an overall assessment of the material.';

/**
 * The chair's opening instruction when the bench raised nothing at all (LC-10
 * fast-follow, review minor M2).
 *
 * Task 3 fixed this by keeping CHAIR_TASK unchanged and appending a correcting note
 * — asymmetric with buildJudgeBundle, which swaps JUDGE_TASK_B for
 * JUDGE_TASK_B_NO_FINDINGS outright. The un-swapped CHAIR_TASK asks the chair to
 * "distinguish findings the bench broadly endorsed from contested or singleton
 * claims" over an empty tier table and two bare section headings — an instruction
 * whose only satisfiable reading is to invent material — and the chair reads that
 * unfollowable directive FIRST, the correction second. This constant replaces
 * CHAIR_TASK entirely on a clean bench instead: it never asks for a distinction
 * that cannot exist, and the clean-bench framing (still stated, not just implied)
 * is now the only instruction the chair sees, not an amendment to a bad one.
 */
const CHAIR_TASK_NO_FINDINGS =
  'You are the council chair. Write the synthesized verdict across the reviews and ' +
  'rankings below. Weigh each reviewer\'s standing by rank position, and arrive at ' +
  'an overall assessment of the material. NOTE: this bench raised NO findings. ' +
  'Every reviewer read the material and reported nothing to fix, which is a valid ' +
  'outcome — not a failed run. Synthesize on that basis: say what the reviews ' +
  'actually establish and where the bench\'s agreement is thin, and do not ' +
  'manufacture concerns to fill the sections below.';

/** A section body, or an explicit reason it is empty — never a heading over nothing. */
function orNone(text, none) {
  return (typeof text === 'string' && text.trim()) ? text : none;
}

/**
 * De-anonymized chair packet (spec §5/§6: the chair sees identities).
 * @param {{reviews: Array<{model: string, text: string}>,
 *   rankings: Array<{judge: string, order: Array<string|string[]>}>,
 *   adjudications: Array<{findingId: string, judge: string, verdict: string}>,
 *   tierCounts: object}} args
 *   `rankings` and `adjudications` may both be empty — an all-clean bench (LC-10)
 *   has nothing to adjudicate, and a Stage 2 whose judges all died has nothing to
 *   rank. Each empty section says WHICH of those it is rather than rendering blank.
 */
function buildChairPacket({ reviews, rankings, adjudications, tierCounts, date }) {
  const reviewBlocks = reviews.map(r => `--- Review by ${r.model} ---\n${r.text}`).join('\n\n');
  const rankingLines = (rankings || [])
    .map(r => `${r.judge}: ${JSON.stringify(r.order)}`)
    .join('\n');
  const adjLines = (adjudications || [])
    .map(a => `${a.findingId} — ${a.judge}: ${a.verdict}`)
    .join('\n');
  // Every finding lands in exactly one tier (tally.js countTiers), so the tier
  // counts sum to the record's finding count — which is how an all-clean bench is
  // told apart from a bench whose judges simply never voted.
  const raisedCount = Object.values(tierCounts || {})
    .reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0);
  const tiers = JSON.stringify(tierCounts);
  const parts = [CHAIR_NO_TOOLS_PREAMBLE];
  if (date) { parts.push(dateLine(date)); }
  parts.push(raisedCount === 0 ? CHAIR_TASK_NO_FINDINGS : CHAIR_TASK);
  parts.push(
    `Deterministic tier counts (peers-only cascade): ${tiers}`,
    '--- STAGE-1 REVIEWS (de-anonymized) ---',
    reviewBlocks,
    '--- PEER RANKINGS (judge: order, best first) ---',
    orNone(rankingLines, '(none — no judge produced a usable ranking)'),
    '--- PER-FINDING ADJUDICATIONS ---',
    orNone(adjLines, raisedCount === 0
      ? '(none — the bench raised no findings, so there was nothing to adjudicate)'
      : '(none — no judge produced a usable adjudication)'),
    VERDICT_SCALE_ADDENDUM,
  );
  return parts.join('\n\n');
}

/**
 * One-shot chair repair: the VERDICT line was missing (spec §5 chair contract).
 *
 * ⚠️ LC-12: this builder took NO arguments at all, so the repair solo — a fresh
 * session — was asked for a verdict on a synthesis it could not see. The chair's
 * synthesis WAS received; it is the verdict line that is missing. Handing back the
 * synthesis lets the chair pick the verdict its own prose supports instead of
 * re-deriving one from nothing.
 * @param {{synthesis?: string}} [args]
 */
function buildChairRepairPrompt({ synthesis } = {}) {
  const text = typeof synthesis === 'string' ? synthesis.trim() : '';
  const prior = text
    ? ['--- YOUR SYNTHESIS (verbatim — verdict on THIS) ---', text,
      '--- END OF YOUR SYNTHESIS ---'].join('\n')
    : null;
  return [
    'Do NOT use any tools or read any files; everything is in this message; begin '
    + 'immediately with the VERDICT line.',
    ...(prior ? [prior] : []),
    'Your synthesis was received, but the final parseable line was missing. Emit ONLY '
    + 'one line, exactly one of:',
    'VERDICT: Ship it',
    'VERDICT: Fix these first',
    'VERDICT: Fundamental rethink',
  ].join('\n\n');
}

module.exports = {
  JUDGE_NO_TOOLS_PREAMBLE, CHAIR_NO_TOOLS_PREAMBLE, CHAIR_VERDICT_VALUES,
  JUDGE_OUTPUT_CONTRACT, VERDICT_SCALE_ADDENDUM, dateLine,
  JUDGE_TASK_B, JUDGE_TASK_B_NO_FINDINGS, NO_FINDINGS_INDEX,
  CHAIR_TASK, CHAIR_TASK_NO_FINDINGS,
  buildJudgeBundle, buildJudgeRepairPrompt, buildChairPacket, buildChairRepairPrompt,
};
