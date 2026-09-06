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
 * `reasoning` part and no `text` part (L2/L4) -- exactly the shape
 * sidecar/conversation-mirror.js :: mirrorMessages promotes to `output`. No
 * row carries an engine error for the stop.
 *
 * So the death is keyed on `finish` plus "no answer text arrived", never on a
 * token count; the counts are reported, not decided on. Pure: no I/O, no clock.
 * headless.js :: runHeadless calls both functions once, post-loop.
 */
'use strict';

const { outputTokenFlagValue, ENGINE_DEFAULT_OUTPUT_TOKENS } = require('./engine-output-flag');

/** The prefix a consumer can classify on, like `NO_OUTPUT_BACKSTOP:`. */
const OUTPUT_LENGTH_PREFIX = 'OUTPUT_LENGTH:';

/**
 * Is this leg the Mode 2 death? The provider stopped for length AND no answer
 * text arrived: nothing at all (L1), or only reasoning, which the mirror
 * promoted to `output` (L2/L4). Named mutants (tests/utils/output-length.test.js):
 * "NOTLENGTH" drops the finish check, "PROMOTEIGNORED" drops the promotion clause.
 * @param {{finish?: string|null, output?: string, promotedReasoning?: boolean}} leg
 * @returns {boolean}
 */
function isOutputLengthDeath({ finish, output, promotedReasoning }) {
  return finish === 'length' && (!output || promotedReasoning === true);
}

/**
 * The reason string. Every clause is an observation: `finish` and the two
 * counts are the engine's own record of the message; the budget clause is what
 * config holds (`null` = unset, `undefined` = could not be read). The remedy
 * names the one lever that exists today; PR 4 adds the effort lever. Named
 * mutant "BUDGETUNSET": always print the unset clause.
 * @param {{tokens?: {reasoning?: number, output?: number}|null,
 *   budget?: number|null, promotedReasoning?: boolean}} args
 * @returns {string}
 */
function formatOutputLengthReason({ tokens, budget, promotedReasoning }) {
  const t = tokens || {};
  const count = (n) => (Number.isFinite(n) ? n : 0);
  const streamed = promotedReasoning
    ? 'only reasoning was streamed, no answer text'
    : 'no answer text arrived';
  const knob = budget === undefined
    ? 'outputBudget could not be read'
    : budget === null
      ? `outputBudget is unset — the engine's ${ENGINE_DEFAULT_OUTPUT_TOKENS} default reservation governs`
      : `outputBudget is ${outputTokenFlagValue(budget)}`;
  return `${OUTPUT_LENGTH_PREFIX} the provider stopped at the max_tokens reservation (finish 'length') and ${streamed} — `
    + `${count(t.reasoning)} reasoning / ${count(t.output)} output tokens; ${knob} — `
    + 'raise outputBudget in config.json (docs/configuration.md, Output budget)';
}

module.exports = { OUTPUT_LENGTH_PREFIX, isOutputLengthDeath, formatOutputLengthReason };
