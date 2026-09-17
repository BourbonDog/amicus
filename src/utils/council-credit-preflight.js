/**
 * @module utils/council-credit-preflight
 *
 * #256: the ruling the CI council's credit preflight makes, as a pure function.
 *
 * MEASURED (run 35143585179, 2026-09-16): four of seven legs were refused by
 * OpenRouter in 2–3 s, the once-only Stage-1 retries were spent on those
 * refusals, and the round ended COUNCIL_QUORUM with ONE seat reviewed for
 * $0.003. gpt's retry said why: `You requested up to 64000 tokens, but can only
 * afford 56097`.
 *
 * ⚠️ WHAT THIS GUARANTEES, AND WHAT IT CANNOT — the whole shape follows from it,
 * and every message THIS MODULE returns says it out loud (council #264 r2 read
 * the earlier copy as a promise the probe cannot keep). The workflow step's own
 * messages — a module that would not load, a probe that threw — report that the
 * check did not RUN at all, so they have nothing to qualify:
 *   GUARANTEES: it refuses before any seat is dispatched when a refusal is
 *   CERTAIN (nothing on the key can fund even one seat's reservation), warns
 *   when refusals are LIKELY (the first wave cannot be funded in full), and
 *   bounds aggregate spend by clamping `--max-cost` to the money that is left.
 *   CANNOT: prevent a per-request refusal once seats are dispatched. Reservations
 *   are charged against the key CONCURRENTLY and settle asynchronously, so the
 *   money available to leg four is not knowable before legs one to three exist.
 *
 * TWO READS, because they are two facts (council #264 r2, HQ2 / findings A1+D1):
 * `/api/v1/key` reports the KEY's monthly cap and `/api/v1/credits` reports the
 * ACCOUNT's balance. A key with no cap at all (`limitRemaining: null`) on a
 * depleted account used to pass as `ok`. `remaining` is the MINIMUM of whichever
 * of the two is a finite number, and an unanswered balance read can never be
 * `ok` — unknown is not permission.
 *
 * THE RESERVATION, not the aggregate (council #264 r2, HQ1 / findings A1+D1):
 * `--max-cost` is a whole-run ceiling, and OpenRouter never refuses on it. It
 * refuses on ONE request's `max_tokens` reservation. `utils/council-credit-
 * reservation.js` prices that; below one seat's worth nothing can be dispatched,
 * and below the first wave's worth some of it will be refused.
 *
 * `clamp` survives as a SPEND BOUND only, and is the weakest state: any warn
 * outranks it, because "your spend is capped lower" matters less than "some of
 * this run will be refused".
 */

'use strict';

/**
 * Format a USD figure for a human reading an Actions annotation.
 * Two decimals, except for a non-zero amount that would round to $0.00 — the
 * incident's own run spent $0.003, so "you have $0.00" would be a lie about a
 * real balance. The sign leads (`-$3.00`), because `$-3.00` is not money
 * (council #264 r2, finding D5).
 */
function usd(n) {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  return `${sign}$${(v !== 0 && v < 0.01) ? v.toFixed(4) : v.toFixed(2)}`;
}

/** What every message ends with. See the module header. */
const GUARANTEE = ' — this preflight refuses when a refusal is certain and warns when one is '
  + 'likely; it cannot prevent a per-request refusal once seats are dispatched';

/**
 * Coerce the run ceiling. The workflow hands this over as `$MAX_COST`, a string
 * ('2.00'), so a number and a numeric string are both legitimate. Everything
 * else is UNUSABLE, not zero: `Number('')` is 0 and `Number('x')` is NaN, and
 * both make a `<` comparison silently false — a pass nobody decided.
 */
