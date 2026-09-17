// tests/utils/redact-provider-error.test.js
'use strict';

/**
 * #256 item 4 — a provider error must not carry a key IDENTIFIER into an
 * uploaded artifact.
 *
 * MEASURED (run 35143585179, 2026-09-16): the r3 gpt retry was refused, and the
 * engine's message error embedded
 * `https://openrouter.ai/workspaces/default/keys/<64 hex>`. That text rode
 * `sessionError` -> `leg.error` -> `metadata.reason` -> `run.json ::
 * degrades[].data.reason` into the run-directory artifact the workflow uploads.
 * It is not the key, but it names the key inside the owner's account, and
 * `redactSecret` (api-key-validation.js) only ever covered the validation path.
 */

const { redactProviderError } = require('../../src/utils/redact-provider-error');

const HEX64 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('#256 redactProviderError', () => {
  test('the r3 shape: the key id inside a /keys/ URL is replaced, the rest is intact', () => {
    const raw = 'This request requires more credits, or fewer max_tokens. You requested up to '
      + `64000 tokens, but can only afford 56097. See https://openrouter.ai/workspaces/default/keys/${HEX64} for more.`;
    const out = redactProviderError(raw);
    expect(out).not.toContain(HEX64);
    expect(out).toContain('https://openrouter.ai/workspaces/default/keys/<redacted>');
    // Everything a reader needs is still there — the figures especially.
    expect(out).toContain('can only afford 56097');
    expect(out).toContain(' for more.');
  });

  test('a trailing path segment, query and fragment survive the redaction', () => {
    expect(redactProviderError(`https://openrouter.ai/keys/${HEX64}/settings?tab=limits#x`))
      .toBe('https://openrouter.ai/keys/<redacted>/settings?tab=limits#x');
  });

  test('every occurrence is redacted, not just the first', () => {
    const out = redactProviderError(`a /keys/${HEX64} b /keys/${HEX64.replace(/a/g, 'b')} c`);
    expect(out).toBe('a /keys/<redacted> b /keys/<redacted> c');
  });

  test('an id with dashes and underscores is still an id', () => {
    const id = 'sk_live-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(id.length).toBeGreaterThanOrEqual(32);
    expect(redactProviderError(`/keys/${id}`)).toBe('/keys/<redacted>');
  });

  test('a URL without /keys/ is untouched', () => {
    const raw = `https://openrouter.ai/workspaces/default/models/${HEX64}`;
    expect(redactProviderError(raw)).toBe(raw);
  });

  test('a SHORT /keys/ segment is not an identifier and is left alone', () => {
    // Doc and UI paths look like this; redacting them would destroy a useful
    // pointer without protecting anything.
    for (const raw of ['https://openrouter.ai/keys', 'https://openrouter.ai/keys/',
      'see https://openrouter.ai/docs/keys/overview']) {
      expect(redactProviderError(raw)).toBe(raw);
    }
  });

  test('plain error text with no URL at all is byte-identical', () => {
    const raw = 'This request would exceed your available credits given your current in-flight '
      + 'requests. Retry after in-flight requests settle, or add credits.';
    expect(redactProviderError(raw)).toBe(raw);
  });

  test('null, undefined and non-strings are safe and pass through unchanged', () => {
    expect(redactProviderError(null)).toBe(null);
    expect(redactProviderError(undefined)).toBe(undefined);
    expect(redactProviderError('')).toBe('');
    const obj = { a: 1 };
    expect(redactProviderError(obj)).toBe(obj);
    expect(redactProviderError(42)).toBe(42);
  });
});
