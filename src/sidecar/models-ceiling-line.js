/**
 * @module models-ceiling-line
 * The one `Ceilings:` line `amicus models --refresh` prints (#218 P3).
 *
 * It is an honest report of where the direct-provider context/output ceilings
 * came from, or why they did not come at all — filled, already complete, still
 * missing a number, failed, or skipped.
 *
 * Extracted from `models.js` (council #230 r4) because that file sat at 298 of
 * the 300-line budget and this round adds two more branches to the formatter.
 * It owns the WORDING only: the outcome object it renders is built by
 * `src/utils/model-ceilings-modelsdev.js` and persisted by
 * `src/utils/model-catalog.js` as the cache document's `ceilingEnrichment`.
 */

'use strict';

/**
 * How a ceiling-enrichment failure is worded, keyed by its `failure.reason`
 * (council #230 D4/C1). `http-status`, `parse-error`, `too-large` and
 * `bad-shape` all mean models.dev ANSWERED; `exception` — and any reason a later
 * failure invents — is a local bug, so it falls through to a neutral lead.
 */
const CEILING_FAILURE_LEAD = {
  timeout: 'models.dev unreachable',
  'network-error': 'models.dev unreachable',
  'http-status': 'models.dev answered but could not be used',
  'parse-error': 'models.dev answered but could not be used',
  'too-large': 'models.dev answered but could not be used',
  'bad-shape': 'models.dev answered but could not be used',
};

/**
 * #218 P3: one honest line about where the direct-provider ceilings came from.
 * @param {object|null} e the persisted `ceilingEnrichment` outcome
 * @returns {string}
 */
function fmtCeilingLine(e) {
  // Unreachable in production after #218 P3 (every successful refresh persists a
  // ceilingEnrichment object); kept for a hand-built or pre-field cache doc.
  if (!e) { return 'Ceilings: not attempted'; }
  if (e.failure) {
    const f = e.failure;
    const why = f.reason + (f.status ? ` ${f.status}` : '') + (f.detail ? `: ${f.detail}` : '');
    const lead = CEILING_FAILURE_LEAD[f.reason] || 'ceiling enrichment failed';
    return `Ceilings: ${lead} (${why}); rows without a ceiling get an outputBudget through the engine flag alone, clamped only where the engine's own catalog knows the model`;
  }
  // A skip is not a failure and not a fill: naming which one it was is the
  // difference between "you turned this off" and "there was nothing to do".
  if (e.skipped === 'disabled') {
    // Named, not "direct routes": Google publishes its own ceiling first-party
    // and OpenRouter rows keep OpenRouter's. Since PR 2 the budget still
    // reaches the unnamed rows through the engine flag, clamped by the
    // engine's own catalog (probe K5/K12).
    return 'Ceilings: models.dev lookup disabled (modelsDevCeilings: false); openai/anthropic/deepseek direct rows carry no ceiling here and are clamped by the engine\'s own catalog instead (Google publishes its own ceiling and OpenRouter rows keep OpenRouter\'s)';
  }
  if (e.skipped === 'nothing-to-fill') {
    // NOT "every row": routers, local rows and malformed rows are not
    // candidates and are never asked about (council #230 C2).
    return 'Ceilings: nothing to fill (no candidate row is missing a number)';
  }
  // `?? 0`: a hand-built or pre-field cache doc can carry a partial object, and
  // `undefined already complete` would be a worse lie than a zero. `stillMissing`
  // deliberately overlaps the other counters — it is the STATE the pass left,
  // and it is the number that says whether outputBudget can clamp those rows.
  return `Ceilings: ${e.filled ?? 0} rows filled from models.dev (${e.alreadyKnown ?? 0} already complete, ` +
    `${e.unknown ?? 0} unknown to models.dev, ${e.stillMissing ?? 0} still missing a number)`;
}

module.exports = { fmtCeilingLine };
