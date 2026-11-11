/**
 * Shipped-pin drift findings for `amicus models --check` text, `--json`, and doctor.
 *
 * Split from sidecar/models.js so the text report and the `--json`
 * audit document read ONE set of findings: before this split the JSON doc never
 * carried them, and `--check --json` stayed silent on drift the text path
 * printed.
 */

'use strict';

const { getFamilies } = require('../utils/curated-models');
const { pickCurrent } = require('../utils/quick-picks');
const { gatedCatalogIds } = require('../utils/alias-proposals');
const { newestSibling } = require('../utils/model-id-siblings');
const { loadCuratedPins } = require('../utils/curated-pins');
const { safeFragment } = require('../utils/text-sanitize');

/**
 * Non-blocking drift findings: pinned family fallbacks vs live resolution
 * (`kind: 'family'`), and (#238 Q7) a newer same-tier sibling of each CARDLESS
 * pin (`kind: 'sibling'`). Accepts a catalogInfo (`{models, providerFailures}`)
 * or a bare models array (older callers). Empty catalog → [] (cannot check).
 * #238 §5: when the openrouter namespace itself was REJECTED this run, the
 * catalog is missing the rows that make a pin look current, and a finding
 * computed from it would propose a downgrade — so there are none for that
 * catalog. The sibling findings use the §5-gated ids (authoritative rows, no
 * rejected namespace) — the same gate that keeps the picker from offering a
 * floor row; mutant SIBLINGGATE feeds it every catalog id instead. Never
 * affects the exit code.
 * @param {{models: Array<{id:string}>, providerFailures?: Array<{provider:string}>}|Array<{id:string}>} catalogOrInfo
 * @returns {Array<{kind:'family'|'sibling', alias:string, pinned:string, live:string}>}
 *   `pinned` is the shipped pin (house bytes); `live` is catalog-derived (third-party, unsanitized)
 */
function findFallbackDrift(catalogOrInfo) {
  const info = Array.isArray(catalogOrInfo) ? { models: catalogOrInfo } : (catalogOrInfo || { models: [] });
  const catalog = info.models || [];
  if (catalog.length === 0) { return []; }
  const failures = Array.isArray(info.providerFailures) ? info.providerFailures : [];
  if (failures.some(f => f && f.provider === 'openrouter')) { return []; }
  const findings = [];
  const families = getFamilies();
  for (const f of families) {
    const live = pickCurrent(catalog, 'openrouter/', f.vendorPath, f.idPattern);
    if (live && f.fallback.openrouter && live !== f.fallback.openrouter) {
      findings.push({ kind: 'family', alias: f.alias, pinned: f.fallback.openrouter, live });
    }
  }
  const familyAliases = new Set(families.map(f => f.alias));
  const gated = gatedCatalogIds(info);
  const { pins } = loadCuratedPins();
  for (const alias of Object.keys(pins)) {
    if (familyAliases.has(alias)) { continue; } // a family's idPattern rule speaks for it above
    const pinned = pins[alias].routes.openrouter;
    const newer = newestSibling(pinned, gated);
    if (newer) { findings.push({ kind: 'sibling', alias, pinned, live: newer }); }
  }
  return findings;
}

/**
 * Human-readable lines for findFallbackDrift; every line points at owner mode,
 * the flow that moves a shipped pin.
 * @param {Parameters<typeof findFallbackDrift>[0]} catalogOrInfo
 * @returns {string[]} warning lines
 */
function buildFallbackDriftReport(catalogOrInfo) {
  // F5: `live` is catalog-derived (third-party); `pinned` is the shipped pin (house bytes) -- only the former rides the sanitizer.
  return findFallbackDrift(catalogOrInfo).map(d => (d.kind === 'family'
    ? `  pinned fallback drift: ${d.alias} → ${d.pinned} (live: ${safeFragment(d.live)}) — amicus aliases --review --owner (a family match is not always a same-tier sibling; when the picker offers nothing, edit src/utils/curated-pins.json by hand)`
    : `  newer sibling: ${d.alias} → ${d.pinned} (catalog: ${safeFragment(d.live)}) — amicus aliases --review --owner`));
}

module.exports = { findFallbackDrift, buildFallbackDriftReport };
