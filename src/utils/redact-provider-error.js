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
 * id in a `/keys/<id>` path segment or a key-ish query parameter, and nothing else.
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
 * The other shape a key identifier actually arrives in: a query parameter
 * (council #264 r1, findings C3 and D1). Same ≥32-character floor.
 *
 * The two modules' families OVERLAP but are not identical, and saying so is the
 * point: `api-key-validation.js :: redactSecret` masks `key`, `api_key` and
 * `access_token` on the VALIDATION path, where the key is in hand and the name
 * set only has to cover the endpoints amicus itself calls. This module runs on
 * text a PROVIDER wrote, so it also covers the spellings a provider might use —
 * `keys`, `apikey`, bare `token` — and matches case-insensitively.
 *
 * ⚠️ NOT EXTENDED TO BARE HEX IN PROSE, which D1 also raised. Deliberate: the
 * forensic record of this very incident is bare hex — run 35143585179, base sha
 * 309862bf, the leg/session ids in every degrade note, and content hashes. A
 * bare-hex rule would eat all of them on every death reason, destroying the
 * evidence these artifacts exist to carry, while protecting nothing: an
 * identifier that is dangerous is dangerous because a URL says what it names,
 * and both URL shapes that do so are covered here. If a provider is later seen
 * emitting a key id with no surrounding URL, that is a new measured shape and
 * gets its own rule — not a guess applied to every hex string.
 */
const KEY_QUERY_ID = /([?&](?:keys?|api_key|apikey|(?:access_)?token)=)([A-Za-z0-9_-]{32,})/gi;

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
  return text.replace(KEY_PATH_ID, '$1<redacted>').replace(KEY_QUERY_ID, '$1<redacted>');
}

module.exports = { redactProviderError };
