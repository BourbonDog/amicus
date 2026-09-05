/**
 * @module http-get
 * One HTTPS GET, always resolved, never rejected — the timer/destroy/failure
 * core that model-fetcher.js :: fetchViaConfigDetailed carried inline (#209)
 * and that the models.dev ceiling fetch (#218 P3) needs too. Extracted rather
 * than copied so a second caller cannot drift from the first: the same failure
 * reasons and the same {reason, status?, detail?} shape the catalog persists
 * as providerFailures.
 *
 * The call shape is deliberately `https.get(url, { headers }, cb)` — the one
 * tests/model-fetcher.test.js mocks — so that suite keeps intercepting after
 * the extraction.
 *
 * REDIRECTS ARE OPT-IN, AND THEN FOLLOWED AT MOST TWICE (council #230 A2, made
 * opt-in by #230 D4). Without `followRedirects: true` a 3xx is the terminal
 * `http-status` failure it has always been — the keyed provider fetches in
 * `model-fetcher.js` never hop, so a provider's redirect stays a visible
 * failure rather than a silent behavioural change. With the option on, a
 * 301/302/303/307/308 carrying a `Location` is resolved against the URL that
 * produced it and re-issued under the SAME deadline — one timeout covers the
 * whole chain, so a hop never buys the server more time. The target must be
 * `https:`. A plain-http Location, a missing Location and a third redirect are
 * each an `http-status` failure carrying the status plus a `detail` naming
 * which, so a domain move that loops or downgrades stays visible on the
 * caller's failure line (for the models.dev ceiling fetch, the `Ceilings:` line
 * of `amicus models --refresh`) instead of being chased silently.
 *
 * ONLY AN ALLOWLIST OF HEADERS CROSSES AN ORIGIN (council #230 C3). `model-fetcher.js`
 * hands this module `Authorization: Bearer <key>` (openrouter/openai/deepseek)
 * or `x-api-key` (anthropic), so a 302 — or an open redirect — on a provider
 * host would otherwise forward a live key to whatever host the `Location`
 * named. A same-origin hop keeps every header; a CROSS-ORIGIN hop keeps ONLY
 * `user-agent`, `accept`, `accept-language` and `accept-encoding` (matched
 * case-insensitively) and drops everything else. An allowlist rather than a
 * deny-list because the deny-list has to be extended for every new vendor
 * header — `x-goog-api-key` was not on it — and the one that is forgotten is
 * the one that leaks. Once dropped, stay dropped: the stripped set is what the
 * next hop carries, so a same-origin third hop cannot resurrect a credential.
 *
 * The body is capped at `maxBytes` (council #230 B3): a response that keeps
 * coming is destroyed and reported as `too-large` rather than accumulated in a
 * string until the process dies.
 */

'use strict';

const https = require('https');

const DEFAULT_TIMEOUT_MS = 5000;
/** 16 MiB. models.dev's api.json is ~4.5 MB, so this is headroom, not a budget. */
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
/** Two hops, then `redirect limit reached`. */
const MAX_REDIRECTS = 2;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
/** The ONLY headers a cross-origin hop keeps. Lower-case: callers spell headers freely. */
const CROSS_ORIGIN_HEADERS = new Set(['user-agent', 'accept', 'accept-language', 'accept-encoding']);

/**
 * The headers the NEXT hop may carry. A same-origin hop keeps the caller's
 * object untouched; a cross-origin hop gets a copy holding ONLY the allowlisted
 * names. A current URL that will not parse counts as cross-origin — the safe
 * direction, since the comparison cannot be made.
 * @param {object} headers the headers this hop was issued with
 * @param {string} from the URL that produced the redirect
 * @param {URL} to the resolved target
 * @returns {object} `headers` itself, or an allowlisted copy
 */
function hopHeaders(headers, from, to) {
  let fromOrigin = null;
  try { fromOrigin = new URL(from).origin; } catch (err) { fromOrigin = null; }
  if (fromOrigin !== null && fromOrigin === to.origin) { return headers; }
  const kept = {};
  for (const name of Object.keys(headers)) {
    if (CROSS_ORIGIN_HEADERS.has(name.toLowerCase())) { kept[name] = headers[name]; }
  }
  return kept;
}

