/**
 * @module utils/engine-skew
 * Runtime detection of an opencode ENGINE version skew: server vs installed.
 *
 * The version the server we are actually talking to reports, against the engine
 * sitting in THIS install's node_modules.
 *
 * WHY (#133, piece 3). The outage was one engine version (npx cache, 1.17.3)
 * serving every MCP session while another (global install, 1.18.15) served the
 * CLI, both writing one shared SQLite file — so every MCP prompt died before a
 * model was ever called. `amicus doctor` printed ZERO errors throughout: its
 * skew check (`doctor-engine-check.js`) compares npx-cache copies against the
 * GLOBAL install and says nothing whatever about the copy the running process
 * actually loaded. MEASURED on this machine 2026-08-25: that baseline sees
 * global 1.18.15 vs npx 1.18.15 and reports clean, while the running checkout
 * loads engine **1.2.20** — a live instance of #133's own class, invisible to
 * the check built for it. Hence a RUNTIME comparison with no global baseline.
 *
 * SCOPE, stated honestly (W10 review F2): this handshake fires when the server
 * answering this process was started by a DIFFERENT install (shared or
 * external server, PATH-hoisted binary). In #133's literal recorded topology
 * the npx copy spawned its OWN engine — server and installed versions were
 * EQUAL on that side, the skew being against a global install neither side
 * loads — so THIS check stays silent there; the engine-log excerpt (piece 2)
 * is what names that case, by quoting the SQLiteError itself.
 *
 * MEASURED, not reasoned from types (2026-08-25, against a locally spawned
 * engine): `client.session.create({})` returns
 * `data = {directory,id,projectID,slug,time,title,version}` and `data.version`
 * was `"1.2.20"` — byte-identical to this checkout's
 * `node_modules/opencode-ai/package.json`. `Session.version` IS the engine's
 * own version, so the two sides are directly comparable.
 *
 * SHAPE. `src/opencode-client.js :: createSession` pushes the observed version
 * here together with its client (it discarded both before); this module owns
 * the comparison, the announcement and the remedy text, while
 * `./engine-skew-records.js` owns the server identity and the standing record —
 * one per SERVER, refreshed on every create — that `src/headless.js` appends to
 * a leg's death report. That keeps the client's return type a plain
 * session-id string —
 * measured: all three production callers (`headless.js`, `mcp-server.js`,
 * `sidecar/interactive.js`) assign it straight to a `sessionId` string — so no
 * caller had to change.
 *
 * EVERYTHING HERE IS BEST-EFFORT: a diagnosis must never become the failure it
 * reports on. Every path returns null/undefined rather than throwing.
 */

'use strict';

const path = require('path');
const {
  serverKeyForClient, currentEngineSkew, skewForKey, rememberSkew, forgetSkew,
  UNKNOWN_SERVER_KEY, MAX_SKEW_SERVERS, _resetSkewRecords,
} = require('./engine-skew-records');

/** Memo for the installed-version disk read (see installedEngineVersion). */
let _installedRead = false;
let _installedCache;

/** Test-only: clear the standing records and the read memo. */
function _resetEngineSkew() {
  _resetSkewRecords();
  _installedRead = false;
  _installedCache = undefined;
}

/**
 * Read the engine version out of the RUNNING install's node_modules.
 *
 * Roots come from `path-setup.js :: opencodeRoots()` with no argument — the
 * same resolver `engine-ensure`/`hasOpencodeBinary` use to decide whether THIS
 * process's engine binary exists, so "the engine we would run" and "the engine
 * we version-check" are the same thing by construction.
 *
 * Reading `opencode-ai`'s own package.json (rather than anything next to the
 * binary) mirrors `engine-install-scan.js :: defaultReadEngineVersion`, whose
 * docblock records why: it is a faithful proxy because opencode-ai exact-pins
 * all 12 platform sub-packages, and the binary's own directory has no
 * package.json on POSIX at all.
 *
 * @param {object} [deps]
 * @param {object} [deps.fs] - fs module seam (readFileSync)
 * @param {string[]} [deps.roots] - node_modules roots seam
 * @returns {string|undefined} undefined on every miss path
 */
