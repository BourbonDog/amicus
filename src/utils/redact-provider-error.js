/**
 * @module utils/redact-provider-error
 *
 * #256 item 4: strip key IDENTIFIERS out of a provider's error text before it
 * becomes a leg's death reason.
 *
 * MEASURED (run 35143585179, 2026-09-16): the r3 gpt retry was refused for
 * credit, and the engine's message error embedded
 * `https://openrouter.ai/workspaces/default/keys/<64 hex>` — a key-management
 * URL naming one key inside the owner's account. That text travelled the
 * ordinary death channel (`headless.js` sessionError -> `leg.error` ->
 * `metadata.reason` -> `run.json :: degrades[].data.reason`) and was published
 * inside the workflow's evidence artifact, unredacted.
 *
 * It is NOT the secret — `redactSecret` (utils/api-key-validation.js) handles
 * that, and only on the validation path, where the key is in hand. Here there is
 * no key to match against: the identifier must be recognised by its SHAPE.
 *
 * Deliberately narrow. This runs on every provider error that reaches a death
 * reason, and an over-eager rule would eat the figures a reader needs ("can only
 * afford 56097") or the doc links that make an error actionable. It replaces the
 * id in a `/keys/<id>` path segment and nothing else.
 */

'use strict';

/**
 * A `/keys/` path segment followed by an identifier: at least 32 characters of
 * the URL-safe id alphabet. The floor is what separates an identifier from a UI
 * or doc path (`/keys`, `/docs/keys/overview`) — those must survive, because
 * redacting them would destroy a useful pointer while protecting nothing.
 */
const KEY_PATH_ID = /(\/keys\/)([A-Za-z0-9_-]{32,})/g;

/**
 * Redact key-management identifiers from provider error text.
 *
 * Non-strings (null, undefined, an Error object, a number) pass straight
 * through: the one call site guards on truthiness and hands this whatever the
 * engine put on the message, so the function must never change a caller's type
 * or throw.
 *
 * @param {*} text the provider's error text
 * @returns {*} the same value, with any `/keys/<id>` id replaced by `<redacted>`
 */
function redactProviderError(text) {
  if (typeof text !== 'string' || text.length === 0) { return text; }
  return text.replace(KEY_PATH_ID, '$1<redacted>');
}

module.exports = { redactProviderError };
