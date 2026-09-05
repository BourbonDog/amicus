/**
 * Shared fixture: the real 25-alias config from issue #213's evidence table.
 *
 * 13 of these names appear in the deleted ALIAS_GROUPS whitelist; the other 12
 * did not, and rendered NOWHERE before the vendor-derived grouping landed.
 * Kept in its own module so the grouping tests and any future measurement of
 * the same regression share one input rather than two drifting copies.
 */

/** @type {Object<string,string>} */
const ALIASES_25 = {
  // --- the 13 the old name whitelist happened to cover ---
  'gemini': 'google/gemini-3.6-flash',
  'gemini-pro': 'google/gemini-3.1-pro-preview',
  'gpt': 'openai/gpt-5.6-terra',
  'gpt-pro': 'openai/gpt-5.6-sol-pro',
  'claude': 'anthropic/claude-sonnet-5',
  'fable': 'anthropic/claude-fable-5',
  'deepseek': 'deepseek/deepseek-v4-pro',
  'qwen': 'openrouter/qwen/qwen3.8-max-0902',
  'qwen-flash': 'openrouter/qwen/qwen3.6-flash',
  'minimax': 'openrouter/minimax/minimax-m2.7',
  'grok': 'openrouter/x-ai/grok-4.3',
  'kimi': 'openrouter/moonshotai/kimi-k3',
  'seed': 'openrouter/bytedance-seed/seed-2.0-lite',
  // --- the 12 issue #213 measured as DROPPED (invisible, uneditable) ---
  'GLM': 'openrouter/z-ai/glm-5.2',                   // case variant of 'glm'
  'Inkling': 'openrouter/thinkingmachines/inkling',   // case variant of 'inkling'
  'Venice': 'openrouter/cognitivecomputations/dolphin-mistral-24b-venice-edition',
  'openai': 'openai/gpt-5.6-terra',
  'google': 'google/gemini-3.7-flash',
  'anthropic': 'anthropic/claude-sonnet-5',
  'devstral': 'openrouter/mistralai/voxtral-small-24b-2507',
  'lmstudio': 'lmstudio/qwen2.5-coder-7b-instruct',   // local provider, no gateway prefix
  'free-cohere-north-mini-code': 'openrouter/cohere/north-mini-code:free',
  'free-google-gemma-4-31b-it': 'openrouter/google/gemma-4-31b-it:free',
  'free-inclusionai-ling-3.0-flash': 'openrouter/inclusionai/ling-3.0-flash:free',
  'free-nvidia-nemotron-3-nano-omni-30b-a3b-reasoning':
    'openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
};

/** The 12 names issue #213's evidence table lists as rendering nowhere. */
const DROPPED_BY_WHITELIST = [
  'GLM', 'Venice', 'openai', 'lmstudio',
  'free-cohere-north-mini-code', 'free-google-gemma-4-31b-it',
  'free-inclusionai-ling-3.0-flash',
  'free-nvidia-nemotron-3-nano-omni-30b-a3b-reasoning',
  'devstral', 'Inkling', 'google', 'anthropic',
];

module.exports = { ALIASES_25, DROPPED_BY_WHITELIST };
