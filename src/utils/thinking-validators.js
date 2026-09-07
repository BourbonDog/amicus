/**
 * Thinking Level Validators
 *
 * #218 PR 4: the CLI's `--thinking` check is a VOCABULARY check only — the seven
 * levels the curated routes declare between them (engine-variants.js ::
 * VARIANT_LEVELS, measured on the engine's /config/providers dump, probe M0).
 * Whether a given MODEL declares the level is the engine's call, read from that
 * same dump at send time (opencode-client.js :: sendPrompt), where a level the
 * model does not declare is refused before anything is sent. The per-model table
 * this file carried until PR 4 (gpt-5 "without minimal", gemini "with everything")
 * was a static guess the dump CONFIRMS on one row and contradicts on the other
 * (M0: both exclude `minimal` for gpt-5 — gpt-5.6-terra declares none, low, medium,
 * high, xhigh, max — while the table gave gemini `none` and `xhigh` and
 * gemini-3.6-flash declares neither, only minimal, low, medium, high), and its "use
 * medium instead" adjustment sent a level the user never asked for. Both are gone;
 * nothing is adjusted here — guessing right on one row does not make a guess a
 * declaration (council #235 r1 wave 2: this docblock had cited the CONFIRMING row
 * as the contradiction, the same inversion the CHANGELOG carried).
 */

const { VARIANT_LEVELS } = require('./engine-variants');

/**
 * @param {string} [thinking] the requested level; omitted (undefined/null) is valid (nothing is sent then)
 * @returns {{valid: boolean, error?: string}}
 */
function validateThinkingLevel(thinking) {
  // council #235 r2 (A2): presence, not truthiness. `--thinking=` parses to '' (cli.js's
  // inline-value branch) and a truthiness test accepted it as "flag omitted", so the level
  // was silently dropped. An omitted flag is undefined/null; anything else the user typed
  // must face the vocabulary check. Named mutant "FALSYLEVELACCEPTED": restore `if (!thinking)`.
  if (thinking === undefined || thinking === null) { return { valid: true }; }
  if (!VARIANT_LEVELS.includes(thinking)) {
    return { valid: false, error: `Error: --thinking must be one of: ${VARIANT_LEVELS.join(', ')}` };
  }
  return { valid: true };
}

module.exports = { VARIANT_LEVELS, validateThinkingLevel };
