/**
 * @module doctor-credit-check
 * The `openrouter-credit` doctor row (#43), split out of
 * src/cli-handlers-doctor.js to keep that file under the 300-line size gate
 * (mirrors doctor-base-url-check.js / doctor-alias-check.js / doctor-key-auth-check.js).
 *
 * Warns, never errors: a zero-credit or free-tier key is a real constraint but
 * not a broken install, and free councils against :free models are legitimate.
 *
 * ⚠️ A SKIPPED probe is a WARN, not an ok. checkOpenRouterCredit resolves
 * `warning: null` both when the account is fine AND when the probe never ran,
 * so branching on `warning` alone reported "credit ok" for an account nobody
 * checked — concealing quota exhaustion behind a green row. Council review of
 * PR 222. The `skipped` flag is what distinguishes them.
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
    if (res.warning) {
      return { id: ID, name: NAME, status: 'warn', message: res.warning, hint: 'Add credit at openrouter.ai/credits, or build a free council (amicus setup → option 2).' };
    }
    const remaining = (typeof res.limitRemaining === 'number') ? ` ($${res.limitRemaining} remaining)` : '';
    return { id: ID, name: NAME, status: 'ok', message: `credit ok${remaining}`, hint: null };
}

module.exports = { evaluateOpenRouterCredit };
