/** Family definitions + pinned fallbacks for the wizard model picker (v2). */
/*
 * Families are MATCH RULES over the live catalog, not pinned truths:
 * src/utils/quick-picks.js resolves each family to the current catalog
 * flagship at setup time. The pinned `fallback` ids are used only when
 * the catalog cannot resolve a route (offline / unkeyed provider) and to
 * derive the static DEFAULT_ALIASES (runtime alias resolution must never
 * wait on the network). `amicus models --check` audits every pinned route
 * here against the live catalog AND warns when a fallback falls behind
 * the live resolution.
 */

'use strict';

const { isDirectProvider } = require('./provider-registry');

/**
 * Wizard quick-pick families. `idPattern` matches the model segment after
 * `<vendorPath>/` (openrouter ns) or `<provider>/` (direct ns).
 * `directProviders` lists direct namespaces the quick-picks resolver may
 * resolve live from the catalog. A per-provider `fallback` entry is
 * OPTIONAL: when absent and the catalog cannot resolve that namespace,
 * the direct route is omitted (no pinned guess is better than a wrong one).
 * `gpt`'s pattern intentionally matches any plain numeric flagship id
 * (gpt-5.5, gpt-6) and excludes suffixed variants (-pro/-mini/-codex).
 * Pinned ids verified against the live catalog 2026-06-24.
 */
const FAMILIES = [
  { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
    vendorPath: 'google',
    idPattern: /^gemini-[\d.]+-flash(-preview|-exp|-latest)?$/,
    directProviders: ['google'],
    fallback: { openrouter: 'openrouter/google/gemini-3.5-flash',
                google: 'google/gemini-3.5-flash' } },
  { alias: 'gemini-pro', label: 'Gemini Pro-class', blurb: 'advanced reasoning',
    vendorPath: 'google',
    idPattern: /^gemini-[\d.]+-pro(-preview|-exp|-latest)?$/,
    directProviders: ['google'],
    fallback: { openrouter: 'openrouter/google/gemini-3.1-pro-preview' } },
  { alias: 'gpt', label: 'GPT flagship', blurb: 'strong coding',
    vendorPath: 'openai',
    idPattern: /^gpt-[\d.]+$/,
    directProviders: ['openai'],
    fallback: { openrouter: 'openrouter/openai/gpt-5.5' } },
  { alias: 'opus', label: 'Claude Opus-class', blurb: 'deep analysis',
    vendorPath: 'anthropic',
    idPattern: /^claude-opus-[\d.-]+$/,
    directProviders: ['anthropic'],
    fallback: { openrouter: 'openrouter/anthropic/claude-opus-4.8',
                anthropic: 'anthropic/claude-opus-4-6' } },
  { alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
    vendorPath: 'deepseek',
    idPattern: /^deepseek-v[\d.]+(-pro)?$/,
    directProviders: ['deepseek'],
    fallback: { openrouter: 'openrouter/deepseek/deepseek-v4-pro',
                deepseek: 'deepseek/deepseek-v4-pro' } },
];

/**
 * Alias-only entries (no wizard quick pick); openrouter route only.
 * Refreshed against the live catalog 2026-06-11.
 */
