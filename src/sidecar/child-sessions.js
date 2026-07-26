// src/sidecar/child-sessions.js
'use strict';

/**
 * @module sidecar/child-sessions
 * v4.4.1 CA-1 (B4) — enumerate a leg's CHILD (subagent) sessions and total
 * their spend, so it can be attributed to the parent leg instead of vanishing.
 *
 * THE DEFECT. A leg that calls the `task` tool spawns a child OpenCode session.
 * OpenCode bills it separately and does NOT roll it into the parent session's
 * cost, and amicus never enumerated it — so it was invisible to every total the
 * product prints. Measured across the four recorded paid runs: **$0.492506**
 * ($0.021460 in `council-wsgate01`, $0.471046 in `council-wsgate02`).
 * `wsgate01` is the honest limit case: all 7 legs `source: 'reported'`,
 * `unpricedLegs: 0`, and the run still 7.1% short — 100% of that gap was one
 * `explore` child session.
 *
 * WHY IT IS SAFE TO DO THIS NOW. Both blockers named in
 * `cost-pipeline-fix-report.md` §5.4/§5.7 are closed. The client capability was
 * already there (`getChildren`, src/opencode-client.js — only `directory`
 * scoping was missing, backlog LC-7, fixed with this change), and the
 * premature-completion fix (`dcb0792`) means a `task` part goes terminal only
 * once its child session ends, so enumerating at finalization can no longer
 * capture a partial child cost and trade a silent zero for a silent floor.
 *
 * THE HONESTY RULE. Never fabricate a number. `complete: false` is returned
 * whenever any part of the walk could not be carried out — an API failure, a
 * bound, or a child whose spend cannot be stated — and the caller turns that
 * into the leg's existing `subtreeUnknown` flag rather than into a zero. There
 * is deliberately no fourth honesty concept here: what this module produces is
 * either an attributable amount or the flag that already exists for "the
 * subtree is not knowable".
 *
 * A child's price comes from the SAME field the parent's does: the assistant
 * messages' `info.cost`. It is never estimated from a catalog — the SDK's
 * Session record carries no model id, so estimating one would mean guessing
 * which route billed it, and a guess is exactly what this module exists to
 * avoid. A child that shows real tokens but reports no cost is therefore
 * `priced: false` and makes the subtree incomplete (the B2 rule, one level
 * down): work happened, and we cannot state what it cost.
 */

const { getChildren, getMessages } = require('../opencode-client');
const { createMirrorState, mirrorUsageOnly } = require('./conversation-mirror');
const { sumPerMessageUsage, hasObservedTokens } = require('../utils/pricing');

/**
 * Bounds. Hard constants rather than env knobs: they exist to stop a pathological
 * walk, not to be tuned. Real subagent trees observed in the corpus are one child
 * deep and one wide; 4/64 is orders of magnitude of headroom, and exceeding either
 * is reported as INCOMPLETE rather than silently truncated.
 */
const SUBTREE_MAX_DEPTH = 4;
const SUBTREE_MAX_SESSIONS = 64;

/** Resolve, or reject after `ms`. `ms <= 0` passes the promise through untouched. */
function withDeadline(promise, ms) {
  if (!ms || ms <= 0) { return promise; }
  let timer;
  return Promise.race([
    promise.then((v) => { clearTimeout(timer); return v; },
      (e) => { clearTimeout(timer); throw e; }),
    new Promise((_r, reject) => { timer = setTimeout(() => reject(new Error('subtree call timed out')), ms); }),
  ]);
}

