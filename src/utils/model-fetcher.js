/**
 * Model Fetcher
 *
 * Fetches available model lists from provider APIs for the dropdown selector.
 * Uses the same HTTPS pattern as api-key-store.js validateApiKey().
 */

const { httpGetText } = require('./http-get');

/**
 * Hardcoded Anthropic floor: the anthropic/ rows a KEYLESS user (or a
 * failed live fetch) gets. Every id here must be one the direct API
 * GENUINELY serves — classifyModel() returns 'valid' on a floor HIT before
 * it ever checks `authoritative`, so a speculative row would mislabel a
 * dead direct-API request as valid. (fable joined 2026-08-05 after live
 * verification — /v1/models lists claude-fable-5 and a direct smoke leg
 * served; v4.6.3 spec §3.)
 */
const ANTHROPIC_MODELS = [
  { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', contextLength: null, pricing: null },
  { id: 'anthropic/claude-opus-4-8', name: 'Claude Opus 4.8', contextLength: null, pricing: null },
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', contextLength: null, pricing: null },
  { id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', contextLength: null, pricing: null },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', contextLength: null, pricing: null },
  // Dated snapshot: the id Anthropic's /v1/models actually lists, and the
  // `haiku` direct route curated-models.js authors. Without it the floor
  // (the only anthropic/ rows a keyless or OpenRouter-only user ever has)
  // reports the shipped `haiku` default as stale.
  { id: 'anthropic/claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (2025-10-01)',
    contextLength: null, pricing: null },
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextLength: null, pricing: null }
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
        // #218: real output ceiling (411/417 rows); clamps outputBudget -- see utils/model-output-limit.js.
        maxOutputTokens: (m.top_provider && m.top_provider.max_completion_tokens) ?? null,
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
    // Floor-fallback rows are tagged authoritative:false (#61 4.3) so classifyModel
    // never hard-blocks a miss against a stale/hardcoded list -- it returns
    // 'unknown' instead. Rows from a successful live fetch are NOT tagged (they
    // are authoritative). Map to new objects; never mutate ANTHROPIC_MODELS in place.
    if (!key) { return Promise.resolve(ANTHROPIC_MODELS.map(r => ({ ...r, authoritative: false }))); }
    return fetchViaConfig('anthropic', key).then(rows =>
      (rows.length > 0 ? rows : ANTHROPIC_MODELS.map(r => ({ ...r, authoritative: false }))));
  }

  const config = PROVIDER_FETCH_CONFIG[provider];
  if (!config) {
    return Promise.resolve([]);
  }

  return fetchViaConfig(provider, key);
}

/**
 * Perform the HTTPS fetch + normalize for a single configured provider,
 * REPORTING why it failed (issue #209). The four failure modes used to
 * collapse to a bare `[]`, which made a rejected fetch indistinguishable from
 * a provider that legitimately serves no models -- and that ambiguity is what
 * lets `classifyModel` return 'unknown' for a namespace whose fetch was
 * actually refused (see #208).
 * @param {string} provider - Key into PROVIDER_FETCH_CONFIG
 * @param {string} key - API key
 * @returns {Promise<{rows: Array, failure: {reason: string, status?: number, detail?: string}|null}>}
 */
async function fetchViaConfigDetailed(provider, key) {
  const config = PROVIDER_FETCH_CONFIG[provider];
  const url = config.buildUrl ? config.buildUrl(key) : config.url;
  const res = await httpGetText(url, { headers: config.authHeader(key), timeoutMs: FETCH_TIMEOUT_MS });
  if (!res.ok) { return { rows: [], failure: res.failure }; }
  try {
    return { rows: config.normalize(res.body), failure: null };
  } catch (err) {
    return { rows: [], failure: { reason: 'parse-error', detail: err.message } };
  }
}

/**
 * Rows-only view of `fetchViaConfigDetailed`, preserving the historical
 * contract (`[]` on any failure) for existing callers.
 * @param {string} provider @param {string} key @returns {Promise<Array>}
 */
function fetchViaConfig(provider, key) {
  return fetchViaConfigDetailed(provider, key).then(r => r.rows);
}

/**
 * Per-provider fetch WITH failure reporting. Mirrors
 * `fetchModelsFromProvider`'s special cases exactly:
 *  - anthropic without a key: the hardcoded floor, no network, NOT a failure.
 *  - anthropic with a key that yields nothing: floor rows, failure reported.
 *  - unknown provider: no rows, not a failure (nothing was attempted).
 * @param {string} provider @param {string} key
 * @returns {Promise<{rows: Array, failure: object|null}>}
 */
function fetchModelsFromProviderDetailed(provider, key) {
  const floor = () => ANTHROPIC_MODELS.map(r => ({ ...r, authoritative: false }));
  if (provider === 'anthropic') {
    if (!key) { return Promise.resolve({ rows: floor(), failure: null }); }
    return fetchViaConfigDetailed('anthropic', key).then(({ rows, failure }) =>
      (rows.length > 0 ? { rows, failure: null } : { rows: floor(), failure }));
  }
  const config = PROVIDER_FETCH_CONFIG[provider];
  if (!config) { return Promise.resolve({ rows: [], failure: null }); }
  return fetchViaConfigDetailed(provider, key);
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
 * @returns {Promise<{rows: Array, failures: Array<{provider: string, reason: string, status?: number, detail?: string}>}>}
 */
async function fetchAllModelsDetailed(keys) {
  const providers = providersToFetch(keys);
  const results = await Promise.all(providers.map(p =>
    fetchModelsFromProviderDetailed(p, keys[p] || '').then(r => ({ provider: p, ...r }))));
  const rows = results.flatMap(r => r.rows);
  const failures = results
    .filter(r => r.failure)
    .map(r => ({ provider: r.provider, ...r.failure }));
  // v4.2 §4.4: append local-provider rows via the scheme-aware probe (5s, [] on failure).
  try {
    const { getLocalProviders } = require('./local-providers');
    const { listLocalModels } = require('./local-probe');
    const localEntries = Object.values(getLocalProviders());
    const localResults = await Promise.all(localEntries.map((e) =>
      listLocalModels(e, { timeoutMs: 5000, bearer: e.apiKeyEnv ? process.env[e.apiKeyEnv] : undefined })));
    for (const r of localResults) { rows.push(...r); }
  } catch (_err) { /* local rows are best-effort — never break the cloud catalog */ }
  return { rows, failures };
}

/**
 * Rows-only view of `fetchAllModelsDetailed` — the historical signature, kept
 * so existing callers and their tests are unaffected.
 * @param {Object<string, string>} keys
 * @returns {Promise<Array>} Combined model list
 */
async function fetchAllModels(keys) {
  return (await fetchAllModelsDetailed(keys)).rows;
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
  fetchAllModelsDetailed,
  fetchModelsFromProviderDetailed,
  providersToFetch,
  groupModelsByFamily,
  ANTHROPIC_MODELS,
  PROVIDER_FETCH_CONFIG,
  PROVIDER_FAMILY_NAMES
};
