'use strict';

/**
 * @module input-validators
 * MCP input validation with structured error responses.
 * Composes validators from validators.js for prompt/timeout/agent checks.
 * Model resolution/routing lives in mcp-server.js (#61 Task 6.2), not here.
 */

// Lazy require to avoid circular dependency (validators.js re-exports from here)
let _validators;
function getValidators() {
  if (!_validators) { _validators = require('./validators'); }
  return _validators;
}

/**
 * Validate sidecar_start inputs before session creation.
 * Composes existing validators for prompt/timeout/agent. Model resolution is
 * NOT this function's concern (#61 Task 6.2): it is routed separately by the
 * mcp-server.js amicus_start handler via resolveRouteForLaunch, so a routing
 * failure can be rendered as a structured `model_route_error` (parity with the
 * CLI's resolveLaunchModel) rather than the `validation_error` shape below.
 * @param {Object} input - Raw MCP tool input
 * @returns {{ valid: true } | { valid: false, error: Object }}
 */
function validateStartInputs(input) {
  // 1. Prompt
  const { validatePromptContent, validateHeadlessAgent } = getValidators();
  const promptResult = validatePromptContent(input.prompt);
  if (!promptResult.valid) {
    return {
      valid: false,
      error: {
        type: 'validation_error',
        field: 'prompt',
        message: promptResult.error,
      },
    };
  }

  // 2. Timeout: positive number, max 60 minutes
  if (input.timeout !== undefined) {
    const t = Number(input.timeout);
    if (isNaN(t) || t <= 0) {
      return {
        valid: false,
        error: {
          type: 'validation_error',
          field: 'timeout',
          message: `Timeout must be a positive number (minutes). Got: ${input.timeout}`,
        },
      };
    }
    if (t > 60) {
      return {
        valid: false,
        error: {
          type: 'validation_error',
          field: 'timeout',
          message: `Timeout cannot exceed 60 minutes. Got: ${t}`,
        },
      };
    }
  }

  // 3. Agent + headless compatibility
  // Note: MCP Zod schema defaults agent to 'Chat'. The handler auto-converts
  // Chat to Build for headless mode (line ~92 in mcp-server.js). Only reject
  // if the user explicitly set agent to Chat with noUi (not the Zod default).
  // We detect explicit by checking if agent was in the original input vs Zod default.
  // Since we can't distinguish here, skip validation for Chat+noUi -
  // the handler will convert it to Build before use.
  if (input.noUi && input.agent) {
    const lower = input.agent.toLowerCase();
    // Only reject chat if it's NOT the auto-convertible case
    // The handler converts chat -> build for headless, so we allow it
    if (lower !== 'chat') {
      const agentResult = validateHeadlessAgent(input.agent);
      if (!agentResult.valid) {
        return {
          valid: false,
          error: {
            type: 'validation_error',
            field: 'agent',
            message: agentResult.error,
            suggestions: ['Build', 'Plan'],
          },
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Levenshtein edit distance between two strings (insertions, deletions,
 * substitutions, each cost 1). Hand-rolled — no runtime dependency added,
 * since fast-levenshtein is only a dev-time transitive and runtime deps are
 * locked for this project.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) { return n; }
  if (n === 0) { return m; }

  // Single rolling row (O(min(m,n)) space) rather than a full m×n matrix —
  // plenty for CLI command names, which are always short.
  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const currRow = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,      // deletion
        currRow[j - 1] + 1,  // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    prevRow = currRow;
  }
  return prevRow[n];
}

/**
 * Suggest known commands close to an unrecognized one ("did you mean").
 * @param {string} input - the unrecognized token the user typed
 * @param {string[]} candidates - known command names
 * @param {number} [maxDistance=2] - inclusive distance cap
 * @param {number} [maxSuggestions=3]
 * @returns {string[]} candidates within maxDistance, closest first, capped
 */
function suggestCommand(input, candidates, maxDistance = 2, maxSuggestions = 3) {
  if (!input) { return []; }
  return candidates
    .map(c => ({ c, distance: levenshteinDistance(input.toLowerCase(), c.toLowerCase()) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxSuggestions)
    .map(({ c }) => c);
}

module.exports = { validateStartInputs, levenshteinDistance, suggestCommand };