/**
 * Retire a SUPERSEDED response before the next hop is started. Its `data`/`end`
 * listeners and — the point of this — the chain's `error` listener are detached
 * first, so an abrupt close on the abandoned socket can no longer settle a
 * promise the live hop now owns. `error` is REPLACED by a swallow rather than
 * simply removed: a destroyed stream still emits, and an 'error' with no
 * listener at all throws as an uncaught exception.
 * @param {object} res the http.IncomingMessage the chain has moved on from
 */
function retire(res) {
  res.removeAllListeners('data');
  res.removeAllListeners('end');
  res.removeAllListeners('error');
  res.on('error', () => {});
  if (typeof res.destroy === 'function') { res.destroy(); }
}

/**
 * One hop's 3xx: resolve `Location` against the URL that produced it, retire
 * this response, and hand the target plus its (possibly stripped) headers to
 * `ctx.hop` — or fail with the status and a `detail` naming why the hop was
 * refused. The response is drained on every refusal.
 * @param {object} res the http.IncomingMessage
 * @param {{url: string, left: number, headers: object}} hop the hop it answered
 * @param {{hop: Function, fail: Function, retireRequest: Function}} ctx
 */
function followRedirect(res, hop, ctx) {
  const status = res.statusCode;
  const loc = (res.headers && res.headers.location) || null;
  res.on('data', () => {});  // drain: an unread socket is never released
  if (loc === null) { ctx.fail({ reason: 'http-status', status, detail: 'redirect without Location' }); return; }
  if (hop.left <= 0) { ctx.fail({ reason: 'http-status', status, detail: 'redirect limit reached' }); return; }
  let next;
  try {
    next = new URL(loc, hop.url);
  } catch (err) {
    ctx.fail({ reason: 'http-status', status, detail: `redirect to an unparseable Location: ${err.message}` });
    return;
  }
  // https ONLY: a downgrade would re-send the caller's headers in clear text.
  if (next.protocol !== 'https:') { ctx.fail({ reason: 'http-status', status, detail: 'redirect to non-https location' }); return; }
  const headers = hopHeaders(hop.headers, hop.url, next);
  retire(res);  // BEFORE the next hop exists, so the two can never race
  ctx.retireRequest();  // and its REQUEST's 'error' listener with it
  ctx.hop({ url: next.toString(), left: hop.left - 1, headers });
}

/**
 * One hop's response: a 3xx goes to followRedirect WHEN the caller opted in,
 * any other non-200 — an un-opted-in 3xx included — is an `http-status` failure
 * once the body drains, a 200 accumulates under the byte cap.
 * @param {object} res the http.IncomingMessage
 * @param {{url: string, left: number, headers: object}} hop the hop it answered
 * @param {{hop: Function, fail: Function, done: Function, onError: Function, destroy: Function,
 *   retireRequest: Function, maxBytes: number, followRedirects: boolean}} ctx
 */
function readResponse(res, hop, ctx) {
  // Decode once, at the stream: `chunks += chunk` decodes each Buffer on its
  // own and mangles any multi-byte character split across a chunk boundary.
  res.setEncoding('utf8');
  // A mid-body stream error is emitted on `res`, NOT on `req`. With no listener
  // here node rethrows it as an uncaught exception and the promise never
  // settles — so it is attached once, ahead of the status check, and covers the
  // redirect and non-200 drain branches too.
  res.on('error', ctx.onError);
  if (ctx.followRedirects && REDIRECT_STATUS.has(res.statusCode)) { followRedirect(res, hop, ctx); return; }
  if (res.statusCode !== 200) {
    // The deadline stays armed until `end`: a non-200 whose body never ends
    // must still time out rather than leave the promise pending for ever.
    res.on('data', () => {});
    res.on('end', () => { ctx.fail({ reason: 'http-status', status: res.statusCode }); });
    return;
  }
  let body = '';
  let bytes = 0;
  res.on('data', (chunk) => {
    // Bytes, not `body.length`: the cap is named in bytes and the stream is
    // already decoded, so a multi-byte body would otherwise pass an over-budget
    // payload through under the character count.
    bytes += Buffer.byteLength(chunk, 'utf8');
    if (bytes > ctx.maxBytes) {
      ctx.destroy();
      ctx.fail({ reason: 'too-large', detail: `body exceeded ${ctx.maxBytes} bytes` });
      return;
    }
    body += chunk;
  });
  res.on('end', () => { ctx.done({ ok: true, body }); });
}

