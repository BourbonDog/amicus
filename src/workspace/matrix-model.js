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
 * unconditionally (src/council/tally.js:139) — it is never a real source for
 * either the override badge or the post-override tier. Only `buildVerdict`
 * materializes `{from,to,reason}` and rewrites `tier` to `tierOverride.to`
 * (src/council/verdict.js:122-126). So both fields are joined in from
 * verdict.findings[] by `id`; when verdict is absent/unparseable (caller
 * passes null/undefined, or a finding has no verdict-side counterpart) the
 * row falls back to tally's own (pre-override) tier and renders no badge.
 */
'use strict';

const { SYMBOL } = require('../council/report');
const { labelFor, pairFor } = require('./blind-mode');

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
  const meta = (tally && tally.meta) || {};
  const aliasJudges = Array.isArray(meta.models) ? meta.models : [];
  // v4.8 PR4c §3.6 (R4c-8): the IDENTICAL flag report.js applies to
  // verdict.seats, here over tally.meta.seats — run-detail.js already hands
  // this function the parsed tally.json, so the 3-arg signature is unchanged.
  // One flag for all three readers (roster, vote key, raiser); see report.js's
  // block for why every element must carry a string id and why `??` is wrong.
  const seatSpace = Array.isArray(meta.seats) && meta.seats.length > 0
    && meta.seats.every(s => s && typeof s.id === 'string');
  // report.js filters the reserved claude seat out of ITS roster; this one
  // never has — tally.meta.models carries `claude` (run-assemble.js appends it)
  // and HEAD renders a blank column for it. seats[] is bench-only, so a seat
  // roster would silently DELETE that column; re-append it so the only thing a
  // claude run's matrix changes is the twin split.
  const claudeTail = meta.claudeInCouncil === true && aliasJudges.includes('claude') ? ['claude'] : [];
  // A column is {key, pair}: `key` is what votes and the raiser are matched
  // against, `pair` is what the renderer shows.
  // ⚠️ BLIND MODE: resolve the label from the seat's ALIAS and carry the seat's
  // ID only as identity. `pairFor(seat.id, map)` returns label:null (labelMap's
  // values are aliases), and workspace-render.js's display() then falls back to
  // pair.model and prints `deepseek#1` with blind mode ON. A seat id contains
  // its alias, so rendering one in blind mode defeats blind mode. Both twins
  // therefore collapse to `Review A` when blind — exactly as at HEAD.
  const columns = seatSpace
    ? meta.seats.map(s => ({ key: s.id, pair: { model: s.id, label: labelFor(s.alias, map) } }))
      .concat(claudeTail.map(j => ({ key: j, pair: pairFor(j, map) })))
    : aliasJudges.map(j => ({ key: j, pair: pairFor(j, map) }));
  const findings = tally && Array.isArray(tally.findings) ? tally.findings : [];
  const verdictById = indexVerdictFindings(verdict);

  const rows = findings.map((f) => {
    const votes = {};
    for (const adj of (Array.isArray(f.adjudications) ? f.adjudications : [])) {
      if (!adj || typeof adj.judge !== 'string') { continue; }
      votes[(seatSpace && adj.seat) || adj.judge] = adj.verdict;
    }
    // The raiser's column key. In alias space this is `f.raiser` and every
    // expression below is byte-identical to HEAD.
    const raiserKey = seatSpace ? (f.raiserSeat || f.raiser) : f.raiser;
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
      // (src/council/verdict.js:43). Consumed by electron/workspace-ui/workspace-matrix.js's
      // renderMatrix, which renders a `.debate-badge` in the tier cell (alongside the
      // thin/tierOverride badges) so a withdrawn/amended/defended/no-response finding never
      // renders as an ordinary live row. Absent on non-debate runs, hence `|| null`.
      debate: f.debate || null,
      // The THIRD reader. Its label still resolves from the ALIAS (blind mode
      // must not leak a seat id here either), while its identity is the seat —
      // otherwise the starred column and the Raiser cell name different things.
      raiser: { model: raiserKey, label: labelFor(f.raiser, map) },
      basis: f.basis || { a: 0, d: 0, n: 0 },
      cells: columns.map((c) => {
        const vote = Object.prototype.hasOwnProperty.call(votes, c.key) ? votes[c.key] : null;
        return {
          judge: c.pair,
          verdict: vote,
          sym: vote ? (SYMBOL[vote] || '?') : ' ',
          isRaiser: c.key === raiserKey,
        };
      }),
    };
  });

  return {
    judges: columns.map((c) => c.pair),
    rows,
    tierCounts: (tally && tally.tierCounts) || null,
    judged: !(tally && tally.judged === false),
  };
}

module.exports = { buildMatrixModel };
