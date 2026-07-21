// src/council/debate.js
'use strict';

/**
 * @module council/debate
 * PURE final-tally reassembly for headless debate mode (spec §5.5). DI-free —
 * takes the provisional tally input + parsed defense/re-vote maps and returns a
 * new tally input plus the debate.json findings rows. run.js then re-runs
 * tally() on the returned input and decorates the record. Keeps run.js under the
 * line gate.
 */

const PAST_TENSE = { defend: 'defended', amend: 'amended', withdraw: 'withdrawn', 'no-response': 'no-response' };

// runStats roles the ledger join must skip (ledger.js): a debate leg is an extra leg by an
// already-benched model, never an extra ledger row and never that model's ledger identity.
const DEBATE_ROLES = new Set(['rebuttal', 'revote']);

/**
 * Reassemble the tally input after the debate round.
 * @param {{tallyInput: object, provisionalRecord: object|null,
 *   defenseByRaiser: Object<string, Object<string, object>>,
 *   revoteByJudge: Object<string, Object<string, {verdict, reason?}>>}} args
 * @returns {{input: object, debateFindings: Array}}
 */
function applyDebate({ tallyInput, defenseByRaiser, revoteByJudge }) {
  // Deep-ish clone the mutable arrays we touch (findings + adjudications).
  const findings = tallyInput.findings.map(f => ({ ...f }));
  const adjudications = tallyInput.adjudications.map(a => ({ ...a }));

  // Flatten the per-raiser defense map to a per-id lookup + debate.json rows.
  const byId = {};
  const debateFindings = [];
  for (const [raiser, perId] of Object.entries(defenseByRaiser || {})) {
    for (const [id, resp] of Object.entries(perId)) {
      byId[id] = resp;
      const src = findings.find(f => f.id === id) || {};
      const row = { id, raiser, action: resp.action, previousTier: src.previousTier || null };
      if (resp.argument) { row.argument = resp.argument; }
      if (resp.claim) { row.claim = resp.claim; }
      debateFindings.push(row);
    }
  }

  // Amend: swap claim text in place. Withdraw/defend/no-response: findings[] unchanged.
  for (const f of findings) {
    const resp = byId[f.id];
    if (resp && resp.action === 'amend' && typeof resp.claim === 'string') { f.claim = resp.claim; }
    delete f.previousTier; // provisional-only scratch field, never written to tally input
  }

  // Re-vote replacement: replace the wave judge's entry on each bundled id.
  for (const [judge, perId] of Object.entries(revoteByJudge || {})) {
    for (const [id, rv] of Object.entries(perId)) {
      const entry = adjudications.find(a => a.findingId === id && a.judge === judge);
      if (entry) { entry.verdict = rv.verdict; }
      else { adjudications.push({ findingId: id, judge, verdict: rv.verdict }); }
    }
  }

  return { input: { ...tallyInput, findings, adjudications }, debateFindings };
}

/**
 * Inject the additive past-tense debate decoration onto the tally record's
 * findings (spec §5.6). Mutates + returns the record.
 * @param {object} record tally() output
 * @param {Array<{id, action, previousTier}>} debateFindings
 * @returns {object} record
 */
function decorateRecord(record, debateFindings) {
  const byId = new Map((debateFindings || []).map(d => [d.id, d]));
  for (const f of record.findings) {
    const d = byId.get(f.id);
    if (d) { f.debate = { action: PAST_TENSE[d.action] || 'no-response', previousTier: d.previousTier }; }
  }
  return record;
}

/**
 * runStats rows for the debate legs (spec §5.5). role is 'rebuttal' | 'revote';
 * these legs never enter meta.models, so the ledger stays one row per (run×model),
 * and ledger.js skips DEBATE_ROLES when joining runStats so a debate leg cannot
 * overwrite the bench row's role/wasChair/conformance on that model's ledger row.
 * @param {{defenseLegs: Array, revoteLegs: Array}} args leg metadata
 * @returns {Array<object>}
 */
function debateRunStatsRows({ defenseLegs, revoteLegs }) {
  const mk = (role) => (l) => ({
    model: l.model, role, wasChair: false, conformance: l.conformance || 'clean',
    status: l.status || 'unknown',
    durationMs: typeof l.durationMs === 'number' ? l.durationMs : null,
    usage: l.usage || null,
  });
  return [...(defenseLegs || []).map(mk('rebuttal')), ...(revoteLegs || []).map(mk('revote'))];
}

module.exports = { applyDebate, decorateRecord, debateRunStatsRows, PAST_TENSE, DEBATE_ROLES };
