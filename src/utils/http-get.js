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
 * REDIRECTS ARE NOT FOLLOWED. A 3xx is reported as an `http-status` failure
 * carrying the status, exactly like a 404 or a 500 — so a domain move or an
 * http-to-https hop shows up on the caller's failure line (for the models.dev
 * ceiling fetch, the `Ceilings:` line of `amicus models --refresh`) rather than
 * being followed silently. Adding redirect-following would mean re-deciding
 * which headers survive the hop; the failure is visible instead.
 */

'use strict';

const https = require('https');

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * GET `url`; resolve with the raw body on a 200.
 * @param {string} url
 * @param {{headers?: object, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: true, body: string}|{ok: false, failure: {reason: string, status?: number, detail?: string}}>}
 */
function httpGetText(url, opts = {}) {
  const headers = opts.headers || {};
  const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  return new Promise((resolve) => {
    let chunks = '';
    let req;
    const fail = (failure) => resolve({ ok: false, failure });
    const timer = setTimeout(() => {
      req.destroy();
      fail({ reason: 'timeout', detail: `no response within ${timeoutMs}ms` });
    }, timeoutMs);
    const onError = (err) => { clearTimeout(timer); fail({ reason: 'network-error', detail: err.message }); };
    try {
      req = https.get(url, { headers }, (res) => {
        // Decode once, at the stream: `chunks += chunk` decodes each Buffer on its
        // own and mangles any multi-byte character split across a chunk boundary.
        res.setEncoding('utf8');
        // A mid-body stream error is emitted on `res`, NOT on `req`. With no
        // listener here node rethrows it as an uncaught exception and the promise
        // never settles — so it is attached once, ahead of the status check, and
        // covers the non-200 drain branch too.
        res.on('error', onError);
        if (res.statusCode !== 200) {
          // The timer stays armed until `end`: a non-200 whose body never ends
          // must still time out rather than leave the promise pending for ever.
          res.on('data', () => {});
          res.on('end', () => { clearTimeout(timer); fail({ reason: 'http-status', status: res.statusCode }); });
          return;
        }
        res.on('data', (chunk) => { chunks += chunk; });
        res.on('end', () => { clearTimeout(timer); resolve({ ok: true, body: chunks }); });
      });
    } catch (err) {
      // `https.get` throws SYNCHRONOUSLY on a malformed URL (and on a bad option
      // object). "Always resolves, never rejects" has to hold for that too.
      clearTimeout(timer);
      fail({ reason: 'network-error', detail: err.message });
      return;
    }
    req.on('error', onError);
  });
}

/**
 * GET + JSON.parse. A body that is not JSON is a 'parse-error' failure, so a
 * caller sees the transport reasons plus exactly this one more.
 * @param {string} url
 * @param {{headers?: object, timeoutMs?: number}} [opts]
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

module.exports = { httpGetText, getJson, DEFAULT_TIMEOUT_MS };
