// src/council/run-server.js
'use strict';

/**
 * @module council/run-server
 * ONE OpenCode server per council run (v4.4.1 Task 0.5).
 *
 * A run used to start a server per wave: the Stage-1 seat wave, the critic solo,
 * each findings repair, the Stage-2 judge wave, each judge repair, each debate
 * wave, and the chair chain — 10+ process spawns, each one a fresh chance to
 * lose OpenCode's SQLite startup race. Stage 1 launches its seat wave and its
 * critic solo under one Promise.all (run-stages.js), so two of those starts are
 * ~140ms apart by construction: run v441plan01 lost four of five seats in 736ms
 * to `database is locked` and failed quorum.
 *
 * ⚠️ THE `_scratch/` BOUNDARY IS PRESERVED, and that is not an assumption.
 * Stage 2 runs its judges in `<runDir>/_scratch` so a tool-capable judge cannot
 * read the de-anonymized `review-<model>.md` files or the plaintext labelMap in
 * the parent run dir. Nothing about that isolation lives in the server process:
 *   1. `startOpenCodeServer` takes no project/cwd — `buildServerOptions`
 *      (opencode-client.js) passes only hostname/port/signal/config to
 *      `createOpencodeServer`. The server is directory-agnostic.
 *   2. Scoping is PER CALL: run-launch.js sets `directory: opts.project` on
 *      every launch, fanout threads it to each leg, and runHeadless turns it
 *      into `query.directory` on create/prompt/messages/status/abort (dirArgs,
 *      headless.js). A judge's calls carry `_scratch`; a Stage-1 leg's carry the
 *      run dir. One server answers both, scoped per request.
 *   3. The MCP surface is identical for both stages already: every council
 *      launch passes `noMcp: true` and nothing else MCP-related, and fanout's
 *      buildMcpConfig call receives no `projectDir`, so its result is a pure
 *      function of process-level state — the Stage-1 and Stage-2 servers were
 *      being built from the SAME config all along. `acquireRunServer` rebuilds
 *      it the same way, so a judge sees exactly the MCP servers it saw before.
 * Sharing one server therefore changes which PROCESS answers, never which
 * directory a call is scoped to or which tools a judge is handed.
 */

/**
 * Resolve the EXECUTABLE model ids the run's single server must register.
 *
 * ⚠️ Why raw inputs are not enough (v4.4.1 fix wave, finding F1). The seed lands
 * in `buildProviderModels` (utils/config.js), whose `addRoute` DROPS any string
 * without a `/` — and a council bench is alias-shaped (`gpt`, `glm`, `minimax`).
 * So seeding `[models, critic, chair]` verbatim registered nothing at all beyond
 * the alias loop's own defaults, which is exactly the pre-#61 state Task 4.6/7.3
 * fixed: a leg whose router decision diverges from its alias's stored value (and
 * from that value's curated OpenRouter mirror) is told to launch an id the
 * server never registered.
 *
 * ⚠️ AND PREFIX-STRIPPING IS NOT A SUBSTITUTE. For a DIVERGENT vendor the two
 * gateway-native ids are DIFFERENT STRINGS, not differently prefixed —
 * OpenRouter serves `anthropic/claude-opus-4.8`, the direct API serves
 * `anthropic/claude-opus-4-8` (see utils/curated-models.js `DIVERGENT_VENDORS` /
 * `toGatewayRoutes`). Nothing here derives an id: every id in the seed is one
 * `resolveRouteForLaunch` handed back, which is the same call, with the same
 * inputs, that `fanout-validate.js` makes to decide what a per-wave server
 * registers. Same function, same arguments, same answer.
 *
 * Three sources, matching the three reachable divergences:
 *  1. every bench seat + the critic + the chair (the launches that always happen);
 *  2. the v4.3 Task 18 §6.2 FALLBACK-CHAIN UNION — a substitute that never runs
 *     must still be an allowed model if one IS selected mid-wave. run-launch.js
 *     forwards `fallback`/`catalog` on every stage launch, so a per-wave server
 *     would have registered these; the shared server must too;
 *  3. the chair `pickFallbackChair` could promote out of the reliability ledger.
 *     Deterministic from the ledger as it stands at run start — this run's own
 *     row is appended only AFTER the chair leg, so the pick cannot move under us.
 *
 * NEVER FAILS CLOSED: an unresolvable entry is logged and DROPPED, never an
 * error. Registration is config, not spend — and a leg that cannot route will
 * fail on its own, loudly, in its own wave.
 *
 * @param {object} o the council run's resolved options
 * @param {{resolveRouteFn?: Function, statsFn?: Function}} [deps] test seams
 * @returns {Promise<{models: string[], notices: string[]}>}
 */
