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

/**
 * Announce every dropped preset member (spec §5, Plan 4): a seat the user's
 * preset requested that never resolved is a lost seat — announced like every
 * other loss. Fires once per member, before any launch (zero spend), for BOTH
 * transports. Moved verbatim out of run.js for the 300-line gate (P2-R14: PR 2
 * of the council-leg-completion work needed the headroom this freed).
 * @param {{note: Function}} degrade the run's degrade sink
 * @param {Array<{member: string, reason: string}>} [droppedMembers]
 */
function noteDroppedMembers(degrade, droppedMembers) {
  for (const dm of droppedMembers || []) {
    degrade.note({
      channel: 'dropped-members',
      what: `seat ${dm.member} was not seated`,
      why: dm.reason,
      effect: 'the bench is smaller than the preset requested; the run will exit degraded (2)',
      data: { member: dm.member, reason: dm.reason },
    });
  }
}

module.exports = { createDegradeSink, noteDroppedMembers };
