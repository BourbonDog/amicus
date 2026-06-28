/**
 * Free OpenRouter model detection (Unit A).
 *
 * A free model is an openrouter/* catalog id whose slug ends in ':free'.
 * The ':free' suffix is OpenRouter's authoritative free-tier marker. A
 * zero prompt/completion price is deliberately NOT used: the catalog
 * normalizer keeps only {prompt, completion} and discards request/image
 * pricing, so a per-request-charged model with prompt:'0' would be
 * mislabeled. Pure + network-free.
 */
'use strict';

/** Offline last-resort free ids (used only when the live catalog is empty). */
const PINNED_FREE_MODELS = [
  'openrouter/deepseek/deepseek-r1:free',
  'openrouter/google/gemini-2.0-flash-exp:free',
  'openrouter/qwen/qwen3-coder:free',
];

/** @param {{id?:string}} row @returns {boolean} */
function isFreeModel(row) {
  const id = row && typeof row.id === 'string' ? row.id : '';
  return id.startsWith('openrouter/') && id.endsWith(':free');
}

/** @param {Array} catalog @returns {Array} free rows, sorted by vendor then id */
function listFreeModels(catalog) {
  const rows = (Array.isArray(catalog) ? catalog : []).filter(isFreeModel);
  return rows.sort((a, b) => {
    const va = a.id.split('/')[1] || '';
    const vb = b.id.split('/')[1] || '';
    return va === vb ? a.id.localeCompare(b.id) : va.localeCompare(vb);
  });
}

/** @param {Array} catalog @param {number} n @returns {Array} ≤n free rows, one per vendor */
function suggestFreeCouncil(catalog, n = 3) {
  const out = [];
  const seenVendors = new Set();
  for (const row of listFreeModels(catalog)) {
    const vendor = row.id.split('/')[1] || '';
    if (seenVendors.has(vendor)) { continue; }
    seenVendors.add(vendor);
    out.push(row);
    if (out.length >= n) { break; }
  }
  return out;
}

module.exports = { isFreeModel, listFreeModels, suggestFreeCouncil, PINNED_FREE_MODELS };
