// src/council/briefings-chair.js
'use strict';
// Chair briefing surface: packet, repair prompt, verdict scale, task
// templates, no-tools preamble. Moved verbatim from briefings-stage2.js
// (chunks :16-20 and :154-279 at e8406db; v4.8 PR0 size-gate split, zero
// behavior). dateLine lives HERE (not required back from stage2) because
// stage2 requires this module — a back-require would be a cycle that
// resolves dateLine to undefined at load. briefings-stage2.js re-exports
// every public name below so existing import paths stay stable.
//
// ./seats is the ONLY require here, and it is cycle-free by construction: that
// module deliberately requires nothing (seats.js header), so the load-order
// hazard above does not apply to it. Do NOT require ./briefings-stage2.
const { displayName } = require('./seats');

// v4.9 W7: the preamble's LAST WORD is the only fork ('verdict.' | 'answer.'), so
// the shared sentence keeps ONE spelling. This constant's value is unchanged.
const CHAIR_NO_TOOLS_LEAD =
  'Do NOT use any tools or read any files; everything is in this message; ' +
  'begin immediately with the ';
const CHAIR_NO_TOOLS_PREAMBLE = CHAIR_NO_TOOLS_LEAD + 'verdict.';

const CHAIR_VERDICT_VALUES = ['Ship it', 'Fix these first', 'Fundamental rethink'];

