// src/utils/local-providers.js
'use strict';

/**
 * @module local-providers
 * The merge layer beside the static provider-registry (v4.2 §4.1). Reads
 * user-defined OpenAI-compatible providers from config.providers, validates
 * and normalizes them. Forgiving: an invalid entry is skipped with a one-line
 * stderr warning, never fatal (config.js posture). Leaf-ish: only lazy-requires
 * ./config; NEVER requires provider-registry (no cycle, no static-table edits).
 */

// Mirrors PROVIDERS ids in provider-registry.js; duplicated (not imported) per the leaf-module rule — update both together.
const RESERVED_IDS = Object.freeze(['openrouter', 'google', 'openai', 'anthropic', 'deepseek']);
const VALID_FLAVORS = Object.freeze(['ollama', 'lmstudio', 'vllm', 'generic']);
const ID_RE = /^[a-z][a-z0-9_-]{1,31}$/;

/**
 * Preset id → partial entry (baseURL + flavor). ALL THREE carry a baseURL (D15):
 * vLLM's own default `vllm serve` port is 8000, so `--preset vllm` works alone;
 * `--url` overrides any preset for a non-default port or a remote host.
 * 127.0.0.1 never `localhost` (IPv6-first `::1` gotcha, spec §4.1/§4.10).
 */
const PRESETS = Object.freeze({
  ollama: { baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' },
  lmstudio: { baseURL: 'http://127.0.0.1:1234/v1', flavor: 'lmstudio' },
  vllm: { baseURL: 'http://127.0.0.1:8000/v1', flavor: 'vllm' },
});

/** `vllm-lab` → `VLLM_LAB_API_KEY`. @param {string} id @returns {string} */
function deriveKeyEnv(id) {
  return `${String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}

/** Absolute http:/https: only. @param {string} u @returns {boolean} */
function isAllowedUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch { return false; }
}

/**
 * Validate + normalize a provider entry (id-agnostic — id is checked at the map level).
 * @param {object} entry @returns {{ok:true, normalized:object}|{ok:false, error:string}}
 */
function validateProviderEntry(entry) {
  if (!entry || typeof entry !== 'object') { return { ok: false, error: 'entry must be an object' }; }
  if (entry.type !== 'openai-compatible') { return { ok: false, error: `unsupported type '${entry.type}'` }; }
  if (typeof entry.baseURL !== 'string' || !isAllowedUrl(entry.baseURL)) {
    return { ok: false, error: `baseURL must be an absolute http:/https: URL (got '${entry.baseURL}')` };
  }
  const flavor = entry.flavor === undefined ? 'generic' : entry.flavor;
  if (!VALID_FLAVORS.includes(flavor)) { return { ok: false, error: `invalid flavor '${entry.flavor}'` }; }
  let pricing = { prompt: 0, completion: 0 };
  if (entry.pricing !== undefined) {
    const p = entry.pricing;
    const prompt = Number(p && p.prompt);
    const completion = Number(p && p.completion);
    if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) {
      return { ok: false, error: 'pricing.prompt/completion must be non-negative numbers' };
    }
    pricing = { prompt, completion };
  }
  const normalized = {
    type: 'openai-compatible',
    baseURL: entry.baseURL,
    flavor,
    name: typeof entry.name === 'string' && entry.name ? entry.name : undefined,
    apiKeyEnv: typeof entry.apiKeyEnv === 'string' && entry.apiKeyEnv ? entry.apiKeyEnv : undefined,
    pricing,
  };
  return { ok: true, normalized };
}

/**
 * Validated, normalized local-provider map from config.providers.
 * Invalid/reserved/malformed-id entries are skipped with a stderr warning.
 * @returns {Object<string, object>} id → normalized entry (id stamped on; name defaulted to id)
 */
function getLocalProviders() {
  let config;
  try { config = require('./config').loadConfig(); } catch { config = null; }
  const raw = (config && config.providers && typeof config.providers === 'object') ? config.providers : {};
  const out = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!ID_RE.test(id) || RESERVED_IDS.includes(id)) {
      process.stderr.write(`Notice: skipping invalid provider id '${id}' in config.providers.\n`);
      continue;
    }
    const v = validateProviderEntry(entry);
    if (!v.ok) {
      process.stderr.write(`Notice: skipping provider '${id}' — ${v.error}.\n`);
      continue;
    }
    out[id] = { ...v.normalized, id, name: v.normalized.name || id };
  }
  return out;
}

/** @param {string} id @returns {boolean} */
function isLocalProvider(id) {
  return !!id && Object.prototype.hasOwnProperty.call(getLocalProviders(), id);
}

/**
 * v4.2: assemble the router's local inputs for one descriptor.
 * Lives here (not in route-launch.js) so route-launch stays under the 300-line gate.
 * `providers` is a PARAMETER, not a bare same-module `getLocalProviders()` call, so
 * callers/tests control the map (cf. B3: bare identifiers are unmockable via the exports object).
 * @returns {Promise<{localProviders?: Object, localLive?: Object}>} — `{}` for a non-local vendor.
 */
async function resolveLocalRouteInputs(descriptor, { validateModel, providers } = {}) {
  const all = providers || getLocalProviders();
  const vendor = descriptor && descriptor.vendor;
  const entry = vendor && all && Object.prototype.hasOwnProperty.call(all, vendor) ? all[vendor] : undefined;
  if (!entry) { return {}; }
  let bearer;
  if (entry.apiKeyEnv) {
    // Sole source: env-loader.js's loadCredentials() already projects every
    // configured apiKeyEnv from the .env into process.env at CLI bootstrap.
    // (B1, whole-branch review: do NOT add a readApiKeyValues()[vendor]
    // fallback here. That map is keyed only by the 5 static PROVIDER_ENV_MAP
    // vendor ids, so for a real local id the lookup is always an own-property
    // miss -- and for a local id colliding with an Object.prototype member
    // (e.g. 'constructor') it walks the prototype chain to a truthy inherited
    // value, fabricating a bearer and defeating gateway-router.js's
    // no_local_key check. Never use a bare `map[vendor]`-shaped lookup here.)
    bearer = process.env[entry.apiKeyEnv] || undefined;
  }
  const localProviders = { [vendor]: { ...entry, keyPresent: !!bearer } };
  const localLive = validateModel === false
    ? { status: 'skipped', models: [] }
    : await require('./local-probe').probeLocalProvider(entry, { timeoutMs: 2000, bearer });
  return { localProviders, localLive };
}

module.exports = {
  getLocalProviders, isLocalProvider, deriveKeyEnv, validateProviderEntry, resolveLocalRouteInputs,
  PRESETS, RESERVED_IDS, VALID_FLAVORS, ID_RE,
};
