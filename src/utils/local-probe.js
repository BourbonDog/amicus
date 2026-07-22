// src/utils/local-probe.js
'use strict';

/**
 * @module local-probe
 * Scheme-aware (http/https) bounded GET for local / OpenAI-compatible servers
 * (v4.2 §3 http-fix, §4.2 route-time probe, §4.4 catalog rows). Fixes the
 * model-fetcher https-only silent-[] bug for local http endpoints. No redirects
 * followed; bearer attached only to the configured origin; Authorization never
 * logged. Never throws — every failure resolves to unreachable / [].
 */

const http = require('http');
const https = require('https');

/** GET JSON with a hard timeout; no redirect follow. Resolves {status, body} or {status:0}. */
function getJson(url, { timeoutMs, bearer }) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      // Scheme allowlist: http:/https: only. Handing a non-http(s) URL straight to
      // http.get/https.get is not safe to rely on — Node validates the URL's own embedded
      // protocol against the module and throws ERR_INVALID_PROTOCOL synchronously for a
      // mismatch (e.g. file:, ftp:, javascript:), which would otherwise reject this promise
      // instead of resolving it. Reject the scheme ourselves, before any module dispatch.
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { resolve({ status: 0 }); return; }
      const mod = parsed.protocol === 'https:' ? https : http;
      const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {};
      let body = '';
      const req = mod.get(url, { headers }, (res) => {
        const status = res.statusCode || 0;
        // Non-200 (incl. 3xx redirects — NOT followed) → drain + report status, no body parse.
        if (status !== 200) { res.on('data', () => {}); res.on('end', () => resolve({ status })); return; }
        res.on('data', (c) => { body += c; });
        res.on('end', () => { try { resolve({ status, body: JSON.parse(body) }); } catch { resolve({ status: 0 }); } });
      });
      const timer = setTimeout(() => { req.destroy(); resolve({ status: 0 }); }, timeoutMs);
      req.on('error', () => { clearTimeout(timer); resolve({ status: 0 }); });
      req.on('close', () => clearTimeout(timer));
    } catch {
      // Belt and braces: this module's contract is "never throws". Any other synchronous
      // throw we haven't explicitly enumerated (malformed input, etc.) must still resolve.
      resolve({ status: 0 });
    }
  });
}

/** Trim a trailing `/v1` (or `/`) off the baseURL to get the server origin for /api/tags. */
function originOf(baseURL) {
  try { const u = new URL(baseURL); return `${u.protocol}//${u.host}`; } catch { return baseURL; }
}

/** OpenAI /v1/models body → ['<id>/<model>', ...]. */
function idsFromV1(id, body) {
  const data = (body && Array.isArray(body.data)) ? body.data : [];
  return data.map((m) => m && m.id).filter(Boolean).map((name) => `${id}/${name}`);
}

/** Ollama /api/tags body → ['<id>/<model>', ...]. */
function idsFromTags(id, body) {
  const models = (body && Array.isArray(body.models)) ? body.models : [];
  return models.map((m) => m && m.name).filter(Boolean).map((name) => `${id}/${name}`);
}

/**
 * Route-time reachability probe (spec §4.2). Never throws.
 * @param {{id:string, baseURL:string, flavor?:string}} entry
 * @param {{timeoutMs?:number, bearer?:string}} [opts]
 * @returns {Promise<{status:'ok'|'unreachable', models:string[]}>}
 */
async function probeLocalProvider(entry, opts = {}) {
  // Finding 1 (CRITICAL): entry.baseURL.replace(...) below ran before getJson was ever
  // called and outside any try/catch — a missing/null/non-string baseURL (or a missing
  // entry altogether) threw synchronously inside this async function, which rejected the
  // returned promise instead of resolving the documented unreachable/[] shape. This is the
  // same defect shape as the scheme bug already fixed in getJson, one field over: that fix
  // guards the URL's *scheme*; this guards entry.baseURL's *shape*, before it ever reaches
  // getJson. listLocalModels (below) inherits the fix by calling through this function.
  if (!entry || typeof entry.baseURL !== 'string' || !entry.baseURL) { return { status: 'unreachable', models: [] }; }
  const timeoutMs = opts.timeoutMs || 2000;
  const bearer = opts.bearer;
  const primary = await getJson(`${entry.baseURL.replace(/\/$/, '')}/models`, { timeoutMs, bearer });
  if (primary.status === 200) { return { status: 'ok', models: idsFromV1(entry.id, primary.body) }; }
  // Ollama-flavor fallback: older servers answer /api/tags, not /v1/models.
  if (entry.flavor === 'ollama' && primary.status === 404) {
    const tags = await getJson(`${originOf(entry.baseURL)}/api/tags`, { timeoutMs, bearer });
    if (tags.status === 200) { return { status: 'ok', models: idsFromTags(entry.id, tags.body) }; }
  }
  return { status: 'unreachable', models: [] };
}

/**
 * Catalog rows (spec §4.4). Never throws; [] on any failure.
 * @param {{id:string, baseURL:string, flavor?:string, pricing?:object}} entry
 * @param {{timeoutMs?:number, bearer?:string}} [opts]
 * @returns {Promise<Array<object>>}
 */
async function listLocalModels(entry, opts = {}) {
  const timeoutMs = opts.timeoutMs || 5000;
  const probe = await probeLocalProvider(entry, { timeoutMs, bearer: opts.bearer });
  if (probe.status !== 'ok') { return []; }
  const pricing = entry.pricing || { prompt: 0, completion: 0 };
  return probe.models.map((id) => ({
    id, name: id.slice(entry.id.length + 1), contextLength: null, pricing,
    authoritative: true, local: true,
  }));
}

module.exports = { probeLocalProvider, listLocalModels };