async function resolveRunServerModels(o, deps = {}) {
  const { logger } = require('../utils/logger');
  const resolveFn = deps.resolveRouteFn
    || require('../utils/route-launch').resolveRouteForLaunch;
  const gatewayMode = o.gateway || 'auto';
  const validateModel = !o.noValidateModel;
  const ids = new Set();
  const notices = [];

  const resolve = async (input, source) => {
    if (!input || typeof input !== 'string') { return null; }
    let route;
    try {
      route = await resolveFn({ model: input, gatewayMode, source, allowSelection: false, validateModel });
    } catch { route = { kind: 'error' }; }
    if (!route || route.kind !== 'resolved' || !route.executableId) {
      logger.warn('Council model failed to route — dropped from the shared server registration',
        { runId: o.runId, model: input });
      return null;
    }
    ids.add(route.executableId);
    // resolveRouteForLaunch BURNS the one-shot per-vendor migration flag when it
    // builds the result, so whichever caller resolves first owns the notice.
    // That is now this one — carry it out so acquireRunServer can print it
    // rather than letting it evaporate (council waves run quiet, so the wave
    // doc's `notices` were never shown for a council run anyway).
    if (route.notice) { notices.push(route.notice); }
    return route.executableId;
  };

  const primaries = [];
  for (const input of [...(o.models || []), o.critic, o.chair].filter(Boolean)) {
    const id = await resolve(input, 'cli');
    if (id) { primaries.push(id); }
  }

  // (2) fallback-chain union — same derivation fanout-validate.js uses.
  if (o.fallback && o.fallback.enabled) {
    const { deriveChain } = require('../sidecar/fallback-chains');
    for (const primary of primaries) {
      let chain = [];
      try { chain = deriveChain(primary, { config: { chains: o.fallback.chains }, catalog: o.catalog }) || []; }
      catch { chain = []; }
      for (const candidate of chain) { await resolve(candidate, 'fallback'); }
    }
  }

  // (3) the chair the ledger could promote mid-run (run-chair.js).
  try {
    const statsFn = deps.statsFn || require('./ledger').deriveReliability;
    const { pickFallbackChair } = require('./run-chair');
    const promoted = pickFallbackChair(statsFn() || [], o.models || [], o.chair);
    if (promoted) { await resolve(promoted, 'cli'); }
  } catch { /* no ledger yet, or an unreadable one: nothing to promote */ }

  return { models: [...ids], notices: [...new Set(notices)] };
}

/**
 * Record the shared server's fate on run.json — guarded, always.
 *
 * ⚠️ BOOKKEEPING MUST NEVER SINK THE RUN IT REPORTS ON. run.js awaits
 * `acquireRunServer` OUTSIDE its try, so a throw from here would escape
 * runCouncil as a rejection, past its documented "never rejects for run errors"
 * contract, with no result for the caller at all (the run-finalize precedent).
 *
 * `checkpoint` is a READ-MERGE-WRITE (run-state.js: read run.json → shallow
 * `{...existing, ...patch}` → one atomic whole-file write), so writing this key
 * cannot clobber `budgetRefusals[]` or anything else already on the document.
 * Verified, not assumed — `tests/council/run-state.test.js` pins it.
 *
 * @param {object} o the council run's resolved options
 * @param {object} patch a single top-level run.json key
 * @param {string} what the field name, for the failure log
 */
function recordServerFate(o, patch, what) {
  const { logger } = require('../utils/logger');
  try { require('./run-state').checkpoint(o.runDir, patch); }
  catch (writeErr) {
    logger.warn(`Could not record ${what} on run.json`, { runId: o.runId, error: writeErr.message });
  }
}

