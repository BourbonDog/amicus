/**
 * Council Workspace — adjudication matrix view model (v4.4 §5.2).
 *
 * Pure: tally.json + labelMap (+ verdict.json) → renderable rows/cells.
 * Symbols come from council/report.js SYMBOL (single source — the report and
 * the workspace can never disagree about what the symbols mean). Every
 * name-bearing field carries BOTH spellings ({model, label}) so the
 * renderer's blind toggle is a pure display flip with no re-fetch. Missing
 * votes (partial waves) are blank cells, never invented neutrals — tier math
 * already excluded them (v4.0).
 *
 * ⚠️ DE-ROT (F07): `tally()` writes `tierOverride: null` on EVERY finding,
 * unconditionally (src/council/tally.js:106) — it is never a real source for
 * either the override badge or the post-override tier. Only `buildVerdict`
 * materializes `{from,to,reason}` and rewrites `tier` to `tierOverride.to`
 * (src/council/verdict.js:33-37). So both fields are joined in from
 * verdict.findings[] by `id`; when verdict is absent/unparseable (caller
 * passes null/undefined, or a finding has no verdict-side counterpart) the
 * row falls back to tally's own (pre-override) tier and renders no badge.
 */
'use strict';

const { SYMBOL } = require('../council/report');
const { pairFor } = require('./blind-mode');

/** Index verdict.findings[] by id, tolerating an absent/malformed verdict doc. */
function indexVerdictFindings(verdict) {
  const byId = new Map();
  if (verdict && Array.isArray(verdict.findings)) {
    for (const vf of verdict.findings) {
      if (vf && typeof vf.id === 'string') { byId.set(vf.id, vf); }
    }
  }
  return byId;
}

/**
 * @param {object} tally parsed tally.json
 * @param {object} labelMap run.json labelMap
 * @param {object|null} [verdict] parsed verdict.json — source of truth for
 *   tierOverride and the post-override tier (⚠️ DE-ROT F07). Omitted, null,
 *   or a finding missing from it falls back to tally's tier with no badge.
 * @returns {object} MatrixModel (see plan Shared contracts)
 */
function buildMatrixModel(tally, labelMap, verdict) {
  const map = labelMap || {};
  const judges = tally && tally.meta && Array.isArray(tally.meta.models) ? tally.meta.models : [];
  const findings = tally && Array.isArray(tally.findings) ? tally.findings : [];
  const verdictById = indexVerdictFindings(verdict);

  const rows = findings.map((f) => {
    const votes = {};
    for (const adj of (Array.isArray(f.adjudications) ? f.adjudications : [])) {
      votes[adj.judge] = adj.verdict;
    }
    const vf = verdictById.get(f.id);
    return {
      id: f.id,
      severity: f.severity || null,
      tier: (vf ? vf.tier : null) || f.tier || null,
      thin: f.confidence === 'thin',
      tierOverride: (vf && vf.tierOverride) || null,
      // ⚠️ DE-ROT (F29): v4.1 decorates tally.json findings in place with
      // `debate: {action, previousTier}` (src/council/debate.js:71-75; action ∈
      // defended|amended|withdrawn|no-response) and verdict.json carries it through
      // (src/council/verdict.js:43). Dropping it renders a WITHDRAWN finding as an
      // ordinary live row. Absent on non-debate runs, hence `|| null`.
      debate: f.debate || null,
      raiser: pairFor(f.raiser, map),
      basis: f.basis || { a: 0, d: 0, n: 0 },
      cells: judges.map((j) => {
        const vote = Object.prototype.hasOwnProperty.call(votes, j) ? votes[j] : null;
        return {
          judge: pairFor(j, map),
          verdict: vote,
          sym: vote ? (SYMBOL[vote] || '?') : ' ',
          isRaiser: j === f.raiser,
        };
      }),
    };
  });

  return {
    judges: judges.map((j) => pairFor(j, map)),
    rows,
    tierCounts: (tally && tally.tierCounts) || null,
    judged: !(tally && tally.judged === false),
  };
}

module.exports = { buildMatrixModel };
