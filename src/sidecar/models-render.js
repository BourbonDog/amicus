/**
 * Presentation helpers for `amicus models` -- pure string formatting, no I/O.
 *
 * Split out of models.js when the per-provider failure line (issue 209) pushed
 * that file past the 300-line ceiling. Formatting and command flow are
 * separable concerns, so the ceiling picked the seam: everything here takes a
 * plain object and returns a string.
 */

'use strict';

/** '0.000003' per token → '3.00' per Mtok; '—' when unknown or variable (-1) */
function perMtok(perToken) {
  if (perToken === null || perToken === undefined) { return '—'; }
  const n = Number(perToken);
  if (Number.isNaN(n) || n < 0) { return '—'; }
  return (n * 1e6).toFixed(2);
}

function fmtRow(m, aliasesById) {
  const alias = aliasesById.get(m.id);
  const aliasCol = alias ? `[${alias}] ` : '';
  const ctx = m.contextLength ?? '—';
  const pIn = perMtok(m.pricing && m.pricing.prompt);
  const pOut = perMtok(m.pricing && m.pricing.completion);
  return `${aliasCol}${m.id}\n    ${m.name}  ctx ${ctx}  $/Mtok in ${pIn} out ${pOut}`;
}

/** One readable line per gateway-route finding (Task 6, #gwid). @param {object} f @returns {string} */
function fmtGatewayFinding(f) {
  if (f.kind === 'stale') {
    return `  GATEWAY STALE (${f.gateway}): ${f.alias} -> ${f.model}`;
  }
  if (f.kind === 'divergent-missing') {
    return `  GATEWAY DIVERGENT: ${f.alias} has no direct form; catalog confirms ${f.model}`;
  }
  return `  GATEWAY DIVERGENT: ${f.alias} direct form ${f.model} no longer matches catalog (now ${f.expected})`;
}

const PROBE_LABELS = { served: 'SERVED', 'accepted-but-silent': 'SILENT', error: 'ERROR' };

/** '$0.0004' | '$1.23' | '—' (unknown). Deliberately NOT formatCost (pricing.js):
 * a probe result's `cost` is a bare number (models-probe.js doesn't carry the
 * reported/estimated source tag), so this never claims a precision it can't back. */
function fmtProbeCost(cost) {
  if (cost === null || cost === undefined || Number.isNaN(cost)) { return '—'; }
  return cost < 1 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

/** One readable line per probed alias (`--check --live`, v4.6.2 PR3): uppercase
 * class prefix padded to a fixed column, two-space indent — mirrors the STALE/
 * DRIFTED/GATEWAY line style above. @param {object} r probeStoredAliases() row */
function fmtProbeLine(r) {
  const head = `  ${(PROBE_LABELS[r.outcome] + ':').padEnd(8)}${r.alias} -> ${r.target}`;
  if (r.outcome === 'served') { return `${head} (${fmtProbeCost(r.cost)})`; }
  if (r.outcome === 'accepted-but-silent') { return `${head} — ${r.detail} (no output within the probe window)`; }
  return `${head} — ${r.detail}`;
}

/** One readable line per REJECTED provider fetch (issue 209): a namespace that is
 * empty because its key was refused explains stale/absent aliases downstream.
 * @param {{provider: string, reason: string, status?: number, detail?: string}} f
 * @returns {string} */
function fmtProviderFailure(f) {
  const why = f.reason === 'http-status' ? `HTTP ${f.status}` : (f.detail || f.reason);
  return `PROVIDER FETCH FAILED: ${f.provider} (${why}) — its models are absent from the catalog`;
}

module.exports = {
  perMtok, fmtRow, fmtGatewayFinding, PROBE_LABELS, fmtProbeCost, fmtProbeLine, fmtProviderFailure,
};