/**
 * Start the run's single OpenCode server.
 *
 * Never fails closed (standing project ruling): a start failure is a NOTICE, not
 * an abort. Returning null simply means no server is injected, so every wave
 * falls back to starting its own — exactly the pre-v4.4.1 behaviour, with the
 * lock-class retry in session-utils still in front of it. That fallback is also
 * the bug this task removed, so it is recorded on run.json as
 * `sharedServerUnavailable` (Step 10.5); see the catch block.
 *
 * ⚠️ BOTH OUTCOMES ARE RECORDED, and the POSITIVE one is the point. Step 10.5
 * originally made only the failure durable, which left "the shared server WAS
 * used" provable solely by INFERENCE: fanout writes `goPid` into a wave's
 * metadata only for a wave that owns its server (`if (!externalServer …)`), so
 * an investigator had to notice a goPid on the wrong wave and reason backwards.
 * Step 10.5's own text says that inference "should not be the primary
 * diagnostic" — so `sharedServer {acquired, at, goPid, models}` is written on
 * acquisition SUCCESS. A run record now answers the question directly, in the
 * affirmative, and the two keys are mutually exclusive by construction: exactly
 * one of them is present on any run that reached the acquisition.
 *
 * @param {object} o the council run's resolved options ({models, critic, chair, …})
 * @param {{startOpenCodeServerFn?: Function, resolveRouteFn?: Function,
 *   statsFn?: Function}} [deps] test seams
 * @returns {Promise<{serverClient: object, server: object}|null>}
 */
async function acquireRunServer(o, deps = {}) {
  const { logger } = require('../utils/logger');
  const startFn = deps.startOpenCodeServerFn
    || require('../sidecar/session-utils').startOpenCodeServer;
  const { buildMcpConfig } = require('../sidecar/start');

  // Same inputs run-launch.js hands every council launch (see note 3 above).
  const mcpServers = buildMcpConfig({ noMcp: true });
  // #61 Task 4.6/7.3 sole-input invariant, applied one scope level up.
  const { models, notices } = await resolveRunServerModels(o, deps);
  for (const notice of notices) { process.stderr.write(`Notice: ${notice}\n`); }

  try {
    const { client, server } = await startFn(mcpServers, { models });
    logger.info('Council run using ONE shared OpenCode server',
      { runId: o.runId, url: server.url, models: models.length });
    // The POSITIVE, durable signal (see the ⚠️ above). `goPid` is the field that
    // makes it a correlator rather than a boolean: no wave writes a goPid when a
    // server is injected, so "run.json names pid N and no wave metadata does"
    // reads as proof the shared server served the run — no inference required.
    recordServerFate(o, {
      sharedServer: {
        acquired: true, at: new Date().toISOString(),
        goPid: (server && server.goPid) || null, models: models.length,
      },
    }, 'sharedServer');
    return { serverClient: client, server };
  } catch (err) {
    // ⚠️ v4.4.1 Step 10.5: a failed acquisition drops the run back to ONE SERVER
    // PER WAVE — precisely the racy behaviour this task removed. Degrading is
    // correct (never fail closed); degrading QUIETLY is not. Run v441plan02 did
    // exactly this and lost 4 of 5 seats to `database is locked`, and the only
    // signal was a single stderr `Notice:` that a `| tail` discarded. run.json
    // recorded nothing, so the degrade was diagnosable only by inference — a
    // `goPid` on the critic wave, which fanout writes only for a wave that owns
    // its own server. That inference is not a diagnostic. So the degrade is now
    // DURABLE: it lands on the run's own record, next to `budgetRefusals[]`,
    // for the same reason — a silent partial is the failure mode this whole
    // release exists to remove.
    const degrade = { error: err.message, at: new Date().toISOString() };
    recordServerFate(o, { sharedServerUnavailable: degrade }, 'sharedServerUnavailable');
    logger.warn('Shared OpenCode server unavailable — falling back to one server per wave', {
      runId: o.runId, error: err.message,
    });
    process.stderr.write(
      `Notice: could not start a shared OpenCode server (${err.message}); each wave will start `
      + 'its own, which is the configuration that races. Expect degraded results.\n');
    return null;
  }
}

/**
 * Close the run's server. Called from exactly ONE place — run.js's finalize(),
 * the single path every terminal outcome (success, error, abort, signal) already
 * funnels through. A second close site is how a mid-run teardown gets introduced.
 * @param {{server: object}|null} shared
 */
async function releaseRunServer(shared) {
  if (!shared || !shared.server) { return; }
  try { await shared.server.close(); } catch { /* best-effort: the run is over */ }
}

module.exports = { acquireRunServer, releaseRunServer, resolveRunServerModels };
