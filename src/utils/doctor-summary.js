/**
 * @module doctor-summary
 * Compact doctor summary (v4.2 §4.7 C8). All-ok -> one line; otherwise the
 * non-ok lines + counts + a pointer to the full command. Shared by the setup
 * wizard finale (src/sidecar/setup.js) and, next, `amicus init` (Task 15) --
 * kept in its own leaf module (rather than inside cli-handlers-doctor.js) so
 * both callers can require it without pulling in the doctor check machinery,
 * and so cli-handlers-doctor.js stays under the 300-line size gate.
 */

'use strict';

/**
 * @param {Array<{status:string,name?:string,id?:string,message?:string}>} checks
 * @returns {string}
 */
function summarizeDoctor(checks) {
  const list = Array.isArray(checks) ? checks : [];
  const nonOk = list.filter((c) => c && c.status !== 'ok');
  if (nonOk.length === 0) {
    return `doctor: all ${list.length} checks pass`;
  }
  const errors = nonOk.filter((c) => c.status === 'error').length;
  const warns = nonOk.filter((c) => c.status === 'warn').length;
  const lines = nonOk.map((c) => {
    const marker = c.status === 'error' ? '✗' : '⚠';
    return `  ${marker} ${c.name || c.id}: ${c.message || ''}`.trimEnd();
  });
  lines.push(`${errors} error(s), ${warns} warning(s) — run \`amicus doctor\` for details`);
  return lines.join('\n');
}

module.exports = { summarizeDoctor };
