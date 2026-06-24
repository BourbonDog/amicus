// src/sidecar/wave-progress.js
'use strict';

/**
 * @module wave-progress
 * Per-leg live progress rollup for a fan-out wave. Each headless leg already
 * writes progress.json + conversation.jsonl to its own session dir; this reads
 * them on a timer and prints ONE terse line per leg to stderr — milestones,
 * never a token firehose (all three council models flagged firehose noise).
 */

const { readProgress, isStalled } = require('./progress');

const WAVE_HEARTBEAT_INTERVAL = 15000;

/**
 * Render one compact status line per leg. Pure: takes already-read leg states.
 * @param {Array<{label:string, messages:number, latest:string, stage?:string, stalled:boolean}>} legStates
 * @returns {string}
 */
function formatWaveProgress(legStates) {
  return legStates.map((s) => {
    const stage = s.stage || 'starting';
    const flag = s.stalled ? ' ⏳stalled' : '';
    return `[amicus]   ${String(s.label).padEnd(16)} ${String(stage).padEnd(10)} ` +
      `${s.messages} msg | ${s.latest}${flag}`;
  }).join('\n');
}

/**
 * Read a single leg's live state from its session dir. Degrades gracefully when
 * progress.json is absent (a leg that has not started writing yet).
 * @param {{label:string, dir:string}} leg
 * @returns {{label:string, messages:number, latest:string, stage?:string, stalled:boolean}}
 */
function readLegState(leg) {
  const fs = require('fs');
  const path = require('path');
  const progressPath = path.join(leg.dir, 'progress.json');
  const convPath = path.join(leg.dir, 'conversation.jsonl');

  // Degrade gracefully when neither file has been written yet
  if (!fs.existsSync(progressPath) && !fs.existsSync(convPath)) {
    return { label: leg.label, messages: 0, latest: 'starting…', stalled: false };
  }

  let p;
  try { p = readProgress(leg.dir); } catch { p = null; }
  if (!p) { return { label: leg.label, messages: 0, latest: 'starting…', stalled: false }; }

  const state = {
    label: leg.label,
    messages: p.messages,
    latest: p.latest,
    stalled: isStalled(p.lastActivityMs),
  };
  if (p.stage !== undefined) {
    state.stage = p.stage;
  }
  return state;
}

/**
 * Start a wave heartbeat that prints a per-leg rollup each tick. Mirrors the
 * createHeartbeat contract: returns { stop() }.
 * @param {Array<{label:string, dir:string}>} legs
 * @param {number} [interval]
 * @returns {{stop: () => void}}
 */
function createWaveHeartbeat(legs, interval = WAVE_HEARTBEAT_INTERVAL) {
  const startTime = Date.now();
  const intervalId = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const states = legs.map(readLegState);
    process.stderr.write(`[amicus] wave ${elapsed}s — ${states.length} legs\n${formatWaveProgress(states)}\n`);
  }, interval);
  return { stop() { clearInterval(intervalId); } };
}

module.exports = { formatWaveProgress, readLegState, createWaveHeartbeat, WAVE_HEARTBEAT_INTERVAL };