/** Shared date line (spec §4.3) — prepended to every model-facing briefing. */
function dateLine(date) { return `Today's date is ${date}.`; }

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
 * Site (3)'s per-slot zip (v4.8 SI-25, ruling R25-3). `order` and `orderSeats`
 * are PARALLEL per-slot arrays minted together by
 * `anonymize.js :: rankingToOrder`, and a slot is either a scalar or an array
 * (a tie group) — hence the two arms.
 *
 * EVERY read is a fallback, because `orderSeats` is a PARITY SHAPE, not a
 * presence: its `seatOne` returns `(seatMap && seatMap[label]) || null`, and
 * `run-assemble.js :: buildTallyInput` ships the array whenever ANY entry is
 * truthy — so a MIXED array of seat ids and `null`s is a normal shipping shape.
 * No `null` may reach the rendered JSON: this is the one artifact a paid chair
 * reads as authoritative. An absent `orderSeats` returns `order` untouched
 * (spec §4.2's byte-identity promise). ⚠️ That promise is UNCONDITIONAL as of
 * the SHAPESWAP fix — it holds even when the two arrays DISAGREE on a slot's
 * structure (scalar vs array), which no producer here can emit but which two
 * independent reviewers reached for. A disagreeing slot falls back to `order`'s
 * own value and NEVER changes that slot's shape.
 *
 * ⚠️ The SHORT-array arm is DEFENSIVE, and this docblock does not claim
 * otherwise: `rankingToOrder` mints both arrays from one `slots.map`, so no
 * producer in this tree can emit an `orderSeats` shorter than its `order`
 * (measured — 0 mismatches over 24 ranking × seatMap shapes). The arm and its
 * pin guard hand-assembled input, which is why they stay.
 *
 * ⚠️ `||`, deliberately, NOT `??`. `anonymize.js :: rankingToOrder`'s `seatOne`
 * returns `(seatMap && seatMap[label]) || null`, so every entry this array can
 * hold is already truthy-or-null and the two operators are behaviourally
 * identical on it. Where they differ — a falsy-but-present id — `||` falls back
 * to the alias and `??` would render the empty string into the packet, so `||`
 * is never worse and sometimes safer. It is also this spine's convention
 * (`seat || alias` at every other site). PR #189's council raised the swap as
 * A1 (solid); declined on that measurement, and recorded here so the next
 * reader does not re-propose it as a tidy-up.
 *
 * Two named mutants guard the two arms — NULLLEAK the scalar fallback, FLATTIE
 * the tie arm — with their measured red sets in
 * tests/council/chair-packet-seat-mutants.js :: NULLLEAK. Re-run them, never
 * renumber, if this expression or its pins change.
 */
function seatKeyedOrder(order, orderSeats) {
  if (!Array.isArray(order) || !Array.isArray(orderSeats)) { return order; }
  return order.map((slot, i) => {
    const seats = orderSeats[i];
    return Array.isArray(slot)
      ? slot.map((alias, k) => (Array.isArray(seats) ? seats[k] : null) || alias)
      // ⚠️ `Array.isArray(seats)` here, NOT just `seats || slot`: a scalar `order`
      // slot against an ARRAY `orderSeats` slot returned the seats array RAW, which
      // both changed the slot's shape and could render `[null,null]` — breaking the
      // no-null promise above for the one input class this arm exists to defend.
      // Named mutant SHAPESWAP (drop this guard) in
      // tests/council/chair-packet-seat-mutants.js :: SHAPESWAP.
      : (Array.isArray(seats) ? slot : (seats || slot));
  });
}

/**
 * De-anonymized chair packet (spec §5/§6: the chair sees identities).
 *
 * ⚠️ `seat` is an OBJECT on `reviews[]` and a STRING on `rankings[]` and
 * `adjudications[]`. Deliberate, and declared as such in the @param below.
 * Reviews carry the object because `seats.js :: displayName` is the naming seam
 * (v4.8 SI-25 / R25-4); the other two carry `j.seat.id` because
 * `run-assemble.js :: buildTallyInput` has emitted a string there since PR4c and
 * changing it would move a shipped tally schema. These are three arrays each
 * with one consistently-typed field, not one polymorphic field. PR #189's
 * council raised it as D1 (major, CONTESTED a1/d1/n1); declined on that reading.
 * @param {{reviews: Array<{model: string, text: string, seat?: ?object}>,
 *   rankings: Array<{judge: string, seat?: ?string, order: Array<string|string[]>,
 *     orderSeats?: ?Array<?string|Array<?string>>}>,
 *   adjudications: Array<{findingId: string, judge: string, seat?: ?string, verdict: string}>,
 *   tierCounts: object}} args
 *   `rankings` and `adjudications` may both be empty — an all-clean bench (LC-10)
 *   has nothing to adjudicate, and a Stage 2 whose judges all died has nothing to
 *   rank. Each empty section says WHICH of those it is rather than rendering blank.
 *   `intent` (v4.9 W7): `'task'` composes the twins from ./briefings-chair-task;
 *   absent — or anything else, fail-closed — composes this packet byte-identically.
 *   The four seams it moves, and the V11 vocabulary it leaves shared, are listed
 *   in briefings-chair-task.js's docblock.
 */
function buildChairPacket({ reviews, rankings, adjudications, tierCounts, date, findings, intent }) {
  // ⚠️ v4.8 SI-25: all three rendering sites below are SEAT-KEYED with an ALIAS
  // FALLBACK. Alias-keyed, a twin bench handed the chair "tier counts:
  // {Confirmed: 1}" beside two identical `A1 — deepseek:` lines, with nothing in
  // the packet able to reconcile them; PR4c seat-keyed the report and the
  // Workspace matrix but not this packet, so the human-facing artifact and the
  // model-facing one disagreed.
  // ⚠️ THIS PACKET IS PROSE, NEVER A LAUNCH ARGUMENT — that boundary is what
  // makes seat ids safe here. A seat id in a model-carrying LAUNCH argument is a
  // non-routable model name and a real paid failure, which is why `order`,
  // `orderSeats`, `tallyInput`, verdict.json, the report and every launcher
  // option stay alias-valued and untouched (run-debate.test.js's parity pin
  // guards that boundary). Nothing routes on this artifact.
  // The fallbacks are load-bearing, not defensive — named mutants ALIASBACK and
  // SEATONLY, with their measured red sets, in
  // tests/council/chair-packet-seat-mutants.js :: ALIASBACK. On a unique-alias
  // bench the seat channel is ABSENT at every site (spec §4.2's
  // emit-when-DIFFERENT rule), so the rendering is byte-identical there by
  // construction — and the review projection that feeds site (1) applies that
  // same rule for a reason its own comment gives.
  const reviewBlocks = reviews
    .map(r => `--- Review by ${displayName(r.seat) || r.model} ---\n${r.text}`).join('\n\n');
  const rankingLines = (rankings || [])
    .map(r => `${r.seat || r.judge}: ${JSON.stringify(seatKeyedOrder(r.order, r.orderSeats))}`)
    .join('\n');
  const adjLines = (adjudications || [])
    .map(a => `${a.findingId} — ${a.seat || a.judge}: ${a.verdict}`)
    .join('\n');
  // ⚠️ v4.8 PR5a T7 (R5-3): surface R8. tally.js has stamped sameModelCorroboration since
  // PR4c and it reached verdict.json — and stopped. Spec §4.6 says the chair packet is
  // REQUIRED to surface it; measured, nothing did. A Confirmed reached only via the
  // raiser's own twin read to the chair exactly like independent corroboration, which is
  // the overstatement R8 was chosen over model-exact exclusion to prevent.
  // Emit-when-present, so a bench that raised none is byte-identical.
  const corroborated = (findings || [])
    // ⚠️ `&& f.id` (council-3 C3, as corrected by measurement): the reported symptom —
    // 'undefined' in the prose — does NOT occur, because Array#join renders undefined as ''.
    // What DID render is worse in kind: "…corroborated only by a same-model seat: ." — the R8
    // caveat firing while naming nobody, in the one artifact a paid chair reads as
    // authoritative. Unnameable findings are dropped, and the emit-when-present guard below
    // then suppresses the section entirely rather than showing an empty list.
    .filter(f => f && f.sameModelCorroboration && f.id)
    .map(f => f.id);
  // Every finding lands in exactly one tier (tally.js countTiers), so the tier
  // counts sum to the record's finding count — which is how an all-clean bench is
  // told apart from a bench whose judges simply never voted.
  const raisedCount = Object.values(tierCounts || {})
    .reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0);
  const tiers = JSON.stringify(tierCounts);
  // Lazy, AT CALL TIME (the W6 dispatcher shape) — a top-level require would bind
  // the two chair modules into a cycle the moment the twins need a fragment back.
  const task = intent === 'task' ? require('./briefings-chair-task') : null;
  const parts = [CHAIR_NO_TOOLS_LEAD + (task ? 'answer.' : 'verdict.')];
  if (date) { parts.push(dateLine(date)); }
  parts.push(task
    ? (raisedCount === 0 ? task.TASK_CHAIR_SYNTHESIS_NO_CLAIMS : task.TASK_CHAIR_SYNTHESIS)
    : (raisedCount === 0 ? CHAIR_TASK_NO_FINDINGS : CHAIR_TASK));
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
  );
  // Placed AFTER the adjudications it qualifies and BEFORE the verdict scale, so the chair
  // reads the caveat while the votes are still in view rather than after being told how to
  // score them.
  if (corroborated.length) {
    parts.push(
      '--- SAME-MODEL CORROBORATION (R8) ---',
      `These findings were agreed only by a seat running the SAME model as the raiser: ${corroborated.join(', ')}.`
      + ' Their tier reflects concurrence between two generations of one model, not independent support.'
      + ' Weigh them accordingly.',
    );
  }
  // R8's placement rule, applied again: after the votes it qualifies, before the
  // scale — read while the adjudications are still in view.
  if (task) { parts.push(task.TASK_CONCURRENCE_CAVEAT); }
  parts.push(task ? task.ANSWER_SCALE_ADDENDUM : VERDICT_SCALE_ADDENDUM);
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

/**
 * Chair repair-prompt dispatcher (v4.9 W7, the W6 shape): `'task'` asks for the
 * ANSWER line, anything else for the VERDICT line, byte-identically. Lazy require.
 */
function chairRepairPromptFor(intent, args) {
  return intent === 'task'
    ? require('./briefings-chair-task').buildTaskChairRepairPrompt(args)
    : buildChairRepairPrompt(args);
}

module.exports = {
  dateLine,
  CHAIR_NO_TOOLS_PREAMBLE, chairRepairPromptFor,
  CHAIR_VERDICT_VALUES,
  VERDICT_SCALE_ADDENDUM,
  CHAIR_TASK,
  CHAIR_TASK_NO_FINDINGS,
  buildChairPacket,
  buildChairRepairPrompt,
};
