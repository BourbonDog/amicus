// src/council/tally.js
'use strict';

/**
 * Peers-only tier cascade. a/d are agree/dispute counts among PEER judges
 * (the raiser's own adjudication is excluded by the caller).
 * Exhaustive and mutually exclusive over all (a,d).
 *
 * Uncontested agreement is Confirmed: either a strong majority (a>=2 && a>d)
 * or a lone corroborating peer with no dispute (a=1 && d===0). The latter must
 * not rank weaker than a lone disputing peer (a=0,d=1, which is Contested); the
 * `confidence` flag ('thin' when a+d<=1) is what separates single-peer
 * corroboration from a multi-peer majority. Singleton is now reserved for the
 * no-signal case (a=0,d=0).
 * @param {number} a - peer agree count
 * @param {number} d - peer dispute count
 * @returns {{tier:string, confidence:'thin'|'solid'}}
 */
function assignTier(a, d) {
  let tier;
  if (d >= 2 && d > a) { tier = 'Disputed'; }
  else if ((a >= 2 && a > d) || (a === 1 && d === 0)) { tier = 'Confirmed'; }
  else if (d >= 1) { tier = 'Contested'; }
  else { tier = 'Singleton'; }
  const confidence = (a + d <= 1) ? 'thin' : 'solid';
  return { tier, confidence };
}

function mean(arr) { return arr.reduce((s, x) => s + x, 0) / arr.length; }

/** Map each model to its (possibly fractional) rank position in one judge's order. */
function rankPositions(order) {
  const pos = new Map();
  let p = 1;
  for (const slot of order) {
    const group = Array.isArray(slot) ? slot : [slot];
    const meanPos = p + (group.length - 1) / 2;
    for (const m of group) { pos.set(m, meanPos); }
    p += group.length;
  }
  return pos;
}

/**
 * Both-numbers street-cred. Lower mean rank = better.
 * @param {Array<{judge:string, order:Array<string|string[]>}>} rankings
 * @param {string[]} models all reviewed models (incl. claude when in-council)
 */
function computeStreetCred(rankings, models) {
  const judgePos = rankings.map(r => ({ judge: r.judge, pos: rankPositions(r.order) }));
  return models.map(m => {
    const all = [], peers = [], perJudgeRank = {};
    for (const { judge, pos } of judgePos) {
      if (!pos.has(m)) { continue; }       // absent from this judge's ranking → skip
      const rank = pos.get(m);
      perJudgeRank[judge] = rank;
      all.push(rank);
      if (judge !== m) { peers.push(rank); }
    }
    return {
      model: m,
      withSelf: all.length ? mean(all) : null,
      peersOnly: peers.length ? mean(peers) : null,
      perJudgeRank,
    };
  });
}

// v4.0 §7: council family v2 — every council doc carries {schemaVersion, type}.
const COUNCIL_SCHEMA_VERSION = 2;
const VERDICTS = { agree: 'a', dispute: 'd', neutral: 'n' };

function countTiers(findings) {
  const counts = { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 };
  for (const f of findings) { counts[f.tier] += 1; }
  return counts;
}

/**
 * Deterministic council tally. Pure: no IO. Claude assembles `input`
 * (de-anonymized) and may override margin tiers afterward.
 * @returns {object} record
 */
function tally(input) {
  const { meta, findings, rankings, adjudications, runStats } = input;
  const byFinding = new Map();
  for (const adj of adjudications) {
    if (!byFinding.has(adj.findingId)) { byFinding.set(adj.findingId, []); }
    byFinding.get(adj.findingId).push({ judge: adj.judge, verdict: adj.verdict });
  }
  const outFindings = findings.map(f => {
    const votes = byFinding.get(f.id) || [];
    // Only exclude the raiser's own vote when a raiser is known; the raiser is
    // populated by the orchestrator (not the reviewer JSON), so an unset raiser
    // must not silently drop a real peer vote (L8).
    const peers = f.raiser ? votes.filter(v => v.judge !== f.raiser) : votes;
    const basis = { a: 0, d: 0, n: 0 };
    // Skip unknown verdict strings so a stray value can't corrupt the basis via
    // basis[undefined] = NaN (L9).
    for (const v of peers) {
      const key = VERDICTS[v.verdict];
      if (key !== undefined) { basis[key] += 1; }
    }
    const { tier, confidence } = assignTier(basis.a, basis.d);
    return { id: f.id, raiser: f.raiser, severity: f.severity, tier, basis, confidence,
             tierOverride: null, adjudications: votes };
  });
  return {
    schemaVersion: COUNCIL_SCHEMA_VERSION,
    type: 'council-tally',
    meta,
    judged: Array.isArray(rankings) && rankings.length >= 2,
    streetCred: computeStreetCred(rankings || [], meta.models),
    findings: outFindings,
    runStats: (runStats || []).map(r => ({
      model: r.model, role: r.role, wasChair: !!r.wasChair, conformance: r.conformance || 'clean',
      // ⚠️ Review F3: this allowlist already carries `conformance`, which makes
      // tally.json (and verdict.json, which copies runStats verbatim) THE per-run
      // artifact showing a seat's conformance — so the two facts that qualify it
      // travel with it: LC-11's `findingsUnverified` (contract uncheckable) and
      // F1's `repairRefused` (contract checked and broken). Additive, emitted only
      // when set, and the runStats schema declares no additionalProperties, so a
      // run without either is byte-for-byte unchanged. The append-only LEDGER is
      // deliberately NOT extended — that is a schema-versioned product decision.
      ...(r.findingsUnverified ? { findingsUnverified: true } : {}),
      ...(r.repairRefused ? { repairRefused: r.repairRefused } : {}),
      ...(r.waveId ? { waveId: r.waveId } : {}),
      status: r.status || 'unknown',
      durationMs: typeof r.durationMs === 'number' ? r.durationMs : null,
      usage: r.usage || null,
    })),
    tierCounts: countTiers(outFindings),
  };
}

module.exports = { assignTier, computeStreetCred, tally, COUNCIL_SCHEMA_VERSION };
