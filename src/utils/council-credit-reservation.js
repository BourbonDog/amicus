/**
 * @module utils/council-credit-reservation
 *
 * #256 / council #264 r2 (HQ1): price the thing OpenRouter actually refuses.
 *
 * The first two rounds clamped the run's AGGREGATE `--max-cost`. The bench's
 * central objection — unanimous across glm and deepseek, and correct — is that
 * an aggregate ceiling cannot prevent a PER-REQUEST refusal, because the
 * aggregate is not the quantity the provider refuses on. Run 35143585179's gpt
 * retry was told, verbatim:
 *
 *   "This request requires more credits, or fewer max_tokens. You requested up
 *    to 64000 tokens, but can only afford 56097"
 *
 * That is one request's `max_tokens` RESERVATION weighed against the money left
 * on the key. No aggregate appears in it. So the preflight has to compute the
 * same figures the provider will, one per seat:
 *
 *   seatReservationUsd = outputBudget x that row's pricing.completion
 *
 * `outputBudget` and the bench ids come from the alias map this job's own
 * earlier step provisioned (the credit step runs after it, and reads the same
 * file); the per-token completion prices come from a KEYLESS
 * `GET /api/v1/models`.
 *
 * ⚠️ FOUR FIGURES, not one (council #264 r3). Round 2 used a single `max` over
 * bench AND chair and gated everything on it. `priceBenchReservation` below says
 * why that was two errors at once; in short, the gate needs the CHEAPEST bench
 * seat (below it nothing can run), the DEAREST (below it some seats certainly
 * will not), the SUM over the bench (the concurrent first wave), and the CHAIR
 * priced apart from all three. A bench with ANY unpriced row is still not priced
 * — the missing row could be the cheapest, leaving the refuse gate no floor.
 *
 * SPLIT FROM `council-credit-preflight.js` for two reasons, not just the
 * 300-line gate: this module does I/O (a catalog fetch) while that one must stay
 * a pure ruling that the decision matrix can enumerate, and pricing a bench is a
 * fact about the RUN'S CONFIGURATION — the provisioned alias map and the live
 * catalog — where the other is a policy about what to do with the facts.
 */

'use strict';

const https = require('https');

/** Bounded like the other two probes: a catalog read must never hang a job. */
const FETCH_TIMEOUT_MS = 10000;

/**
 * Comparison-only key for an OpenRouter catalog lookup: drop a leading
 * `openrouter/` gateway prefix and lowercase.
 *
 * ⚠️ PARSE, NEVER DERIVE — the same test `.eslintrc.js`'s `openrouter/` ban
 * applies to its allowlisted callers (`route-launch.js :: normalizeForModelIndex`,
 * `model-tiers.js :: buildGatewayOnlyAliasMap`): this returns an INDEX KEY and
 * nothing that is ever sent to a provider. It is not `stripGatewayPrefix`
 * (curated-models.js), which strips only for vendors with a direct integration
 * and would leave `openrouter/z-ai/...` intact — the catalog keys every row
 * bare, so the strip here is unconditional. And it does NOT unify dots and
 * dashes the way `normalizeForModelIndex` does: real ids carry meaningful dots
 * (`glm-5.3`), and a lenient key here would silently price the wrong model.
 * @param {string} id
 * @returns {string|null}
 */
function catalogKey(id) {
  if (typeof id !== 'string') { return null; }
  const bare = id.trim().replace(/^openrouter\//i, '');
  return bare.length > 0 ? bare.toLowerCase() : null;
}

/**
 * Resolve the bench's seats to OpenRouter catalog ids through the provisioned
 * alias map. A seat containing `/` is already a full id and is taken as one —
 * the same rule the bench pre-flight step applies one step earlier.
 *
 * @param {{aliases: object, seats: string[]}} o
 * @returns {{ids: string[], unresolved: string[]}} ONE id per seat, duplicates
 *   included — the sum over them is what the concurrent wave holds. `unresolved`
 *   is REPORTED, not dropped: a seat whose price cannot be looked up leaves the
 *   bench unpriced, and the caller has to be able to say which one.
 */
function resolveBenchIds({ aliases, seats } = {}) {
  const map = (aliases && typeof aliases === 'object' && !Array.isArray(aliases)) ? aliases : {};
  const list = Array.isArray(seats) ? seats : [];
  const ids = [];
  const unresolved = [];
  for (const raw of list) {
    const seat = typeof raw === 'string' ? raw.trim() : '';
    if (!seat) { continue; }
    const resolved = seat.indexOf('/') !== -1 ? seat : map[seat];
    const key = catalogKey(resolved);
    if (!key) {
      // Reported once, however many seats share the unresolvable name.
      if (!unresolved.includes(seat)) { unresolved.push(seat); }
      continue;
    }
    // ⚠️ ONE ID PER SEAT — duplicates are NOT collapsed (council #264 r3
    // polish). Two aliases resolving to one model are still two concurrent
    // requests, each holding its own max_tokens reservation, so deduping here
    // made `waveUsd` under-count the wave by exactly the duplicate's share.
    // `cheapest`/`dearest` are min/max and cannot notice the difference.
    ids.push(key);
  }
  return { ids, unresolved };
}

/**
 * Price a list of rows, in dollars reserved per seat.
 * @returns {{usd: number[], unpriced: string[]}}
 */
function priceRows(table, ids, outputBudget) {
  const usd = [];
  const unpriced = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const key = catalogKey(id);
    const price = key === null ? undefined : table[key];
    // A zero or negative price is not a price for a PAID run: it means the
    // table told us nothing usable about what this row reserves.
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      unpriced.push(id);
      continue;
    }
    usd.push(outputBudget * price);
  }
  return { usd, unpriced };
}

