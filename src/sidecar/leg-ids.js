'use strict';
// deriveLegIds — the <waveId>-<i+1> leg-id convention. Moved verbatim from
// fanout.js:24-32 (v4.8 PR0 size-gate split, zero behavior; fanout.js was
// 300/300). The shape is load-bearing: council stage-1 composes
// `${runId}-s1` waves onto it, and ~10 suites plus a replay fixture
// hard-code the composite. Pinned by tests/sidecar/fanout.test.js:84-93
// through fanout.js's re-export.

/**
 * Derive leg task IDs: <waveId>-1 .. <waveId>-N (matches TASK_ID_PATTERN).
 * @param {string} waveId
 * @param {number} count
 * @returns {string[]}
 */
function deriveLegIds(waveId, count) {
  return Array.from({ length: count }, (_, i) => `${waveId}-${i + 1}`);
}

module.exports = { deriveLegIds };
