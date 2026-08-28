/**
 * @module live-probes
 * The single gate on outbound AUTHENTICATED network probes made by diagnostics
 * (`amicus doctor` / `init` / the setup finale), which run with the user's real
 * stored keys.
 *
 * OPT-IN, NOT OPT-OUT. `bin/amicus.js` — the one entry point every command
 * routes through — calls enable() at startup. Nothing else does, so a module
 * required directly (by a test, a script, another tool) can never probe.
 *
 * ⚠️ WHY IT IS SHAPED THIS WAY. The first version detected test RUNNERS
 * instead: JEST_WORKER_ID, VITEST, NODE_TEST_CONTEXT. That is a blocklist
 * heuristic, and a blocklist is only as good as its enumeration — a bespoke
 * runner, a plain `node script.js`, or a harness nobody thought of walks
 * straight past it and spends the developer's credentials. Council review of
 * PR 222. Detecting "am I in a test?" is unbounded; asserting "I am the CLI"
 * is a single known fact, so the burden moved to the side that can actually
 * discharge it.
 *
 * ⚠️ AND WHY THAT IS SAFE. Inverting a default risks the opposite failure: miss
 * an entry point and production silently stops probing. That is survivable
 * ONLY because a skipped probe is never reported as healthy — callers must
 * surface it as unverified (see doctor-key-auth-check.js and the
 * `openrouter-credit` row). Worst case is a visible warn, never a false green.
 * If you add an entry point that should probe, call enable() there; if you
 * forget, `doctor` says so out loud.
 */

'use strict';

let enabled = false;

/** Allow live probes for the remainder of this process. Called by bin/amicus.js. */
function enableLiveProbes() {
  enabled = true;
}

/**
 * Whether a live authenticated probe may run right now.
 * `AMICUS_NO_NETWORK_PROBES=1` forces off even for the CLI — an escape hatch
 * for air-gapped or rate-limited environments.
 */
function liveProbesAllowed() {
  if (process.env.AMICUS_NO_NETWORK_PROBES === '1') { return false; }
  return enabled;
}

/** Test-only: restore the default (disabled) state. */
function _resetLiveProbes() {
  enabled = false;
}

module.exports = { enableLiveProbes, liveProbesAllowed, _resetLiveProbes };
