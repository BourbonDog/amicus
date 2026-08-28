/**
 * API Key Validation — test API keys against provider endpoints.
 * Extracted from api-key-store.js to keep modules under 300 lines.
 */
const https = require('https');

/** Validation endpoints per provider */
const VALIDATION_ENDPOINTS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` })
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` })
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    authHeader: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    })
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    authHeader: () => ({})
  },
  deepseek: {
    url: 'https://api.deepseek.com/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` })
  }
};

const FORBIDDEN_MESSAGE =
  'Forbidden (403) — the request was rejected, but this may be a disabled API, '
  + 'a quota, or a region/bot block rather than the key';

/**
 * Strip every spelling of a secret out of a message before it can escape.
 *
 * The Google probe embeds the key in the URL as `?key=...`, so ANY error text
 * that quotes the request URL quotes the key with it — Node's ERR_INVALID_URL
 * and several socket errors do exactly that. Redacting here, at the source,
 * is what protects the callers that never look: electron/ipc-setup.js returns
 * `err.message` straight to the renderer AND logs it, and src/cli-handlers.js
 * awaits this function with no try/catch at all. (Council finding 3, PR 221.)
 *
 * Two passes, in this order:
 *   1. Mask `key=` / `api_key=` / `access_token=` query parameters
 *      structurally. This is what actually protects the Google probe, and it
 *      works for a key of ANY length.
 *   2. Remove the key's own spellings — raw, percent-encoded, and the
 *      form-encoded `+`-for-space variant — but only when the key is at least
 *      8 characters. Blind substring replacement of a 1-2 character key
 *      rewrote unrelated diagnostics (every "a" in a DNS error became ***)
 *      while protecting nothing real. Council review of PR 222.
 */
