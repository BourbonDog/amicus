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
 * The boundary clause every `ok` message carries. `GET /api/v1/key` reports the
 * key's monthly limit and nothing else — not the account balance, and not the
 * in-flight `max_tokens` reservations that refused three of the four legs in run
 * 35143585179. A green preflight is therefore not a promise that the run will
 * not be refused, and the notice must not be readable as one.
 */
const UNCHECKED_BOUNDARY = '; in-flight reservations and account balance are not checked';

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
 * FOUR outcomes, and only one of them stops the job:
 *  - `warn`   — nothing usable to decide on: the probe gave no answer (network
 *               blip, non-200, no key), the reported limit is unreadable, or the
 *               run ceiling is not a number. The step continues; a blind
 *               preflight must never cost the repo a review.
 *  - `refuse` — the key can fund NOTHING: it is free tier, or its monthly limit
 *               is exhausted (`<= 0`). The step exits 1 BEFORE the paid step, so
 *               no seat is dispatched and nothing is spent.
 *  - `clamp`  — the key has money, just less than the whole-run ceiling. The run
 *               goes ahead on `effectiveMaxCost` instead.
 *  - `ok`     — the monthly limit covers the whole ceiling, or there is no limit.
 *
 * ⚠️ WHY `clamp` AND NOT AN ABORT (council #264 r1, finding B1 — this is the
 * shape that replaced the first version). Refusing whenever
 * `limitRemaining < maxCost` treats `--max-cost` as the expected spend. It is
 * not: it is a WHOLE-RUN CEILING, and the motivating run (35143585179) spent
 * $0.003 under a $2.00 ceiling. THREE of its seats reviewed successfully with
 * the remaining limit already below that ceiling, so the abort rule would have
 * turned a partially successful round into zero reviews — and it would kill any
 * run whose ceiling merely happens to exceed a healthy balance, e.g. just after
 * a monthly reset. Clamping hands the run a ceiling the key can actually fund
 * and lets `run-budget.js :: createBudget` do the bounding it already does: a
 * leg past the ceiling is refused with a degrade note and the run exits 2 —
 * loud, and with whatever reviews did land.
 *
 * `limitRemaining === null` (or absent) means OpenRouter reports NO monthly
 * limit, which is the healthiest answer there is — never a refusal. Any OTHER
 * unparseable value is UNKNOWN and warns (council #264 r1, finding A2): a NaN or
 * a string used to fall into the same bucket as `null` and produce a confident
 * "this key has no monthly limit" from a value that says nothing at all.
 *
 * ⚠️ WHAT `ok` DOES NOT MEAN, and the message says so out loud. `GET
 * /api/v1/key` returns `limit`, `usage`, `limit_remaining` and `is_free_tier` —
 * it does NOT return the account balance, and it cannot see the in-flight
 * `max_tokens` reservations that were the multiplier behind three of the four
 * refusals in run 35143585179 (#218: a concurrent leg's reservation is counted
 * against the key while it is in flight). So `ok` is "the monthly limit is not
 * the thing that will refuse you", not "this run will not be refused". An
 * operator debugging a refusal after a green preflight must not read a
 * guarantee this probe cannot give.
 *
 * The key itself is never an input here and never appears in a message: only
 * figures do.
 *
 * @param {{checked: boolean, isFreeTier: boolean, limitRemaining: number|null}} result
 *   a `checkOpenRouterCredit` result; anything else is treated as unchecked
 * @param {number|string} maxCost the run's `--max-cost` ceiling in USD
 * @returns {{outcome: 'ok'|'warn'|'refuse'|'clamp', message: string,
 *   effectiveMaxCost: number|null}} `effectiveMaxCost` is a number ONLY on
 *   `clamp`; null everywhere else means "keep the ceiling you already have".
 */
function decideCreditPreflight(result, maxCost) {
  const r = (result && typeof result === 'object') ? result : {};
  if (r.checked !== true) {
    return { outcome: 'warn', effectiveMaxCost: null,
      message: 'OpenRouter credit could not be checked — the probe returned no answer '
        + '(missing key, non-200, unreadable body, network error or timeout); continuing' };
  }

  const ceiling = toCeiling(maxCost);

  // Free tier first: a hard fact about the key, true regardless of the ceiling
  // or of anything the limit says, so neither an unusable ceiling nor an
  // unreadable limit may mask it. Every paid seat 402s on such a key.
  // ⚠️ The remedy is ADD CREDIT and nothing else: raising a monthly limit does
  // not make a free-tier key paid, so offering that lever here would send the
  // reader to a setting that cannot fix their run.
  if (r.isFreeTier === true) {
    const against = ceiling === null ? 'this run' : `a ${usd(ceiling)} run ceiling`;
    return { outcome: 'refuse', effectiveMaxCost: null,
      message: 'OpenRouter key cannot cover this run: the key is free tier, so every paid seat '
        + `would be refused (${against}); add credit at openrouter.ai/credits `
        + '— no seat was dispatched' };
  }

  // Council #264 r1 / A2: `null` and "absent" are the ONLY values that mean "no
  // monthly limit". Everything else unparseable is unknown, and unknown warns —
  // it must never be rendered as a confident "this key has no limit".
  const raw = r.limitRemaining;
  if (raw !== null && raw !== undefined && !(typeof raw === 'number' && Number.isFinite(raw))) {
    // NOT JSON.stringify alone: it renders NaN and ±Infinity as the literal
    // `null`, i.e. as the ONE value that legitimately means "no monthly limit" —
    // the message would deny exactly the distinction it exists to draw.
    const shown = (typeof raw === 'number') ? String(raw) : JSON.stringify(raw);
    return { outcome: 'warn', effectiveMaxCost: null,
      message: 'OpenRouter credit could not be checked — the reported monthly limit '
        + `${shown} is not a number, so it is unknown rather than absent; continuing` };
  }
  const remaining = (raw === null || raw === undefined) ? null : raw;

  // An exhausted limit funds no seat at all, whatever the ceiling says — so it
  // is decided before the ceiling is required, exactly like free tier.
  if (remaining !== null && remaining <= 0) {
    return { outcome: 'refuse', effectiveMaxCost: null,
      message: `OpenRouter key cannot cover this run: ${usd(remaining)} of the key's monthly `
        + 'limit remains, so every paid seat would be refused; add credit or raise the '
        + "key's monthly limit — no seat was dispatched" };
  }

  if (remaining === null) {
    // No monthly limit on the key: nothing to compare, nothing to clamp. The
    // ceiling is still printed so the notice says what the run intends to spend.
    return { outcome: 'ok', effectiveMaxCost: null,
      message: 'OpenRouter key limit ok (no monthly limit on the key; run ceiling '
        + `${ceiling === null ? 'unreadable' : usd(ceiling)}${UNCHECKED_BOUNDARY})` };
  }

  if (ceiling === null) {
    return { outcome: 'warn', effectiveMaxCost: null,
      message: `OpenRouter credit could not be checked — the run ceiling ${JSON.stringify(maxCost)} `
        + `is not a usable dollar amount, so ${usd(remaining)} remaining could not be compared `
        + 'against it; continuing' };
  }

  if (remaining < ceiling) {
    // Rounded DOWN to cents: a clamped ceiling ABOVE the real remaining limit
    // would put the run straight back into the refusal this preflight exists to
    // avoid. A sub-cent remainder therefore clamps to $0.00, and createBudget
    // stops the run at once with a degrade note — bounded and loud, not a crash.
    const effective = Math.floor(remaining * 100) / 100;
    return { outcome: 'clamp', effectiveMaxCost: effective,
      message: `OpenRouter key limit is below this run's ceiling: ${usd(remaining)} monthly limit `
        + `remaining vs a ${usd(ceiling)} ceiling — the run continues with its ceiling clamped to `
        + `${usd(effective)} and its own cost gate will stop it there`
        + `${UNCHECKED_BOUNDARY.replace('; ', ' (')})` };
  }

  return { outcome: 'ok', effectiveMaxCost: null,
    message: `OpenRouter key limit ok (${usd(remaining)} monthly limit remaining vs run ceiling `
      + `${usd(ceiling)}${UNCHECKED_BOUNDARY})` };
}

module.exports = { decideCreditPreflight };