function defaultReadInstalledEngineVersion(deps = {}) {
  const fs = deps.fs || require('fs');
  const roots = deps.roots || require('./path-setup').opencodeRoots();
  for (const root of roots) {
    try {
      const raw = fs.readFileSync(path.join(root, 'opencode-ai', 'package.json'), 'utf-8');
      const v = JSON.parse(raw).version;
      if (v) { return String(v); }
    } catch (_e) { /* try the next root */ }
  }
  return undefined;
}

/**
 * The installed engine version, read at most ONCE per process.
 *
 * node_modules cannot change under a live process, and this is consulted on
 * every session create (every fanout leg, every council seat) — a per-session
 * stat of two roots would be pure waste. The memo is cleared only by
 * `_resetEngineSkew()`, so a test that swaps seams must reset between cases;
 * production has exactly one call path and never does.
 *
 * @param {object} [deps] - defaultReadInstalledEngineVersion seams, plus:
 * @param {() => (string|undefined)} [deps.readInstalledVersion] - reader seam
 * @returns {string|undefined}
 */
function installedEngineVersion(deps = {}) {
  if (!_installedRead) {
    _installedRead = true;
    try {
      _installedCache = deps.readInstalledVersion
        ? deps.readInstalledVersion()
        : defaultReadInstalledEngineVersion(deps);
    } catch (_e) {
      _installedCache = undefined;
    }
  }
  return _installedCache;
}

/**
 * The one-time notice. Written to stderr, NOT through `logger.warn`.
 *
 * MEASURED: `utils/logger.js :: getCurrentLevel` defaults `LOG_LEVEL` to
 * `'error'`, so `logger.warn` is filtered out on every default install — a
 * self-diagnosis routed there would be silent exactly where it matters, which
 * the product principle rates as bad as a crash. stderr with an `[amicus] `
 * prefix is the house pattern for notices the user must see (the MCP update
 * notice in `mcp-server.js`, `engine-ensure.js`'s self-heal progress) and is
 * safe under MCP stdio, where stdout carries the protocol.
 * @param {string} msg
 */
function defaultNotify(msg) {
  try { process.stderr.write(`[amicus] ${msg}\n`); } catch (_e) { /* EPIPE at shutdown */ }
}

/**
 * The announcement text. Names both versions (the whole point — #133 cost 30
 * minutes because nothing ever printed the two numbers side by side) and then
 * the action that actually ends it: make the two copies the same version.
 *
 * It deliberately does NOT say "see amicus doctor" (W10 round-1 review B1).
 * Doctor's skew check is structurally blind to THIS skew — the module docblock
 * above records the measurement — so pointing there would spend the user's next
 * five minutes on a check that reports clean by construction.
 * @param {{server: string, installed: string}} skew
 * @returns {string} one line
 */
function formatSkewWarning({ server, installed }) {
  return `engine version skew: server ${server} ≠ installed ${installed} — `
    + 'MCP and CLI may be running different engines; update whichever copy is behind '
    + '(`npm i -g amicus`, or re-run the failing surface\'s installer). '
    + '`amicus doctor` cannot see this skew: its baseline compares npx against global, '
    + 'not the server actually answering.';
}

/**
 * The clause appended to an enriched failure message. EMPTY when there is no
 * standing skew, so every message that would not have carried it is
 * byte-identical to what it was before this module existed.
 * @param {{server: string, installed: string}|null} [skew]
 * @returns {string}
 */
function formatSkewSuffix(skew) {
  if (!skew) { return ''; }
  return ` (engine skew: server ${skew.server} ≠ installed ${skew.installed})`;
}

