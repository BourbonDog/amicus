// src/council/briefings-task.js
'use strict';

/**
 * @module council/briefings-task
 * Stage-1 TASK-intent briefing twins (v4.9 W6; v4.8 design spec §5.1-§5.3).
 * One frame per dispatch surface — seat, critic (V13), lens, findings repair —
 * composed on the SAME skeleton as the review builders (briefings.js ::
 * composeWith), so the `--- MATERIAL / BRIEFING ---` separator contract
 * (src/sidecar/list-search.js:14) survives both modes.
 *
 * CUT 1/2 (spec §5.2): the JSON skeleton, the `blocker|major|minor|nit` enum
 * and the required-non-empty `location` rule are review mode's, verbatim —
 * only the frame and the field GLOSSES fork, and findings.js changes by zero
 * lines: one validator, one repair loop, both intents.
 *
 * Load order: this module top-requires briefings for the shared skeleton;
 * briefings.js only ever lazy-requires this one at dispatch time (acyclic).
 */

const { composeWith } = require('./briefings');

/** Task twin of ANTI_SYCOPHANCY_CLAUSE — confidence honesty over finding honesty. */
const TASK_ANTI_SYCOPHANCY_CLAUSE =
  'Do not hedge to be agreeable. Lead with your strongest position and show why it holds. ' +
  'Never perform confidence you don\'t hold — where the evidence is thin, say so and mark ' +
  'the claim an assumption. Do not pad: state every load-bearing claim and no invented ' +
  'ones. An empty claims list under a real answer is a valid result.';

/**
 * "Produce exactly two things" framing, task-worded: the deliverable IS the
 * work, the trailing json block carries the claims it rests on. Kept out of
 * the repair prompt for the same reason as review mode (a repair turn wants
 * ONLY the corrected json, never a fresh deliverable).
 */
const TASK_TWO_PART_FRAMING = [
  'Produce exactly two things, in this order:',
  '',
  '1. Your deliverable — the full analysis, answer, or artifact the briefing asks for.',
  '2. A trailing fenced ```json block immediately after it — no text after it:',
].join('\n');

/**
 * JSON shape + field rules, task gloss. The fenced skeleton is byte-identical
 * to briefings.js :: FINDINGS_JSON_SHAPE (CUT 1: same keys, same example, same
 * severity enum — pinned in tests/council/briefings-task.test.js); the glosses
 * below it speak in claims. LC-10 carries verbatim: `findings` may be `[]`
 * under a real `overall`, and validateFindings accepts exactly that answer.
 * `location` keeps review mode's required-non-empty rule (CUT 2) — in task
 * mode it is the grounding discipline: source, computation, or "assumption".
 */
const TASK_FINDINGS_JSON_SHAPE = [
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
  '- "overall" — your answer, compressed to one paragraph: the position your deliverable takes. Always required.',
  '- "findings" — the load-bearing claims your deliverable rests on, always present. If the',
  '  reasoning is fully inline and no discrete claim needs adjudication, emit [] and say so',
  '  in "overall". Never invent a claim to fill the array.',
  '- "id" — sequential integer within this response, starting at 1.',
  '- "severity" — one of: blocker | major | minor | nit. blocker = the answer fails if this',
  '  claim is wrong; major = materially weakens it; minor = adjusts a detail; nit = cosmetic.',
  '- "claim", "location", "rationale" — non-empty strings. "location" names what the claim',
  '  rests on: a source, a computation, or the literal word "assumption".',
  'Emit the JSON verbatim after the deliverable, without preamble, so it parses cleanly.',
].join('\n');

/** Full task structured-output contract (deliverable + trailing ```json claims block). */
const TASK_FINDINGS_CONTRACT = [TASK_TWO_PART_FRAMING, TASK_FINDINGS_JSON_SHAPE].join('\n\n');

/** Task seat role — execute the briefing, never review it (spec §5.1, the #134 fix). */
const TASK_SEAT_ROLE =
  'You are one analyst on an independent multi-model bench. Do the work the ' +
  'briefing below asks for: produce the analysis, answer, or artifact it requests — you ' +
  'are not reviewing the briefing, you are executing it. Another analyst is doing the ' +
  'same work independently.';

