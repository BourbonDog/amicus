// src/sidecar/fanout-wave-io.js
'use strict';

/**
 * @module fanout-wave-io
 * On-disk lifecycle of a WAVE document, split out of fanout.js to keep that
 * file under the 300-line gate (v4.4.1 Task 0.5, which needed room for the
 * external-server seam). Pure move — same writes, same order, same atomicity:
 *
 *   writeWaveMetadata  metadata.json read-merge-write, abort-wins
 *   writeWaveDoc       wave.json, atomic (tmp + rename)
 *   finishWave         the terminal path every completed wave funnels through:
 *                      persist → checkpoint metadata → emit wave-terminal →
 *                      fire --on-complete → print
 *
 * `finishWave` had two byte-identical copies in fanout.js (the all-legs-failed-
 * to-route short circuit and the normal aggregation); they are one function here
 * so a future change to the terminal contract cannot land on only one of them.
 */

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../utils/atomic-write');

/**
 * Write/merge wave metadata (preserves fields an MCP pre-spawn handler wrote).
 * Abort-wins: once existing status is 'aborted', a patch cannot demote it back
 * to a softer status (same precedence rule as writeLegPatch — a signal/abort
 * marker must never lose a write race against an in-flight init/finalize).
 */
function writeWaveMetadata(waveDir, patch) {
  const metaPath = path.join(waveDir, 'metadata.json');
  let existing = {};
  if (fs.existsSync(metaPath)) {
    try { existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* corrupt → rewrite */ }
  }
  const safePatch = { ...patch };
  if (existing.status === 'aborted' && safePatch.status && safePatch.status !== 'aborted') {
    delete safePatch.status;
  }
  const merged = { ...existing, ...safePatch };
  writeFileAtomic(metaPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

/**
 * Persist a wave document atomically (tmp + rename).
 * @returns {string} the wave.json path
 */
function writeWaveDoc(waveDir, wave) {
  const wavePath = path.join(waveDir, 'wave.json');
  writeFileAtomic(wavePath, JSON.stringify(wave, null, 2), { mode: 0o600 });
  return wavePath;
}

/**
 * Terminal path for a wave that produced leg documents: persist wave.json,
 * checkpoint metadata.json, emit wave-terminal, fire --on-complete, print.
 * @param {{wave: object, waveDir: string, waveId: string, project: string,
 *   exitCode: number, completedAt: string, follow: object|null, emit: Function,
 *   onComplete?: string, onCompleteDeps?: object}} args
 * @returns {Promise<{wave: object, exitCode: number}>}
 */
async function finishWave({ wave, waveDir, waveId, project, exitCode, completedAt, follow, emit, onComplete, onCompleteDeps }) {
  const { emitWaveTerminal } = require('../observe/events');
  const wavePath = writeWaveDoc(waveDir, wave);
  writeWaveMetadata(waveDir, { status: wave.status, completedAt });
  emitWaveTerminal(waveDir, waveId, { status: wave.status, counts: wave.counts, usage: wave.usage, exitCode }, follow);
  await require('../observe/on-complete').fireWaveOnComplete(onComplete, wave,
    { waveId, waveDir, wavePath, exitCode, project }, onCompleteDeps);
  emit(wave);
  return { wave, exitCode };
}

/**
 * v4.3 §7.2 (moved here v4.7 PR3 Task 1): stamp council attribution onto every
 * leg — fanout-leg's appendSpend reads it; no-op for every non-council caller.
 * v4.7 F8 (Task 7) adds tag stamping in the same pass. v4.8 R5 (T4.2) adds
 * seat stamping in the same pass.
 */
function stampLegAttribution(legs, options) {
  if (options.councilRunId || options.councilName) {
    legs.forEach(l => { l.councilRunId = options.councilRunId; l.councilName = options.councilName; });
  }
  if (options.tag) { legs.forEach(l => { l.tag = options.tag; }); }
  // v4.8 R5: seat identity for the LIVE path. `options.seats` is the launching
  // wave's roster, index-parallel with `options.models` by construction
  // (run-stage1-launch.js builds `roster` and `models` from the same filter, and
  // fanout-validate.js:66-87 pushes exactly one leg per model on BOTH its ok and
  // its unroutable branch, so a leg that never routed still holds its slot).
  //
  // ⚠️ emit-when-DIFFERENT, against the seat's OWN alias — the shared predicate
  // stated at run-stats-entry.js :: buildRunStatsEntry, which the three sites in
  // run-assemble.js also spell. buildSeats mints `alias#N` ONLY when an alias
  // repeats (seats.js:67), so `id !== alias` IS "the bench repeats this alias",
  // and on a unique bench `id` IS the alias — a bare `if (s.id)` would stamp an
  // alias-valued seat onto every leg of every run: the same wrong output shape
  // run-assemble.js:165-169 records having already fixed once there (a
  // wrong-comparator bug, `!== j.judge` rather than `!== alias`, with a
  // narrower trigger — only a leg/seat alias drift, not every leg).
  // Comparing against the seat's own alias and never against `model` also makes
  // this immune to the two cases where `model` is NOT the alias (a leg reporting
  // no modelInput; a padded --council member).
  if (Array.isArray(options.seats)) {
    legs.forEach((l, i) => {
      const s = options.seats[i];
      if (s && s.id !== s.alias) { l.seat = s.id; }
    });
  }
}

module.exports = { writeWaveMetadata, writeWaveDoc, finishWave, stampLegAttribution };
