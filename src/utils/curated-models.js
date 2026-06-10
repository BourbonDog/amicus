/**
 * Curated Models — THE single source of truth for default model lists.
 *
 * Three consumers derive from this module (F5 anti-drift):
 *   - src/utils/config.js DEFAULT_ALIASES   (toDefaultAliases)
 *   - electron/setup-ui-model.js MODEL_CHOICES (getCuratedModels)
 *   - src/sidecar/setup.js MODEL_CHOICES      (getCuratedModels)
 * Never hand-edit a model id anywhere else. `amicus models --check`
 * audits every route here against the live catalog.
 */

'use strict';

/**
 * Card entries (shown as wizard quick picks). `routes` maps provider →
 * full model id; the openrouter route doubles as the default alias target.
 * Direct (non-openrouter) route ids MUST be verified against the provider
 * whenever they change.
 */
const CARDS = [
  { alias: 'gemini', label: 'Gemini 3.1 Flash Lite', blurb: 'fast, large context',
    routes: { openrouter: 'openrouter/google/gemini-3.1-flash-lite-preview',
              google: 'google/gemini-3.1-flash-lite-preview' } },
  { alias: 'gemini-pro', label: 'Gemini 3.1 Pro', blurb: 'advanced reasoning',
    routes: { openrouter: 'openrouter/google/gemini-3.1-pro-preview',
              google: 'google/gemini-3.1-pro-preview' } },
  { alias: 'gpt', label: 'GPT-5.4', blurb: 'strong coding',
    routes: { openrouter: 'openrouter/openai/gpt-5.4',
              openai: 'openai/gpt-5.4' } },
  { alias: 'opus', label: 'Claude Opus 4.6', blurb: 'deep analysis',
    routes: { openrouter: 'openrouter/anthropic/claude-opus-4.6',
              anthropic: 'anthropic/claude-opus-4-6' } },
  { alias: 'deepseek', label: 'DeepSeek v3.2', blurb: 'open-source',
    routes: { openrouter: 'openrouter/deepseek/deepseek-v3.2' } },
];

/** Alias-only entries (no wizard card); openrouter route only. */
const CARDLESS = [
  { alias: 'gpt-pro', routes: { openrouter: 'openrouter/openai/gpt-5.4-pro' } },
  // codex: newest codex-specific model on OpenRouter (verified 2026-06-09).
  { alias: 'codex', routes: { openrouter: 'openrouter/openai/gpt-5.3-codex' } },
  { alias: 'claude', routes: { openrouter: 'openrouter/anthropic/claude-sonnet-4.6' } },
  { alias: 'sonnet', routes: { openrouter: 'openrouter/anthropic/claude-sonnet-4.6' } },
  { alias: 'haiku', routes: { openrouter: 'openrouter/anthropic/claude-haiku-4.5' } },
  { alias: 'qwen', routes: { openrouter: 'openrouter/qwen/qwen3.5-397b-a17b' } },
  { alias: 'qwen-coder', routes: { openrouter: 'openrouter/qwen/qwen3-coder-next' } },
  { alias: 'qwen-flash', routes: { openrouter: 'openrouter/qwen/qwen3.5-flash-02-23' } },
  { alias: 'mistral', routes: { openrouter: 'openrouter/mistralai/mistral-large-2512' } },
  { alias: 'devstral', routes: { openrouter: 'openrouter/mistralai/devstral-2512' } },
  { alias: 'glm', routes: { openrouter: 'openrouter/z-ai/glm-5' } },
  { alias: 'minimax', routes: { openrouter: 'openrouter/minimax/minimax-m2.5' } },
  { alias: 'grok', routes: { openrouter: 'openrouter/x-ai/grok-4.3' } },
  { alias: 'kimi', routes: { openrouter: 'openrouter/moonshotai/kimi-k2.5' } },
  { alias: 'seed', routes: { openrouter: 'openrouter/bytedance-seed/seed-2.0-mini' } },
];

/** @returns {Array<{alias,label,blurb,routes}>} card entries (wizard quick picks) */
function getCuratedModels() {
  return CARDS.map(c => ({ ...c, routes: { ...c.routes } }));
}

/** @returns {Object<string,string>} alias → preferred route (openrouter first) */
function toDefaultAliases() {
  const out = {};
  for (const e of [...CARDS, ...CARDLESS]) {
    out[e.alias] = e.routes.openrouter || Object.values(e.routes)[0];
  }
  return out;
}

/** @returns {Array<{alias,provider,model}>} every route of every entry, flattened */
function listCuratedRoutes() {
  const out = [];
  for (const e of [...CARDS, ...CARDLESS]) {
    for (const [provider, model] of Object.entries(e.routes)) {
      out.push({ alias: e.alias, provider, model });
    }
  }
  return out;
}

module.exports = { getCuratedModels, toDefaultAliases, listCuratedRoutes };
