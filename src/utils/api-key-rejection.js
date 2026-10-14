/**
 * Definitive key rejections besides a 401 (google API_KEY_INVALID, malformed keys).
 * Split out of api-key-validation.js to keep it under the 300-line size gate.
 *
 * `keyRejected: true` marks "this credential is not accepted" — the verdict
 * that blocks a save (electron/ipc-keys.js, src/cli-handlers.js) and turns
 * doctor's key-auth row red. A 401 is one. These are the others:
 *
 *   - Google answers a bad key with 400 and `reason: API_KEY_INVALID` in the
 *     body — no 401 at all. Its 403 (disabled API, quota) stays a warning.
 *   - A key holding anything but visible ASCII. No provider issues one; the
 *     case that bit was the setup wizard's MASKED HINT (8 chars + U+2022
 *     bullets) sent as the key. Node refused it as a header value with a raw
 *     `Invalid character in header content`, google (key in the URL) answered
 *     400, and since neither status blocked, a direct save-key call wrote the
 *     hint into .env. Refused before any request now, in words.
 *
 * Every message here is built from constants: none echoes a response body,
 * a URL or the key.
 */

'use strict';

const MALFORMED_KEY_MESSAGE =
  "The key contains characters that aren't valid in an API key — paste the full key";

/** @param {string} key a TRIMMED key */
const isMalformedKey = (key) => /[^\x21-\x7e]/.test(key);

/** The resolved result for a definitive rejection that got an HTTP status. */
const invalidKey = (status, detail) =>
  ({ valid: false, status, keyRejected: true, error: `Invalid API key (${detail})` });

/** The resolved result for a key refused before any request. */
const malformedKey = () =>
  ({ valid: false, status: null, keyRejected: true, error: MALFORMED_KEY_MESSAGE });

/** Google's invalid-key 400 carries `reason: API_KEY_INVALID` in error.details. */
function isGoogleKeyInvalid(body) {
  try {
    const details = JSON.parse(body).error.details;
    return Array.isArray(details) && details.some((d) => d && d.reason === 'API_KEY_INVALID');
  } catch (_e) {
    return false;
  }
}

module.exports = { MALFORMED_KEY_MESSAGE, isMalformedKey, invalidKey, malformedKey, isGoogleKeyInvalid };
