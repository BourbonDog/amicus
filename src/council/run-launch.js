// src/council/run-launch.js
'use strict';

/**
 * @module council/run-launch
 * Council-flavored, DI-injected launch wrappers over the fanout transport
 * (spec §5). Every council call — Stage-1 wave, critic/lens solos, Stage-2
 * judge wave, repair re-prompts, chair — goes through runFanout with:
 *   - `--agent Plan` default (fixes the skill-vs-engine 'build' default
 *     mismatch, fanout.js:184),
 *   - `--no-context` (council briefings are self-contained),
 *   - quiet mode (the engine owns stdout; wave docs are consumed in-process).
 * Solos are SINGLE-LEG WAVES: one launch primitive gives every call the same
 * leg contract, budget gate, signal abort, and usage accounting.
 */

const fs = require('fs');
const path = require('path');
// sanitizeName lives in ./seats (v4.8 PR1) so that module can stay
// require-free; re-exported below — run-stage2.js and workspace/artifact-guard.js
// import it from here.
const { sanitizeName } = require('./seats');

/**
 * Did a launch exit because a SIGNAL killed it (130 = SIGINT, 143 = SIGTERM)
 * rather than because the work failed? Every stage loop short-circuits on this
 * instead of treating the wave as a normal failure.
 *
 * It lives HERE, with the module that produces those exit codes, because every
 * stage loop needs it — including run-stage2.js. Defining it in run-stages.js and
 * importing it back from its own child made the two mutually circular, which is
 * why runStage2 could not be re-exported from run-stages.js (v4.4.1 review F5).
 * @param {number} code
 * @returns {boolean}
 */
function isAbortExit(code) { return code === 130 || code === 143; }

/**
 * @param {{fanoutFn?: Function, remainingBudget?: () => number|null,
 *   reserveBudget?: (waveId: string, estimate: number) => boolean,
 *   onBudgetRefusal?: (info: {waveId, models, message}) => void}} [deps]
 *   fanoutFn: test seam; default = real runFanout.
 *   remainingBudget (v4.4): supplies the council's REMAINING `--max-cost`
 *   allowance (ceiling − known spend − outstanding reservations) at launch time,
 *   threaded into the fanout pre-flight estimate gate. Omitted (or returning
 *   null) leaves `maxCost` off the transport call entirely, exactly as before.
 *   reserveBudget (v4.4 cost-council finding 1): the ATOMIC claim. Reading the
 *   remaining allowance is not enough when two waves launch concurrently — both
 *   read the same unreduced number and both pass. The transport calls this once,
 *   synchronously, with the estimate it just computed; see run-budget.js.
 *   onBudgetRefusal: notified when the ceiling refuses a wave, so a seat that
 *   never launched can never vanish silently.
 *   sharedServer (v4.4.1 Task 0.5): a GETTER returning the run's single
 *   {serverClient, server} pair, or null. A getter (not a value) because run.js
 *   builds the launchers before it acquires the server — see ./run-server for
 *   why one server per run, and why `_scratch` isolation survives it. Returning
 *   null leaves the transport call byte-identical: the wave owns its own server.
 * @returns {{launchWave: Function, launchSolo: Function}}
 */
