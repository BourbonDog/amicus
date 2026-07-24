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

module.exports = { appendEvent, createEventTail, EVENTS_FILE, EVENTS_SCHEMA_VERSION };