/**
 * Record a server-reported session version as the LAST comparison for that
 * server, announcing a mismatch the first time that server shows it.
 *
 * REFRESHED ON EVERY CREATE, not written once (W10 round-1 review A3+B3): a
 * matching version RETRACTS a standing skew for that server, so a mid-run fix
 * (or a server that was restarted onto the right engine) stops being reported;
 * a different mismatch REPLACES it, because the newer observation is the true
 * one. Records are per server identity, so a skewed server's clause never rides
 * out on an unrelated server's death report.
 *
 * A version-less create CLEARS that server's record (round-2 review B4).
 * Absence of the field means an older SDK or engine is answering — which is not
 * evidence of SKEW, but is evidence that whatever the record describes is no
 * longer what is on that URL. Unknown beats stale. Announcing nothing and
 * returning null, exactly like a match. An unreadable INSTALLED version is
 * different: with one side of the comparison missing there is no observation at
 * all, so that path touches nothing.
 *
 * BOTH CLEARS APPLY UNDER `UNKNOWN_SERVER_KEY` TOO, deliberately (round-2
 * review B3, which proposed the opposite). Under that shared bucket a clear can
 * be wrong — server B's healthy create can delete server A's real skew — so the
 * rule was re-derived against the property that matters, "never attribute a
 * skew to a server that does not have it", and MEASURED as a three-step
 * sequence (A skewed, B healthy, A fixed, A regresses):
 *   retract     → B dies clean, A-after-fix dies clean, A's regression is
 *                 re-recorded on its very next create
 *   never retract → B wears A's skew, A wears its own stale skew after the fix,
 *                 and NOTHING can ever clear either
 * Retraction's error (briefly losing a true skew) is self-healing, because this
 * runs on EVERY create; no-retraction's error is a wrong attribution that no
 * later observation can undo. The shared bucket stays a genuinely degraded
 * mode — see serverKeyForClient — but it is degraded in the recoverable
 * direction.
 *
 * The notice repeats only when the record CHANGES: the skewed leg of a 20-seat
 * wave must not print 20 identical lines.
 *
 * @param {string|undefined} serverVersion - `Session.version` from the create response
 * @param {object} [deps] - installedEngineVersion seams, plus:
 * @param {object} [deps.client] - the SDK client, for the server identity
 * @param {(msg: string) => void} [deps.notify] - notice sink seam
 * @returns {{server: string, installed: string}|null} that server's record
 */
function noteSessionVersion(serverVersion, deps = {}) {
  const key = serverKeyForClient(deps.client);
  if (typeof serverVersion !== 'string' || !serverVersion) {
    forgetSkew(key); // an older engine answers here NOW — unknown beats stale
    return null;
  }
  const installed = installedEngineVersion(deps);
  if (typeof installed !== 'string' || !installed) { return null; }
  if (serverVersion === installed) {
    forgetSkew(key); // the two agree NOW — any older mismatch is stale
    return null;
  }

  const prior = skewForKey(key);
  const skew = { server: serverVersion, installed };
  // Record BEFORE announcing: a notifier that throws must not cost us the
  // enrichment clause too.
  rememberSkew(key, skew);
  if (prior && prior.server === skew.server && prior.installed === skew.installed) { return skew; }
  const notify = deps.notify || defaultNotify;
  try { notify(formatSkewWarning(skew)); } catch (_e) { /* best-effort */ }
  return skew;
}

// Ordered so the FUNCTIONS this module is used for come first: the generated
// `Key Exports` cell in CLAUDE.md keeps five names and renders each as `name()`,
// so a constant in that window reads as a function it is not (round-2 B8).
module.exports = {
  noteSessionVersion,
  currentEngineSkew,
  serverKeyForClient,
  formatSkewWarning,
  formatSkewSuffix,
  installedEngineVersion,
  defaultReadInstalledEngineVersion,
  UNKNOWN_SERVER_KEY,
  MAX_SKEW_SERVERS,
  _resetEngineSkew,
};
