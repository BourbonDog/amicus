// src/sidecar/fanout-retry.js
'use strict';

/**
 * @module fanout-retry
 * `fanout --retry-failed <waveId>` — relaunch ONLY the dead legs of a prior
 * wave as a NEW linked wave, using each failed leg's own saved initial
 * context for a byte-identical retry (spec 6.1). Split out of fanout.js
 * (⚠️ DE-ROT B1): fanout.js is hard-gated at 300 lines and near the cap —
 * inlining this ~120-line surface would blow it past the limit. Mirrors the
 * fanout-leg-fallback.js extraction precedent (Task 18).
 * `wave.json` is NEVER touched by this module — all linkage (retryOf /
 * retriedBy / retry-started event / effective block) is additive, living in
 * metadata.json (mutable via writeWaveMetadata) and the in-memory wave doc.
 */

const fs = require('fs');
const path = require('path');

/** Terminal, non-complete leg statuses eligible for --retry-failed. */
const ELIGIBLE_RETRY = new Set(['error', 'timeout', 'crashed', 'aborted', 'idle-timeout']);

/**
 * Parse an initial_context.md written by saveInitialContext (session-utils.js:69):
 *   `# System Prompt\n\n<sys>\n\n# User Message (Task)\n\n<user>`
 * Returns null for any file that does not match that exact framing (legacy legs
 * or a hand-edited file) so the caller falls back to briefing.md at launch time.
 * @returns {{systemPrompt: string, userMessage: string}|null}
 */
function parseInitialContext(ctx) {
  const head = '# System Prompt\n\n';
  const marker = '\n\n# User Message (Task)\n\n';
  if (!ctx.startsWith(head)) { return null; }
  const mi = ctx.indexOf(marker, head.length);
  if (mi === -1) { return null; }
  return { systemPrompt: ctx.slice(head.length, mi), userMessage: ctx.slice(mi + marker.length) };
}

/**
 * Plan a --retry-failed relaunch (spec 6.1). Pure over disk: reads the original
 * wave + leg metadata, selects terminal non-complete legs (optionally filtered
 * by --models), and loads each leg's saved initial context for a byte-identical
 * retry. Refuses while the original wave is still running.
 * @returns {{eligible: Array<{legId, model, systemPrompt, userMessage, hadSavedContext}>, error?: string}}
 */
function buildRetryPlan(origWaveId, project, { models } = {}) {
  const { getSessionDir } = require('../session-manager');
  const { SessionPaths } = require('./session-utils');
  const waveDir = getSessionDir(project, origWaveId);
  let waveMeta;
  try { waveMeta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8')); }
  catch { return { eligible: [], error: `wave ${origWaveId} not found` }; }
  if (waveMeta.type !== 'wave') { return { eligible: [], error: `${origWaveId} is not a fan-out wave` }; }
  if (waveMeta.status === 'running') { return { eligible: [], error: `wave ${origWaveId} is still running — wait for it to finish before retrying` }; }

  const wanted = models && models.length ? new Set(models) : null;
  const eligible = [];
  for (const legId of (waveMeta.legs || [])) {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(getSessionDir(project, legId), 'metadata.json'), 'utf-8')); }
    catch { continue; }
    if (!ELIGIBLE_RETRY.has(m.status)) { continue; }
    const model = m.modelInput || m.model;
    if (wanted && !wanted.has(model) && !wanted.has(m.model)) { continue; }
    // load saved initial context (system + user) for a byte-identical retry
    const legDir = getSessionDir(project, legId);
    let systemPrompt = null;
    let userMessage = null;
    let hadSavedContext = false;
    try {
      const parsed = parseInitialContext(fs.readFileSync(SessionPaths.contextFile(legDir), 'utf-8'));
      if (parsed) { ({ systemPrompt, userMessage } = parsed); hadSavedContext = true; }
    } catch { /* legacy leg — fall back to briefing.md at launch time */ }
    eligible.push({ legId, model, systemPrompt, userMessage, hadSavedContext });
  }
  return { eligible };
}

/**
 * Launch a --retry-failed wave (spec 6.1). New linked wave, byte-identical
 * relaunch of the original wave's failed legs. Additive linkage only:
 *   - new wave metadata + doc gain `retryOf:<origWaveId>`
 *   - each new leg metadata gains `retryOf:<origLegId>`
 *   - the ORIGINAL wave metadata gains `retriedBy:[<newWaveId>,...]` (mutable,
 *     abort-wins via writeWaveMetadata) — wave.json is NOT touched
 *   - a `retry-started` event lands in the new wave dir
 *   - the doc gains an `effective` block (per original failed slot: the
 *     retry leg's latest status + usage)
 * Linkage is gated on `runFanout` actually producing a wave: a pre-flight
 * failure inside runFanout (wave:null, e.g. budget gate) must leave the
 * original wave's metadata untouched — no false retriedBy record for a
 * retry that never launched. runFanout suppresses its OWN stdout doc-print
 * for a retry launch (its `options.retryOfWaveId` gate — see fanout.js),
 * so this function owns printing the enriched doc (retryOf + effective),
 * exactly once, respecting the caller's --json/--quiet.
 * @param {object} [opts.runFanout] - injected for tests (defaults to runFanout)
 * @returns {Promise<{wave: object|null, exitCode: number, errorDoc?: object}>}
 */
