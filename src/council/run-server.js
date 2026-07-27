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
 * Start the run's single OpenCode server.
 *
 * Never fails closed (standing project ruling): a start failure is a NOTICE, not
 * an abort. Returning null simply means no server is injected, so every wave
 * falls back to starting its own — exactly the pre-v4.4.1 behaviour, with the
 * lock-class retry in session-utils still in front of it.
 *
 * @param {object} o the council run's resolved options ({models, critic, chair, …})
 * @param {{startOpenCodeServerFn?: Function}} [deps] test seam
 * @returns {Promise<{serverClient: object, server: object}|null>}
 */
async function acquireRunServer(o, deps = {}) {
  const { logger } = require('../utils/logger');
  const startFn = deps.startOpenCodeServerFn
    || require('../sidecar/session-utils').startOpenCodeServer;
  const { buildMcpConfig } = require('../sidecar/start');

  // Same inputs run-launch.js hands every council launch (see note 3 above).
  const mcpServers = buildMcpConfig({ noMcp: true });
  // Seed provider.models with every model this run can launch. buildProviderModels
  // already registers every CONFIGURED alias (plus its OpenRouter mirror), which
  // covers the alias-shaped bench a council normally runs; this adds any
  // fully-qualified `vendor/model` a caller passed literally, which the alias
  // loop would not see. A chair promoted from the ledger mid-run is the one
  // residual case the seed cannot know about — it is alias-shaped in practice.
  const models = [...(o.models || []), o.critic, o.chair].filter(Boolean);

  try {
    const { client, server } = await startFn(mcpServers, { models });
    logger.info('Council run using ONE shared OpenCode server', { runId: o.runId, url: server.url });
    return { serverClient: client, server };
  } catch (err) {
    logger.warn('Shared OpenCode server unavailable — falling back to one server per wave', {
      runId: o.runId, error: err.message,
    });
    process.stderr.write(
      `Notice: could not start a shared OpenCode server (${err.message}); ` +
      'each wave will start its own.\n');
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

module.exports = { acquireRunServer, releaseRunServer };
