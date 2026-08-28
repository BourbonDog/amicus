/**
 * @module doctor-credit-check
 * The `openrouter-credit` doctor row (#43), split out of
 * src/cli-handlers-doctor.js to keep that file under the 300-line size gate
 * (mirrors doctor-base-url-check.js / doctor-alias-check.js / doctor-key-auth-check.js).
 *
 * Warns, never errors: a zero-credit or free-tier key is a real constraint but
 * not a broken install, and free councils against :free models are legitimate.
 *
 * ⚠️ "credit ok" MEANS CHECKED. checkOpenRouterCredit resolves `warning: null`
 * for a healthy account, for a skipped probe, AND for every failure — so
 * branching on `warning` alone reported a funded account for one nobody
 * reached, concealing quota exhaustion behind a green row.
 *
 * Two flags separate the three cases, and both are required: `skipped` (we
 * chose not to look) and `checked` (we looked and got an answer). Fixing only
 * `skipped` left the false green alive on the network-failure path — which is
 * exactly what the fourth council pass on PR 222 found, because the test
 * pinning the fix ran with the gate CLOSED and could never enter the path it
 * claimed to protect.
 */

'use strict';

const ID = 'openrouter-credit';
const NAME = 'OpenRouter credit';

/**
 * @param {{readApiKeyValues: () => Object<string,string>,
 *          checkOpenRouterCredit: (key:string) => Promise<object>}} d
 * @returns {Promise<{id,name,status,message,hint}>}
 */
async function evaluateOpenRouterCredit(d) {

    const values = d.readApiKeyValues() || {};
    const key = values.openrouter;
    if (!key) {
      return { id: ID, name: NAME, status: 'ok', message: 'no OpenRouter key — skipped', hint: null };
    }
    // Reuses the #38 non-blocking probe; resolves warning:null on any failure.
    const res = (await d.checkOpenRouterCredit(key)) || {};
    if (res.skipped) {
      // Never 'ok': nothing was checked, so quota exhaustion or a free-tier cap
      // would be concealed behind a green row (council review of PR 222).
      return { id: ID, name: NAME, status: 'warn', message: 'credit not checked — live probes disabled', hint: 'Unset AMICUS_NO_NETWORK_PROBES, or run `amicus doctor` from the CLI.' };
    }
    // A probe that ran but got no answer (timeout, 5xx, socket reset, garbage
    // body) is NOT evidence of a funded account. Distinct message from the
    // skip above: one means "we chose not to look", this means "we looked and
    // could not see".
    if (res.checked !== true) {
      return { id: ID, name: NAME, status: 'warn', message: 'credit could not be checked — the probe did not complete', hint: 'Transient: re-run `amicus doctor` when the network settles.' };
    }
    if (res.warning) {
      return { id: ID, name: NAME, status: 'warn', message: res.warning, hint: 'Add credit at openrouter.ai/credits, or build a free council (amicus setup → option 2).' };
    }
    const remaining = (typeof res.limitRemaining === 'number') ? ` ($${res.limitRemaining} remaining)` : '';
    return { id: ID, name: NAME, status: 'ok', message: `credit ok${remaining}`, hint: null };
}

module.exports = { evaluateOpenRouterCredit };
