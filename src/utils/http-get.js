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
 * REDIRECTS ARE FOLLOWED, AT MOST TWICE (council #230 A2). A 301/302/303/307/308
 * carrying a `Location` is resolved against the URL that produced it and
 * re-issued with the SAME headers under the SAME deadline — one timeout covers
 * the whole chain, so a hop never buys the server more time. The target must be
 * `https:`. A plain-http Location, a missing Location and a third redirect are
 * each an `http-status` failure carrying the status plus a `detail` naming
 * which, so a domain move that loops or downgrades stays visible on the
 * caller's failure line (for the models.dev ceiling fetch, the `Ceilings:` line
 * of `amicus models --refresh`) instead of being chased silently.
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

/**
 * One hop's 3xx: resolve `Location` against the URL that produced it and hand
 * the result to `ctx.hop`, or fail with the status and a `detail` naming why
 * the hop was refused. The response is drained either way.
 * @param {object} res the http.IncomingMessage
 * @param {string} url the URL this response answered
 * @param {number} left redirects still allowed
 * @param {{hop: Function, fail: Function}} ctx
 */
function followRedirect(res, url, left, ctx) {
  const status = res.statusCode;
  const loc = (res.headers && res.headers.location) || null;
  res.on('data', () => {});  // drain: an unread socket is never released
  if (loc === null) { ctx.fail({ reason: 'http-status', status, detail: 'redirect without Location' }); return; }
  if (left <= 0) { ctx.fail({ reason: 'http-status', status, detail: 'redirect limit reached' }); return; }
  let next;
  try {
    next = new URL(loc, url);
  } catch (err) {
    ctx.fail({ reason: 'http-status', status, detail: `redirect to an unparseable Location: ${err.message}` });
    return;
  }
  // https ONLY: a downgrade would re-send the caller's headers in clear text.
  if (next.protocol !== 'https:') { ctx.fail({ reason: 'http-status', status, detail: 'redirect to non-https location' }); return; }
  ctx.hop(next.toString(), left - 1);
}

/**
 * One hop's response: a 3xx goes to followRedirect, any other non-200 is an
 * `http-status` failure once the body drains, a 200 accumulates under the byte
 * cap.
 * @param {object} res the http.IncomingMessage
 * @param {string} url the URL this response answered
 * @param {number} left redirects still allowed
 * @param {{hop: Function, fail: Function, done: Function, onError: Function, destroy: Function, maxBytes: number}} ctx
 */
function readResponse(res, url, left, ctx) {
  // Decode once, at the stream: `chunks += chunk` decodes each Buffer on its
  // own and mangles any multi-byte character split across a chunk boundary.
  res.setEncoding('utf8');
  // A mid-body stream error is emitted on `res`, NOT on `req`. With no listener
  // here node rethrows it as an uncaught exception and the promise never
  // settles — so it is attached once, ahead of the status check, and covers the
  // redirect and non-200 drain branches too.
  res.on('error', ctx.onError);
  if (REDIRECT_STATUS.has(res.statusCode)) { followRedirect(res, url, left, ctx); return; }
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
 * GET `url`; resolve with the raw body on a 200. Follows at most two https
 * redirects under a single deadline and caps the body at `maxBytes`.
 * @param {string} url
 * @param {{headers?: object, timeoutMs?: number, maxBytes?: number}} [opts]
 * @returns {Promise<{ok: true, body: string}|{ok: false, failure: {reason: string, status?: number, detail?: string}}>}
 */
function httpGetText(url, opts = {}) {
  const headers = opts.headers || {};
  const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  const maxBytes = opts.maxBytes === undefined ? DEFAULT_MAX_BYTES : opts.maxBytes;
  return new Promise((resolve) => {
    let req = null;
    let timer = null;
    let settled = false;
    // Single-settle: a timeout, a stream error, a size trip and an `end` can all
    // race, and across a redirect chain the losing hops are still live.
    const done = (v) => { if (settled) { return; } settled = true; clearTimeout(timer); resolve(v); };
    const fail = (failure) => { done({ ok: false, failure }); };
    const onError = (err) => { fail({ reason: 'network-error', detail: err.message }); };
    // ONE deadline for the WHOLE chain — armed before the first hop, never rearmed.
    timer = setTimeout(() => {
      if (req) { req.destroy(); }
      fail({ reason: 'timeout', detail: `no response within ${timeoutMs}ms` });
    }, timeoutMs);
    const ctx = { fail, done, onError, maxBytes, destroy: () => { if (req) { req.destroy(); } }, hop: null };
    ctx.hop = (target, left) => {
      try {
        req = https.get(target, { headers }, (res) => { readResponse(res, target, left, ctx); });
      } catch (err) {
        // `https.get` throws SYNCHRONOUSLY on a malformed URL (and on a bad
        // option object). "Always resolves, never rejects" has to hold for that.
        onError(err);
        return;
      }
      req.on('error', onError);
    };
    ctx.hop(url, MAX_REDIRECTS);
  });
}

/**
 * GET + JSON.parse. A body that is not JSON is a 'parse-error' failure, so a
 * caller sees the transport reasons plus exactly this one more.
 * @param {string} url
 * @param {{headers?: object, timeoutMs?: number, maxBytes?: number}} [opts]
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
