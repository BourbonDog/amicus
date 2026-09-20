/**
 * @module utils/output-length
 * #218 PR 3: name the "Mode 2" death.
 *
 * THE PROBLEM. A council leg whose provider stopped for length before any
 * answer text -- the whole max_tokens reservation went to reasoning (the #218
 * ledger rows: 32000 reasoning, 0-2 output, $0.63 billed for nothing) -- came
 * back `complete` with an empty summary and was announced as "the leg ended
 * 'complete' with no usable output"; with VISIBLE reasoning it came back
 * `complete` with its thinking promoted to the review and was adjudicated as one.
 *
 * WHAT THE ENGINE RECORDS (scripts/probe-max-tokens.js rows A/H1/L1-L4, engine
 * 1.18.15): `finish: 'length'` on the assistant message on both provider
 * families; a reasoning/output token split on OpenAI-compatible routes
 * (L3: output = completion - reasoning) but NOT on the direct Anthropic route
 * (L4: everything is `output`, reasoning 0); and, with visible reasoning, a
 * `reasoning` part and no `text` part (L2/L4), which
 * sidecar/conversation-mirror.js :: mirrorMessages promotes to `output` -- so
 * `output` cannot be the test; the mirror records the last message's own facts
 * and this module reads only those. No row carries an engine error for the stop.
 *
 * So the death is keyed on `finish` plus "no answer text arrived", never on a
 * token count; the counts are reported, not decided on. Pure: no I/O, no clock.
 * headless.js :: runHeadless calls both functions once, post-loop.
 */
'use strict';

const {
  outputTokenFlagValue, ENGINE_DEFAULT_OUTPUT_TOKENS, OUTPUT_TOKEN_FLAG, PLAIN_OUTPUT_TOKEN_FLAG,
} = require('./engine-output-flag');
// #257 R-X43: the house sanitizer, a leaf. The ambient flag below is OPERATOR text quoted into
// a reason that is itself quoted into a council note, so it is bounded before interpolation.
const { safeFragment } = require('./text-sanitize');

/**
 * #257 R-X44(c) — a usage record with no positive count is not a report.
 *
 * This death is a `finish 'length'` stop: the provider hit the max_tokens RESERVATION, so tokens
 * were spent. Had usage been reported, one of the five counts would be positive. An all-zero
 * record is the absence of an observation — the same rule `resolveLegCost` applies to cost
 * (v4.4 B2) — and it is exactly what this formatter is handed: its only caller,
 * `headless.js :: runHeadless`, passes `sumPerMessageUsage(...)`.tokens, which starts at
 * `emptyUsageTotals()` and accumulates with `|| 0`, so a leg whose engine reported nothing
 * arrives here as all zeros. Without this clause the not-reported arm below was unreachable from
 * the product and this sentence still printed `0 reasoning / 0 output tokens` — the exact
 * falsehood R-X44 names (council #270 r4 review of G2, I1). ⚠️ The SEAM still sums to zeros, so
 * the leg document and the spend ledger keep them; that is filed in BACKLOG.md, not fixed here.
 *
 * A SECOND SPELLING of `council/promoted.js :: reportedTokens`, deliberately: `utils/` must not
 * require `council/`, and `pricing.js :: hasObservedTokens` — read, as the ruling directs — is a
 * DIFFERENT predicate (input/output only, by design: v4.4.1 CA-7 keeps reasoning and cache out
 * because its estimate cannot price them). Using it here would render the #218 flagship shape,
 * `{ reasoning: 32000, output: 0 }`, as "not reported". The two spellings are pinned equal in
 * tests/council/degrade-contract.test.js.
 */
function reportedTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') { return false; }
  return [tokens.input, tokens.output, tokens.reasoning, tokens.cacheRead, tokens.cacheWrite]
    .some((v) => Number.isInteger(v) && v > 0);
}

/** The prefix a consumer can classify on, like `NO_OUTPUT_BACKSTOP:`. */
const OUTPUT_LENGTH_PREFIX = 'OUTPUT_LENGTH:';

/**
 * Is this leg the Mode 2 death? The provider stopped for length AND the LAST
 * assistant message carries no answer text: nothing at all (L1), or only
 * reasoning (L2/L4). Decided per message, never on the session's accumulated
 * output (council #232 r1 B2/D1). Named mutants (tests/utils/output-length.test.js):
 * "NOTLENGTH" drops the finish check, "TEXTIGNORED" drops the text check.
 * @param {{finish?: string|null, hasText?: boolean}} last the last assistant message's facts
 * @returns {boolean}
 */
function isOutputLengthDeath({ finish, hasText }) {
  return finish === 'length' && hasText !== true;
}