/**
 * Task critic brief (ruling V13): a designated skeptic is MORE valuable on
 * generative work. The four review passes become assumption / edge-case /
 * framing / actionability passes over the asks in the brief; the closing
 * be-specific + empty-pass-valid lines carry, reworded for claims.
 */
const TASK_CRITIC_BRIEF = [
  'You are this bench\'s designated critic. Assume the easy answer has holes; your job is',
  'to find them while doing the work, not to produce the same answer as everyone else.',
  'Work through four passes and fold everything into one claims list:',
  '',
  '1. Assumption hunt — what will the other analysts take as given that is contestable?',
  '   For every likely premise: what evidence supports it, or is it an assumption',
  '   presented as fact?',
  '2. Edge-case hunt — where does the asked-for work break? On the unexpected input, the',
  '   degenerate case, at zero, at one, at scale? Report only the cases that change the',
  '   answer.',
  '3. Framing check — is the briefing\'s own framing the right question? What is it not',
  '   asking that it should be?',
  '4. Actionability test — what would someone acting on the likely answers need that they',
  '   won\'t have? Name it specifically.',
  '',
  'Be specific: name the claim, the premise, the exact gap. State every load-bearing claim',
  'and no invented ones; do not pad to look thorough. An empty pass is a valid result.',
].join('\n');

/** Task seat briefing (Stage-1 fanout wave). */
function buildTaskSeatBriefing(args) {
  return composeWith(TASK_SEAT_ROLE, TASK_ANTI_SYCOPHANCY_CLAUSE, TASK_FINDINGS_CONTRACT, args);
}

/** Task critic briefing (concurrent solo — --critic, ruling V13). */
function buildTaskCriticBriefing(args) {
  return composeWith(TASK_CRITIC_BRIEF, TASK_ANTI_SYCOPHANCY_CLAUSE, TASK_FINDINGS_CONTRACT, args);
}

/** Task expert-lens briefing (concurrent solo per seat — --lenses). */
function buildTaskLensBriefing({ lens, briefing, date }) {
  return composeWith(
    `Do the work the briefing asks for strictly through the lens of a ${lens}. ` +
    'Produce only what that perspective is qualified to produce, at the depth a top ' +
    'practitioner of it would reach. Stay in-domain: if something matters but is outside ' +
    'your lens, leave it to the other analysts.',
    TASK_ANTI_SYCOPHANCY_CLAUSE, TASK_FINDINGS_CONTRACT, { briefing, date }
  );
}

/**
 * Task findings-repair re-prompt — mirrors briefings.js ::
 * buildFindingsRepairPrompt structure exactly, because LC-6 and LC-10 carry:
 * the response being repaired is embedded verbatim and uncapped (a repair solo
 * is a fresh session with no memory of the turn it repairs), the empty-prior
 * case is STATED and describes an answer the validator accepts, and only the
 * json-shape fragment rides along — never the two-part framing.
 * @param {{errors?: Array<{code: string, detail: string}>, review?: string}} args
 */
function buildTaskFindingsRepairPrompt({ errors, review }) {
  const lines = (errors || []).map(e => `- ${e.code}: ${e.detail}`).join('\n');
  const text = typeof review === 'string' ? review.trim() : '';
  const prior = text
    ? ['--- YOUR PREVIOUS RESPONSE (verbatim — this is the text to correct) ---',
      text,
      '--- END OF YOUR PREVIOUS RESPONSE ---'].join('\n')
    : 'Your previous response was empty — there is no prior text to correct. ' +
      'Do not invent claims to satisfy the schema: emit an empty "findings" array ' +
      'and say so in "overall".';
  return [
    'Do NOT use any tools or read any files; everything is in this message; begin ' +
    'immediately with the JSON block.',
    prior,
    'That response\'s trailing findings JSON failed validation with these errors:',
    lines,
    'Re-emit ONLY the corrected findings JSON block (the same claims, fixed — do not ' +
    'add or remove claims), as a single fenced ```json block:',
    TASK_FINDINGS_JSON_SHAPE,
  ].join('\n\n');
}

module.exports = {
  TASK_ANTI_SYCOPHANCY_CLAUSE, TASK_FINDINGS_JSON_SHAPE, TASK_FINDINGS_CONTRACT,
  buildTaskSeatBriefing, buildTaskCriticBriefing, buildTaskLensBriefing,
  buildTaskFindingsRepairPrompt,
};
