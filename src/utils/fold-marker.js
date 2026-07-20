/**
 * Fold marker construction/parsing helpers — shared by prompt-builder.js
 * (instructs the model), headless.js (writes + detects), electron/fold.js
 * (writes), and src/sidecar/resume.js (re-derives the nonce from a saved
 * prompt on resume). Centralized here so the marker CONTRACT lives in one
 * place instead of being duplicated string-literal by string-literal.
 *
 * #BL-7 residual: the marker used to be the static string `[SIDECAR_FOLD]`,
 * so model output that genuinely ends with a bare marker (echoing these
 * instructions, a prior sidecar summary, or scraped content) could force a
 * premature fold. A per-run nonce closes that gap — only the exact nonce
 * generated for THIS run completes THIS run.
 */
const crypto = require('crypto');

/** The fixed, public prefix. Intentionally still `[SIDECAR_FOLD` as a
 *  substring — anything that greps for the OLD literal string still finds
 *  the new nonced marker; it just no longer matches an ANCHORED bare-bracket
 *  string (`[SIDECAR_FOLD]`) because a real marker now always carries a
 *  `:<nonce>` suffix before the closing bracket. */
const FOLD_MARKER_PREFIX = 'SIDECAR_FOLD';

/** Generate a fresh per-run nonce. 16 hex chars (8 random bytes) — comfortably
 *  above the brief's 12+ hex char floor, cheap to embed in prompts. */
function generateFoldNonce() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Build the full marker string for a given nonce: `[SIDECAR_FOLD:<nonce>]`.
 * @param {string} nonce
 * @returns {string}
 */
function buildFoldMarker(nonce) {
  return `[${FOLD_MARKER_PREFIX}:${nonce}]`;
}

/** Escape a string for safe embedding inside a RegExp source. */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a RegExp that matches `buildFoldMarker(nonce)` as the FINAL
 * non-empty line of a string (see headless.js findTrailingFoldMarker for the
 * consuming semantics). Exported so headless.js doesn't hand-roll the same
 * escaping logic.
 * @param {string} nonce
 * @returns {RegExp}
 */
function trailingFoldMarkerRegex(nonce) {
  const escaped = escapeRegExp(buildFoldMarker(nonce));
  return new RegExp(`^[^\\S\\r\\n]*${escaped}[^\\S\\r\\n]*$(?![\\s\\S]*\\S)`, 'm');
}

/**
 * Recover the nonce embedded in a previously-built system prompt (resume.js:
 * a resumed session re-sends the ORIGINAL prompt text — which already
 * instructs the model with the nonce baked in at initial `start`/`continue`
 * time — rather than building a fresh one via buildPrompts). Matches the
 * FIRST occurrence of the marker anywhere in the text (the prompt's own
 * instruction line), not a final-line match — this is prompt text, not
 * model output.
 * @param {string} text
 * @returns {string|null} the nonce, or null if no marker is present
 */
function extractNonceFromText(text) {
  if (!text) { return null; }
  const m = new RegExp(`\\[${FOLD_MARKER_PREFIX}:([0-9a-f]+)\\]`).exec(text);
  return m ? m[1] : null;
}

/**
 * v4.0 §9 (BL-7 done-done): remove every fold-marker occurrence — bare
 * `[SIDECAR_FOLD]` and nonced `[SIDECAR_FOLD:<nonce>]` — from a text.
 * A line consisting of ONLY a marker (plus horizontal whitespace) is removed
 * together with its line terminator; a marker embedded mid-line is removed in
 * place, keeping the rest of the line. Superset of prompt-builder.js's old
 * inline regex (which left empty lines behind) — used by the resume replay
 * (src/sidecar/resume.js) and buildPrompts (src/prompt-builder.js) so a
 * replayed conversation never carries a stale wire-format token.
 * @param {string|null|undefined} text
 * @returns {string|null|undefined} falsy input is returned unchanged
 */
function stripFoldMarkers(text) {
  if (!text) { return text; }
  const marker = `\\[${FOLD_MARKER_PREFIX}(:[^\\]]*)?\\]`;
  const markerOnlyLine = new RegExp(`^[^\\S\\r\\n]*${marker}[^\\S\\r\\n]*(?:\\r?\\n|$)`, 'gm');
  const inlineMarker = new RegExp(marker, 'g');
  return text.replace(markerOnlyLine, '').replace(inlineMarker, '');
}

module.exports = {
  FOLD_MARKER_PREFIX,
  generateFoldNonce,
  buildFoldMarker,
  trailingFoldMarkerRegex,
  extractNonceFromText,
  stripFoldMarkers,
};
