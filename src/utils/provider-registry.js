/**
 * Provider-capability registry — the single source of truth for provider
 * identity, credentials, direct-vs-gateway role, and display names.
 * The historical maps (PROVIDER_ENV_MAP, PROVIDER_KEY_MAP, KNOWN_PROVIDERS,
 * PROVIDER_FAMILY_NAMES) are DERIVED from PROVIDERS below so they can never
 * drift apart again. Leaf module: requires nothing internal (no circular deps).
 */
'use strict';

/**
 * @typedef {Object} ProviderDescriptor
 * @property {string} id            provider id (namespace)
 * @property {string} envVar        env var holding the key
 * @property {string} keyDisplayName human name used in missing-key errors
 * @property {string} familyName    short name used for optgroup grouping
 * @property {boolean} direct        can be a DIRECT route target (false for the gateway)
 * @property {boolean} gateway       is the OpenRouter gateway itself
 * @property {boolean} hasLiveFetch  has a live GET /models endpoint
 * @property {string} authJsonKey    key used in OpenCode auth.json
 */

/** @type {ProviderDescriptor[]} */
const PROVIDERS = [
  { id: 'openrouter', envVar: 'OPENROUTER_API_KEY',            keyDisplayName: 'OpenRouter',    familyName: 'OpenRouter', direct: false, gateway: true,  hasLiveFetch: true,  authJsonKey: 'openrouter' },
  { id: 'google',     envVar: 'GOOGLE_GENERATIVE_AI_API_KEY', keyDisplayName: 'Google Gemini', familyName: 'Google',     direct: true,  gateway: false, hasLiveFetch: true,  authJsonKey: 'google' },
  { id: 'openai',     envVar: 'OPENAI_API_KEY',               keyDisplayName: 'OpenAI',        familyName: 'OpenAI',     direct: true,  gateway: false, hasLiveFetch: true,  authJsonKey: 'openai' },
  { id: 'anthropic',  envVar: 'ANTHROPIC_API_KEY',            keyDisplayName: 'Anthropic',     familyName: 'Anthropic',  direct: true,  gateway: false, hasLiveFetch: true,  authJsonKey: 'anthropic' },
  { id: 'deepseek',   envVar: 'DEEPSEEK_API_KEY',             keyDisplayName: 'DeepSeek',      familyName: 'DeepSeek',   direct: true,  gateway: false, hasLiveFetch: true,  authJsonKey: 'deepseek' },
];

const _byId = new Map(PROVIDERS.map(p => [p.id, p]));

/** @param {string} id @returns {ProviderDescriptor|undefined} */
function getProvider(id) { return _byId.get(id); }

/** @param {string} id @returns {boolean} true only for direct-route vendors (never the gateway) */
function isDirectProvider(id) { const p = _byId.get(id); return !!p && p.direct; }

/** @returns {string[]} ids of direct-route vendors (excludes openrouter) */
function listDirectProviders() { return PROVIDERS.filter(p => p.direct).map(p => p.id); }

// --- Derived compatibility maps (do not hand-edit; edit PROVIDERS above) ---
const PROVIDER_ENV_MAP = Object.fromEntries(PROVIDERS.map(p => [p.id, p.envVar]));
const PROVIDER_KEY_MAP = Object.fromEntries(PROVIDERS.map(p => [p.id, { key: p.envVar, name: p.keyDisplayName }]));
const KNOWN_PROVIDERS = PROVIDERS.map(p => p.id);
const PROVIDER_FAMILY_NAMES = Object.fromEntries(PROVIDERS.map(p => [p.id, p.familyName]));

module.exports = {
  PROVIDERS,
  getProvider,
  isDirectProvider,
  listDirectProviders,
  PROVIDER_ENV_MAP,
  PROVIDER_KEY_MAP,
  KNOWN_PROVIDERS,
  PROVIDER_FAMILY_NAMES,
};
