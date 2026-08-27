/**
 * @module doctor-key-auth-check
 * The `key-auth` doctor row (issue #210), split out of src/cli-handlers-doctor.js
 * to keep that file under the 300-line size gate (mirrors
 * doctor-base-url-check.js / doctor-alias-check.js / doctor-local-providers-check.js).
 *
 * WHY IT EXISTS: doctor's `keys` row tests PRESENCE only — readApiKeys()
 * returns booleans — and validateApiKey() was called at exactly two SAVE-TIME
 * sites (electron/ipc-setup.js, src/cli-handlers.js). A key that rotted after
 * it was entered, or that reached .env by any path other than the wizard /
 * `amicus key`, was never re-checked: #210's reporter had a green doctor while
 * the stored DeepSeek key returned 401 and the catalog served 0 deepseek rows.
 *
 * THE STATUS RULE (the whole design problem is FALSE ALARMS):
 *   - definitive auth rejection → 'error'. The evidence is the HTTP STATUS,
 *     not the prose: `classifyProbeFailure` pulls the last parenthesised
 *     3-digit status out of validateApiKey's error string and treats 401/403
 *     — and only those — as authoritative. 401/403 is the server saying "this
 *     credential is not accepted"; nothing else in the space says that.
 *     Anchoring on the status rather than on the literal
 *     "Invalid API key (401)" wording keeps the rule correct if
 *     api-key-validation.js ever rewords, and correctly catches an
 *     "Unexpected response (403)" too.
 *   - EVERYTHING else → 'warn'. Timeout, DNS/socket error, 5xx, 429, an
 *     unexpected 4xx, an unparseable message: none of these distinguish a
 *     rotted key from a laptop on a plane. Unrecognised input falls to the
 *     ambiguous side ON PURPOSE — the failure mode of a false 'error' here is
 *     a user re-entering a perfectly good key, which is worse than a warn.
 *   - no keys stored → 'ok' + "skipped" (mirrors the openrouter-credit skip).
 *
 * NO KEY MATERIAL, NO URLs, EVER. Two hard rules, both structural rather than
 * best-effort:
 *   1. Only provider IDS and a sanitized reason reach the row — the raw error
 *      string is never echoed. validateApiKey builds the Google probe as
 *      `${url}?key=${key}`, so any message that quotes its request URL quotes
 *      the key with it.
 *   2. Each probe is individually caught. validateApiKey is documented to
 *      resolve-never-reject, but https.get() can throw SYNCHRONOUSLY inside its
 *      promise executor (ERR_INVALID_URL), which rejects — and that message
 *      echoes the full URL. Uncaught, guardAsync in cli-handlers-doctor.js
 *      would print it as the row message.
 *
 * Probes run in PARALLEL: validateApiKey's own timeout is 10s, so five stored
 * keys probed sequentially would add up to 50s to a `doctor` run. Fan-out is
 * bounded by the number of configured providers (5 today), so no pool is needed.
 */

'use strict';

const { VALIDATION_ENDPOINTS } = require('./api-key-validation');

const ID = 'key-auth';
const NAME = 'API key auth';

/** Statuses that are an authoritative "this credential is not accepted". */
const DEFINITIVE_STATUSES = new Set([401, 403]);

const REENTER_HINT = (providers) =>
  `amicus key <provider> <key>  (re-enter the rejected key for: ${providers.join(', ')})`;

const UNVERIFIED_HINT =
  'Not a rejection — the probe could not reach the provider (offline, DNS failure, '
  + '5xx or timeout). Re-run `amicus doctor` when connectivity is restored.';

/**
 * Classify one validateApiKey failure as a definitive auth rejection or an
 * ambiguous one, and produce the SANITIZED reason that may be printed.
 *
 * The returned `reason` is built here from scratch — it never contains any
 * substring of `error`, which is what makes the no-URL/no-key guarantee
 * structural instead of a hope about provider prose.
 *
 * @param {string} [error] validateApiKey's `error` field
 * @returns {{definitive: boolean, reason: string}}
 */
function classifyProbeFailure(error) {
  const text = typeof error === 'string' ? error : '';
  // Last parenthesised 3-digit group: "Invalid API key (401)",
  // "Server error (503)", "Unexpected response (404)".
  const matches = text.match(/\((\d{3})\)/g) || [];
  const last = matches.length ? matches[matches.length - 1] : null;
  const status = last ? parseInt(last.slice(1, -1), 10) : null;

  if (status !== null && DEFINITIVE_STATUSES.has(status)) {
    return { definitive: true, reason: `rejected (HTTP ${status})` };
  }
  if (status !== null) {
    return { definitive: false, reason: `unverified (HTTP ${status})` };
  }
  if (/timed?\s*out|timeout/i.test(text)) {
    return { definitive: false, reason: 'unverified (timed out)' };
  }
  return { definitive: false, reason: 'unverified (unreachable)' };
}

/**
 * Probe one stored key. Always resolves; never surfaces `error`/`e.message`.
 * @returns {Promise<{provider: string, part: string, rejected: boolean, unverified: boolean}>}
 */
async function probeOne(d, provider, key) {
  let res;
  try {
    res = await d.validateApiKey(provider, key);
  } catch (_e) {
    // See rule 2 in the file header: _e.message can carry the Google probe URL,
    // key included. It is deliberately dropped rather than logged.
    return { provider, part: `${provider}: unverified (probe failed)`, rejected: false, unverified: true };
  }
  if (res && res.valid) {
    return { provider, part: `${provider}: valid`, rejected: false, unverified: false };
  }
  const { definitive, reason } = classifyProbeFailure(res && res.error);
  return { provider, part: `${provider}: ${reason}`, rejected: definitive, unverified: !definitive };
}

/**
 * @param {{readApiKeyValues: () => Object<string,string>,
 *          validateApiKey: (provider:string, key:string) => Promise<{valid:boolean, error?:string}>}} d
 * @returns {Promise<{id:string, name:string, status:string, message:string, hint:?string}>}
 */
async function evaluateKeyAuth(d) {
  const values = d.readApiKeyValues() || {};
  // Object.keys + bracket access (never `for..in`) — same prototype-chain
  // discipline as doctor-local-providers-check.js.
  const stored = Object.keys(values).filter((p) => values[p]);

  if (stored.length === 0) {
    return { id: ID, name: NAME, status: 'ok', message: 'no keys stored — skipped', hint: null };
  }

  // A stored key for a provider with no validation endpoint cannot be probed
  // at all. Reported, never warned about: adding a provider to
  // provider-registry.js before api-key-validation.js has an endpoint for it
  // must not turn every doctor run yellow.
  const probeable = stored.filter((p) => VALIDATION_ENDPOINTS[p]);
  const unprobeable = stored.filter((p) => !VALIDATION_ENDPOINTS[p]);

  // Parallel by construction — see the file header.
  const results = await Promise.all(probeable.map((p) => probeOne(d, p, values[p])));

  const parts = results.map((r) => r.part)
    .concat(unprobeable.map((p) => `${p}: not probeable (no validation endpoint)`));
  const message = parts.join('; ');

  const rejected = results.filter((r) => r.rejected).map((r) => r.provider);
  if (rejected.length > 0) {
    return { id: ID, name: NAME, status: 'error', message, hint: REENTER_HINT(rejected) };
  }
  if (results.some((r) => r.unverified)) {
    return { id: ID, name: NAME, status: 'warn', message, hint: UNVERIFIED_HINT };
  }
  return { id: ID, name: NAME, status: 'ok', message, hint: null };
}

module.exports = { evaluateKeyAuth, classifyProbeFailure };
