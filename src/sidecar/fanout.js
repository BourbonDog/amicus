// src/sidecar/fanout.js
'use strict';

/**
 * @module fanout
 * F4 council-native fan-out: run N models on the same prompt concurrently on
 * ONE shared OpenCode server (runHeadless external-server mode). Each leg is
 * an ordinary session (parentWave metadata); results aggregate into a wave
 * document persisted as wave.json in the wave session dir.
 * Spec: docs/superpowers/specs/2026-06-09-f4-fanout-json-design.md
 *
 * NOTE: fs, path, and logger are used by the Task 7 orchestrator half.
 * Add those imports when implementing runFanout() in Task 7.
 */

/** Default max legs per wave (env-overridable). */
const DEFAULT_MAX_LEGS = 10;

/**
 * Split a --models value into trimmed, non-empty entries (duplicates allowed).
 * @param {string|boolean|undefined} modelsArg
 * @returns {string[]}
 */
function parseModelsList(modelsArg) {
  if (typeof modelsArg !== 'string') { return []; }
  return modelsArg.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Derive leg task IDs: <waveId>-1 .. <waveId>-N (matches TASK_ID_PATTERN).
 * @param {string} waveId
 * @param {number} count
 * @returns {string[]}
 */
function deriveLegIds(waveId, count) {
  return Array.from({ length: count }, (_, i) => `${waveId}-${i + 1}`);
}

/**
 * Fail-fast validation of the whole model list BEFORE any leg launches:
 * alias resolution, API-key presence, live-catalog validation (F3 machinery).
 * @param {string} modelsArg - Raw --models value
 * @param {{noValidateModel?: boolean}} [opts]
 * @returns {Promise<{legs: Array<{modelInput: string, model: string}>} | {error: string}>}
 */
async function validateFanoutModels(modelsArg, opts = {}) {
  const raw = parseModelsList(modelsArg);
  if (raw.length === 0) {
    return { error: 'Error: --models requires a comma-separated list (e.g. gemini,gpt,deepseek)' };
  }
  // Invalid or non-positive AMICUS_FANOUT_MAX_LEGS (0, negative, garbage) falls back to the default.
  const envCap = Number(process.env.AMICUS_FANOUT_MAX_LEGS);
  const maxLegs = (Number.isInteger(envCap) && envCap > 0) ? envCap : DEFAULT_MAX_LEGS;
  if (raw.length > maxLegs) {
    return { error: `Error: --models exceeds the fan-out cap of ${maxLegs} legs (set AMICUS_FANOUT_MAX_LEGS to raise)` };
  }

  const { tryResolveModel } = require('../utils/config');
  const { validateApiKey } = require('../utils/validators');
  const { validateAgainstCatalog } = require('../utils/model-validator');
  const legs = [];
  for (const modelInput of raw) {
    const resolved = tryResolveModel(modelInput);
    if (resolved.error) {
      return { error: `Error: model '${modelInput}': ${resolved.error}` };
    }
    let model = resolved.model;
    const keyCheck = validateApiKey(model);
    if (!keyCheck.valid) {
      return { error: keyCheck.error };
    }
    if (!opts.noValidateModel) {
      const alias = modelInput.includes('/') ? undefined : modelInput;
      try {
        model = await validateAgainstCatalog(model, alias);
      } catch (err) {
        return { error: err.message };
      }
    }
    legs.push({ modelInput, model });
  }
  return { legs };
}

module.exports = { parseModelsList, deriveLegIds, validateFanoutModels, DEFAULT_MAX_LEGS };
