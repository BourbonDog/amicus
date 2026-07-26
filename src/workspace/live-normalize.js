/**
 * Council Workspace — live-doc normalization (v4.4 §3 A1/A2/A4 seam).
 *
 * ONE defensive mapping from the v4.3 composed live doc (the amicus_status
 * rollup stamped view:'live') to the renderer's seat model. If the merged
 * composed-doc shape ever drifts, THIS file moves and nothing else does.
 * Liveness/staleness is passed through, never invented here (A4).
 *
 * The council composed doc (buildCouncilStatusPayload, src/mcp-council-
 * awareness.js) is UNVERSIONED (F63) and carries: {taskId, type, runId,
 * runDir, status, currentStage, stages:[{name,status,waveId}], legsTotal,
 * legsComplete, elapsed, exitCode, version, view:'live', usage?, reason?,
 * legs:[{taskId, model, modelInput, role, status, messages, stage,
 * latestPreview, lastActivityAt, stalled, usage?}], stalled?,
 * stalledForSeconds?}. Do NOT copy the WAVE doc's shape (src/mcp-server.js:
 * 592-662) — that is a different document, gated on metadata.type === 'wave'.
 */
'use strict';

const { formatCost } = require('../utils/pricing');
const { TERMINAL_STATUSES } = require('./run-detail');

function legRowsOf(doc) {
  if (Array.isArray(doc.legs)) { return doc.legs; }
  if (doc.wave && Array.isArray(doc.wave.legs)) { return doc.wave.legs; }
  return [];
}

function numOrNull(v) { return typeof v === 'number' ? v : null; }

function seatOf(leg) {
  const usage = leg.usage || null;
  const tokens = usage && usage.tokens ? usage.tokens : null;
  return {
    id: leg.taskId || leg.legId || null,
    // ⚠️ DE-ROT (F34/F36): `model` and `modelInput` are TWO SEPARATE fields, never collapsed.
    // A live leg's `model` is the resolved executable id (e.g. `google/gemini-2.5`); `modelInput`
    // is the council ALIAS (e.g. `gemini`) that run.json's labelMap and blind mode's labelFor()
    // key on (src/council/anonymize.js:30 stamps labelMap values from the alias, never the
    // resolved id). The already-shipped electron/workspace-ui/live-model.js:55 reads
    // `seat.modelInput || seat.model` to pick the alias for its label lookup — collapsing the two
    // into one field here would silently break blind mode (a resolved-id lookup never matches
    // labelMap, leaking the real model id instead of degrading to a label or an em-dash).
    model: leg.model || null,
    modelInput: leg.modelInput || null,
    role: leg.role || null,
    status: leg.status || 'unknown',
    // ⚠️ PRE-FLIGHT (P5): `leg.phase` is dead weight — Task 0.5 does not emit it. `leg.stage` IS
    // emitted (src/observe/council-legs.js:88), so it is the only source; no fallback to invent.
    stage: leg.stage || null,
    messages: leg.messages === undefined ? null : leg.messages,
    tokensIn: tokens ? numOrNull(tokens.input) : null,
    tokensOut: tokens ? numOrNull(tokens.output) : null,
    costDisplay: usage && usage.cost ? formatCost(usage.cost) : null,
    // ⚠️ PRE-FLIGHT (P5): maps the ISO `lastActivityAt` only. `leg.lastActivity` /
    // `leg.latestActivity` do not exist on a real leg row (`latestActivity` is an action LABEL —
    // "Using <tool>" — not a time), so falling back to either would put prose in a timestamp
    // column or leave it permanently null.
    lastActivity: leg.lastActivityAt || null,
    latestPreview: leg.latestPreview || null,
    stalled: leg.stalled === true,
  };
}

/**
 * How many legs in this stage rollup contributed NO amount (v4.4 §8). Read off
 * sumWaveUsage's `unpricedLegs` (src/observe/live-doc.js rollupWaveUsage), which
 * the composed doc already carries — nothing new is invented renderer-side.
 */
function liveUnknownLegs(doc) {
  const c = doc.usage && doc.usage.cost ? doc.usage.cost : null;
  return (c && typeof c.unpricedLegs === 'number') ? c.unpricedLegs : 0;
}

/**
 * How many legs in this rollup have an unattributed subagent SUBTREE (v4.4
 * Task 2) — their own cost is known, but they spawned a child OpenCode session
 * that is billed separately and never enumerated. Distinct from an unpriced leg,
 * and the reason a fully-priced total can still be short.
 */
function liveSubtreeUnknownLegs(doc) {
  const c = doc.usage && doc.usage.cost ? doc.usage.cost : null;
  return (c && typeof c.subtreeUnknownLegs === 'number') ? c.subtreeUnknownLegs : 0;
}

