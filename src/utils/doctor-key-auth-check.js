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
 *   - HTTP 401 → 'error'. That is the server saying "this credential is not
 *     accepted", and nothing else in the space says it that plainly.
 *   - EVERYTHING else → 'warn'. Timeout, DNS/socket error, 5xx, 429, an
 *     unexpected 4xx, a result with no status at all: none of these
 *     distinguish a rotted key from a laptop on a plane. Unrecognised input
 *     falls to the ambiguous side ON PURPOSE — the failure mode of a false
 *     'error' here is a user re-entering a perfectly good key.
 *   - HTTP 403 is explicitly on the WARN side (council finding 1, PR 221). It
 *     read as definitive at first, which was wrong: Google returns 403 for
 *     "API not enabled" and for quota, and a WAF returns it for bot
 *     protection. Treating it as a verdict traded the false-GREEN this check
 *     was built to kill for a false-ALARM of the same shape.
 *   - a stored key with NO validation endpoint → 'warn'. It cannot be probed,
 *     so this check cannot vouch for it (council finding C1, first review).
 *   - no keys stored → 'ok' + "skipped" (mirrors the openrouter-credit skip).
 *
 * The evidence is the STRUCTURED `status` field, not the prose.
 * classifyProbeFailure used to regex "(401)" out of the error string, which
 * made control flow depend on message wording — a reword upstream that dropped
 * the parentheses would have degraded every row to a permanent "unverified"
 * with nothing failing to announce it (council finding 2, PR 221).
 *
 * NO KEY MATERIAL, NO URLs, EVER. Four layers, each structural:
 *   1. Only provider IDS and a reason built here reach the row — the raw error
 *      string is never echoed.
 *   2. Every live authenticated request realDeps() can make goes through the
 *      probe wrappers below (probeApiKey, probeOpenRouterCredit), which share
 *      one gate. An earlier version of this note claimed probeApiKey alone was
 *      that gate while checkOpenRouterCredit sat beside it unguarded — the
 *      claim is now true rather than merely written down.
 *   3. api-key-validation.js redacts the key from any message before it
 *      escapes, and resolves rather than rejecting on a synchronous throw from
 *      https.get. That is the ROOT fix (council finding 3, PR 221): the Google
 *      probe embeds the key as `?key=...`, and the two save-time call sites
 *      have no protection of their own — electron/ipc-setup.js hands
 *      `err.message` to the renderer and logs it, and src/cli-handlers.js has
 *      no try/catch at all.
 *   4. Each probe here is STILL individually caught, because this module must
 *      not depend on an injected validator honouring that contract.
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
// 401 only. 403 was here and is not a credential verdict — see
// classifyProbeFailure (council finding 1, PR 221).
const DEFINITIVE_STATUSES = new Set([401]);

const REENTER_HINT = (providers) =>
  `amicus key <provider> <key>  (re-enter the rejected key for: ${providers.join(', ')})`;

const UNPROBEABLE_HINT =
  'Not a rejection — amicus has no validation endpoint for this provider, so the '
  + 'key could not be checked either way. Add one in utils/api-key-validation.js '
  + '(VALIDATION_ENDPOINTS) to bring it under this check.';

const UNVERIFIED_HINT =
  'Not a rejection — the probe could not reach the provider (offline, DNS failure, '
  + '5xx or timeout). Re-run `amicus doctor` when connectivity is restored.';

/**
 * Whether a live authenticated request is allowed right now. The shared gate
 * for BOTH probes below — that sharing is the point, see layer 2 in the header.
 *
 * Council finding 7 (PR 221): `runDoctorChecks` merges a caller's deps over
 * `realDeps()`, so ANY suite that builds deps by hand and forgets to inject a
 * double — i.e. bypasses tests/helpers/doctor-base-deps.js — would fire live
 * authenticated HTTPS requests using the developer's REAL
 * ~/.config/amicus/.env keys. Nothing would fail; the suite would just be
 * slower and quietly spending someone's credentials. Suites that DO inject a
 * double are unaffected: theirs wins the merge and these are never called.
 *
 * @returns {boolean}
 */
function liveProbesDisabled() {
  return !require('./live-probes').liveProbesAllowed();
}

/** Marker string the classifier recognises, so a skip reads as a skip. */
const SKIPPED_REASON = 'probe skipped (live probes disabled)';

const SKIPPED = () => Promise.resolve({
  valid: false, status: null, skipped: true, error: SKIPPED_REASON,
});

/**
 * The key-validation probe `realDeps()` injects, behind the shared gate.
 * A skip resolves as an ordinary unverified result, so the row warns rather
 * than claiming health it did not establish.
 * @returns {Promise<{valid: boolean, status: number|null, error?: string}>}
 */
function probeApiKey(provider, key) {
  if (liveProbesDisabled()) { return SKIPPED(); }
  return require('./api-key-validation').validateApiKey(provider, key);
}

