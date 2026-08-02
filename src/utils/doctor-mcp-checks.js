/**
 * @module doctor-mcp-checks
 * B14/Task 4.3: the two MCP-registration doctor checks ('mcp' and
 * 'mcp-legacy'), split out of src/cli-handlers-doctor.js to keep that file
 * under the 300-line size gate (mirrors how session-index-tmp-sweep.js holds
 * the B15 sweep's evaluate* composer — src/cli-handlers-doctor.js just wraps
 * these in guard() the same way).
 *
 * 'mcp' (evaluateMcpRegistration): PRIMARY signal is
 * d.hasAmicusRegistration() — a RAW (unstripped) read of the same Claude
 * Code sources discoverClaudeCodeMcps reads. discoverClaudeCodeMcps always
 * strips every 'amicus'/'sidecar'-shaped entry as its own recursive-spawn
 * guard (src/utils/mcp-self-identity.js), so testing `code.amicus` here
 * would ALWAYS be false — that was the B14 false-negative. Cowork/Desktop
 * discovery (d.discoverCoworkMcps) does not strip and stays a bonus signal.
 *
 * 'mcp-legacy' (evaluateLegacyMcpEntry): unchanged logic, moved verbatim.
 */

'use strict';

const HINTS = require('./remediation-hints');

/**
 * @param {{hasAmicusRegistration: () => boolean, discoverCoworkMcps: () => object|null}} d
 */
function evaluateMcpRegistration(d) {
  const id = 'mcp'; const name = 'MCP registration';
  const inCode = !!d.hasAmicusRegistration();
  const cowork = d.discoverCoworkMcps();
  const inCowork = !!(cowork && cowork.amicus);
  // Primary signal: Claude Code MCP registration. Cowork/Desktop is reported as bonus only.
  if (!inCode) {
    return { id, name, status: 'warn', message: 'not registered in Claude Code', hint: `${HINTS.reinstall}  (or install the amicus plugin)` };
  }
  const extra = inCowork ? ', Cowork/Desktop' : '';
  return { id, name, status: 'ok', message: `registered: Claude Code${extra}`, hint: null };
}

/**
 * Duplicate legacy 'sidecar' MCP registration (same server twice — doubles
 * the client-visible tool list). Detection reads the raw config files via
 * legacy-mcp-migration: mcp-discovery can't see it (it strips 'sidecar' as
 * its own recursion guard). --fix removes only identical-in-effect twins.
 * @param {{inspectLegacyMcpEntries: () => Array, fix?: boolean, migrateLegacyMcpEntries: () => Array}} d
 */
function evaluateLegacyMcpEntry(d) {
  const id = 'mcp-legacy'; const name = 'Legacy sidecar MCP entry';
  const entries = d.inspectLegacyMcpEntries() || [];
  const dupes = entries.filter(e => e.status === 'removable');
  const custom = entries.filter(e => e.status === 'customized');
  // An unreadable config is neither "no problem" nor a duplicate we can act
  // on — reporting it as ok/'none' would hide a config doctor (and --fix)
  // could not actually inspect. Always surface it, even alongside dupes.
  const unreadable = entries.filter(e => e.status === 'unreadable');
  const unreadableNote = unreadable.length
    ? `${unreadable.map(e => e.target).join(', ')} config unreadable — skipped`
    : null;
  if (dupes.length === 0) {
    if (unreadableNote) {
      const suffix = custom.length ? `; custom 'sidecar' entry in ${custom.map(e => e.target).join(', ')} — left alone` : '';
      return { id, name, status: 'warn', message: `${unreadableNote}${suffix}`, hint: null };
    }
    const message = custom.length
      ? `custom 'sidecar' entry in ${custom.map(e => e.target).join(', ')} — left alone`
      : 'none';
    return { id, name, status: 'ok', message, hint: null };
  }
  if (d.fix) {
    const removed = (d.migrateLegacyMcpEntries() || []).filter(r => r.result === 'removed');
    // Structured fix outcome (v4.6 Plan 3 Task 3): a repaired row carries
    // fixed/fixDetail whenever ANY entry was actually removed, even on the
    // partial-failure path below — a genuine no-op (removed.length === 0)
    // stays unflagged.
    const fixFields = removed.length > 0
      ? { fixed: true, fixDetail: `removed the duplicate legacy 'sidecar' entry from ${removed.map(r => r.target).join(', ')}` }
      : {};
    if (removed.length >= dupes.length) {
      const message = `removed legacy entry from: ${removed.map(r => r.target).join(', ')}`;
      return unreadableNote
        ? { id, name, status: 'warn', message: `${message}; ${unreadableNote}`, hint: HINTS.removeLegacySidecar, ...fixFields }
        : { id, name, status: 'ok', message, hint: null, ...fixFields };
    }
    const message = `removed ${removed.length}/${dupes.length} duplicate(s) — could not update every config`;
    return { id, name, status: 'warn', message: unreadableNote ? `${message}; ${unreadableNote}` : message, hint: HINTS.removeLegacySidecar, ...fixFields };
  }
  const message = `duplicate 'sidecar' entry in ${dupes.map(e => e.target).join(', ')} — doubles the MCP tool list`;
  return { id, name, status: 'warn', message: unreadableNote ? `${message}; ${unreadableNote}` : message, hint: HINTS.removeLegacySidecar };
}

module.exports = { evaluateMcpRegistration, evaluateLegacyMcpEntry };