function createLaunchers(deps = {}) {
  const fanoutFn = deps.fanoutFn || require('../sidecar/fanout').runFanout;
  const remainingBudget = deps.remainingBudget || null;
  const reserveBudget = deps.reserveBudget || null;
  const onBudgetRefusal = deps.onBudgetRefusal || null;
  const sharedServer = deps.sharedServer || null;

  /**
   * @param {{models: string[], prompt: string, project: string, waveId: string,
   *   timeout?: number, gateway?: string, noValidateModel?: boolean, agent?: string,
   *   councilRunId?: string, councilName?: string, tag?: string, fallback?: object,
   *   catalog?: Array, noOutputBackstopMs?: number}} opts
   *   councilRunId/councilName (v4.3 Task 3, spec §7.2) are additive attribution
   *   ids forwarded verbatim into the runFanout call so it can stamp them onto
   *   every leg. tag (v4.7 F8 D16) rides the same forward — every call site
   *   below that sets councilRunId/councilName sets `tag: o.tag` alongside it.
   *   fallback/catalog (v4.3 Task 18, spec §6.2) are likewise
   *   additive/opt-in — omitted by callers that must never substitute (the
   *   chair, debate legs); run-stages.js's Stage-1/Stage-2 launches pass them.
   *   noOutputBackstopMs (Task 5, #129) is opt-in and spread-guarded on
   *   Number.isFinite (0 is a valid disable value); only run-retry.js sets it,
   *   to escalate the window on a Stage-1 retry.
   * @returns {Promise<{wave: object|null, exitCode: number}>}
   */
  async function launchWave(opts) {
    fs.mkdirSync(opts.project, { recursive: true });
    // v4.4: arm fanout's SOFT total-$ ceiling with the council's remaining
    // allowance. Previously omitted, so fanout fell back to `cfg.maxCost` (a key
    // src/utils/config.js never defines) and the pre-flight estimate gate was
    // inert for every council run — run.js's post-hoc check was the only ceiling,
    // and it can only refuse after the money is gone. Left OFF when there is no
    // provider or no ceiling, so the transport call is byte-identical for
    // non-council callers and for `--max-cost`-less runs.
    const remaining = remainingBudget ? remainingBudget() : null;
    // v4.4.1 Task 0.5: every launch in the run rides the SAME OpenCode server.
    // NOT `client` — that key is fanout's client TYPE string; the SDK client is
    // `serverClient` (see the seam comment in fanout.js). Absent → the wave
    // starts and closes its own server, exactly as before.
    const shared = sharedServer ? sharedServer() : null;
    const { wave, exitCode, errorDoc } = await fanoutFn({
      ...(typeof remaining === 'number' ? { maxCost: remaining } : {}),
      ...(shared ? { serverClient: shared.serverClient, server: shared.server } : {}),
      // v4.4 cost-council finding 1: `maxCost` above is a READ taken before the
      // transport resolved routing; a concurrently launching sibling can claim
      // part of that allowance in the meantime. This is the CLAIM that settles
      // it — synchronous by contract, so two callers can never interleave.
      ...(reserveBudget ? { reserveBudget: (est) => reserveBudget(opts.waveId, est) } : {}),
      // SL-2: a Stage-1 retry names the wave it replaces; fanout threads this
      // onto every leg and its spend-ledger row (v4.3 --retry-failed machinery).
      // Spread-guarded so a normal launch's transport call stays byte-identical.
      ...(opts.retryOfWaveId ? { retryOfWaveId: opts.retryOfWaveId } : {}),
      models: opts.models.join(','),
      prompt: opts.prompt,
      promptMeta: { source: 'council-engine', file: null, chars: opts.prompt.length },
      waveId: opts.waveId,
      project: opts.project,
      agent: opts.agent || 'Plan',
      timeout: opts.timeout,
      summaryLength: 'verbose',
      includeContext: false,
      gatewayMode: opts.gateway,
      noValidateModel: opts.noValidateModel,
      councilRunId: opts.councilRunId,
      councilName: opts.councilName,
      // v4.7 F8 D16: rides the SAME forward as councilRunId/councilName above —
      // undefined when no --tag, so stampLegAttribution's `if (options.tag)`
      // guard (fanout-wave-io.js) simply no-ops, byte-identical to today.
      tag: opts.tag,
      // Task 5 (#129): spread-guarded on Number.isFinite, NOT on truthiness —
      // an explicit 0 is this knob's documented disable hatch
      // (no-output-backstop.js:13-15) and a truthiness guard would silently
      // drop it. Guarding at all — rather than a plain
      // `noOutputBackstopMs: opts.noOutputBackstopMs` — keeps the transport
      // call key-identical for run-stage1-launch / run-stage2 / run-chair /
      // run-debate, none of which set it.
      ...(Number.isFinite(opts.noOutputBackstopMs) ? { noOutputBackstopMs: opts.noOutputBackstopMs } : {}),
      // v4.3 Task 18 (spec §6.2): additive/opt-in. Callers that must never
      // substitute (run-chair.js, run-debate.js) simply omit these — runLeg's
      // fallback path only activates when `fallback.enabled` is true.
      fallback: opts.fallback,
      catalog: opts.catalog,
      // v4.1 §4.5d: `--no-cost-gate` is a WHOLE-RUN opt-out (an intentional
      // o3-class council), so it has to ride every council launch — otherwise
      // fanout's per-$/Mtok gate refuses the first repair or the chair
      // mid-council. Transport key is literally `noCostGate` (fanout.js
      // guards with `if (!options.noCostGate)`); the CALLERS assemble these
      // option objects, so run-stages/run-chair/run-debate each set it.
      noCostGate: !!opts.noCostGate,
      json: false,
      quiet: true,
      // Spec §6 judge isolation: pin every leg's OpenCode tool-exec cwd to its
      // own session dir (judges' `project` is `<runDir>/_scratch`, so this
      // scopes them there) and strip inherited MCP servers, so a tool-capable
      // judge can't read the de-anonymized review-*.md files or the plaintext
      // labelMap in run.json sitting in the parent run dir.
      directory: opts.project,
      noMcp: true,
    });
    // A ceiling refusal returns `wave: null`, which the council driver's
    // addWave() treats as a no-op — so before v4.4 the seats simply vanished
    // from the bench with nothing on stdout, stderr or run.json to say so. A
    // partial bench is an acceptable outcome; an UNANNOUNCED one is not.
    if (onBudgetRefusal && errorDoc && errorDoc.code === 'BUDGET_EXCEEDED') {
      onBudgetRefusal({ waveId: opts.waveId, models: opts.models.slice(), message: errorDoc.message });
    }
    return { wave, exitCode, errorDoc: errorDoc || null };
  }

  /**
   * One-model launch (critic/lens legs, repairs, the chair) as a 1-leg wave.
   * @returns {Promise<{wave: object|null, exitCode: number, leg: object|null,
   *   errorDoc: object|null}>}
   */
  async function launchSolo(opts) {
    const { wave, exitCode, errorDoc } = await launchWave({ ...opts, models: [opts.model] });
    const leg = (wave && Array.isArray(wave.legs) && wave.legs[0]) || null;
    return { wave, exitCode, leg, errorDoc };
  }

  return { launchWave, launchSolo };
}