async function retryFailedWave(origWaveId, project, opts = {}) {
  const { runFanout, deriveLegIds, writeWaveMetadata } = require('./fanout');
  const { generateTaskId } = require('./start');
  const { getSessionDir } = require('../session-manager');
  const { appendEvent } = require('../observe/events');
  const { writeFileAtomic } = require('../utils/atomic-write');
  const { buildWaveResult } = require('../utils/result-schema');
  const runFanoutImpl = opts.runFanout || runFanout;

  const plan = buildRetryPlan(origWaveId, project, { models: opts.models });
  if (plan.error) {
    // no-console (repo lint gate): this module isn't on the CLI-output
    // allowlist (unlike fanout.js) — write directly, matching failJson's
    // established process.stdout/stderr.write pattern for JSON/human output.
    if (!opts.quiet) { process.stderr.write(plan.error + '\n'); }
    const { buildErrorDoc } = require('../utils/error-doc');
    return { wave: null, errorDoc: buildErrorDoc({ code: 'BAD_ARGS', message: plan.error }), exitCode: 1 };
  }
  if (plan.eligible.length === 0) {
    if (!opts.quiet) {
      if (opts.json) {
        // valid-JSON no-op doc (Finding 5) — reuses the wave schema so a
        // --json caller's stdout stays machine-parseable either way.
        const noopDoc = {
          ...buildWaveResult({ waveId: origWaveId, legs: [], status: 'complete' }),
          retryOf: origWaveId, effective: [], note: 'no failed legs',
        };
        process.stdout.write(JSON.stringify(noopDoc, null, 2) + '\n');
      } else {
        process.stdout.write(`No failed legs to retry in ${origWaveId} — nothing to do.\n`);
      }
    }
    return { wave: null, exitCode: 0 };
  }

  const origWaveDir = getSessionDir(project, origWaveId);
  let briefing = '';
  try { briefing = fs.readFileSync(path.join(origWaveDir, 'briefing.md'), 'utf-8'); } catch { /* legacy — empty */ }

  const newWaveId = generateTaskId();
  const models = plan.eligible.map(e => e.model);
  const retryContexts = plan.eligible.map(e => ({
    origLegId: e.legId, systemPrompt: e.systemPrompt, userMessage: e.userMessage, hadSavedContext: e.hadSavedContext,
  }));

  // Launch the new wave. `retryContexts`/`retryOfWaveId` are additive options;
  // runFanout uses each slot's saved system/user verbatim when present (Step 4b)
  // and threads retryOfWaveId onto each leg so Task 1's append tags the rows.
  // `models` MUST be the comma-separated STRING runFanout's own validator
  // expects (parseModelsList/validateFanoutModels) — an array silently fails
  // every leg pre-flight (BAD_ARGS), matching run-launch.js:41's precedent.
  // Strip our own injection key so it is never forwarded.
  const fanoutOpts = { ...opts, models: models.join(','), prompt: briefing, project, waveId: newWaveId, retryContexts, retryOfWaveId: origWaveId };
  delete fanoutOpts.runFanout;
  const { wave, exitCode } = await runFanoutImpl(fanoutOpts);

  // No wave produced (pre-flight failure inside runFanout) — nothing
  // launched, so no linkage may be recorded on the original wave.
  if (!wave) { return { wave: null, exitCode }; }

  // --- additive linkage (best-effort; a missing dir never throws) ---
  const newWaveDir = getSessionDir(project, newWaveId);
  writeWaveMetadata(newWaveDir, { retryOf: origWaveId });
  wave.retryOf = origWaveId;

  const newLegIds = deriveLegIds(newWaveId, plan.eligible.length);
  newLegIds.forEach((newLegId, i) => {
    const mp = path.join(getSessionDir(project, newLegId), 'metadata.json');
    try {
      const m = JSON.parse(fs.readFileSync(mp, 'utf-8'));
      m.retryOf = retryContexts[i].origLegId;
      writeFileAtomic(mp, JSON.stringify(m, null, 2), { mode: 0o600 });
    } catch { /* leg dir absent (short-circuited wave) — best-effort */ }
  });

  // original wave gains retriedBy:[...] (dedup; abort-wins merge)
  let origMeta = {};
  try { origMeta = JSON.parse(fs.readFileSync(path.join(origWaveDir, 'metadata.json'), 'utf-8')); } catch { /* corrupt */ }
  const retriedBy = Array.isArray(origMeta.retriedBy) ? origMeta.retriedBy.slice() : [];
  if (!retriedBy.includes(newWaveId)) { retriedBy.push(newWaveId); }
  writeWaveMetadata(origWaveDir, { retriedBy });

  // milestone: retry-started into the NEW wave dir (never-throws appendEvent)
  appendEvent(newWaveDir, { event: 'retry-started', id: newWaveId, retryOf: origWaveId, legIds: newLegIds });

  // effective block: original failed slot -> the retry leg's latest status/usage
  const legs = Array.isArray(wave.legs) ? wave.legs : [];
  const effective = plan.eligible.map((e, i) => ({
    origLegId: e.legId, model: e.model,
    status: legs[i] ? legs[i].status : 'unknown',
    usage: legs[i] ? (legs[i].usage || null) : null,
  }));
  wave.effective = effective;

  // runFanout suppressed its own stdout print for this retry launch (its
  // options.retryOfWaveId gate) — print the enriched doc (retryOf +
  // effective now attached) ONCE, respecting --json/--quiet (Finding 3).
  if (!opts.quiet) {
    if (opts.json) {
      process.stdout.write(JSON.stringify(wave, null, 2) + '\n');
    } else {
      const { formatWaveHuman } = require('./fanout-output');
      process.stdout.write(formatWaveHuman(wave) + '\n');
    }
  }

  return { wave, exitCode };
}

module.exports = { ELIGIBLE_RETRY, parseInitialContext, buildRetryPlan, retryFailedWave };
