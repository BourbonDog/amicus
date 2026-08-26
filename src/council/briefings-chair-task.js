// src/council/briefings-chair-task.js
'use strict';

/**
 * @module council/briefings-chair-task
 * Chair TASK-intent templates (v4.9 W7; v4.8 design spec §5.5, closing #146):
 * the synthesis pair, the ANSWER scale addendum, the concurrence caveat and the
 * one-shot ANSWER-line repair prompt. `briefings-chair.js` lazy-requires this
 * module at call time from `buildChairPacket` and `chairRepairPromptFor` — the
 * W6 dispatcher shape — so the review path composes byte-identically by
 * construction and the two modules can never form a load cycle.
 *
 * WHAT FORKS, AND WHAT DOES NOT. The packet takes exactly four seams on
 * `intent`: the synthesis instruction (the pair below replaces CHAIR_TASK /
 * CHAIR_TASK_NO_FINDINGS), the scale addendum, the no-tools preamble's last
 * word ('verdict.' → 'answer.'), and this module's concurrence caveat. Ruling
 * V11 keeps everything else ONE vocabulary — and this task records the
 * extension the ruling did not spell out: the packet's SECTION HEADERS
 * (`--- STAGE-1 REVIEWS (de-anonymized) ---`, `--- PEER RANKINGS …`,
 * `--- PER-FINDING ADJUDICATIONS ---`, the R8 block), the `Review by <model>`
 * labels and the empty-section `(none — …)` wordings are shared verbatim. A
 * task packet is the review packet with a different instruction, a different
 * scale and one extra caveat; nothing re-parses those headers, and one habit
 * should read both intents.
 *
 * ⚠️ TWO SCALES, EACH SPELLED TWICE (memo trap 2). `CHAIR_ANSWER_VALUES` here
 * and `parse-stage2.js :: CHAIR_ANSWERS` are independent constants, exactly as
 * the review pair has always been. Skew either and the chair is asked for a
 * phrase the parser cannot read — a degraded run AFTER the whole bench is paid
 * for. Both pairs are drift-pinned in tests/council/chair-scale-drift.test.js,
 * which also carries the named mutant ANSWERSCALEDRIFT and its measured red
 * set. The published schema's enum is a THIRD independent spelling and is
 * pinned in the same suite.
 */

/** The task chair's terminal scale (spec §5.5; ruling V4). */
const CHAIR_ANSWER_VALUES = ['Converged', 'Split', 'Insufficient'];

/**
 * The chair's opening instruction when the bench raised claims (the ordinary
 * case). Task mode asks for an ANSWER, not an assessment: the chair adopts,
 * merges or refuses, and the disputed claims its answer still rests on are
 * named in a RESIDUAL RISK section rather than left implicit.
 *
 * ⚠️ v4.9 fix round 2 (council C3) — the close carries an ESCAPE HATCH, and it
 * is the same lesson as the no-claims twin below, one bench-shape over. That
 * twin drops the section entirely because a bench that declared NO adjudicable
 * claims cannot have disputed any. But this instruction runs on the commoner
 * middle case: claims WERE raised and adjudicated, and every one of them was
 * concurred. "The claims peers disputed" then names the empty set, and the only
 * satisfiable reading of an unfollowable directive is to invent material —
 * LC-10 exactly. Naming the honest line is a satisfiable instruction for that
 * bench; deleting the section here is not an option, because unlike the twin
 * this template cannot know at composition time whether any dispute survived.
 */
const TASK_CHAIR_SYNTHESIS =
  'You are the council chair. Write the synthesized ANSWER across the responses, ' +
  'rankings, and adjudications below: adopt the strongest response, merge ' +
  'complementary ones, or refuse the premise if the bench showed it unsound. State ' +
  'the consensus, the disagreements and which way they went, and close the synthesis ' +
  'with a RESIDUAL RISK section — the claims peers disputed that your answer still ' +
  'depends on, or the single line "RESIDUAL RISK: none — no load-bearing claim was ' +
  'disputed." when that is the truth.';

/**
 * The chair's opening instruction when the bench declared no adjudicable claims
 * — the LC-10-shaped twin, and it carries that lesson twice.
 *
 * LC-10's rule is that an instruction whose only satisfiable reading is to
 * invent material must be REPLACED, never amended: the review twin swaps
 * CHAIR_TASK out entirely rather than appending a correction after it. Task
 * mode inherits that, and drops one thing more — the RESIDUAL RISK close. That
 * section is defined as "the claims peers disputed", which is precisely the set
 * a clean bench just declared empty; asking for it here would be the same
 * unfollowable directive in a new place.
 */