/**
 * Write `review-<modelInput>.md` per surviving Stage-1 leg (skill layout).
 * Dead legs and empty summaries are skipped — the caller applies the
 * wave-degrade rules to what remains.
 * @param {string} runDir
 * @param {Array<object>} legs run documents from the wave/solo docs
 * @returns {Array<{model: string, modelInput: string, file: string, text: string, leg: object}>}
 */
function materializeReviews(runDir, legs) {
  const out = [];
  for (const leg of legs) {
    if (!leg || leg.status !== 'complete') { continue; }
    const text = leg.summary;
    if (!text || !String(text).trim()) { continue; }
    const modelInput = leg.modelInput || leg.model;
    const file = path.join(runDir, `review-${sanitizeName(modelInput)}.md`);
    fs.writeFileSync(file, text, { mode: 0o600 });
    out.push({ model: leg.model, modelInput, file, text, leg });
  }
  return out;
}

/**
 * Write per-leg debate artifacts: `<prefix>-<sanitizeName(model)>.md` for each
 * leg with a non-empty summary. Mirrors materializeReviews.
 * @param {string} runDir
 * @param {Array<{model: string, summary: string}>} legs
 * @param {string} prefix 'rebuttal' | 'revote'
 * @returns {Array<{model: string, file: string}>}
 */
function materializeDebate(runDir, legs, prefix) {
  const out = [];
  for (const leg of legs) {
    if (!leg || !leg.summary || !leg.summary.trim()) { continue; }
    const file = path.join(runDir, `${prefix}-${sanitizeName(leg.model)}.md`);
    fs.writeFileSync(file, leg.summary, { mode: 0o600 });
    out.push({ model: leg.model, file });
  }
  return out;
}

module.exports = {
  createLaunchers, materializeReviews, materializeDebate, sanitizeName, isAbortExit,
};
