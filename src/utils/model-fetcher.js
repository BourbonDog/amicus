/**
 * Model Fetcher
 *
 * Fetches available model lists from provider APIs for the dropdown selector.
 * Uses the same HTTPS pattern as api-key-store.js validateApiKey().
 */

const https = require('https');

/** Hardcoded Anthropic models (no public listing endpoint) */
const ANTHROPIC_MODELS = [
  { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', contextLength: null, pricing: null },
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextLength: null, pricing: null },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', contextLength: null, pricing: null },
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextLength: null, pricing: null },
  { id: 'anthropic/claude-3-5-haiku', name: 'Claude 3.5 Haiku', contextLength: null, pricing: null }
];

const { PROVIDER_FAMILY_NAMES } = require('./provider-registry');

/** Provider API configs for fetching model lists */
const PROVIDER_FETCH_CONFIG = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models',
    // Public endpoint: works keyless; attach auth only when a key exists (F5).
    authHeader: (key) => (key ? { 'Authorization': `Bearer ${key}` } : {}),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `openrouter/${m.id}`,
        name: m.name || m.id,
        contextLength: m.context_length ?? null,
        pricing: m.pricing
          ? { prompt: m.pricing.prompt ?? null,
              completion: m.pricing.completion ?? null }
          : null
      }));
    }
  },
  google: {
    url: null, // built dynamically with key
    authHeader: () => ({}),
    buildUrl: (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.models || []).map(m => ({
        id: `google/${m.name.replace('models/', '')}`,
        name: m.displayName || m.name.replace('models/', ''),
        contextLength: m.inputTokenLimit ?? null,
        pricing: null
      }));
    }
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `openai/${m.id}`,
        name: m.id,
        contextLength: null,
        pricing: null
      }));
    }
  },
  deepseek: {
    url: 'https://api.deepseek.com/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `deepseek/${m.id}`,
        name: m.id,
        contextLength: null,
        pricing: null
      }));
    }
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    authHeader: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `anthropic/${m.id}`,
        name: m.display_name || m.id,
        contextLength: null,
        pricing: null,
      }));
    },
  },
};

const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch models from a single provider API
 * @param {string} provider - Provider name (openrouter, google, openai, anthropic, deepseek)
 * @param {string} key - API key
 * @returns {Promise<Array<{id: string, name: string, contextLength: number|null, pricing: {prompt: string|null, completion: string|null}|null}>>} Normalized model list
 */
function fetchModelsFromProvider(provider, key) {
  if (provider === 'anthropic') {
    // No key -> hardcoded floor, no network. With a key -> try live, fall back to floor.
    if (!key) { return Promise.resolve(ANTHROPIC_MODELS); }
    return fetchViaConfig('anthropic', key).then(rows => (rows.length > 0 ? rows : ANTHROPIC_MODELS));
  }

  const config = PROVIDER_FETCH_CONFIG[provider];
  if (!config) {
    return Promise.resolve([]);
  }

  return fetchViaConfig(provider, key);
}

/**
 * Perform the HTTPS fetch + normalize for a single configured provider.
 * Resolves to `[]` on any non-200 response, network error, timeout, or parse error.
 * @param {string} provider - Key into PROVIDER_FETCH_CONFIG
 * @param {string} key - API key
 * @returns {Promise<Array>} Normalized model rows, or [] on any failure
 */
function fetchViaConfig(provider, key) {
  const config = PROVIDER_FETCH_CONFIG[provider];
  const url = config.buildUrl ? config.buildUrl(key) : config.url;
  const headers = config.authHeader(key);

  return new Promise((resolve) => {
    let chunks = '';
    const timer = setTimeout(() => {
      req.destroy();
      resolve([]);
    }, FETCH_TIMEOUT_MS);

    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.on('data', () => {});
        res.on('end', () => resolve([]));
        return;
      }
      res.on('data', (chunk) => { chunks += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          resolve(config.normalize(chunks));
        } catch (_err) {
          resolve([]);
        }
      });
    });
    req.on('error', () => {
      clearTimeout(timer);
      resolve([]);
    });
  });
}

/** Providers to fetch: every keyed provider + openrouter (keyless-capable) + anthropic. */
function providersToFetch(keys) {
  const set = new Set(Object.keys(keys).filter(p => keys[p]));
  set.add('openrouter');
  set.add('anthropic');
  return Array.from(set);
}

/**
 * Fetch models from all providers that have keys configured; openrouter is
 * always included (keyless public endpoint) as is anthropic (hardcoded list).
 * @param {Object<string, string>} keys - Map of provider → API key string
 * @returns {Promise<Array<{id: string, name: string, contextLength: number|null, pricing: object|null}>>} Combined model list
 */
async function fetchAllModels(keys) {
  const providers = providersToFetch(keys);
  const results = await Promise.all(providers.map(p => fetchModelsFromProvider(p, keys[p] || '')));
  return results.flat();
}

/**
 * Group models by provider family for <optgroup> rendering
 * @param {Array<{id: string, name: string, contextLength: number|null, pricing: {prompt: string|null, completion: string|null}|null}>} models
 * @returns {Array<{family: string, models: Array<{id: string, name: string}>}>}
 */
function groupModelsByFamily(models) {
  if (models.length === 0) { return []; }

  const groups = new Map();

  for (const model of models) {
    const prefix = model.id.split('/')[0];
    const family = PROVIDER_FAMILY_NAMES[prefix] || prefix;
    if (!groups.has(family)) {
      groups.set(family, []);
    }
    groups.get(family).push(model);
  }

  return Array.from(groups.entries()).map(([family, familyModels]) => ({
    family,
    models: familyModels
  }));
}

module.exports = {
  fetchModelsFromProvider,
  fetchAllModels,
  providersToFetch,
  groupModelsByFamily,
  ANTHROPIC_MODELS,
  PROVIDER_FETCH_CONFIG,
  PROVIDER_FAMILY_NAMES
};
