// src/sidecar/fanout-output.js
'use strict';

/**
 * @module fanout-output
 * Human-readable rendering of a wave document (the non-JSON default for
 * `amicus fanout` stdout and `amicus read <waveId>`).
 */

/** Format ms as "1m5s" / "42s". */
function fmtDuration(ms) {
  if (ms === null || ms === undefined) { return '-'; }
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

/**
 * Render a wave document for humans: per-leg sections in order, then a footer.
 * @param {object} wave - Wave document (result-schema shape)
 * @returns {string}
 */
function formatWaveHuman(wave) {
  const lines = [];
  for (const leg of wave.legs) {
    const label = leg.modelInput || leg.model || leg.taskId;
    lines.push(`${'─'.repeat(8)} ${label} (${leg.taskId}) ${'─'.repeat(8)}`);
    if (leg.summary) {
      lines.push(leg.summary.trim());
    } else {
      lines.push(`(no output) [${leg.status}${leg.error ? `: ${leg.error}` : ''}]`);
    }
    lines.push('');
  }
  lines.push('─'.repeat(40));
  lines.push(`Wave ${wave.waveId}: ${wave.status} — ${wave.counts.complete}/${wave.counts.total} complete in ${fmtDuration(wave.durationMs)}`);
  for (const leg of wave.legs) {
    const label = leg.modelInput || leg.model || leg.taskId;
    lines.push(`  ${leg.taskId}  ${String(label).padEnd(12)} ${String(leg.status).padEnd(9)} ${fmtDuration(leg.durationMs)}`);
  }
  return lines.join('\n');
}

module.exports = { formatWaveHuman, fmtDuration };
