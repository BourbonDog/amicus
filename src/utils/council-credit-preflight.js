/**
 * @module utils/council-credit-preflight
 *
 * #256: the ruling the CI council's credit preflight makes, as a pure function.
 *
 * MEASURED (run 35143585179, 2026-09-16): the OpenRouter key's remaining
 * monthly limit sat below the run's own `--max-cost` ceiling, so four of seven
 * legs were refused by the provider in 2–3 s ("This request would exceed your
 * available credits…"), the once-only Stage-1 retries were spent on those
 * refusals, and the round ended COUNCIL_QUORUM with ONE seat reviewed. The
 * probe that could have said so — `utils/openrouter-credit.js ::
 * checkOpenRouterCredit`, already wired into `amicus doctor` — was never called
 * by `.github/workflows/council-review.yml`.
 *
 * WHY A SHIPPED MODULE AND NOT A `scripts/` FILE: the workflow never checks the
 * repo out. It resolves everything through `npm root -g` against the published
 * tarball, and `package.json :: files` ships `src/` but only two named files out
 * of `scripts/` — so a decision module under `scripts/` would not exist on the
 * runner at all.
 *
 * WHY A MODULE AND NOT INLINE SHELL: the step is a YAML block scalar wrapping a
 * heredoc; nothing in it can be unit-tested. The ruling is the part that can be
 * wrong, so the ruling lives here and the step only prints its answer.
 */

'use strict';

/**
 * Format a USD figure for a human reading an Actions annotation.
 * Two decimals, except for a non-zero amount that would round to $0.00 — the
 * incident's own run spent $0.003, so "you have $0.00" would have been a lie
 * about a real balance.
 * @param {number} n
 * @returns {string}
 */
function usd(n) {
  return (n !== 0 && Math.abs(n) < 0.005) ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

/**
 * Coerce the run ceiling. The workflow hands this over as `$MAX_COST`, a string
 * ('2.00'), so a number and a numeric string are both legitimate. Everything
 * else is UNUSABLE, not zero: `Number('')` is 0 and `Number('x')` is NaN, and
 * both make `limitRemaining < maxCost` false — i.e. a silent pass, which is the
 * exact failure mode this preflight exists to remove.
 * @param {number|string} maxCost
 * @returns {number|null} the ceiling, or null when no comparison can be made
 */
function toCeiling(maxCost) {
  const raw = (maxCost === null || maxCost === undefined) ? '' : maxCost;
  const n = (typeof maxCost === 'number') ? maxCost : Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) { return null; }
  return n;
}

/**
 * Decide what the CI preflight should do with a credit probe result.
 *
 * Three outcomes, and only one of them stops the job:
 *  - `warn`   — the probe gave no usable answer (network blip, non-200, no key,
 *               or a run ceiling that is not a number). The step continues: a
 *               blind preflight must never cost the repo a review.
 *  - `refuse` — the key demonstrably cannot cover this run (free tier, or a
 *               known remaining limit below the ceiling). The step exits 1
 *               BEFORE the paid step, so no seat is dispatched and nothing is
 *               spent.
 *  - `ok`     — the key can cover it, or it carries no monthly limit at all.
 *
 * `limitRemaining === null` means OpenRouter reports NO monthly limit on the
 * key, which is the healthiest answer there is — never a refusal.
 *
 * The key itself is never an input here and never appears in a message: only
 * figures do.
 *
 * @param {{checked: boolean, isFreeTier: boolean, limitRemaining: number|null}} result
 *   a `checkOpenRouterCredit` result; anything else is treated as unchecked
 * @param {number|string} maxCost the run's `--max-cost` ceiling in USD
 * @returns {{outcome: 'ok'|'warn'|'refuse', message: string}}
 */
function decideCreditPreflight(result, maxCost) {
  const r = (result && typeof result === 'object') ? result : {};
  if (r.checked !== true) {
    return { outcome: 'warn',
      message: 'OpenRouter credit could not be checked — the probe returned no answer '
        + '(missing key, non-200, unreadable body, network error or timeout); continuing' };
  }

  const ceiling = toCeiling(maxCost);

  // Free tier first: it is true regardless of the ceiling, so an unusable
  // ceiling must not be able to mask it. Every paid seat 402s on such a key.
  if (r.isFreeTier === true) {
    const against = ceiling === null ? 'this run' : `a ${usd(ceiling)} run ceiling`;
    return { outcome: 'refuse',
      message: 'OpenRouter key cannot cover this run: the key is free tier, so every paid seat '
        + `would be refused (${against}); add credit or raise the key's monthly limit `
        + '— no seat was dispatched' };
  }

  const remaining = (typeof r.limitRemaining === 'number' && Number.isFinite(r.limitRemaining))
    ? r.limitRemaining : null;

  if (remaining === null) {
    // No monthly limit on the key (or none reported): nothing to compare, and
    // nothing to refuse. The ceiling is still printed so the notice says what
    // the run intends to spend.
    return { outcome: 'ok',
      message: `OpenRouter credit ok (no key limit; run ceiling ${ceiling === null ? 'unreadable' : usd(ceiling)})` };
  }

  if (ceiling === null) {
    return { outcome: 'warn',
      message: `OpenRouter credit could not be checked — the run ceiling ${JSON.stringify(maxCost)} `
        + `is not a usable dollar amount, so ${usd(remaining)} remaining could not be compared `
        + 'against it; continuing' };
  }

  if (remaining < ceiling) {
    return { outcome: 'refuse',
      message: `OpenRouter key cannot cover this run: ${usd(remaining)} remaining against a `
        + `${usd(ceiling)} run ceiling; add credit or raise the key's monthly limit `
        + '— no seat was dispatched' };
  }

  return { outcome: 'ok',
    message: `OpenRouter credit ok (${usd(remaining)} remaining; run ceiling ${usd(ceiling)})` };
}

module.exports = { decideCreditPreflight };
