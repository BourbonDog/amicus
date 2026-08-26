// src/council/chair-fallback.js
'use strict';

/**
 * @module council/chair-fallback
 * Chair fallback promotion + attempt classification for the headless chair
 * walk. Moved verbatim from run-chair.js@eb0ff79c:25-104 (v4.9 W4 size-gate
 * split, zero behavior): pickFallbackChair (spec §4 promotion) and
 * classifyChairAttempt (spec §8 LC-5 outcome taxonomy), each with its full
 * docblock. run-chair.js re-exports both, so every existing import path
 * (run.js mid-walk, run-server.js pre-seed, the test suites) is unchanged.
 */

/**
 * Chair fallback promotion (spec §4): the highest peers-only street-cred
 * model from `council stats` that is not a bench seat and not the failed
 * chair. "Highest street-cred" = BEST = numerically LOWEST mean rank
 * (deriveReliability's avgStreetCredPeersOnly; lower is better).
 *
 * The reserved seat name 'claude' is never eligible (v4.1 §4.4 "never chairs"):
 * a --claude-review run puts a real 'claude' row in the ledger, so without this
 * filter a LATER run could promote it and walk straight past the pre-flight
 * --chair claude guard — with no Claude leg to launch.
 *
 * v4.7 GOA-7 D11: exclusions test the group key AND aliases[]; the promoted
 * name is aliases[0] (most-recent alias) so the launch string stays routable
 * through the same alias policy both call sites (run.js mid-walk, run-server.js
 * pre-seed) already resolve.
 * @returns {string|null}
 */
function pickFallbackChair(statsRows, bench, failedChair) {
  const benchSet = new Set(bench);
  // v4.7 GOA-7 D11: an aggregate's identity is its key PLUS every alias it was
  // observed under — post-D10 keys may be executable ids while bench/o.chair
  // stay alias-space, so every exclusion tests the whole name set (a bench
  // seat's resolved-keyed group must never be promoted as its own chair).
  // The LAUNCHED name is aliases[0] (most-recent alias): alias-space names
  // re-enter the router's alias bridge and current key/gateway policy; a raw
  // executable id would dodge them (divergent-vendor forms, openrouter-
  // literals under --gateway direct, dropped aliases). aliases[] is non-empty
  // for every ledger-derived group; the bare-model fallback covers pre-D10
  // aggregate shapes only.
  const names = (r) => [r.model, ...(Array.isArray(r.aliases) ? r.aliases : [])];
  const excluded = (r) => names(r).some(n => n === 'claude' || benchSet.has(n) || n === failedChair);
  // v4.8 PR4a: every sort term is read off the row, so CANDIDATE SELECTION is
  // independent of the order `statsRows` arrives in — previously that order
  // (deriveReliability's Map insertion order = council-ledger.jsonl row order)
  // silently decided every exact street-cred tie, and such ties are an ordinary
  // arithmetic outcome. Terms: street cred (lower mean rank = better), then
  // council appearances, then model id for a guaranteed total order. ⚠️ `runs`
  // is the count of DISTINCT runIds across the group's ledger rows (v4.8 PR4b
  // R4b-1, ledger-stats.js's countRuns) — one council run contributes 1 however many
  // seats that executable filled, and rows from `judged:false` runs that
  // contributed no street cred still count. It is a tie-break, never a ranking
  // signal. Always present on deriveReliability output; the default serves
  // fixtures.
  // Full rationale + the tie arithmetic: tests/council/run-chair.test.js.
  const runsOf = (r) => (typeof r.runs === 'number' ? r.runs : 0);
  const candidates = (statsRows || [])
    .filter(r => !excluded(r) && typeof r.avgStreetCredPeersOnly === 'number')
    .sort((a, b) => (a.avgStreetCredPeersOnly - b.avgStreetCredPeersOnly)
      || (runsOf(b) - runsOf(a))
      || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
  if (!candidates.length) { return null; }
  const top = candidates[0];
  return (Array.isArray(top.aliases) && top.aliases.length) ? top.aliases[0] : top.model;
}

/**
 * Outcome taxonomy for one fallback-walk attempt (spec §8, LC-5). The ch4
 * VERDICT repair is deliberately NOT an attempt: its chair leg already
 * completed — only the verdict line is being re-prompted — and the outcome
 * enum has no honest value for it.
 * @param {object|null} rawLeg the UNFILTERED leg (attemptChair nulls `leg` on
 *   failure; this is the one before that narrowing, so a failed leg document
 *   is still visible here)
 * @param {object|null} [errorDoc] set when the launch never produced a wave
 *   at all (pre-flight refusal) — the only source of a reason in that case
 * @returns {{outcome: 'completed'|'error'|'timeout'|'no-output', reason: string|null}}
 */
function classifyChairAttempt(rawLeg, errorDoc) {
  if (!rawLeg) {
    const reason = (errorDoc && (errorDoc.message || errorDoc.reason)) || 'no leg document';
    return { outcome: 'error', reason };
  }
  if (rawLeg.status === 'timeout') { return { outcome: 'timeout', reason: rawLeg.reason || null }; }
  if (rawLeg.status === 'complete') {
    const hasOutput = rawLeg.summary && String(rawLeg.summary).trim();
    return hasOutput ? { outcome: 'completed', reason: null }
      : { outcome: 'no-output', reason: rawLeg.reason || null };
  }
  return { outcome: 'error', reason: rawLeg.reason || rawLeg.error || String(rawLeg.status) };
}

module.exports = { pickFallbackChair, classifyChairAttempt };