const TASK_CHAIR_SYNTHESIS_NO_CLAIMS =
  'You are the council chair. Write the synthesized ANSWER across the responses and ' +
  'rankings below: adopt the strongest response, merge complementary ones, or refuse ' +
  'the premise if the bench showed it unsound. Weigh each analyst\'s standing by rank ' +
  'position. NOTE: this bench declared NO adjudicable claims. Every analyst did the ' +
  'work and reported no discrete claim needing adjudication, which is a valid outcome ' +
  '— not a failed run. Synthesize on that basis: say what the responses actually ' +
  'establish and where the bench\'s agreement is thin, and do not manufacture disputes ' +
  'to fill the sections below.';

/**
 * Pushed after the adjudications the chair is about to weigh (R8-style
 * placement — the caveat is read while the votes are still in view). Peer
 * agreement on a generative bench is correlation between models trained on
 * overlapping priors, not independent verification, and a task chair that
 * reads "3 agree" as evidence overstates exactly what the tier table cannot.
 */
const TASK_CONCURRENCE_CAVEAT =
  'Peer agreement on a claim is CONCURRENCE, not verification — models correlate on ' +
  'priors. Weigh adjudications accordingly.';

/**
 * The ANSWER-scale addendum. Its first seven lines are
 * `briefings-chair.js :: VERDICT_SCALE_ADDENDUM`'s, verbatim (V11: the
 * two-closing-sections framing, the whole HARD QUESTIONS item and the
 * "final line, alone" rule are scale-independent) — pinned as a prefix in
 * tests/council/briefings-chair-task.test.js so the shared half cannot fork
 * silently. Only the phrase list and its gloss are task-specific.
 */
const ANSWER_SCALE_ADDENDUM = [
  'After your synthesis, add two closing sections:',
  '',
  '1. HARD QUESTIONS — three to five questions the material\'s author has probably not',
  '   asked themselves, chosen so that an unanswerable question reveals a structural gap',
  '   (not gotchas — questions whose answers should exist).',
  '2. A final line, alone on the last line, containing ONLY the phrase — no rationale, no',
  '   dash, no trailing text of any kind — exactly one of:',
  '',
  '   ANSWER: Converged',
  '   ANSWER: Split',
  '   ANSWER: Insufficient',
  '',
  '   Pick one. "Converged" = the bench substantially agrees and the synthesis above is',
  '   well-supported. "Split" = material disagreement remains; the synthesis states both',
  '   positions and what would settle them. "Insufficient" = the bench\'s work cannot',
  '   support an answer — missing information, an unsound premise, or too little usable',
  '   output. Name which, in the synthesis ABOVE, not on the ANSWER line.',
].join('\n');

/**
 * One-shot chair repair, task twin: the ANSWER line was missing.
 *
 * Mirrors `briefings-chair.js :: buildChairRepairPrompt` block for block,
 * because LC-12 carries unchanged — the chair leg SUCCEEDED and only the
 * terminal line is missing, so the synthesis rides along and the repair solo
 * picks the phrase its own prose supports instead of re-deriving one from
 * nothing.
 * @param {{synthesis?: string}} [args]
 */
function buildTaskChairRepairPrompt({ synthesis } = {}) {
  const text = typeof synthesis === 'string' ? synthesis.trim() : '';
  const prior = text
    ? ['--- YOUR SYNTHESIS (verbatim — answer on THIS) ---', text,
      '--- END OF YOUR SYNTHESIS ---'].join('\n')
    : null;
  return [
    'Do NOT use any tools or read any files; everything is in this message; begin '
    + 'immediately with the ANSWER line.',
    ...(prior ? [prior] : []),
    'Your synthesis was received, but the final parseable line was missing. Emit ONLY '
    + 'one line, exactly one of:',
    'ANSWER: Converged',
    'ANSWER: Split',
    'ANSWER: Insufficient',
  ].join('\n\n');
}

module.exports = {
  CHAIR_ANSWER_VALUES,
  ANSWER_SCALE_ADDENDUM,
  TASK_CHAIR_SYNTHESIS,
  TASK_CHAIR_SYNTHESIS_NO_CLAIMS,
  TASK_CONCURRENCE_CAVEAT,
  buildTaskChairRepairPrompt,
};