/**
 * The OpenRouter credit probe, behind the SAME guard.
 *
 * ⚠️ This exists because the claim above was FALSE when first written. The
 * header said probeApiKey was "the one place" a live authenticated request is
 * decided, while realDeps() still injected `checkOpenRouterCredit` as an
 * unguarded raw require — an authenticated call to openrouter.ai/api/v1/key
 * with the developer's stored key, reachable by exactly the hand-built dep
 * suites the guard was written for. Council review of PR 222 falsified the
 * claim; routing both probes through one gate makes it true instead of
 * deleting it. Resolves the same shape checkOpenRouterCredit does, so the
 * caller's `res.warning` branch is unaffected.
 */
function probeOpenRouterCredit(key) {
  if (liveProbesDisabled()) {
    // ⚠️ `warning: null` alone is what checkOpenRouterCredit resolves when the
    // account is FINE, so returning it here made a skipped probe render as
    // "credit ok" — a false green reporting a funded account nobody checked.
    // Introduced in the same commit that removed the identical shape from the
    // anthropic branch, one function over, with a test blessing it. Council
    // review of PR 222. `skipped` is what the row branches on now.
    return Promise.resolve({
      skipped: true, checked: false,
      warning: null, isFreeTier: false, limitRemaining: null, limit: null, usage: null,
    });
  }
  return require('./api-key-validation').checkOpenRouterCredit(key);
}

/**
 * Classify one validateApiKey failure as a definitive auth rejection or an
 * ambiguous one, and produce the SANITIZED reason that may be printed.
 *
 * Reads the STRUCTURED `status` field. This used to regex the status out of
 * `error` — which made a control-flow decision depend on message wording, so a
 * reword upstream that dropped the parentheses would have silently degraded
 * every row to a permanent "unverified" with no test failing to say so
 * (council finding 2, PR 221). api-key-validation.js returns the status as
 * data now. A result with no status is ambiguous, which is the fail-safe side.
 *
 * The returned `reason` is built here from scratch — it never contains any
 * substring of `error`, which is what makes the no-URL/no-key guarantee
 * structural rather than a hope about provider prose.
 *
 * @param {{status: number|null, error?: string}} [res] validateApiKey's result
 * @returns {{definitive: boolean, reason: string}}
 */
function classifyProbeFailure(res) {
  const r = (res && typeof res === 'object') ? res : {};
  const status = (typeof r.status === 'number' && Number.isFinite(r.status)) ? r.status : null;

  if (status !== null && DEFINITIVE_STATUSES.has(status)) {
    return { definitive: true, reason: `rejected (HTTP ${status})` };
  }
  if (status === 403) {
    // Deliberately NOT definitive (council finding 1). Google returns 403 for
    // "API not enabled" and for quota; a WAF returns it for bot protection.
    // Telling someone to re-enter a working key is the false-ALARM twin of the
    // false-GREEN this check exists to kill, and this check's whole design
    // premise is that a false error costs more than a warn.
    return { definitive: false, reason: 'unverified (HTTP 403 — forbidden, may not be the key)' };
  }
  if (status !== null) {
    return { definitive: false, reason: `unverified (HTTP ${status})` };
  }
  if (r.skipped) {
    // Named, not folded into "unreachable" — the two have different fixes and
    // conflating them is the kind of small dishonesty this row exists to avoid.
    return { definitive: false, reason: 'unverified (probe skipped)' };
  }
  if (/timed?\s*out|timeout/i.test(typeof r.error === 'string' ? r.error : '')) {
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
  const { definitive, reason } = classifyProbeFailure(res);
  return { provider, part: `${provider}: ${reason}`, rejected: definitive, unverified: !definitive };
}

/**
 * @param {{readApiKeyValues: () => Object<string,string>,
 *          validateApiKey: (provider:string, key:string)
 *            => Promise<{valid:boolean, status:number|null, error?:string}>}} d
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

  // A stored key for a provider with no validation endpoint cannot be probed at
  // all — so this check cannot vouch for it, and must not imply that it can.
  //
  // ⚠️ This originally reported such a key but still returned `ok`, on the
  // reasoning that adding a provider to provider-registry.js ahead of an
  // endpoint in api-key-validation.js should not turn every doctor run yellow.
  // Council finding C1 on PR #221 (raised by `gpt`) is right that this is the
  // EXACT false-green class #210 exists to close: a row that says "ok" while a
  // stored credential was never checked. It warns now. The cost is zero today —
  // PROVIDER_ENV_MAP and VALIDATION_ENDPOINTS carry identical key sets, so
  // `unprobeable` is always empty and this can only fire once someone actually
  // creates the gap. Silence is not health.
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
  // Unprobeable counts as unverified (C1): 'ok' here would vouch for a key
  // nothing checked. A definitive rejection still outranks it above.
  if (results.some((r) => r.unverified) || unprobeable.length > 0) {
    const hint = unprobeable.length > 0 && !results.some((r) => r.unverified)
      ? UNPROBEABLE_HINT : UNVERIFIED_HINT;
    return { id: ID, name: NAME, status: 'warn', message, hint };
  }
  return { id: ID, name: NAME, status: 'ok', message, hint: null };
}

module.exports = {
  evaluateKeyAuth, classifyProbeFailure,
  probeApiKey, probeOpenRouterCredit, liveProbesDisabled, SKIPPED_REASON,
};
