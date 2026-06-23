// src/council/tally.js
'use strict';

/**
 * Peers-only tier cascade. a/d are agree/dispute counts among PEER judges
 * (the raiser's own adjudication is excluded by the caller).
 * Exhaustive and mutually exclusive over all (a,d).
 * @param {number} a - peer agree count
 * @param {number} d - peer dispute count
 * @returns {{tier:string, confidence:'thin'|'solid'}}
 */
function assignTier(a, d) {
  let tier;
  if (d >= 2 && d > a) { tier = 'Disputed'; }
  else if (a >= 2 && a > d) { tier = 'Confirmed'; }
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

module.exports = { assignTier, computeStreetCred };