/**
 * What the bench reserves before it has produced a single token.
 *
 * ⚠️ FOUR FIGURES, NOT ONE (council #264 r3, findings B1 + C1). A single `max`
 * over everything was two mistakes at once:
 *   * it refused the whole run when the money could not fund the DEAREST seat —
 *     even when it could fund the cheap ones, and a cheaper quorum would have
 *     seated. That contradicts this PR's own rationale: turning a partial round
 *     into zero reviews is the harm being avoided, not a remedy for it.
 *   * it folded the CHAIR into the bench's maximum. The chair runs sequentially,
 *     AFTER the wave, out of a budget the bench has already spent from — so a
 *     dear chair could refuse a bench that would have seated fine. It is priced
 *     and reported, never a reason to refuse the bench.
 * `waveUsd` is the SUM over the bench, not `seats x dearest`: the seats launch
 * concurrently and each holds its OWN reservation, so the sum is the figure the
 * provider sees. The approximation over-stated a mixed bench threefold here.
 *
 * @param {{prices: Object<string, number>, benchIds: string[], chairIds: string[],
 *   outputBudget: number}} o
 * @returns {{priced: boolean, cheapestSeatUsd: number|null, dearestSeatUsd: number|null,
 *   waveUsd: number|null, chairUsd: number|null, unpriced: string[],
 *   unpricedChair: string[], reason: string|null}}
 */
function priceBenchReservation({ prices, benchIds, chairIds, outputBudget } = {}) {
  const none = (reason, unpriced = []) => ({ priced: false, cheapestSeatUsd: null,
    dearestSeatUsd: null, waveUsd: null, chairUsd: null, unpriced, unpricedChair: [], reason });

  if (typeof outputBudget !== 'number' || !Number.isFinite(outputBudget) || outputBudget <= 0) {
    return none('the output budget is not a positive number');
  }
  const bench = Array.isArray(benchIds) ? benchIds : [];
  if (bench.length === 0) { return none('the bench resolved to no model ids'); }

  const table = {};
  if (prices && typeof prices === 'object') {
    for (const [id, price] of Object.entries(prices)) {
      const key = catalogKey(id);
      if (key) { table[key] = price; }
    }
  }

  const seats = priceRows(table, bench, outputBudget);
  // ANY unpriced BENCH row leaves the bench unpriced: the row we could not price
  // could be the cheapest one, so the refuse gate would have no floor.
  if (seats.unpriced.length > 0) {
    return none('one or more bench rows have no completion price', seats.unpriced);
  }
  if (seats.usd.length === 0) { return none('no bench row carries a usable completion price'); }

  // An unpriced CHAIR does NOT unprice the bench: its affordability is a
  // separate clause, so not knowing it must not suppress a bench verdict the
  // bench's own prices fully support.
  const chair = priceRows(table, chairIds, outputBudget);

  return {
    priced: true,
    cheapestSeatUsd: Math.min(...seats.usd),
    dearestSeatUsd: Math.max(...seats.usd),
    waveUsd: seats.usd.reduce((a, b) => a + b, 0),
    chairUsd: chair.usd.length ? Math.max(...chair.usd) : null,
    unpriced: [],
    unpricedChair: chair.unpriced,
    reason: null,
  };
}

/**
 * Read the OpenRouter model catalog's completion prices. KEYLESS on purpose: it
 * is a public catalog, and a read that does not need the secret must not carry
 * it. Same `checked: false`-on-every-failure discipline as the two key probes.
 *
 * @param {{timeoutMs?: number}} [o]
 * @returns {Promise<{checked: boolean, prices: Object<string, number>}>}
 */
function fetchOpenRouterModelPrices({ timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const none = { checked: false, prices: {} };
  return new Promise((resolve) => {
    const req = https.get('https://openrouter.ai/api/v1/models', { headers: {} }, (res) => {
      let body = '';
      res.on('error', () => { resolve(none); });
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) { resolve(none); return; }
        let rows;
        try {
          rows = (JSON.parse(body) || {}).data;
        } catch (_e) {
          resolve(none);
          return;
        }
        if (!Array.isArray(rows)) { resolve(none); return; }
        const prices = {};
        for (const row of rows) {
          const key = catalogKey(row && row.id);
          // The API sends prices as USD-per-token STRINGS ("0.000015").
          const raw = row && row.pricing && row.pricing.completion;
          const price = (typeof raw === 'string' || typeof raw === 'number') ? Number(raw) : NaN;
          if (key && Number.isFinite(price)) { prices[key] = price; }
        }
        resolve({ checked: true, prices });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(none);
    });
    req.on('error', () => { resolve(none); });
  });
}

module.exports = { resolveBenchIds, priceBenchReservation, fetchOpenRouterModelPrices, catalogKey };
