// src/council/run-launch.js
'use strict';

/**
 * @module council/run-launch
 * Council-flavored, DI-injected launch wrappers over the fanout transport
 * (spec §5). Every council call — Stage-1 wave, critic/lens solos, Stage-2
 * judge wave, repair re-prompts, chair — goes through runFanout with:
 *   - `--agent Plan` default (fixes the skill-vs-engine 'build' default
 *     mismatch, fanout.js:184),
 *   - `--no-context` (council briefings are self-contained),
 *   - quiet mode (the engine owns stdout; wave docs are consumed in-process).
 * Solos are SINGLE-LEG WAVES: one launch primitive gives every call the same
 * leg contract, budget gate, signal abort, and usage accounting.
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {{fanoutFn?: Function}} [deps] test seam; default = real runFanout
 * @returns {{launchWave: Function, launchSolo: Function}}
 */
function createLaunchers(deps = {}) {
  const fanoutFn = deps.fanoutFn || require('../sidecar/fanout').runFanout;

  /**
   * @param {{models: string[], prompt: string, project: string, waveId: string,
   *   timeout?: number, gateway?: string, noValidateModel?: boolean, agent?: string}} opts
   * @returns {Promise<{wave: object|null, exitCode: number}>}
   */
  async function launchWave(opts) {
    fs.mkdirSync(opts.project, { recursive: true });
    const { wave, exitCode } = await fanoutFn({
      models: opts.models.join(','),
      prompt: opts.prompt,
      promptMeta: { source: 'council-engine', file: null, chars: opts.prompt.length },
      waveId: opts.waveId,
      project: opts.project,
      agent: opts.agent || 'Plan',
      timeout: opts.timeout,
      summaryLength: 'verbose',
      includeContext: false,
      gatewayMode: opts.gateway,
      noValidateModel: opts.noValidateModel,
      json: false,
      quiet: true,
      // Spec §6 judge isolation: pin every leg's OpenCode tool-exec cwd to its
      // own session dir (judges' `project` is `<runDir>/_scratch`, so this
      // scopes them there) and strip inherited MCP servers, so a tool-capable
      // judge can't read the de-anonymized review-*.md files or the plaintext
      // labelMap in run.json sitting in the parent run dir.
      directory: opts.project,
      noMcp: true,
    });
    return { wave, exitCode };
  }

  /**
   * One-model launch (critic/lens legs, repairs, the chair) as a 1-leg wave.
   * @returns {Promise<{wave: object|null, exitCode: number, leg: object|null}>}
   */
  async function launchSolo(opts) {
    const { wave, exitCode } = await launchWave({ ...opts, models: [opts.model] });
    const leg = (wave && Array.isArray(wave.legs) && wave.legs[0]) || null;
    return { wave, exitCode, leg };
  }

  return { launchWave, launchSolo };
}

/** Filesystem-safe model name for review-/judge- artifact filenames. */
function sanitizeName(model) {
  return String(model).replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * Write `review-<modelInput>.md` per surviving Stage-1 leg (skill layout).
 * Dead legs and empty summaries are skipped — the caller applies the
 * wave-degrade rules to what remains.
 * @param {string} runDir
 * @param {Array<object>} legs run documents from the wave/solo docs
 * @returns {Array<{model: string, modelInput: string, file: string, text: string, leg: object}>}
 */
function materializeReviews(runDir, legs) {
  const out = [];
  for (const leg of legs) {
    if (!leg || leg.status !== 'complete') { continue; }
    const text = leg.summary;
    if (!text || !String(text).trim()) { continue; }
    const modelInput = leg.modelInput || leg.model;
    const file = path.join(runDir, `review-${sanitizeName(modelInput)}.md`);
    fs.writeFileSync(file, text, { mode: 0o600 });
    out.push({ model: leg.model, modelInput, file, text, leg });
  }
  return out;
}

/**
 * Write per-leg debate artifacts: `<prefix>-<sanitizeName(model)>.md` for each
 * leg with a non-empty summary. Mirrors materializeReviews.
 * @param {string} runDir
 * @param {Array<{model: string, summary: string}>} legs
 * @param {string} prefix 'rebuttal' | 'revote'
 * @returns {Array<{model: string, file: string}>}
 */
function materializeDebate(runDir, legs, prefix) {
  const out = [];
  for (const leg of legs) {
    if (!leg || !leg.summary || !leg.summary.trim()) { continue; }
    const file = path.join(runDir, `${prefix}-${sanitizeName(leg.model)}.md`);
    fs.writeFileSync(file, leg.summary, { mode: 0o600 });
    out.push({ model: leg.model, file });
  }
  return out;
}

module.exports = { createLaunchers, materializeReviews, materializeDebate, sanitizeName };