const CARDLESS = [
  { alias: 'gpt-pro', routes: { openrouter: 'openrouter/openai/gpt-5.5-pro' } },
  // codex: newest codex-specific model on OpenRouter (verified 2026-06-09).
  { alias: 'codex', routes: { openrouter: 'openrouter/openai/gpt-5.3-codex' } },
  { alias: 'claude', routes: { openrouter: 'openrouter/anthropic/claude-sonnet-4.6' } },
  { alias: 'sonnet', routes: { openrouter: 'openrouter/anthropic/claude-sonnet-4.6' } },
  { alias: 'haiku', routes: { openrouter: 'openrouter/anthropic/claude-haiku-4.5' } },
  { alias: 'qwen', routes: { openrouter: 'openrouter/qwen/qwen3.7-max' } },
  { alias: 'qwen-coder', routes: { openrouter: 'openrouter/qwen/qwen3-coder-next' } },
  { alias: 'qwen-flash', routes: { openrouter: 'openrouter/qwen/qwen3.6-flash' } },
  { alias: 'mistral', routes: { openrouter: 'openrouter/mistralai/mistral-medium-3-5' } },
  { alias: 'devstral', routes: { openrouter: 'openrouter/mistralai/devstral-2512' } },
  { alias: 'glm', routes: { openrouter: 'openrouter/z-ai/glm-5.1' } },
  { alias: 'minimax', routes: { openrouter: 'openrouter/minimax/minimax-m2.7' } },
  { alias: 'grok', routes: { openrouter: 'openrouter/x-ai/grok-4.3' } },
  { alias: 'kimi', routes: { openrouter: 'openrouter/moonshotai/kimi-k2.6' } },
  { alias: 'seed', routes: { openrouter: 'openrouter/bytedance-seed/seed-2.0-lite' } },
];

/**
 * @returns {Array} shallow-spread copies of the family definitions;
 * `idPattern` is intentionally a shared RegExp reference — safe because
 * none use the g/y flags (no lastIndex state) and callers treat it read-only.
 */
function getFamilies() {
  return FAMILIES.map(f => ({
    ...f,
    directProviders: [...f.directProviders],
    fallback: { ...f.fallback },
  }));
}

/**
 * Direct-first canonicalization for a pinned `openrouter/<vendor>/<rest>`
 * route: when `<vendor>` has a direct integration (provider-registry
 * `isDirectProvider`), strip the `openrouter/` prefix so the resulting bare
 * `<vendor>/<rest>` id is policy-routed by the gateway router (direct when a
 * direct key exists, OpenRouter otherwise). Gateway-only vendors (no direct
 * integration — e.g. qwen, x-ai, z-ai, mistralai, minimax, moonshotai,
 * bytedance-seed) are returned unchanged, since OpenRouter is their only
 * route anyway. Non-openrouter routes (already bare, or malformed) pass
 * through unchanged.
 * @param {string} route
 * @returns {string}
 */
function toCanonicalDefault(route) {
  if (typeof route === 'string' && route.startsWith('openrouter/')) {
    const rest = route.slice('openrouter/'.length); // '<vendor>/<rest...>'
    const slashIdx = rest.indexOf('/');
    const vendor = slashIdx > 0 ? rest.slice(0, slashIdx) : null;
    if (vendor && isDirectProvider(vendor)) { return rest; }
  }
  return route;
}

/**
 * @returns {Object<string,string>} alias → pinned route, direct-first for
 * direct-capable vendors (bare `vendor/model`), openrouter-prefixed for
 * gateway-only vendors. STATIC — runtime-safe.
 */
function toDefaultAliases() {
  const out = {};
  for (const f of FAMILIES) {
    const route = f.fallback.openrouter || Object.values(f.fallback)[0];
    out[f.alias] = toCanonicalDefault(route);
  }
  for (const e of CARDLESS) {
    const route = e.routes.openrouter || Object.values(e.routes)[0];
    out[e.alias] = toCanonicalDefault(route);
  }
  return out;
}

/**
 * @returns {Array<{alias,provider,model}>} every pinned route, flattened (for the alias audit).
 */
function listCuratedRoutes() {
  const out = [];
  for (const f of FAMILIES) {
    for (const [provider, model] of Object.entries(f.fallback)) {
      out.push({ alias: f.alias, provider, model });
    }
  }
  for (const e of CARDLESS) {
    for (const [provider, model] of Object.entries(e.routes)) {
      out.push({ alias: e.alias, provider, model });
    }
  }
  return out;
}

module.exports = { getFamilies, toDefaultAliases, listCuratedRoutes };