function liveCostDisplay(doc) {
  if (!doc.usage || !doc.usage.cost) { return null; }
  const base = formatCost(doc.usage.cost);
  const parts = [];
  const unknown = liveUnknownLegs(doc);
  const subtree = liveSubtreeUnknownLegs(doc);
  if (unknown > 0) { parts.push(`${unknown} unknown`); }
  if (subtree > 0) { parts.push(`${subtree} subagent subtree`); }
  return parts.length > 0 ? `${base} + ${parts.join(' + ')}` : base;
}

/**
 * @param {object} doc composed live doc (amicus_status payload)
 * @returns {object} LiveModel (see plan Shared contracts); {ok:false, error?} on junk
 */
function normalizeLive(doc) {
  if (!doc || typeof doc !== 'object') { return { ok: false, error: 'no live doc' }; }
  const stages = Array.isArray(doc.stages) ? doc.stages : null;
  const active = stages ? (stages.find((s) => s.status === 'running') || null) : null;
  const status = doc.status || 'unknown';
  return {
    ok: true,
    view: doc.view || null,
    runId: doc.runId || doc.taskId || null,
    status,
    // ⚠️ PRE-FLIGHT (P6): the fallback read `doc.stage`, which NO producer emits — the council
    // payload's field is `currentStage` (src/mcp-council-awareness.js:155). Harmless today only by
    // coincidence: `currentStage` is computed from the same `stages.find(status === 'running')`
    // predicate as `active`, so both arms are null in exactly the same cases. But it is the same
    // read-a-field-nobody-writes class as P5, and this is the arm that would matter if `stages`
    // ever arrived non-array. Read the field that exists.
    stageName: active ? active.name : (doc.currentStage || null),
    stages,
    seats: legRowsOf(doc).map(seatOf),
    // The two counters the payload already ships (src/mcp-council-awareness.js:149) — the honest
    // fallback readout if a seat row is ever unavailable.
    legsTotal: typeof doc.legsTotal === 'number' ? doc.legsTotal : null,
    legsComplete: typeof doc.legsComplete === 'number' ? doc.legsComplete : null,
    // ⚠️ DE-ROT (F39): these two are ACTIVE-STAGE spend, not the run total.
    // buildCouncilStatusPayload rolls up only the legs of the currently-RUNNING stage's sub-waves
    // (mcp-council-awareness.js:136-146) and omits `usage` entirely until one of those legs flushes
    // progress.usage (:154), so the number under-reports and RESETS at each stage boundary; stages
    // with no `project` (tally, verdict) contribute nothing. Decision: keep the field, LABEL it
    // stage-scoped in the renderer (Task 15 suffixes the gauge text "(this stage)"). Do NOT try to
    // add it onto `derived.cost.costAmount` — that is null for the entire life of the live loop
    // (run-detail reads run.json's `usage`, which stays null until finalize(), run.js:98-102), so
    // "adding" is just a rename of the same stage figure. The only run total is the terminal one.
    // v4.4 §8: same treatment as the terminal panel (run-detail.js costPanel) —
    // a stage rollup that omits unpriced legs reads as the full stage spend.
    costDisplay: liveCostDisplay(doc),
    costAmount: doc.usage && doc.usage.cost && typeof doc.usage.cost.amount === 'number' ? doc.usage.cost.amount : null,
    costUnknownLegs: liveUnknownLegs(doc),
    costSubtreeUnknownLegs: liveSubtreeUnknownLegs(doc),
    costExact: liveUnknownLegs(doc) === 0 && liveSubtreeUnknownLegs(doc) === 0,
    flags: {
      // ⚠️ DE-ROT (F03): `crashed` exists nowhere on the composed doc — Task 0.5 deliberately did
      // not add one (out of scope; see task-0.5-report.md). A crashed council instead flips
      // `status` to 'error' and stamps `reason` from run.error
      // (src/mcp-council-awareness.js:110-123) — that is the only real signal, so `crashed` is
      // DERIVED from it here rather than read off a `doc.crashed` field that no real payload ever
      // sets. This is still "never invented renderer-side" (A4): the derivation lives in this
      // seam, not in electron/workspace-ui/*, and uses only fields the data layer actually wrote.
      crashed: status === 'error' && Boolean(doc.reason),
      stalled: doc.stalled === true,
      stalledForSeconds: typeof doc.stalledForSeconds === 'number' ? doc.stalledForSeconds : null,
    },
    terminal: TERMINAL_STATUSES.includes(status),
  };
}

module.exports = { normalizeLive };
