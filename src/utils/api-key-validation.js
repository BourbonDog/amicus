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

/** Validate an API key by making a test request to the provider's API */
function validateApiKey(provider, key) {
  if (!key || key.trim().length === 0) {
    return Promise.resolve({ valid: false, error: 'API key is required' });
  }

  const endpoint = VALIDATION_ENDPOINTS[provider];
  if (!endpoint) {
    return Promise.resolve({ valid: false, error: `Unknown provider: ${provider}` });
  }

  const trimmedKey = key.trim();

  // Google uses query param auth, not header
  let url = endpoint.url;
  if (provider === 'google') {
    url = `${endpoint.url}?key=${trimmedKey}`;
  }

  const headers = endpoint.authHeader(trimmedKey);

  return new Promise((resolve) => {
    const req = https.get(url, { headers }, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        // Anthropic returns 401 for invalid key, 400/405 for valid key with no body
        if (provider === 'anthropic') {
          if (res.statusCode === 401) {
            resolve({ valid: false, error: 'Invalid API key (401)' });
          } else if (res.statusCode >= 500 || res.statusCode === 429) {
            resolve({ valid: false, error: `Server error (${res.statusCode})` });
          } else {
            resolve({ valid: true });
          }
          return;
        }

        if (res.statusCode === 200) {
          resolve({ valid: true });
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          resolve({ valid: false, error: `Invalid API key (${res.statusCode})` });
        } else {
          resolve({ valid: false, error: `Unexpected response (${res.statusCode})` });
        }
      });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ valid: false, error: 'Request timed out' });
    });
    req.on('error', (err) => {
      resolve({ valid: false, error: err.message });
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
  validateOpenRouterKey,
  checkOpenRouterCredit,
  OPENROUTER_NO_CREDIT_WARNING,
  OPENROUTER_FREE_TIER_WARNING,
  VALIDATION_ENDPOINTS
};
