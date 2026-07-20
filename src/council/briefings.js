// src/council/briefings.js
'use strict';

/**
 * @module council/briefings
 * Pure Stage-1 briefing template builders for the headless council engine
 * (spec §5), adapted from skills/second-opinion/SEAT-BRIEFS.md with stricter
 * headless output contracts. No IO, no model calls. Stage-2 / chair templates
 * live in ./briefings-stage2.js (300-line gate split).
 */

/** SEAT-BRIEFS.md standard anti-sycophancy clause — verbatim, EVERY Stage-1 briefing. */
const ANTI_SYCOPHANCY_CLAUSE =
  'Do not soften findings to be agreeable. Lead with your most severe finding. ' +
  'No praise cushions before criticism, and never perform enthusiasm you don\'t hold — ' +
  'if the artifact is mediocre, say so and show why. Do not pad: report every real ' +
  'finding and no invented ones. An empty severity category is a valid result.';

/** Strict headless structured-output contract (prose + trailing ```json findings block). */
const FINDINGS_CONTRACT = [
  'Produce exactly two things, in this order:',
  '',
  '1. A prose review — your full narrative assessment of the material.',
  '2. A trailing fenced ```json block immediately after the prose — no text after it:',
  '',
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
  '- "id" — sequential integer within this review, starting at 1.',
  '- "severity" — one of: blocker | major | minor | nit.',
  '- "claim", "location", "rationale" — non-empty strings.',
  'Emit the JSON verbatim after the prose, without preamble, so it parses cleanly.',
].join('\n');

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

function compose(role, { briefing, date }) {
  return [
    role,
    ANTI_SYCOPHANCY_CLAUSE,
    dateLine(date),
    FINDINGS_CONTRACT,
    '--- MATERIAL / BRIEFING ---',
    briefing,
  ].join('\n\n');
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

/** Bounded findings-repair re-prompt (solo; ≤ 2 per seat — SKILL.md Stage-1 repair loop). */
function buildFindingsRepairPrompt({ errors }) {
  const lines = (errors || []).map(e => `- ${e.code}: ${e.detail}`).join('\n');
  return [
    'Do NOT use any tools or read any files; everything is in this message; begin ' +
    'immediately with the JSON block.',
    'Your previous review\'s trailing findings JSON failed validation with these errors:',
    lines,
    'Re-emit ONLY the corrected findings JSON block (the same findings, fixed — do not ' +
    'add or remove findings), as a single fenced ```json block:',
    FINDINGS_CONTRACT,
  ].join('\n\n');
}

module.exports = {
  ANTI_SYCOPHANCY_CLAUSE, FINDINGS_CONTRACT,
  buildSeatBriefing, buildCriticBriefing, buildLensBriefing, buildFindingsRepairPrompt,
};