function emptyTokens() {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

/**
 * Total one child session's own usage from its assistant messages — the same
 * capture path the parent leg uses (mirrorUsageOnly keys the latest snapshot per
 * message id, so a re-read can never double-count).
 * @returns {{tokens: object, costReported: number, priced: boolean}}
 */
function usageOfSession(messages) {
  const state = createMirrorState();
  mirrorUsageOnly(messages, state);
  const totals = sumPerMessageUsage(state.usageByMsg);
  return {
    tokens: totals.tokens,
    costReported: totals.costReported,
    // "We can state this session's spend." Only a billed amount states it.
    // Tokens with no cost are the child-level form of the B2 lie (`0 × catalog
    // = estimated $0`) and cannot be priced here at all, because the SDK's
    // Session record carries no model id — so they read as unknown, which is
    // what they are. A session with neither tokens nor cost is not free either:
    // we saw nothing, and nothing is not zero.
    priced: totals.costReported > 0,
    observed: hasObservedTokens(totals.tokens),
  };
}

/**
 * Walk `rootSessionId`'s child sessions (breadth-first, bounded, cycle-proof)
 * and total their spend.
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client
 * @param {string} rootSessionId the LEG's own session id (never itself counted)
 * @param {object} [opts]
 * @param {string} [opts.directory] project dir; threaded into every call (#47/LC-7)
 * @param {number} [opts.callTimeoutMs] per-call deadline; 0/absent = no extra timer
 * @param {object} [opts.logger] optional logger for best-effort debug lines
 * @returns {Promise<{sessions: Array<{id: string, tokens: object, costReported: number, priced: boolean}>,
 *   tokens: object, costReported: number, complete: boolean}>}
 */
async function collectSubtreeUsage(client, rootSessionId, opts = {}) {
  const { directory, callTimeoutMs, logger } = opts;
  const dirArgs = directory === undefined ? [] : [directory];
  const tokens = emptyTokens();
  const sessions = [];
  const visited = new Set([rootSessionId]);
  let costReported = 0;
  let complete = true;
  let frontier = [rootSessionId];

  for (let depth = 0; depth < SUBTREE_MAX_DEPTH && frontier.length > 0; depth++) {
    const next = [];
    for (const parentId of frontier) {
      let kids;
      try {
        kids = await withDeadline(getChildren(client, parentId, ...dirArgs), callTimeoutMs);
      } catch (err) {
        // Could not enumerate: the subtree is unknown, not empty.
        complete = false;
        if (logger) { logger.debug('subtree: getChildren failed', { parentId, error: err.message }); }
        continue;
      }
      for (const kid of Array.isArray(kids) ? kids : []) {
        const id = kid && kid.id;
        if (!id || visited.has(id)) { continue; }
        if (visited.size > SUBTREE_MAX_SESSIONS) { complete = false; break; }
        visited.add(id);

        let messages;
        try {
          messages = await withDeadline(getMessages(client, id, ...dirArgs), callTimeoutMs);
        } catch (err) {
          complete = false;
          if (logger) { logger.debug('subtree: getMessages failed', { sessionId: id, error: err.message }); }
          continue;
        }
        const u = usageOfSession(messages);
        sessions.push({ id, tokens: u.tokens, costReported: u.costReported, priced: u.priced });
        if (u.priced) {
          costReported += u.costReported;
          for (const k of Object.keys(tokens)) { tokens[k] += u.tokens[k] || 0; }
        } else {
          // The child exists and we read it, but its spend is not stateable.
          complete = false;
        }
        next.push(id);
      }
    }
    // The frontier is non-empty at the last permitted depth only if there may be
    // another level we are choosing not to walk — say so rather than imply the
    // walk finished.
    if (depth === SUBTREE_MAX_DEPTH - 1 && next.length > 0) { complete = false; }
    frontier = next;
  }

  return { sessions, tokens, costReported, complete };
}

/**
 * Is this leg's subtree spend UNKNOWN, given everything we observed?
 *
 * Split out as a pure predicate because the calibration is the whole argument,
 * and getting it wrong in either direction is a real defect:
 *
 *  - Too eager and the flag cries wolf. An OpenCode server that does not serve
 *    `/session/{id}/children` fails EVERY walk, and a naive `!walkComplete`
 *    would then mark every leg of every run inexact forever — which is not
 *    honesty, it is noise that trains the reader to ignore the one run where it
 *    matters.
 *  - Too lax and it is the silent under-count the flag exists to kill.
 *
 * So it keys on EVIDENCE. A failed walk with no evidence of a subagent at all
 * (no child found, no `task` call recorded) asserts nothing and flags nothing —
 * exactly the pre-CA-1 behaviour. Any positive evidence of a subtree that the
 * walk did not fully account for flags it.
 *
 * @param {{walkComplete: boolean, sessionsFound: number, subagentCalls: number}} obs
 * @returns {boolean}
 */
function subtreeIsUnknown({ walkComplete, sessionsFound, subagentCalls }) {
  const found = sessionsFound > 0;
  const expected = subagentCalls > 0;
  // A clean walk still cannot be believed when it contradicts the other
  // observation: a leg that demonstrably called `task` and yet has no child
  // session means one of the two readings is wrong, and "there was nothing" is
  // not the reading this evidence supports.
  if (walkComplete) { return expected && !found; }
  return found || expected;
}

module.exports = { collectSubtreeUsage, subtreeIsUnknown, SUBTREE_MAX_DEPTH, SUBTREE_MAX_SESSIONS };
