/**
 * @module openrouter-credit
 * The OpenRouter credit/limit probe, split out of api-key-validation.js to keep
 * that module under the 300-line size gate — the same reason it was itself
 * split out of api-key-store.js. Different concern, too: this asks what the
 * ACCOUNT can afford, not whether the credential is accepted.
 *
 * Re-exported from api-key-validation.js so every existing call site keeps
 * working unchanged.
 */

'use strict';

const https = require('https');

/** Warning string for a zero-credit OpenRouter key (paid models will 402). */
const OPENROUTER_NO_CREDIT_WARNING =
  'OpenRouter key has no remaining credit — paid models will fail (402). ' +
  'Add credit at openrouter.ai/credits, or build a free council (amicus setup → option 2).';

/** Warning string for a free-tier OpenRouter key. */
const OPENROUTER_FREE_TIER_WARNING =
  'OpenRouter key is free tier — only :free models will route; paid models will fail (402). ' +
  'Add credit at openrouter.ai/credits to use paid models.';

/**
 * Non-blocking credit/limit check for an OpenRouter key.
 *
 * Hits GET https://openrouter.ai/api/v1/key (returns limit, usage,
 * is_free_tier, limit_remaining) and produces a WARNING — never an error —
 * when is_free_tier is true or limit_remaining <= 0. Any failure (non-200,
 * network error, malformed body) resolves with warning:null so setup is
 * never blocked. Free-tier councils against free models are legitimate.
 *
 * @param {string} key OpenRouter API key
 * @returns {Promise<{checked: boolean, warning: string|null, isFreeTier: boolean,
 *   limitRemaining: number|null, limit: number|null, usage: number|null}>}
 *   `checked` is false whenever no answer was obtained. Never infer health
 *   from `warning: null` alone — see the note on `none` below.
 */
function checkOpenRouterCredit(key) {
  // ⚠️ `checked: false` is the whole point. Every failure path below resolves
  // THIS object, and `warning: null` is also what a perfectly healthy account
  // resolves — so a caller branching on `warning` alone cannot tell "the
  // account is fine" from "the probe never got an answer", and renders the
  // first for the second. That is the false green the fourth council pass
  // found still alive on the network-failure path after it had been fixed only
  // for the gate-disabled one. Intent-to-probe and result-of-probe are
  // different facts and now have different fields.
  const none = {
    checked: false,
    warning: null, isFreeTier: false, limitRemaining: null, limit: null, usage: null
  };
  if (!key || key.trim().length === 0) {
    return Promise.resolve(none);
  }

  const headers = { 'Authorization': `Bearer ${key.trim()}` };

  return new Promise((resolve) => {
    const req = https.get('https://openrouter.ai/api/v1/key', { headers }, (res) => {
      let body = '';
      // Same response-stream gap as validateApiKey (#224). `none` carries
      // checked:false, so a mid-flight death reports "could not be checked"
      // rather than falling through to "credit ok".
      res.on('error', () => { resolve(none); });
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) { resolve(none); return; }
        let data;
        try {
          data = (JSON.parse(body) || {}).data || {};
        } catch (_e) {
          resolve(none);
          return;
        }
        const isFreeTier = data.is_free_tier === true;
        const limitRemaining = (typeof data.limit_remaining === 'number')
          ? data.limit_remaining : null;
        const limit = (typeof data.limit === 'number') ? data.limit : null;
        const usage = (typeof data.usage === 'number') ? data.usage : null;

        let warning = null;
        if (limitRemaining !== null && limitRemaining <= 0) {
          warning = OPENROUTER_NO_CREDIT_WARNING;
        } else if (isFreeTier) {
          warning = OPENROUTER_FREE_TIER_WARNING;
        }
        resolve({ checked: true, warning, isFreeTier, limitRemaining, limit, usage });
      });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(none);
    });
    req.on('error', () => { resolve(none); });
  });
}

module.exports = {
  checkOpenRouterCredit,
  OPENROUTER_NO_CREDIT_WARNING,
  OPENROUTER_FREE_TIER_WARNING,
};
