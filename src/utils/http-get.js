'use strict';

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
 */

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
    const fail = (failure) => resolve({ ok: false, failure });
    const timer = setTimeout(() => {
      req.destroy();
      fail({ reason: 'timeout', detail: `no response within ${timeoutMs}ms` });
    }, timeoutMs);
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.on('data', () => {});
        res.on('end', () => fail({ reason: 'http-status', status: res.statusCode }));
        return;
      }
      res.on('data', (chunk) => { chunks += chunk; });
      res.on('end', () => { clearTimeout(timer); resolve({ ok: true, body: chunks }); });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      fail({ reason: 'network-error', detail: err.message });
    });
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
