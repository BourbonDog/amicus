// tests/council/fixtures/av-receiver-input.js
'use strict';
// De-anonymized from output/av-receiver-council/crossreview-matrix.md.
// Judges: deepseek, gpt, mistral. Reviews: A=deepseek, B=gpt, C=mistral.
// Each row: [findingId, raiser, severity, {deepseek,gpt,mistral verdict}]
const V = { '✓': 'agree', '✗': 'dispute', '–': 'neutral' };
const ROWS = [
  ['A1','deepseek','blocker','✓✓✓'], ['A2','deepseek','blocker','✓✓✓'],
  ['A3','deepseek','minor','✓–✓'],   ['A4','deepseek','major','✓✓✓'],
  ['A5','deepseek','major','✓✓✓'],   ['A6','deepseek','minor','✓✓–'],
  ['A7','deepseek','minor','✓––'],   ['A8','deepseek','minor','✓✓✓'],
  ['B1','gpt','blocker','✓✓✓'], ['B2','gpt','major','✓✓✓'], ['B3','gpt','major','✓✓✓'],
  ['B4','gpt','major','✓✓✓'], ['B5','gpt','major','✓✓✓'], ['B6','gpt','major','✓✓✓'],
  ['B7','gpt','minor','✓✓–'], ['B8','gpt','minor','✓✓–'], ['B9','gpt','minor','✓✓✓'],
  ['B10','gpt','minor','✓✓–'], ['B11','gpt','minor','✓✓–'], ['B12','gpt','nit','✓✓–'],
  ['C1','mistral','major','✓✓✓'], ['C2','mistral','minor','–✗–'], ['C3','mistral','minor','✓✗✓'],
  ['C4','mistral','major','✓✓✓'], ['C5','mistral','minor','✓––'], ['C6','mistral','blocker','✗✗✗'],
  ['C7','mistral','major','✗✗✓'], ['C8','mistral','major','✓✓✓'], ['C9','mistral','major','✓–✓'],
  ['C10','mistral','major','✓––'], ['C11','mistral','minor','✓✓–'], ['C12','mistral','major','✗✗✓'],
  ['C13','mistral','minor','✓✓–'], ['C14','mistral','major','✓✓✓'], ['C15','mistral','blocker','✓✓✓'],
];
const JUDGES = ['deepseek', 'gpt', 'mistral'];
const findings = ROWS.map(([id, raiser, severity]) => ({ id, raiser, severity, claim: id }));
const adjudications = [];
for (const [id, , , marks] of ROWS) {
  [...marks].forEach((mark, i) => adjudications.push({ judge: JUDGES[i], findingId: id, verdict: V[mark] }));
}
const rankings = JUDGES.map(j => ({ judge: j, order: ['gpt', 'deepseek', 'mistral'] }));
const runStats = JUDGES.map(m => ({
  model: m, role: 'council', wasChair: m === 'deepseek', conformance: 'clean',
  status: 'complete', durationMs: null, usage: null,
}));
module.exports = {
  meta: { runId: 'av-receiver-council', runType: 'product-recommendation',
          date: '2026-06-23T15:00:00Z', models: JUDGES, chair: 'deepseek', claudeInCouncil: false },
  findings, rankings, adjudications, runStats,
};
