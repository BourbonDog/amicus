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

/** Stage-2 headless output contract (spec §5, embedded in the judge bundle). */
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
].join('\n');

/**
 * The single shared anonymized judge bundle.
 * @param {{reviews: Array<{label: string, text: string}>,
 *   findings: Array<{id: string, severity: string, claim: string}>}} args
 */
function buildJudgeBundle({ reviews, findings, date }) {
  const findingLines = findings.map(f => `${f.id} [${f.severity}] ${f.claim}`).join('\n');
  const reviewBlocks = reviews
    .map(r => `--- ${r.label} ---\n${r.text}`)
    .join('\n\n');
  const parts = [JUDGE_NO_TOOLS_PREAMBLE];
  if (date) { parts.push(dateLine(date)); }
  parts.push(
    'You are judging the anonymized peer reviews below. Do two things:',
    'Task A — Rank: order the reviews from most to least accurate and insightful.',
    'Task B — Adjudicate: for EVERY finding id listed below, state agree, dispute, or ' +
    'neutral with your reasoning in prose.',
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

/**
 * De-anonymized chair packet (spec §5/§6: the chair sees identities).
 * @param {{reviews: Array<{model: string, text: string}>,
 *   rankings: Array<{judge: string, order: Array<string|string[]>}>,
 *   adjudications: Array<{findingId: string, judge: string, verdict: string}>,
 *   tierCounts: object}} args
 */
function buildChairPacket({ reviews, rankings, adjudications, tierCounts, date }) {
  const reviewBlocks = reviews.map(r => `--- Review by ${r.model} ---\n${r.text}`).join('\n\n');
  const rankingLines = rankings
    .map(r => `${r.judge}: ${JSON.stringify(r.order)}`)
    .join('\n');
  const adjLines = adjudications
    .map(a => `${a.findingId} — ${a.judge}: ${a.verdict}`)
    .join('\n');
  const tiers = JSON.stringify(tierCounts);
  const parts = [CHAIR_NO_TOOLS_PREAMBLE];
  if (date) { parts.push(dateLine(date)); }
  parts.push(
    'You are the council chair. Write the synthesized verdict across the reviews, ' +
    'rankings, and adjudications below. Weigh each reviewer\'s findings by their ' +
    'peer-validated standing (rank position and adjudication pattern), distinguish ' +
    'findings the bench broadly endorsed from contested or singleton claims, and ' +
    'arrive at an overall assessment of the material.',
    `Deterministic tier counts (peers-only cascade): ${tiers}`,
    '--- STAGE-1 REVIEWS (de-anonymized) ---',
    reviewBlocks,
    '--- PEER RANKINGS (judge: order, best first) ---',
    rankingLines,
    '--- PER-FINDING ADJUDICATIONS ---',
    adjLines,
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
  buildJudgeBundle, buildJudgeRepairPrompt, buildChairPacket, buildChairRepairPrompt,
};