/**
 * GET `url`; resolve with the raw body on a 200. Caps the body at `maxBytes`.
 * With `followRedirects: true` it follows at most two https redirects under a
 * single deadline, keeping only the allowlisted headers on a cross-origin hop;
 * without it a 3xx is a terminal `http-status` failure.
 * @param {string} url
 * @param {{headers?: object, timeoutMs?: number, maxBytes?: number, followRedirects?: boolean}} [opts]
 * @returns {Promise<{ok: true, body: string}|{ok: false, failure: {reason: string, status?: number, detail?: string}}>}
 */
function httpGetText(url, opts = {}) {
  const headers = opts.headers || {};
  const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  const maxBytes = opts.maxBytes === undefined ? DEFAULT_MAX_BYTES : opts.maxBytes;
  const followRedirects = opts.followRedirects === true;
  return new Promise((resolve) => {
    // CHAIN-SCOPED. The deadline and the size trip must destroy the LIVE hop, so
    // every hop assigns this from inside itself BEFORE dispatching its response.
    // An outer `req = https.get(...)` cannot: https.get may call back
    // synchronously, and the next hop's assignment would then be undone by the
    // outer one completing afterwards.
    let current = null;
    let timer = null;
    let settled = false;
    // Single-settle: a timeout, a stream error, a size trip and an `end` can all
    // race, and across a redirect chain the losing hops are still live.
    const done = (v) => { if (settled) { return; } settled = true; clearTimeout(timer); resolve(v); };
    const fail = (failure) => { done({ ok: false, failure }); };
    const onError = (err) => { fail({ reason: 'network-error', detail: err.message }); };
    const destroy = () => { if (current) { current.destroy(); } };
    // A superseded hop's REQUEST keeps `onError` attached, so a late socket
    // error on the abandoned connection would settle a chain the live hop now
    // owns. Swapped for a swallow rather than merely removed: 'error' with no
    // listener at all throws as an uncaught exception. Not destroyed — the
    // response side already is, and destroying the request would fire this.
    const retireRequest = () => {
      if (!current) { return; }
      current.removeAllListeners('error');
      current.on('error', () => {});
    };
    // ONE deadline for the WHOLE chain — armed before the first hop, never rearmed.
    timer = setTimeout(() => { destroy(); fail({ reason: 'timeout', detail: `no response within ${timeoutMs}ms` }); }, timeoutMs);
    const ctx = { fail, done, onError, maxBytes, destroy, retireRequest, followRedirects, hop: null };
    ctx.hop = (hop) => {
      let res = null;
      let armed = false;
      let request;
      try {
        request = https.get(hop.url, { headers: hop.headers }, (r) => { res = r; if (armed) { readResponse(r, hop, ctx); } });
      } catch (err) {
        // `https.get` throws SYNCHRONOUSLY on a malformed URL (and on a bad
        // option object). "Always resolves, never rejects" has to hold for that.
        onError(err);
        return;
      }
      current = request;
      request.on('error', onError);
      armed = true;
      // A callback that already fired SYNCHRONOUSLY is replayed here, now that
      // `current` is this hop's request rather than the previous one's.
      if (res) { readResponse(res, hop, ctx); }
    };
    ctx.hop({ url, left: MAX_REDIRECTS, headers });
  });
}

/**
 * GET + JSON.parse. A body that is not JSON is a 'parse-error' failure, so a
 * caller sees the transport reasons plus exactly this one more.
 * @param {string} url
 * @param {{headers?: object, timeoutMs?: number, maxBytes?: number, followRedirects?: boolean}} [opts]
 * @returns {Promise<{ok: true, json: any}|{ok: false, failure: {reason: string, status?: number, detail?: string}}>}
 */
async function getJson(url, opts) {
  const res = await httpGetText(url, opts);
  if (!res.ok) { return res; }
  try {
    return { ok: true, json: JSON.parse(res.body) };
  } catch (err) {
    return { ok: false, failure: { reason: 'parse-error', detail: err.message } };
  }
}

module.exports = { httpGetText, getJson, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES, MAX_REDIRECTS };
