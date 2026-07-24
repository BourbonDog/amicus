// src/observe/events.js
'use strict';

/**
 * @module observe/events
 * Surface B (spec 4.2): the append-only milestone event stream, one
 * events.jsonl per wave dir / council run dir. Single-writer (the owning
 * orchestrator) so ordering is trivially correct; a torn final line on a hard
 * crash is acceptable and skipped by the tail reader (same tradeoff as the two
 * ledgers). appendEvent NEVER throws (spec 8) — emitting an event must never
 * fail a wave/leg. The reader is a poll-stat tail: no fs.watch anywhere
 * (Windows reference platform, spec 3.1).
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const EVENTS_FILE = 'events.jsonl';
const EVENTS_SCHEMA_VERSION = 1;

/**
 * Append one enveloped event line. Best-effort; swallows all failure.
 * Reserved envelope keys — do not reuse these as payload field names, the
 * stamped value always wins (spread order): schemaVersion, type, event, ts, id.
 * @param {string} dir wave/council-run dir
 * @param {{event:string, id:string}} payload event name + owning id + fields
 */
function appendEvent(dir, payload) {
  try {
    const { event, id, ...rest } = payload || {};
    const line = JSON.stringify({
      schemaVersion: EVENTS_SCHEMA_VERSION, type: 'event',
      event, ts: new Date().toISOString(), id, ...rest,
    }) + '\n';
    fs.appendFileSync(path.join(dir, EVENTS_FILE), line);
  } catch (e) {
    logger.debug('events append failed (best-effort, run unaffected)', { error: e.message });
  }
}

/**
 * Create a poll-stat tail over an events file. Returns { poll() } — each call
 * yields the events appended since the previous call (empty on no growth,
 * missing file, or a transient open error). Holds an unterminated tail.
 * @param {string} file absolute path to events.jsonl
 */
function createEventTail(file) {
  let offset = 0;
  let carry = '';
  return {
    poll() {
      let stat;
      try { stat = fs.statSync(file); }
      catch { return []; } // not-yet-exists / transient -> missed tick
      if (stat.size <= offset) { return []; }
      let chunk;
      try {
        const fd = fs.openSync(file, 'r');
        try {
          const buf = Buffer.alloc(stat.size - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          chunk = buf.toString('utf-8');
        } finally { fs.closeSync(fd); }
      } catch { return []; } // EBUSY/EPERM -> missed tick, retry next poll
      offset = stat.size;
      const text = carry + chunk;
      const nl = text.lastIndexOf('\n');
      if (nl === -1) { carry = text; return []; }
      carry = text.slice(nl + 1);
      const out = [];
      for (const line of text.slice(0, nl).split('\n')) {
        if (!line.trim()) { continue; }
        try { out.push(JSON.parse(line)); } catch { /* skip torn/corrupt */ }
      }
      return out;
    },
  };
}

// ---- Milestone emit helpers (Task 7, spec 4.2 vocabulary) ----
// Centralized here (not in fanout.js / run.js / run-chair.js / run-debate.js)
// per the v4.3 Task 7 structural decision: those four files sit close to the
// 300-line hard gate, so every call site below is a thin wrapper over
// appendEvent — which already never throws — so every helper inherits that
// never-fails guarantee for free. Keep this module dependency-free (fs + path
// + logger only); do not import result-schema or anything heavier here.
//
// Task 13 dual-sink: every helper takes an OPTIONAL trailing `follow` arg
// ({onEvent(event)}, from observe/follow.js). appendEvent (disk) stays
// UNCONDITIONAL; when `follow` is present, the SAME raw event object (pre
// envelope) is also handed to follow.onEvent — a live stderr mirror, not a
// durable record. Callers that omit `follow` (every pre-Task-13 call site)
// get the old behavior unchanged.

/** Wave lifecycle start: models resolved (post-routing) + derived leg ids. */
function emitWaveStarted(waveDir, waveId, models, legIds, follow) {
  const evt = { event: 'wave-started', id: waveId, models, legIds };
  appendEvent(waveDir, evt);
  if (follow) { follow.onEvent(evt); }
}

/** Wave lifecycle end: fires AFTER wave.json is written (ordering guarantee). */
function emitWaveTerminal(waveDir, waveId, { status, counts, usage, exitCode }, follow) {
  const evt = { event: 'wave-terminal', id: waveId, status, counts, usage, exitCode };
  appendEvent(waveDir, evt);
  if (follow) { follow.onEvent(evt); }
}

/** Leg lifecycle start, into the OWNING wave's events.jsonl (not the leg dir). */
function emitLegStarted(waveDir, waveId, legId, model, modelInput, follow) {
  const evt = { event: 'leg-started', id: waveId, legId, model, modelInput };
  appendEvent(waveDir, evt);
  if (follow) { follow.onEvent(evt); }
}

/** Leg lifecycle end: fires AFTER the leg metadata patch + ledger append. */
function emitLegTerminal(waveDir, waveId, legId, { model, status, durationMs, usage }, follow) {
  const evt = { event: 'leg-terminal', id: waveId, legId, model, status, durationMs, usage };
  appendEvent(waveDir, evt);
  if (follow) { follow.onEvent(evt); }
}

/** Council run lifecycle start. */
function emitRunStarted(runDir, runId, { bench, chair }, follow) {
  const evt = { event: 'run-started', id: runId, bench, chair };
  appendEvent(runDir, evt);
  if (follow) { follow.onEvent(evt); }
}

/** Entering a council stage (stage1, stage2, chair, debate-defense, debate-revote, tally, verdict, ...). */
function emitStageStarted(runDir, runId, stage, waveId, follow) {
  const evt = { event: 'stage-started', id: runId, stage, waveId };
  appendEvent(runDir, evt);
  if (follow) { follow.onEvent(evt); }
}

/** Leaving a council stage (status: complete/error/skipped/aborted). */
function emitStageTerminal(runDir, runId, stage, status, waveId, follow) {
  const evt = { event: 'stage-terminal', id: runId, stage, status, waveId };
  appendEvent(runDir, evt);
  if (follow) { follow.onEvent(evt); }
}

/** Council run lifecycle end: fires AFTER the terminal run.json checkpoint. */
function emitRunTerminal(runDir, runId, status, exitCode, follow) {
  const evt = { event: 'run-terminal', id: runId, status, exitCode };
  appendEvent(runDir, evt);
  if (follow) { follow.onEvent(evt); }
}

module.exports = {
  appendEvent, createEventTail, EVENTS_FILE, EVENTS_SCHEMA_VERSION,
  emitWaveStarted, emitWaveTerminal, emitLegStarted, emitLegTerminal,
  emitRunStarted, emitStageStarted, emitStageTerminal, emitRunTerminal,
};