function redactSecret(text, key) {
  if (typeof text !== 'string' || text.length === 0) { return ''; }
  if (!key) { return text; }

  // 1. Mask the query parameter STRUCTURALLY, before touching the key at all.
  //    This is what actually protects the Google probe (`?key=...`) and it
  //    works for a key of any length, including ones too short to substring-
  //    match safely.
  let out = text.replace(/([?&](?:key|api_key|access_token)=)[^&\s"')]+/gi, '$1***');

  // 2. Then remove the key itself — but only when it is long enough that a
  //    substring match means something. Blind replacement of a 1-2 character
  //    key rewrote unrelated text ("a" -> "***" across a whole DNS error),
  //    which corrupts diagnostics without protecting anything real. Council
  //    review of PR 222.
  const MIN_SUBSTRING_LEN = 8;
  if (key.length >= MIN_SUBSTRING_LEN) {
    const spellings = new Set([key]);
    try {
      const encoded = encodeURIComponent(key);
      spellings.add(encoded);
      // application/x-www-form-urlencoded spells a space '+', not '%20'.
      spellings.add(encoded.replace(/%20/g, '+'));
    } catch (_e) { /* un-encodable key: the raw spelling below still runs */ }
    for (const s of spellings) {
      if (s) { out = out.split(s).join('***'); }
    }
  }
  return out;
}

/**
 * Validate an API key by making a test request to the provider's API.
 *
 * ALWAYS RESOLVES — never rejects, even on a synchronous throw from https.get
 * (see redactSecret). Two of the three call sites have no catch.
 *
 * @returns {Promise<{valid: boolean, status: number|null, error?: string}>}
 *   `status` is the HTTP status, or null when no response was received. It is
 *   returned as DATA so callers never have to recover it by parsing `error`
 *   (council finding 2): that coupled control flow to message wording, and a
 *   reword that dropped the parentheses would have silently degraded detection
 *   to a permanent "unverified" with nothing failing to announce it.
 */
function validateApiKey(provider, key) {
  if (!key || key.trim().length === 0) {
    return Promise.resolve({ valid: false, status: null, error: 'API key is required' });
  }

  const endpoint = VALIDATION_ENDPOINTS[provider];
  if (!endpoint) {
    return Promise.resolve({ valid: false, status: null, error: `Unknown provider: ${provider}` });
  }

  const trimmedKey = key.trim();

  // Google uses query param auth, not header
  let url = endpoint.url;
  if (provider === 'google') {
    url = `${endpoint.url}?key=${trimmedKey}`;
  }

  const headers = endpoint.authHeader(trimmedKey);

  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(url, { headers }, (res) => {
        const code = res.statusCode;
        res.on('data', () => {});
        res.on('end', () => {
          // Anthropic: the probe is a GET against /v1/messages, so a WORKING
          // key answers with a method/shape complaint (400/404/405), never 200.
          //
          // ⚠️ This used to be `else { valid: true }` — every code that was not
          // 401/429/5xx passed, INCLUDING 403. A region block or WAF therefore
          // reported the key as good: a false GREEN, inside the very function
          // rewritten to stop treating 403 as a verdict, and the exact failure
          // class #210 exists to kill. Council review of PR 222 caught it.
          // Success is an ALLOWLIST now; anything unlisted is not-valid.
          if (provider === 'anthropic') {
            if (code === 401) {
              resolve({ valid: false, status: code, error: 'Invalid API key (401)' });
            } else if (code === 403) {
              resolve({ valid: false, status: code, error: FORBIDDEN_MESSAGE });
            } else if (code >= 500 || code === 429) {
              resolve({ valid: false, status: code, error: `Server error (${code})` });
            } else if (code === 200 || code === 400 || code === 404 || code === 405) {
              resolve({ valid: true, status: code });
            } else {
              resolve({ valid: false, status: code, error: `Unexpected response (${code})` });
            }
            return;
          }

          if (code === 200) {
            resolve({ valid: true, status: code });
          } else if (code === 401) {
            resolve({ valid: false, status: code, error: 'Invalid API key (401)' });
          } else if (code === 403) {
            // NOT stated as a bad key (council finding 1). Google returns 403
            // for "API not enabled" and for quota; a WAF returns it for bot
            // protection. Calling that an invalid credential sends someone off
            // to re-enter a key that works — the false-ALARM twin of the
            // false-GREEN this endpoint exists to catch. Callers decide.
            resolve({ valid: false, status: code, error: FORBIDDEN_MESSAGE });
          } else {
            resolve({ valid: false, status: code, error: `Unexpected response (${code})` });
          }
        });
      });
    } catch (err) {
      // Synchronous throw (ERR_INVALID_URL and friends). Its message quotes the
      // request URL — key included for Google. Redact, resolve, never reject.
      resolve({ valid: false, status: null, error: redactSecret(err.message, trimmedKey) });
      return;
    }
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ valid: false, status: null, error: 'Request timed out' });
    });
    req.on('error', (err) => {
      resolve({ valid: false, status: null, error: redactSecret(err.message, trimmedKey) });
    });
  });
}

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
 * @returns {Promise<{warning: string|null, isFreeTier: boolean,
 *   limitRemaining: number|null, limit: number|null, usage: number|null}>}
 */
function checkOpenRouterCredit(key) {
  const none = {
    warning: null, isFreeTier: false, limitRemaining: null, limit: null, usage: null
  };
  if (!key || key.trim().length === 0) {
    return Promise.resolve(none);
  }

  const headers = { 'Authorization': `Bearer ${key.trim()}` };

  return new Promise((resolve) => {
    const req = https.get('https://openrouter.ai/api/v1/key', { headers }, (res) => {
      let body = '';
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
        resolve({ warning, isFreeTier, limitRemaining, limit, usage });
      });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(none);
    });
    req.on('error', () => { resolve(none); });
  });
}

// Backwards compat alias
const validateOpenRouterKey = validateApiKey;

module.exports = {
  validateApiKey,
  redactSecret,
  validateOpenRouterKey,
  checkOpenRouterCredit,
  OPENROUTER_NO_CREDIT_WARNING,
  OPENROUTER_FREE_TIER_WARNING,
  VALIDATION_ENDPOINTS
};