function toCeiling(maxCost) {
  const raw = (maxCost === null || maxCost === undefined) ? '' : maxCost;
  const n = (typeof maxCost === 'number') ? maxCost : Number(String(raw).trim());
  return (Number.isFinite(n) && n > 0) ? n : null;
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
/** Renders a rejected value honestly: JSON.stringify turns NaN into `null`, the
 *  one value that legitimately means "no monthly limit". */
const shown = (v) => (typeof v === 'number' ? String(v) : JSON.stringify(v));

/**
 * Decide what the CI preflight should do.
 *
 * @param {{credit: object, balance: object, reservation: object, seats: number}} inputs
 *   `credit` from `checkOpenRouterCredit`, `balance` from `checkOpenRouterBalance`,
 *   `reservation` from `priceOneSeatReservation`, `seats` the concurrent bench size.
 * @param {number|string} maxCost the run's `--max-cost` ceiling in USD
 * @returns {{outcome: 'ok'|'warn'|'refuse'|'clamp', message: string,
 *   effectiveMaxCost: number|null}} `effectiveMaxCost` is the clamped spend bound
 *   when one is in force — it travels on a `warn` too, and is null on a refusal.
 */
function decideCreditPreflight(inputs, maxCost) {
  const o = (inputs && typeof inputs === 'object') ? inputs : {};
  const c = (o.credit && typeof o.credit === 'object') ? o.credit : {};
  const b = (o.balance && typeof o.balance === 'object') ? o.balance : {};
  const r = (o.reservation && typeof o.reservation === 'object') ? o.reservation : {};
  const seats = (Number.isInteger(o.seats) && o.seats > 0) ? o.seats : 1;
  const ceiling = toCeiling(maxCost);
  const warn = (why) => ({ outcome: 'warn', effectiveMaxCost: null,
    message: `OpenRouter credit could not be checked — ${why}; continuing${GUARANTEE}` });
  const refuse = (why) => ({ outcome: 'refuse', effectiveMaxCost: null,
    message: `OpenRouter key cannot cover this run: ${why} — no seat was dispatched${GUARANTEE}` });

  if (c.checked !== true) {
    return warn('the key probe returned no answer (missing key, non-200, unreadable body, '
      + 'network error or timeout)');
  }
  // A hard fact about the key: true regardless of every other reading, so nothing
  // may mask it. The remedy is ADD CREDIT alone — raising a monthly limit cannot
  // make a free-tier key paid.
  if (c.isFreeTier === true) {
    return refuse('the key is free tier, so every paid seat would be refused; '
      + 'add credit at openrouter.ai/credits');
  }
  // `null`/absent are the ONLY values meaning "no monthly cap"; anything else
  // unparseable is UNKNOWN, never absence (council #264 r1, finding A2).
  const capRaw = c.limitRemaining;
  if (capRaw !== null && capRaw !== undefined && finite(capRaw) === null) {
    return warn(`the reported monthly limit ${shown(capRaw)} is not a number, so it is unknown `
      + 'rather than absent');
  }
  const cap = finite(capRaw);
  const balanceKnown = b.checked === true && finite(b.balanceRemaining) !== null;
  const bal = balanceKnown ? b.balanceRemaining : null;

  // The money that actually governs: the SMALLER of the two, over whichever are
  // known. Both unknown leaves `remaining` null, which can never be `ok`.
  const known = [cap, bal].filter((v) => v !== null);
  const remaining = known.length ? Math.min(...known) : null;
  const source = (bal !== null && (cap === null || bal <= cap)) ? 'account balance' : "key's monthly limit";

  // ---- refusals: states in which NOTHING can be dispatched ----
  // ⚠️ THE FLOOR IS THE CHEAPEST BENCH SEAT, NOT THE DEAREST (council #264 r3,
  // findings B1 + C1). Refusing when the money cannot fund the dearest seat
  // turns a run that could have seated its cheap seats — possibly to quorum —
  // into zero reviews, which is the harm this whole preflight exists to avoid.
  // And the CHAIR is not in this figure at all: it runs sequentially AFTER the
  // wave, so its price can never be a reason not to start the bench.
  const cheapest = (r.priced === true) ? finite(r.cheapestSeatUsd) : null;
  const dearest = (r.priced === true) ? finite(r.dearestSeatUsd) : null;
  const wave = (r.priced === true) ? finite(r.waveUsd) : null;
  const chairUsd = (r.priced === true) ? finite(r.chairUsd) : null;

  if (remaining !== null && remaining <= 0) {
    return refuse(`${usd(remaining)} of the ${source} remains, so every paid seat would be refused; `
      + "add credit or raise the key's monthly limit");
  }
  if (remaining !== null && cheapest !== null && remaining < cheapest) {
    return refuse(`${usd(remaining)} of the ${source} remains, but even the CHEAPEST bench seat `
      + `reserves ${usd(cheapest)} up front (its output price x the run's output budget), so the `
      + 'provider would refuse every request before it ran');
  }
  // Cents, decided ONCE. `Math.floor(0.29 * 100)` is 28 — `0.29 * 100` is
  // 28.999999999999996 in IEEE 754 — so the clamp published a ceiling a cent
  // BELOW the money for every remainder whose second decimal is a 9 (council
  // #264 r3 / A1). The epsilon is 1e-11 dollars: far under any real balance
  // granularity, and far over the representation error. Deriving the sub-cent
  // refusal from the SAME cents value is what keeps the two from disagreeing.
  const cents = remaining === null ? null : Math.floor(remaining * 100 + 1e-9);
  if (cents !== null && cents <= 0) {
    return refuse(`${usd(remaining)} of the ${source} remains, below one cent — too little to `
      + "give the run any usable ceiling; add credit or raise the key's monthly limit");
  }

  // The spend bound. Computed independently of the outcome, because it travels
  // on a `warn` too — and it is ONLY a spend bound.
  const effectiveMaxCost = (cents !== null && ceiling !== null && remaining < ceiling)
    ? cents / 100
    : null;
  const withBound = (res) => (effectiveMaxCost === null ? res : { ...res, effectiveMaxCost });
  // The chair rides as a CLAUSE on whatever the bench verdict is, never as one
  // of its own: reporting it must not be able to change the bench's outcome.
  const chairClause = (remaining !== null && chairUsd !== null && remaining < chairUsd)
    ? `; the chair reserves ${usd(chairUsd)} and may be refused after the bench` : '';
  const benchWarn = (why) => withBound({ outcome: 'warn', effectiveMaxCost,
    message: `${why}${chairClause}${GUARANTEE}` });

  // ---- warnings: states we cannot clear, or in which refusals are LIKELY ----
  if (b.checked !== true) {
    return withBound(warn('the account balance probe returned no answer, so the key limit alone '
      + 'was read — that cannot rule out a depleted account'));
  }
  if (!balanceKnown) {
    return withBound(warn(`the reported account balance ${shown(b.balanceRemaining)} is not a `
      + 'number, so it is unknown rather than absent'));
  }
  if (r.priced !== true) {
    return withBound(warn("could not price the bench's reservation"
      + `${Array.isArray(r.unpriced) && r.unpriced.length ? ` (${r.unpriced.join(', ')})` : ''}`
      + `${r.reason ? `: ${r.reason}` : ''}, so whether a seat is affordable is unknown`));
  }
  if (remaining === null) {
    return withBound(warn('neither a monthly limit nor an account balance could be read'));
  }
  if (dearest !== null && remaining < dearest) {
    return benchWarn(`OpenRouter money funds only part of the bench: ${usd(remaining)} of the `
      + `${source} remains, and the dearest seat reserves ${usd(dearest)} — expect the dearest `
      + 'seat(s) to be refused, though a cheaper quorum may still seat');
  }
  if (wave !== null && remaining < wave) {
    return benchWarn(`OpenRouter money may not fund the first wave: ${usd(remaining)} of the `
      + `${source} remains, and the bench reserves ${usd(wave)} concurrently — expect some seats `
      + 'to be refused before they run');
  }
  if (chairClause) {
    return benchWarn('OpenRouter money funds the bench but may not fund the chair: '
      + `${usd(remaining)} of the ${source} remains`);
  }
  if (ceiling === null) {
    return withBound(warn(`the run ceiling ${shown(maxCost)} is not a usable dollar amount, so `
      + `${usd(remaining)} remaining could not be compared against it`));
  }

  // ---- the spend bound alone, or nothing to say ----
  if (effectiveMaxCost !== null) {
    return { outcome: 'clamp', effectiveMaxCost,
      message: `OpenRouter money is below this run's ceiling: ${usd(remaining)} of the ${source} `
        + `remains vs a ${usd(ceiling)} ceiling — the run continues with its aggregate spend `
        + `capped at ${usd(effectiveMaxCost)}; the first wave is still affordable${GUARANTEE}` };
  }
  return { outcome: 'ok', effectiveMaxCost: null,
    message: `OpenRouter credit ok: ${usd(remaining)} of the ${source} remains, the ${seats}-seat `
      + `first wave reserves ${usd(wave)}, run ceiling ${usd(ceiling)}${GUARANTEE}` };
}

module.exports = { decideCreditPreflight };