/**
 * The reason string. Every clause is an observation: `finish` and the two
 * counts are the engine's own record of the message — and the counts clause says
 * `token usage not reported` rather than minting a number the engine never gave
 * us, both when either count is not a non-negative integer (#257 R-X44, round 4 D2; the spelling is R-X50's) and
 * when NO count in the record is positive (R-X44(c): see `reportedTokens` above —
 * this is the arm the product actually reaches). A REPORTED zero, beside a
 * positive count, stays a zero. #257 R-X50: the per-count test is
 * `Number.isInteger(v) && v >= 0`, the SAME spelling `promoted.js` and
 * `run-retry-notes.js :: truncatedReviewNote` use — one rule, three renderers, one
 * per-count predicate, pinned equal across all three in tests/council/degrade-contract.test.js.
 * The budget clause is what
 * the engine serving the leg was spawned with: the budget (`null` = unset,
 * `undefined` = unknown — no handle value and config unreadable) or, when no
 * budget was set, the ambient flag. The remedy names the one
 * lever that exists today; PR 4 adds the effort lever. Named mutant
 * "BUDGETUNSET": always print the unset clause.
 * @param {{tokens?: {reasoning?: number, output?: number}|null,
 *   budget?: number|null, reasoningOnly?: boolean,
 *   ambientFlag?: string|null}} args `reasoningOnly` = the
 *   message carried reasoning parts and no text -- L2/L4; `ambientFlag` = the
 *   ambient `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` the engine was started with
 *   when no budget was set (`null` when none, or when a budget overrode it);
 *   named mutant "AMBIENTIGNORED".
 * @returns {string}
 */
function formatOutputLengthReason({ tokens, budget, reasoningOnly, ambientFlag }) {
  const t = tokens || {};
  // #257 R-X44's principle: an ABSENT count is not a zero count. The old `count()` floored a
  // missing token record to 0 and minted "0 reasoning / 0 output tokens" — a measurement the
  // engine never made, in the clause whose whole job is to report what the engine recorded.
  // A REPORTED zero stays a zero. Named mutant "OUTPUTLENGTHZEROS".
  // #257 R-X50: the per-count test is `Number.isInteger(v) && v >= 0`, the same spelling
  // `promoted.js :: promotedFacts` and `run-retry-notes.js :: truncatedReviewNote` use.
  // Named mutant "PREDICATEDIVERGED": restore `Number.isFinite` for either count.
  const counts = (reportedTokens(t)
    && Number.isInteger(t.reasoning) && t.reasoning >= 0
    && Number.isInteger(t.output) && t.output >= 0)
    ? `${t.reasoning} reasoning / ${t.output} output tokens`
    : 'token usage not reported';
  const streamed = reasoningOnly
    ? 'only reasoning was streamed, no answer text'
    : 'no answer text arrived';
  // PLAIN_OUTPUT_TOKEN_FLAG is the one form measured to be honoured (C1, K5,
  // K12); 64000abc and 0 fell back to 32000 (D1/D2); every other form is
  // unmeasured, and the clause below says so -- shared with the doctor row
  // (doctor-output-budget-check.js :: evaluateOutputBudget) so the gates agree.
  // #257 R-X43: the ARM is decided on the RAW bytes — the engine saw those, so ' 64000 ' really
  // does fall back to 32000 and must still read as unmeasured. The PROSE quotes a bounded copy
  // (safeFragment, ≤ 96 chars), which is what makes the 800-char prose cap in
  // run-retry-notes.js a theorem rather than a tripwire. Named mutant "FLAGUNBOUNDED".
  const ambientRaw = typeof ambientFlag === 'string' ? ambientFlag : null;
  const ambient = ambientRaw === null ? null : safeFragment(ambientRaw);
  const knob = budget === undefined
    ? 'outputBudget could not be read'
    : budget !== null
      ? `outputBudget is ${outputTokenFlagValue(budget)}`
      : ambient === null
        ? `outputBudget is unset — the engine's ${ENGINE_DEFAULT_OUTPUT_TOKENS} default reservation governs`
        : PLAIN_OUTPUT_TOKEN_FLAG.test(ambientRaw)
          ? `outputBudget is unset — the ambient ${OUTPUT_TOKEN_FLAG}=${ambient} the engine was started with governs (each leg reserves min(${ambient}, the ceiling the engine's catalog knows for it))`
          : `outputBudget is unset and the ambient ${OUTPUT_TOKEN_FLAG}=${ambient} the engine was started with is not a plain positive integer — the only form measured to be honoured (probe D1/D2: 64000abc and 0 fell back to ${ENGINE_DEFAULT_OUTPUT_TOKENS} silently); any other form is unmeasured`;
  return `${OUTPUT_LENGTH_PREFIX} the provider stopped at the max_tokens reservation (finish 'length') and ${streamed} — `
    + `${counts}; ${knob} — `
    + 'raise outputBudget in config.json (docs/configuration.md, Output budget)';
}

module.exports = { OUTPUT_LENGTH_PREFIX, isOutputLengthDeath, formatOutputLengthReason };
