// src/observe/council-legs.js
'use strict';

/**
 * @module observe/council-legs
 * Per-leg row builder for the composed council live doc
 * (buildCouncilStatusPayload in src/mcp-council-awareness.js). Split out of
 * that file to stay under the 300-line gate (DE-ROT Task 0.5, closes F01:
 * `usageLegs` was computed then discarded — no `legs[]` ever reached the
 * payload, so the live Seats panel had no data source).
 *
 * One row per leg id, built UNCONDITIONALLY: unlike the usage rollup (gated
 * on `enriched.usage` in buildCouncilStatusPayload), a live seats panel needs
 * just-started legs — the ones with no usage yet — just as much as priced
 * ones. Field names mirror the wave branch (src/mcp-server.js:592-608) so
 * live-normalize.js (Task 14) has one vocabulary to map, not two.
 *
 * `modelInput` + `role` (F36/F34 correction): a live leg's `model` is the
 * RESOLVED executable id (metadata.model), never the council ALIAS that
 * run.json's bench/chair/critic/lenses and roleFor's rule are keyed on — so
 * deriving role from `model` is a silent no-op (Role column permanently
 * em-dash) and blind mode's labelOf(alias) lookup never matches (real model
 * id leaks). The alias IS on disk per-leg, though: every council leg goes
 * through src/sidecar/fanout-leg.js's runSingleAttempt, which calls
 * `writeLegPatch(legDir, { parentWave, modelInput })` synchronously,
 * immediately after leg creation (fanout-leg.js:101) — well before any
 * status poll could reasonably observe it missing. So this module reads
 * `modelInput` straight off the leg's own metadata.json, no run.json join
 * needed for the alias itself.
 */

const fs = require('fs');
const path = require('path');
const { readProgress, isStalled } = require('../sidecar/progress');
const { enrichLegUsage, TERMINAL } = require('./live-doc');
const { roleFor } = require('../council/run-stages');
const { logger } = require('../utils/logger');

/**
 * A leg's council role. The chair stage is the one case alias identity
 * cannot resolve: run-chair.js's fallback chain (ch1/ch2 = run.chair's own
 * alias, ch3 = a DIFFERENT ledger-promoted alias, ch4 = whichever succeeded)
 * means a chair leg's modelInput does not reliably equal run.json's `chair`
 * field while the chain is still in flight (that field is only checkpointed
 * once the WHOLE chain resolves, src/council/run-chair.js:122) — so alias
 * matching would miss ch3/ch4 mid-run. The stage that owns the leg is the
 * authoritative signal instead (plan's F34 correction: "derive role from the
 * stage that owns the leg"). Every other stage (stage1/stage2/debate-*)
 * reuses roleFor (src/council/run-stages.js) keyed on modelInput — a
 * model's seat/critic/lens identity is stable whether it's reviewing
 * (stage1) or judging (stage2), and a repair/debate leg relaunches the SAME
 * alias as its origin leg, so the identity carries through unchanged.
 * @returns {string|null} null when modelInput is unknown (truthful — never a guess)
 */
function legRole({ bench, critic, lenses, stageName, modelInput }) {
  if (!modelInput) { return null; }
  if (stageName === 'chair') { return 'chair'; }
  // ⚠️ v4.4.1 LC-4: roleFor's LENS branch does `o.models.indexOf(alias)`, so a
  // run.json carrying truthy `lenses` with a missing or non-array `bench` throws
  // a TypeError. This function runs on every status poll, so one malformed
  // run.json took out three surfaces at once: `amicus status`, the amicus_status
  // MCP tool, and `amicus watch`. It was unreachable only because
  // src/council/run.js:72 happens to write `bench` and `lenses` together — an
  // argument that rests entirely on one writer never changing.
  //
  // A role we cannot compute is `null` — the module's existing, documented
  // degradation (an em-dash in the Role column), never a guess and never a
  // throw. The non-lens branch never touches `models`, so it stays exact.
  //
  // ⚠️ v4.4.1 A2: the guard above was ASYMMETRIC — it validated `bench` and took `lenses` on
  // trust, but roleFor's lens branch indexes BOTH (`o.lenses[o.models.indexOf(alias)]`). Neither
  // remaining shape throws, because slug() coerces with String(), so both produced a confident
  // LIE instead of a crash: `lenses: 'security'` with `bench: ['gpt']` indexes the STRING and
  // yields `lens:s`, and a `lenses` array shorter than `bench` yields `lens:undefined`. The
  // length pairing is a real, enforced invariant, not an assumption — cli-handlers-council-run.js:170
  // refuses `--lenses` unless it has exactly one lens per seat — so a run.json that violates it is
  // malformed, and the honest answer for a malformed pairing is the same `null` (an em-dash in the
  // Role column) that LC-4 established, never a guess.
  if (lenses && (!Array.isArray(bench) || !Array.isArray(lenses) || lenses.length !== bench.length)) {
    logger.debug('leg role unresolved: run.json lenses/bench are not a matched pair', {
      modelInput, stageName,
      benchType: bench === null ? 'null' : typeof bench,
      lensesType: lenses === null ? 'null' : typeof lenses,
      benchLength: Array.isArray(bench) ? bench.length : null,
      lensesLength: Array.isArray(lenses) ? lenses.length : null,
    });
    return null;
  }
  return roleFor({ models: bench, critic, lenses }, modelInput);
}

