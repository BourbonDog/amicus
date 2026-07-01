// src/sidecar/fanout-output.js
'use strict';
const { formatCost } = require('../utils/pricing');
const { formatDuration } = require('../utils/format-duration');

/**
 * @module fanout-output
 * Human-readable rendering of a wave document (the non-JSON default for
 * `amicus fanout` stdout and `amicus read <waveId>`).
 */

/** Format ms as "1m5s" / "42s" (shared helper; "-" placeholder for null). */
function fmtDuration(ms) {
  return formatDuration(ms, '-');
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
    if (leg.summary && leg.summary.trim()) {
      lines.push(leg.summary.trim());
    } else {
      lines.push(`(no output) [${leg.status}${leg.error ? `: ${leg.error}` : ''}]`);
    }
    lines.push('');
  }
  if (wave.error) { lines.push(`Error: ${wave.error}`); }
  lines.push('─'.repeat(40));
  const counts = wave.counts || { complete: '?', total: '?' };
  lines.push(`Wave ${wave.waveId}: ${wave.status} — ${counts.complete}/${counts.total} complete in ${fmtDuration(wave.durationMs)}`);
  lines.push(`  Wave cost: ${formatCost(wave.usage && wave.usage.cost)}`);
  for (const leg of wave.legs) {
    const label = leg.modelInput || leg.model || leg.taskId;
    lines.push(`  ${leg.taskId}  ${String(label).padEnd(12)} ${String(leg.status).padEnd(9)} ` +
      `${String(fmtDuration(leg.durationMs)).padEnd(7)} ${formatCost(leg.usage && leg.usage.cost)}`);
  }
  return lines.join('\n');
}

module.exports = { formatWaveHuman, fmtDuration };
