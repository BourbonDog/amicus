/**
 * Council Workspace — blind-mode name mapping (v4.4 §6.3).
 *
 * Pure inversion helpers over run.json labelMap ({ 'Review A': model }).
 * Finding ids are ALREADY label-space (A1, B2 — v4.0 anonymize), so blind
 * mode never touches ids; it only swaps model display names for labels.
 * Bias hygiene, not security (spec §6.1) — the map is user-readable on disk.
 */
'use strict';

function buildNamePairs(labelMap) {
  if (!labelMap || typeof labelMap !== 'object') { return []; }
  const pairs = Object.entries(labelMap)
    .filter(([label, model]) => typeof label === 'string' && typeof model === 'string')
    .map(([label, model]) => ({ label, model }));
  pairs.sort((a, b) => a.label.localeCompare(b.label));
  return pairs;
}

function labelFor(model, labelMap) {
  if (!labelMap || typeof labelMap !== 'object') { return null; }
  for (const [label, m] of Object.entries(labelMap)) {
    if (m === model) { return label; }
  }
  return null;
}

function pairFor(model, labelMap) {
  return { model, label: labelFor(model, labelMap) };
}

module.exports = { buildNamePairs, labelFor, pairFor };