/**
 * One composed row for a leg, plus the ms-since-activity behind its `stalled`
 * flag (or null when not stalled/not yet measurable) so the caller can roll
 * several legs' staleness into one run-level summary without re-parsing
 * `lastActivityAt` back into a timestamp.
 * @param {string} project
 * @param {string} legId
 * @param {{bench: string[], critic: string|null, lenses: string[]|null, stageName: string}} runCtx
 * @returns {{row: object, stalledMs: number|null}}
 */
function buildLegRow(project, legId, runCtx) {
  const { getSessionDir } = require('../session-manager');
  const legDir = getSessionDir(project, legId);
  let meta = {};
  // ⚠️ v4.4.1 LC-9: the catch stays ALL-OR-NOTHING on purpose (Appendix A-9) —
  // it mirrors the wave branch, and a half-parsed metadata object is worse than
  // an empty one. What was wrong was the SILENCE: a corrupt metadata.json, an
  // EACCES on the leg dir, and "the file doesn't exist yet" were indistinguishable
  // and left no trace anywhere, so a leg with corrupt metadata rendered as a
  // just-started leg forever. `code` is what separates them — ENOENT is the
  // ordinary just-started case, anything else is a real fault. Logging only; the
  // branching is untouched.
  try { meta = JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8')); }
  catch (metaErr) {
    logger.debug('leg metadata.json unreadable — rendering the leg with base fields only', {
      legId, code: metaErr.code || null, error: metaErr.message,
    });
  }
  // Truthful null, never metadata.model as a fallback: showing the resolved
  // id where the alias was expected is exactly the F36 bug (blind mode would
  // leak the real model id instead of degrading to an em-dash).
  const modelInput = meta.modelInput || null;
  // LC-4: hoisted out of the object literal below so the guard inside legRole is
  // the only thing standing between a malformed run.json and three live surfaces.
  const role = legRole({ ...runCtx, modelInput });
  const row = {
    taskId: legId, model: meta.model || null, status: meta.status || 'unknown',
    modelInput, role,
  };
  let stalledMs = null;
  let p = null;
  try {
    p = readProgress(legDir);
    row.messages = p.messages;
    row.stage = p.stage;
    row.latestPreview = p.latestPreview;
    row.lastActivityAt = p.lastActivityAt;
    row.stalled = row.status === 'running' && isStalled(p.lastActivityMs);
    if (row.stalled) { stalledMs = p.lastActivityMs; }
  } catch (progressErr) {
    // ⚠️ v4.4.1 LC-9: same deal as the metadata catch above — all-or-nothing by
    // design (A-9), silent by accident. readProgress swallows a malformed
    // progress.json itself, so reaching here means the leg DIR could not be
    // stat'd/read at all (EACCES, a vanished session dir) or readProgress threw
    // on a shape it could not handle — neither of which is "hasn't started yet",
    // and both of which previously left the row indistinguishable from one.
    logger.debug('leg progress unreadable — rendering the leg with base fields only', {
      legId, code: progressErr.code || null, error: progressErr.message,
    });
  }

  // council review C3: this is a SEPARATE try from readProgress's above, on
  // purpose. The old code wrapped both in one try, so a pricing-resolution
  // failure (an unknown model, a corrupt catalog row) landed in the exact same
  // catch as "progress.json doesn't exist yet" — an operator (or the workspace's
  // cost-by-seat panel) could not tell "pricing lookup failed" from "hasn't
  // billed yet"; both rendered as a permanently blank cost cell. `usageError`
  // makes the failure mode truthful and distinguishable, additive to the row
  // (N3's undefined-key discipline still holds: only set usage/usageError when
  // there is something to say).
  //
  // v4.4 B3 (diagnosis §4/§7.3): for a TERMINAL leg, metadata.json's `usage`
  // block wins over the progress.json snapshot. progress.json's usage is stamped
  // ONLY on 'receiving' flushes — which fire on text/tool/reasoning GROWTH, i.e.
  // always strictly before OpenCode's finalization stamp — so on real paid runs
  // 31 of 35 legs ended with an all-zero snapshot while metadata.json held
  // thousands of real tokens and a reported cost. Reading the snapshot for a
  // finished leg made every completed seat look free in the live doc.
  // headless.js now also writes a terminal 'complete' progress record carrying
  // the settled usage, which fixes the DATA; this makes the READER prefer the
  // authoritative source either way, including for every leg already on disk.
  // A still-RUNNING leg keeps reading progress.json — metadata.usage does not
  // exist until the leg finalizes, and read-time resolution is what keeps a live
  // in-flight cost current (live-doc.js's stated design).
  if (TERMINAL.has(row.status) && meta.usage && meta.usage.cost) {
    row.usage = meta.usage;
  } else if (p && p.usage) {
    try {
      const enriched = enrichLegUsage(row, p.usage);
      if (enriched.usage) { row.usage = enriched.usage; }
    } catch (err) {
      row.usageError = err.message;
    }
  }
  return { row, stalledMs };
}

/**
 * Rows for every leg id, plus a run-level stall rollup. A council run fans
 * legs across several parallel sub-waves at once (seat wave, chair chain,
 * lens/critic solos), so — unlike the single-leg wave branch, which only
 * ever flags its own row — a run-level banner needs one summary rather than
 * making the caller inspect every row.
 *
 * The rollup means exactly what the workspace's dead-run banner claims ("no
 * leg activity for Xm — the run may be dead"): the run is stalled only when
 * EVERY still-running leg is stalled. A single stalled leg alongside another
 * leg that is actively producing (message/cost climbing) must NOT set the
 * flag — that was the old (max-based) bug, observed live: `glm` sat stalled
 * for two minutes while `qwen-coder` was visibly working, and the banner
 * fired anyway. A leg that has already finished (any non-'running' status)
 * is terminal — it is excluded from the "every leg" population entirely: it
 * can neither keep the run "healthy" by counting as active, nor drag it
 * "dead" by counting as stalled. Per-leg `row.stalled` is untouched by this —
 * it stays the accurate, per-row signal it already was.
 *
 * When the run genuinely is stalled, `stalledForSeconds` is the SHORTEST
 * idle duration among the stalled running legs, not the longest: that is the
 * honest answer to "how long has the whole run been quiet" — something was
 * still happening as recently as the most-recently-active (but still
 * over-threshold) leg's last activity.
 * @param {string} project
 * @param {string[]} legIds
 * @param {{bench: string[], critic: string|null, lenses: string[]|null, stageName: string}} runCtx
 *   run.json's alias-valued fields (bench/critic/lenses) + the active stage's
 *   name, threaded through to legRole — this module never reads run.json itself.
 * @returns {{rows: object[], stalled?: true, stalledForSeconds?: number}}
 */
function buildLegRows(project, legIds, runCtx) {
  const rows = [];
  let runningCount = 0;
  const stalledRunningMs = [];
  for (const legId of legIds) {
    const { row, stalledMs } = buildLegRow(project, legId, runCtx);
    rows.push(row);
    if (row.status === 'running') {
      runningCount += 1;
      if (stalledMs !== null) { stalledRunningMs.push(stalledMs); }
    }
  }
  const out = { rows };
  if (runningCount > 0 && stalledRunningMs.length === runningCount) {
    out.stalled = true;
    out.stalledForSeconds = Math.floor(Math.min(...stalledRunningMs) / 1000);
  }
  return out;
}

module.exports = { buildLegRows };
