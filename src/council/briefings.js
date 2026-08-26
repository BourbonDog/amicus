// src/council/briefings.js
'use strict';

/**
 * @module council/briefings
 * Pure Stage-1 briefing template builders for the headless council engine
 * (spec §5), adapted from skills/second-opinion/SEAT-BRIEFS.md with stricter
 * headless output contracts. No IO, no model calls. Stage-2 / chair templates
 * live in ./briefings-stage2.js (300-line gate split).
 */

/** SEAT-BRIEFS.md standard anti-sycophancy clause — verbatim, EVERY Stage-1 review briefing (task briefings carry briefings-task.js's claims-worded twin). */
const ANTI_SYCOPHANCY_CLAUSE =
  'Do not soften findings to be agreeable. Lead with your most severe finding. ' +
  'No praise cushions before criticism, and never perform enthusiasm you don\'t hold — ' +
  'if the artifact is mediocre, say so and show why. Do not pad: report every real ' +
  'finding and no invented ones. An empty severity category is a valid result.';

/**
 * "Produce exactly two things" framing (prose review, THEN the trailing json
 * block). Stage-1 builders need this. The findings-repair prompt deliberately
 * does NOT use it — a repair turn wants ONLY the corrected json, never a
 * fresh prose review (keeping this fragment out of the repair prompt fixes
 * the prior self-contradiction: "re-emit ONLY the JSON" followed by this
 * "write prose then json" framing).
 */
const FINDINGS_TWO_PART_FRAMING = [
  'Produce exactly two things, in this order:',
  '',
  '1. A prose review — your full narrative assessment of the material.',
  '2. A trailing fenced ```json block immediately after the prose — no text after it:',
].join('\n');

/**
 * JSON shape + field rules — shared by the full Stage-1 contract AND the repair prompt.
 *
 * ⚠️ LC-10 (owner ruling, 2026-07-26). The `"overall"` and `"findings"` rules below
 * are what finally make this prompt and `validateFindings` say the same thing. The
 * briefing has always shipped the anti-sycophancy clause's "An empty severity category
 * is a valid result" while the validator rejected exactly that answer (EMPTY_FINDINGS),
 * so the only way for a model to satisfy the schema was to produce a finding —
 * structural pressure to fabricate, which costgate01's grok obeyed. The validator now
 * accepts a well-formed empty set, and these two lines state the same rule to the model:
 * `findings` may be `[]`, `overall` may never be blank. Stating `overall` explicitly
 * matters more than it looks — it is the field that separates "I read it and found
 * nothing" from a hollow shell, and it was never in the field rules at all.
 */
const FINDINGS_JSON_SHAPE = [
  '```json',
  '{',
  '  "overall": "one-paragraph take",',
  '  "findings": [',
  '    { "id": 1, "severity": "blocker",',
  '      "claim": "…", "location": "…", "rationale": "…" }',
  '  ]',
  '}',
  '```',
  '',
  '- "overall" — a non-empty string. Always required, including when you found nothing.',
  '- "findings" — the array of findings, always present. If you genuinely found nothing,',
  '  emit [] and say so in "overall": a review that read the material and found nothing',
  '  is a valid review. Never invent a finding to fill the array.',
  '- "id" — sequential integer within this review, starting at 1.',
  '- "severity" — one of: blocker | major | minor | nit.',
  '- "claim", "location", "rationale" — non-empty strings.',
  'Emit the JSON verbatim after the prose, without preamble, so it parses cleanly.',
].join('\n');

/** Strict headless structured-output contract (prose + trailing ```json findings block). */
const FINDINGS_CONTRACT = [FINDINGS_TWO_PART_FRAMING, FINDINGS_JSON_SHAPE].join('\n\n');

/** Adapted from SEAT-BRIEFS.md § Critic seat brief (quota deliberately absent). */
const CRITIC_BRIEF = [
  'You are this review bench\'s designated critic. Assume problems exist; your job is to',
  'find them, not to confirm the material is fine. Work through four passes and fold',
  'everything into one findings list:',
  '',
  '1. Adversarial pass — for every claim: what evidence supports it, or is it an',
  '   assumption presented as fact? For every goal: is it measurable? For every decision:',
  '   what alternatives were considered? For every scope boundary: real constraint, or',
  '   avoidance of hard work?',
  '2. Edge-case hunt — walk every journey, requirement, and scenario. What happens on the',
  '   unexpected input, the failed integration, the malformed data? At zero, at one, at',
  '   scale? Report only unhandled cases.',
  '3. Consistency check — cross-reference sections against each other: do goals have',
  '   metrics, and metrics targets? Do requirements trace back to stated needs? Does',
  '   anything contradict a stated non-goal or constraint?',
  '4. Executability test — could someone act on this material without coming back with',
  '   clarifying questions? Wherever the answer is no, name the specific section and',
  '   exactly what is missing.',
  '',
  'Be specific: name the section, the line, the exact gap. Report every real finding and',
  'no invented ones; do not pad to look thorough. An empty pass is a valid result.',
].join('\n');

function dateLine(date) {
  return `Today's date is ${date}.`;
}

/**
 * The generalized Stage-1 skeleton (v4.9 W6): role / clause / date / contract /
 * separator / briefing. Both intents compose through here, which is what makes
 * the `--- MATERIAL / BRIEFING ---` separator — a PRODUCTION contract,
 * src/sidecar/list-search.js:14 splits briefing-stage1.md on it — a single
 * spelling in both modes. briefings-task.js top-requires this.
 */
function composeWith(role, clause, contract, { briefing, date }) {
  return [
    role,
    clause,
    dateLine(date),
    contract,
    '--- MATERIAL / BRIEFING ---',
    briefing,
  ].join('\n\n');
}

