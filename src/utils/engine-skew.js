'use strict';

/**
 * @module utils/engine-skew
 * Runtime detection of an opencode ENGINE version skew: the version the server
 * we are actually talking to reports, against the engine sitting in THIS
 * install's node_modules.
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
 * the comparison, the announcement, and the standing record — one per SERVER,
 * refreshed on every create — that `src/headless.js` appends to a leg's death
 * report. That keeps the client's return type a plain session-id string —
 * measured: all three production callers (`headless.js`, `mcp-server.js`,
 * `sidecar/interactive.js`) assign it straight to a `sessionId` string — so no
 * caller had to change.
 *
 * EVERYTHING HERE IS BEST-EFFORT: a diagnosis must never become the failure it
 * reports on. Every path returns null/undefined rather than throwing.
 */

const path = require('path');

/**
 * The standing skew records: server identity -> `{server, installed}`, holding
 * the LAST comparison observed for that server (see noteSessionVersion). Not a
 * single process-wide slot (W10 round-1 review A3+B3): one slot stamped the
 * first skew ever seen onto every later failure, including failures of an
 * unrelated server and failures after the skew was fixed mid-run.
 */
const _skewByServer = new Map();
/** Memo for the installed-version disk read (see installedEngineVersion). */
let _installedRead = false;
let _installedCache;

/** The key used when the client cannot name its server. Distinct from every
 *  real base URL, so an unidentified server borrows no one else's record. */
const UNKNOWN_SERVER_KEY = '<unknown server>';

/** Test-only: clear the standing records and the read memo. */
function _resetEngineSkew() {
  _skewByServer.clear();
  _installedRead = false;
  _installedCache = undefined;
}

/**
 * The identity of the server this client talks to — its base URL, normalized to
 * an origin.
 *
 * MEASURED 2026-08-25 against this checkout's `@opencode-ai/sdk`, not read off
 * the types: `createOpencodeClient({ baseUrl })` returns an object whose only
 * non-namespace key is `_client`, and `client._client.getConfig()` answers
 * `{bodySerializer, headers, parseAs, querySerializer, baseUrl, fetch}` — the
 * `baseUrl` being exactly the string passed in, and `undefined` when none was.
 * That is the SMALLEST honest key available at session-create time: no round
 * trip, no new SDK call, and in production `startServer` always builds the
 * client from one spawned server's own `sdkServer.url`, so distinct servers get
 * distinct ports and distinct keys. It is an identity, not proof of identity —
 * two amicus processes that spawn servers on the same port at different times
 * would collide — which is why every record is also refreshed on each create.
 *
 * `_client` is the SDK's own internal handle and the ONLY route to that value
 * (measured: the client's other keys are all resource namespaces). If a future
 * SDK renames it, this returns UNKNOWN_SERVER_KEY and every server shares one
 * bucket again — a coarser attribution, never a wrong retraction, since the
 * refresh-on-create rule does not depend on the key being distinct.
 *
 * @param {object} [client] - the SDK client, or nothing
 * @returns {string} the origin, the raw value if it will not parse, else
 *   UNKNOWN_SERVER_KEY. Never throws: an identity read on a diagnostic path
 *   must not be able to fail a session create.
 */
function serverKeyForClient(client) {
  let raw;
  try {
    raw = client && client._client && typeof client._client.getConfig === 'function'
      ? client._client.getConfig().baseUrl
      : undefined;
  } catch (_e) {
    return UNKNOWN_SERVER_KEY;
  }
  if (typeof raw !== 'string' || !raw.trim()) { return UNKNOWN_SERVER_KEY; }
  try { return new URL(raw).origin; } catch (_e) { return raw.trim(); }
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
 * The standing skew record for ONE server, or null.
 *
 * A caller with no client gets the UNKNOWN key's record — never another
 * server's. Reading is defensive but cannot meaningfully throw.
 * @param {object} [client] - the SDK client whose server is being asked about
 * @returns {{server: string, installed: string}|null}
 */
function currentEngineSkew(client) {
  try { return _skewByServer.get(serverKeyForClient(client)) || null; } catch (_e) { return null; }
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
 * Silent — returns null, announces nothing, touches no record — when the server
 * reported no usable version (an older SDK/engine: absence of the field is not
 * evidence of anything) or the installed version cannot be read. A version
 * MATCH is also silent, but it does clear that server's record.
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
  if (typeof serverVersion !== 'string' || !serverVersion) { return null; }
  const installed = installedEngineVersion(deps);
  if (typeof installed !== 'string' || !installed) { return null; }
  const key = serverKeyForClient(deps.client);
  if (serverVersion === installed) {
    _skewByServer.delete(key); // the two agree NOW — any older mismatch is stale
    return null;
  }

  const prior = _skewByServer.get(key);
  const skew = { server: serverVersion, installed };
  // Record BEFORE announcing: a notifier that throws must not cost us the
  // enrichment clause too.
  _skewByServer.set(key, skew);
  if (prior && prior.server === skew.server && prior.installed === skew.installed) { return skew; }
  const notify = deps.notify || defaultNotify;
  try { notify(formatSkewWarning(skew)); } catch (_e) { /* best-effort */ }
  return skew;
}

module.exports = {
  noteSessionVersion,
  currentEngineSkew,
  serverKeyForClient,
  UNKNOWN_SERVER_KEY,
  formatSkewWarning,
  formatSkewSuffix,
  installedEngineVersion,
  defaultReadInstalledEngineVersion,
  _resetEngineSkew,
};
