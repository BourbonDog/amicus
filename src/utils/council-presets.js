/**
 * Built-in council benches (B23).
 *
 * `resolveCouncilMembers` (src/utils/config.js) consults this table ONLY when
 * the requested name is absent from user config (`config.councils`) — user
 * config always shadows a built-in of the same name. This preserves today's
 * behavior for the wizard-seeded `councils.free` (src/sidecar/setup.js
 * seedFreeCouncil): once seeded, the user's `free` list wins over the
 * built-in dynamic free bench below.
 *
 * Two shapes:
 *   - 'free' is DYNAMIC: resolved at use time from the live catalog via
 *     suggestFreeCouncil (one :free model per vendor), falling back to the
 *     offline PINNED_FREE_MODELS when the catalog has no free rows. This
 *     mirrors the wizard's own free-council derivation so the built-in and
 *     the wizard-seeded version pick the same kind of members.
 *   - 'budget' and 'frontier' are STATIC: three DEFAULT_ALIASES entries
 *     (src/utils/curated-models.js) each, chosen by catalog pricing at
 *     implementation time (see docs/CHANGELOG or the task report for the
 *     pricing evidence). Alias-based so `amicus models --check` drift
 *     tooling and normal alias resolution keep them healthy for free —
 *     no raw model ids are hardcoded here.
 */
'use strict';

const { suggestFreeCouncil, PINNED_FREE_MODELS } = require('./free-models');

/**
 * Budget bench: three cheapest DEFAULT_ALIASES entries, one per vendor
 * family, verified against the cached catalog (~/.config/amicus/model-catalog.json)
 * on 2026-07-02 (prices are $/token, prompt+completion):
 *   minimax     openrouter/minimax/minimax-m2.7      $0.00000018 / $0.00000072
 *   qwen-coder  openrouter/qwen/qwen3-coder-next     $0.00000011 / $0.0000008
 *   deepseek    openrouter/deepseek/deepseek-v4-pro  $0.000000435 / $0.00000087
 * These are the three lowest total (prompt+completion) prices in
 * DEFAULT_ALIASES, and each is a distinct vendor family (MiniMax / Qwen /
 * DeepSeek) — the qwen-flash entry (also cheap) was skipped to keep vendor
 * diversity across the bench.
 */
const BUDGET_ALIASES = ['minimax', 'qwen-coder', 'deepseek'];

/**
 * Frontier bench: three premium-flagship DEFAULT_ALIASES entries, one per
 * vendor family, verified against the same catalog snapshot:
 *   gpt-pro     openrouter/openai/gpt-5.5-pro          $0.00003 / $0.00018
 *   opus        openrouter/anthropic/claude-opus-5     $0.000005 / $0.000025
 *   gemini-pro  openrouter/google/gemini-3.1-pro-preview  $0.000002 / $0.000012
 * These are the three highest total (prompt+completion) prices in
 * DEFAULT_ALIASES that are also each a distinct vendor family (OpenAI /
 * Anthropic / Google) — `gpt` and `codex` (also OpenAI) and `claude`/`sonnet`
 * (also Anthropic) were skipped as same-family duplicates of the pick above.
 * (opus re-pinned to claude-opus-5 on 2026-08-04 at the same live price, so
 * the selection evidence above is unchanged.)
 */
const FRONTIER_ALIASES = ['gpt-pro', 'opus', 'gemini-pro'];

/**
 * @param {Array} catalog live model-catalog rows (for the dynamic free bench)
 * @returns {string[]} council members (aliases or full ids), possibly empty
 */
function resolveFreeBench(catalog) {
  const picks = suggestFreeCouncil(Array.isArray(catalog) ? catalog : []);
  if (picks.length > 0) { return picks.map(p => p.id); }
  return [...PINNED_FREE_MODELS];
}

/**
 * @param {string} name
 * @param {Array} [catalog] live model-catalog rows, needed only for 'free'
 * @returns {string[]|null} resolved built-in members, or null if `name` is not a built-in
 */
function resolveBuiltinCouncil(name, catalog = []) {
  if (name === 'free') { return resolveFreeBench(catalog); }
  if (name === 'budget') { return [...BUDGET_ALIASES]; }
  if (name === 'frontier') { return [...FRONTIER_ALIASES]; }
  return null;
}

/** @returns {string[]} built-in bench names, in resolution-doc order */
function listBuiltinCouncilNames() {
  return ['free', 'budget', 'frontier'];
}

module.exports = {
  BUDGET_ALIASES,
  FRONTIER_ALIASES,
  resolveBuiltinCouncil,
  listBuiltinCouncilNames,
};