/** Review-mode skeleton — delegates, so the review path is byte-identical by construction. */
function compose(role, args) {
  return composeWith(role, ANTI_SYCOPHANCY_CLAUSE, FINDINGS_CONTRACT, args);
}

/** Standard seat briefing (Stage-1 fanout wave). */
function buildSeatBriefing(args) {
  return compose(
    'You are one reviewer on an independent multi-model review bench. Review the material ' +
    'below against the briefing\'s own criteria.',
    args
  );
}

/** Critic seat briefing (concurrent solo — spec §4 --critic). */
function buildCriticBriefing(args) {
  return compose(CRITIC_BRIEF, args);
}

/** Expert-lens briefing (concurrent solo per seat — spec §4 --lenses). */
function buildLensBriefing({ lens, briefing, date }) {
  return compose(
    `Review this material strictly through the lens of a ${lens}. Raise only findings ` +
    'that perspective is qualified to raise, at the depth a top practitioner of it would ' +
    'reach. Stay in-domain: if something matters but is outside your lens, leave it to ' +
    'the other reviewers.',
    { briefing, date }
  );
}

/**
 * Bounded findings-repair re-prompt (solo; ≤ 2 per seat — SKILL.md Stage-1
 * repair loop). References ONLY the json-shape fragment — never the
 * "prose review THEN json" framing — so a headless model isn't handed license
 * to write a whole new prose review on a tight repair turn.
 *
 * ⚠️ LC-6. This used to carry the validation ERRORS without the REVIEW they
 * were errors about, and a repair solo is a FRESH session with no memory of
 * the review turn. Three of five paid councils burned a seat on it:
 *   - wsgate02 `qwen`  — refused twice: "I don't have a previous review to correct"
 *   - wsgate04 `glm`   — refused twice: "the previous review's content was
 *                        excluded by the caller… I will not fabricate findings"
 *   - costgate01 `grok` — COMPLIED, by inventing a self-referential finding
 *                        about its own empty output, which then entered
 *                        tally.json, the street-cred table and the chair
 *                        synthesis as C1 and reached a human's decision.
 * Honest models lose the seat (a 4-model bench silently adjudicating on 3,
 * still paying for the fourth); compliant ones poison the record.
 *
 * `review` is the text that ACTUALLY failed — the original review on the first
 * attempt, the previous repair's output on the second — so the errors and the
 * artifact they describe are always the same thing. It is embedded verbatim and
 * uncapped: the largest real case was 35 KB, and a silent truncation would
 * recreate this defect in a subtler form (repairing a review the model can only
 * half see).
 * @param {{errors?: Array<{code: string, detail: string}>, review?: string}} args
 */
function buildFindingsRepairPrompt({ errors, review }) {
  const lines = (errors || []).map(e => `- ${e.code}: ${e.detail}`).join('\n');
  const text = typeof review === 'string' ? review.trim() : '';
  // The absent case is stated, never papered over with an empty block: a model
  // asked to repair nothing must be told to report nothing rather than left to
  // guess, which is precisely what produced grok's invented finding.
  //
  // ⚠️ LC-10: this branch's instruction — "emit an empty findings array and say so
  // in overall" — described an answer the validator then REJECTED, so a model that
  // complied burned its second repair attempt and still landed 'unstructured'. It is
  // now the correct answer: an empty set with a real `overall` validates, and the
  // seat ends 'repaired' + findingsUnverified rather than 'unstructured'.
  const prior = text
    ? ['--- YOUR PREVIOUS REVIEW (verbatim — this is the text to correct) ---',
      text,
      '--- END OF YOUR PREVIOUS REVIEW ---'].join('\n')
    : 'Your previous response was empty — there is no prior review text to correct. ' +
      'Do not invent findings to satisfy the schema: emit an empty "findings" array ' +
      'and say so in "overall".';
  return [
    'Do NOT use any tools or read any files; everything is in this message; begin ' +
    'immediately with the JSON block.',
    prior,
    'That review\'s trailing findings JSON failed validation with these errors:',
    lines,
    'Re-emit ONLY the corrected findings JSON block (the same findings, fixed — do not ' +
    'add or remove findings), as a single fenced ```json block:',
    FINDINGS_JSON_SHAPE,
  ].join('\n\n');
}

/**
 * Stage-1 per-surface dispatchers (v4.9 W6). `intent` is the run's task-mode
 * channel (W5 plumbing: `'task'` | absent) — a task run composes the task twin
 * from ./briefings-task, anything else composes the review builder
 * byte-identically (fail-closed). The require is lazy AT CALL TIME:
 * briefings-task top-requires this module for composeWith, so a top-level
 * require here would be a load cycle.
 */
function stage1SeatBriefing(intent, args) {
  return intent === 'task' ? require('./briefings-task').buildTaskSeatBriefing(args) : buildSeatBriefing(args);
}

function stage1CriticBriefing(intent, args) {
  return intent === 'task' ? require('./briefings-task').buildTaskCriticBriefing(args) : buildCriticBriefing(args);
}

function stage1LensBriefing(intent, args) {
  return intent === 'task' ? require('./briefings-task').buildTaskLensBriefing(args) : buildLensBriefing(args);
}

function stage1RepairPrompt(intent, args) {
  return intent === 'task' ? require('./briefings-task').buildTaskFindingsRepairPrompt(args) : buildFindingsRepairPrompt(args);
}

module.exports = {
  ANTI_SYCOPHANCY_CLAUSE, FINDINGS_CONTRACT, FINDINGS_JSON_SHAPE, FINDINGS_TWO_PART_FRAMING,
  buildSeatBriefing, buildCriticBriefing, buildLensBriefing, buildFindingsRepairPrompt,
  composeWith, stage1SeatBriefing, stage1CriticBriefing, stage1LensBriefing, stage1RepairPrompt,
};
