/**
 * @module utils/engine-skew-records
 * Server identity and the bounded store of standing engine-skew records.
 *
 * EXTRACTED from src/utils/engine-skew.js (v4.9 W10 round 2), which owns the
 * comparison, the announcement and the remedy text and had reached the 300-line
 * gate. Everything here answers one question instead — WHICH SERVER is this,
 * and what was last observed about it — and that is where the round-2 findings
 * on identity collapse (A3), the shared unknown bucket (B3) and unbounded growth
 * (B7) all landed. `engine-skew.js` re-exports the public half, so callers and
 * tests keep one import site.
 *
 * BEST-EFFORT, like its parent: an identity read on a diagnostic path must not
 * be able to fail a session create, so nothing here throws.
 */

'use strict';

/**
 * The standing skew records: server identity -> `{server, installed}`, holding
 * the LAST comparison observed for that server (see noteSessionVersion). Not a
 * single process-wide slot (W10 round-1 review A3+B3): one slot stamped the
 * first skew ever seen onto every later failure, including failures of an
 * unrelated server and failures after the skew was fixed mid-run.
 */
const _skewByServer = new Map();

/** The key used when the client cannot name its server. Distinct from every
 *  real base URL, so an unidentified server borrows no one else's record. */
const UNKNOWN_SERVER_KEY = '<unknown server>';

/**
 * How many servers the map remembers (round-2 review B7). This is
 * process-lifetime state on a path that runs once per session create — every
 * fanout leg, every council seat, for as long as an MCP server stays up — and
 * its key is a server URL, which an operator controls. 32 is far past any real
 * topology (production talks to ONE spawned server per process) while still
 * being a bound rather than a hope.
 */
const MAX_SKEW_SERVERS = 32;

/**
 * The identity of the server this client talks to — its base URL, normalized to
 * an origin AND path.
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
 * THE PATH IS PART OF THE KEY (round-2 review A3). `new URL(raw).origin` alone
 * collapses two distinct servers onto one record whenever they share an origin
 * — a reverse proxy at `…:8080/engine-a` and `…:8080/engine-b`, and MEASURED
 * 2026-08-26, EVERY opaque-origin URL: `new URL('unix:///tmp/a.sock').origin`
 * and its `b.sock` twin are both the literal string `"null"`. A shared record
 * is precisely what per-server keying exists to prevent. Amicus's own topology
 * cannot reach it today — `startServer` is the only production client builder
 * and always passes one spawned server's `http://127.0.0.1:<port>` — but the
 * external/shared-server case in engine-skew.js's SCOPE paragraph can, and
 * keeping the path costs one expression.
 *
 * `_client` is the SDK's own internal handle and the ONLY route to that value
 * (measured: the client's other keys are all resource namespaces). If a future
 * SDK renames it, this returns UNKNOWN_SERVER_KEY and every server shares one
 * bucket again. That bucket is genuinely degraded, not merely coarser: under it
 * a record can be attributed to the wrong server AND cleared by the wrong one.
 * `noteSessionVersion` clears from it anyway, on purpose — its docblock records
 * the measurement behind that ruling.
 *
 * @param {object} [client] - the SDK client, or nothing
 * @returns {string} origin + path, the raw value if it will not parse, else
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
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '') || url.origin;
  } catch (_e) { return raw.trim(); }
}

/** The record standing against one KEY, or undefined. */
function skewForKey(key) {
  return _skewByServer.get(key);
}

/** Record a skew as the most RECENTLY seen, evicting the least recent past the
 *  bound. Re-inserting on every observation is what makes "recent" mean last
 *  observed rather than first seen. */
function rememberSkew(key, skew) {
  _skewByServer.delete(key);
  _skewByServer.set(key, skew);
  while (_skewByServer.size > MAX_SKEW_SERVERS) {
    _skewByServer.delete(_skewByServer.keys().next().value);
  }
}

/** Drop one server's record — a retraction, or "an older engine answers here
 *  now". Safe on a key that was never recorded. */
function forgetSkew(key) {
  _skewByServer.delete(key);
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

/** Test-only: forget every standing record. */
function _resetSkewRecords() {
  _skewByServer.clear();
}

module.exports = {
  serverKeyForClient,
  currentEngineSkew,
  skewForKey,
  rememberSkew,
  forgetSkew,
  UNKNOWN_SERVER_KEY,
  MAX_SKEW_SERVERS,
  _resetSkewRecords,
};
