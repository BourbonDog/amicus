/**
 * Byte-bounded slicing for amicus_read (15a.3 / B17).
 *
 * amicus_read's conversation/summary/wave-summary/metadata bodies were
 * previously returned whole and unbounded — a large conversation.jsonl could
 * flood the calling agent's context. This module applies a default ~50KB cap
 * to the BODY of every response and exposes offset/limit/tail paging so an
 * agent can page through the rest.
 *
 * Slicing is byte-based (matches the "~50KB" contract agents reason about)
 * but implemented with JS string slicing over UTF-16 code units, NOT a
 * Buffer byte slice. A slice boundary landing mid multibyte-character is
 * tolerated (the string still round-trips through JSON safely; a stray
 * replacement character at a cut edge is an acceptable trade-off for keeping
 * this a plain string operation with no encode/decode step). Because the cut
 * is code-unit based, the returned slice's real UTF-8 byte length can differ
 * from READ_CAP_BYTES for multibyte content — so the truncation notice
 * always reports the ACTUAL Buffer.byteLength of the returned slice (never
 * the nominal cap), alongside the true total byte count. Both figures in the
 * notice are real, measured byte counts.
 */
'use strict';

/** Default cap on the BODY of every amicus_read response mode, in bytes. */
const READ_CAP_BYTES = 51200; // 50 * 1024

/**
 * Slice `text` per the offset/limit/tail paging params, applying the default
 * cap when no explicit params are given and the content exceeds it.
 *
 * Precedence when both `offset` and `tail` are given: `offset` wins (`tail`
 * is ignored) — an explicit offset is a more specific request than "give me
 * the end".
 *
 * @param {string} text - raw content (pre-fence).
 * @param {{offset?: number, limit?: number, tail?: boolean}} params
 * @returns {{body: string, truncated: boolean}} body is ready to fence/return.
 */
function sliceForRead(text, params = {}) {
  const totalBytes = Buffer.byteLength(text, 'utf-8');
  const limit = clampLimit(params.limit);
  const hasOffset = typeof params.offset === 'number' && params.offset >= 0;

  if (hasOffset) {
    const slice = text.slice(params.offset, params.offset + limit);
    return { body: slice, truncated: false };
  }

  if (params.tail) {
    const sliceLen = Math.min(limit, text.length);
    const slice = text.slice(text.length - sliceLen);
    return { body: slice, truncated: false };
  }

  // No explicit slicing params: apply the default cap. Under-cap content is
  // untouched (byte-identical to pre-15a.3 behavior).
  if (totalBytes <= READ_CAP_BYTES) {
    return { body: text, truncated: false };
  }
  const sliceLen = Math.min(READ_CAP_BYTES, text.length);
  const tailSlice = text.slice(text.length - sliceLen);
  const actualSliceBytes = Buffer.byteLength(tailSlice, 'utf-8');
  const notice = `[truncated: showing last ${actualSliceBytes} of ${totalBytes} bytes — use offset/limit to page]`;
  return { body: `${notice}\n${tailSlice}`, truncated: true };
}

/** Clamp an optional caller-supplied limit into [1, READ_CAP_BYTES]. */
function clampLimit(limit) {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) { return READ_CAP_BYTES; }
  return Math.max(1, Math.min(READ_CAP_BYTES, Math.floor(limit)));
}

module.exports = { sliceForRead, READ_CAP_BYTES };
