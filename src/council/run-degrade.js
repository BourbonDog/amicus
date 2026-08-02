'use strict';

/**
 * @module council/run-degrade
 * THE CHOKE POINT. The only place in the council runtime permitted to set
 * `degraded.value`. Announcing is a side effect of degrading, which is what
 * makes "every degrade is announced" true by construction rather than by
 * discipline — see tests/council/degrade-invariant.test.js, which fails if
 * anyone writes `degraded.value = true` anywhere else.
 */
const { makeDegrade, formatDegrade } = require('../utils/degrade');

function createDegradeSink({ runDir, degraded, write }) {
  const emit = write || ((s) => process.stderr.write(s));
  const records = [];

  // One level, no re-entry. Without this rule a disk-full condition becomes an
  // unbounded loop of degrades about failing to record degrades (spec §7).
  const safeEmit = (s) => { try { emit(s); } catch { /* EPIPE etc — never mask the run */ } };

  function note(input) {
    let record;
    try {
      record = makeDegrade(input);
    } catch (err) {
      record = makeDegrade({
        channel: 'internal',
        what: `a degrade on channel '${input && input.channel}' could not be recorded`,
        why: (err && err.message) || 'unknown error',
        effect: 'the run still degrades; the original detail is lost',
      });
    }
    records.push(record);
    safeEmit(formatDegrade(record));
    try {
      require('./run-state').checkpoint(runDir, { degrades: records.slice() });
    } catch { /* precedent: run-budget.js:156 — a degrade that cannot be persisted is still announced */ }
    if (record.kind === 'degrade' && degraded) { degraded.value = true; }
  }

  return { note, all: () => records.slice() };
}

module.exports = { createDegradeSink };
