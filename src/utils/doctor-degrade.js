'use strict';

/**
 * @module utils/doctor-degrade
 * The doctor-side collector (spec §4): maps doctor's check rows onto the shared
 * degrade/heal vocabulary. Pure — reads row STATUS and the structured `fixed`
 * flag only, never message prose (the Plan 2 rule: prose is the human surface).
 *
 * Mapping (spec §6, with the recorded interpretation):
 *   status 'error'      → kind 'degrade', channel 'doctor-check-failed'
 *   row.fixed === true  → kind 'heal',    channel 'doctor-fix'
 *   'ok'/'warn' rows    → no record — doctor's exit code ignores warns, and the
 *                         §6 equivalence (exit derives from any degrade) must
 *                         hold without changing exit behavior.
 * A row can produce both (a partial self-heal that still fails).
 * Never throws: a malformed row degrades honestly, mirroring the council sink.
 */
const { makeDegrade } = require('./degrade');

function collectDoctorDegrades(checks) {
  const records = [];
  for (const c of Array.isArray(checks) ? checks : []) {
    if (!c) { continue; }
    const name = c.name || c.id || 'unnamed';
    if (c.status === 'error') {
      records.push(makeDegrade({
        channel: 'doctor-check-failed',
        what: `the '${name}' check failed`,
        why: (typeof c.message === 'string' && c.message.trim()) ? c.message : 'the check produced no message',
        effect: 'amicus may not work correctly until this is fixed; doctor exits 1',
        ...(typeof c.hint === 'string' && c.hint.trim() ? { remedy: c.hint } : {}),
        data: { checkId: c.id || null },
      }));
    }
    if (c.fixed === true) {
      records.push(makeDegrade({
        kind: 'heal',
        channel: 'doctor-fix',
        what: `the '${name}' check was repaired in place`,
        why: (typeof c.fixDetail === 'string' && c.fixDetail.trim())
          ? `doctor --fix ${c.fixDetail}`
          : "doctor --fix applied the check's self-heal",
        effect: 'no further action needed; the repair already ran',
        data: { checkId: c.id || null },
      }));
    }
  }
  return records;
}

module.exports = { collectDoctorDegrades };
