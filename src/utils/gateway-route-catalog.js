/**
 * Conservative cross-gateway catalog pairing helper (Task 5, #gwid).
 *
 * The same model has a different id per gateway namespace: direct
 * `anthropic/claude-opus-4-8` (dashes, sometimes a trailing date suffix)
 * vs. OpenRouter `openrouter/anthropic/claude-opus-4.8` (dots). This module
 * pairs the two rows for a given vendor + version token, using a normalized
 * comparison key ONLY to decide whether two catalog rows refer to the same
 * model -- it never derives, transforms, or invents an id. Every id this
 * module returns is copied verbatim from `catalogInfo.models[].id`.
 *
 * Used ONLY by `amicus models --check` (Task 6) to audit/refresh the curated
 * per-gateway route map -- NOT on any launch hot path. Correctness-when-
 * uncertain matters more than cleverness here: when a namespace has zero or
 * more than one plausible match, that side is OMITTED rather than guessed.
 *
 * Pure function: no I/O, no network, no catalog fetch.
 */

'use strict';

const OPENROUTER_PREFIX = 'openrouter/';
/** Trailing 8-digit date suffix (e.g. '-20251001'), comparison-only. */
const TRAILING_DATE_RE = /-\d{8}$/;

/**
 * Normalize a catalog id or a caller-supplied version token into a
 * comparison-only key: strip a leading `openrouter/`, strip a leading
 * `<vendor>/`, lowercase, unify '.'/'-' separators (dots become dashes), and
 * drop a trailing 8-digit date suffix. The result is NEVER returned to
 * callers -- it exists solely to decide whether two strings name the same
 * model.
 * @param {string} raw
 * @param {string} vendor
 * @returns {string|null} normalized key, or null when `raw` isn't a string
 */
function normalizeKey(raw, vendor) {
  if (typeof raw !== 'string' || raw.length === 0) { return null; }
  let s = raw;
  if (s.startsWith(OPENROUTER_PREFIX)) { s = s.slice(OPENROUTER_PREFIX.length); }
  const vendorPrefix = `${vendor}/`;
  if (s.startsWith(vendorPrefix)) { s = s.slice(vendorPrefix.length); }
  s = s.toLowerCase().replace(/\./g, '-');
  s = s.replace(TRAILING_DATE_RE, '');
  return s;
}

/**
 * Find, in `catalogInfo.models`, the direct-namespace id and the
 * OpenRouter-namespace id that both correspond to the model named by
 * `versionToken` for `vendor`.
 *
 * Matching is conservative: a side is only included when EXACTLY ONE row in
 * that namespace normalizes to the same key as `versionToken`. Zero matches
 * or more than one plausible match (ambiguous) both result in that side
 * being omitted -- never a guessed/fuzzy pick.
 *
 * @param {string} vendor e.g. 'anthropic'
 * @param {string} versionToken e.g. 'claude-opus-4-8' or 'claude-opus-4.8'
 * @param {{models: Array<{id: string}>}} catalogInfo
 * @returns {{direct?: string, openrouter?: string}} verbatim catalog ids only
 */
function pairAcrossGateways(vendor, versionToken, catalogInfo) {
  const models = (catalogInfo && Array.isArray(catalogInfo.models)) ? catalogInfo.models : [];
  const targetKey = normalizeKey(versionToken, vendor);
  const result = {};
  if (targetKey === null) { return result; }

  const directPrefix = `${vendor}/`;
  const openrouterPrefix = `${OPENROUTER_PREFIX}${vendor}/`;

  const directMatches = [];
  const openrouterMatches = [];

  for (const row of models) {
    if (!row || typeof row.id !== 'string') { continue; }
    const id = row.id;
    if (id.startsWith(openrouterPrefix)) {
      if (normalizeKey(id, vendor) === targetKey) { openrouterMatches.push(id); }
    } else if (id.startsWith(directPrefix)) {
      if (normalizeKey(id, vendor) === targetKey) { directMatches.push(id); }
    }
  }

  // Exactly one candidate required per side -- ambiguity (>1) is treated the
  // same as absence (0): omit rather than guess.
  if (directMatches.length === 1) { result.direct = directMatches[0]; }
  if (openrouterMatches.length === 1) { result.openrouter = openrouterMatches[0]; }
  return result;
}

module.exports = { pairAcrossGateways };
