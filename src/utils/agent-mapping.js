/**
 * Agent Mapping Module
 *
 * Maps agent names to OpenCode's native agent framework.
 *
 * OpenCode Native Agents (https://opencode.ai/docs/agents/):
 *   - Chat: Reads auto, writes/bash ask permission (interactive default)
 *   - Build: Default primary agent with full tool access
 *   - Plan: Analysis and planning without edits (reads, searches and shell allowed)
 *   - General: Full-access agent for research
 *   - Explore: Read-only agent for codebase exploration
 *
 * Custom agents defined in ~/.config/opencode/agents/ or .opencode/agents/
 * are passed through directly to OpenCode.
 */

/**
 * OpenCode's primary agent names (for main sessions)
 * Note: OpenCode API expects lowercase agent names
 * 'chat' is a custom sidecar agent: reads auto, writes/bash ask. When client=cowork, gets a general-purpose prompt.
 */
const PRIMARY_AGENTS = ['chat', 'build', 'plan'];

/**
 * All OpenCode native agent names (lowercase)
 */
const OPENCODE_AGENTS = [...PRIMARY_AGENTS, 'general', 'explore'];

/**
 * Agents safe for headless (--no-ui) mode.
 * 'chat' requires user permission for writes/bash and stalls in headless.
 */
const HEADLESS_SAFE_AGENTS = ['build', 'plan', 'explore', 'general'];

/**
 * Map an agent name to OpenCode native agent configuration
 *
 * @param {string} agent - Agent name (OpenCode native or custom)
 * @returns {{agent: string}} OpenCode agent configuration
 *
 * @example
 * mapAgentToOpenCode('Build')   // { agent: 'build' }
 * mapAgentToOpenCode('Plan')    // { agent: 'plan' }
 * mapAgentToOpenCode('custom')  // { agent: 'custom' }
 */
function mapAgentToOpenCode(agent) {
  // Handle undefined/null/empty - default to chat (reads auto, writes ask)
  if (!agent || (typeof agent === 'string' && agent.trim() === '')) {
    return { agent: 'chat' };
  }

  // Normalize for case-insensitive matching of native agents
  const normalized = agent.toLowerCase();

  // Check if it's an OpenCode native agent (case-insensitive match)
  const nativeMatch = OPENCODE_AGENTS.find(
    native => native === normalized
  );
  if (nativeMatch) {
    return { agent: nativeMatch };
  }

  // Pass through custom agent names as lowercase (OpenCode API expects lowercase)
  return { agent: normalized };
}

/**
 * Check if an agent is safe for headless (--no-ui) mode
 *
 * @param {string} agent - Agent name to check
 * @returns {boolean|null} true if safe, false if unsafe (chat), null if unknown/custom
 */
function isHeadlessSafe(agent) {
  if (!agent || (typeof agent === 'string' && agent.trim() === '')) {
    return null;
  }

  const normalized = agent.toLowerCase();

  if (HEADLESS_SAFE_AGENTS.includes(normalized)) {
    return true;
  }

  if (normalized === 'chat') {
    return false;
  }

  // Unknown/custom agents — we can't determine safety
  return null;
}

/**
 * Check if an agent name is valid for primary sessions
 *
 * @param {string} agent - Agent name to validate
 * @returns {boolean} True if valid primary agent or custom agent
 */
function isValidPrimaryAgent(agent) {
  if (!isValidAgent(agent)) {
    return false;
  }

  // All non-empty strings are valid (custom agents allowed)
  return true;
}

/**
 * Check if an agent name is valid (non-empty string)
 *
 * All non-empty agent names are considered valid because:
 * 1. OpenCode native agents (Build, Plan, General, Explore) are always valid
 * 2. Custom agents defined in user's agent directory should be allowed
 *    (OpenCode will validate at runtime)
 *
 * @param {string} agent - Agent name to validate
 * @returns {boolean} True if valid (non-empty string)
 */
function isValidAgent(agent) {
  if (agent === null || agent === undefined) {
    return false;
  }

  if (typeof agent !== 'string') {
    return false;
  }

  return agent.trim().length > 0;
}

module.exports = {
  PRIMARY_AGENTS,
  OPENCODE_AGENTS,
  HEADLESS_SAFE_AGENTS,
  mapAgentToOpenCode,
  isValidAgent,
  isHeadlessSafe,
  isValidPrimaryAgent
};
