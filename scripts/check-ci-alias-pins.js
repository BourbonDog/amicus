#!/usr/bin/env node

/**
 * Drift gate for the CI alias map (.github/amicus-ci-aliases.json).
 *
 * `amicus models --check` does NOT cover these pins. That audit compares a
 * curated FAMILY entry against the flagship its `idPattern` resolves to live;
 * the bench aliases (glm/qwen/kimi) are flat CARDLESS entries with no pattern,
 * so all it can ask is whether the pinned id still EXISTS. It does — which is
 * exactly how a pin sits two releases behind while every gate stays green.
 *
 * This script asks the other question — is there a NEWER sibling of each pin? —
 * through `src/utils/model-id-siblings.js`, which also serves the alias review
 * engine (#238).
 * A sibling shares the pin's vendor path, its pre-version prefix and its
 * post-version suffix, and differs only in the version number. That keeps
 * tier/variant lines apart — `gpt-5.6-terra` is never compared against
 * `gpt-5.6-sol`, and `kimi-k3` is never compared against `kimi-k2.7-code`.
 *
 * Usage:
 *   node scripts/check-ci-alias-pins.js           # exit 1 on drift
 *   node scripts/check-ci-alias-pins.js --json    # machine-readable report
 */

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const MAP_PATH = resolve(__dirname, '..', '.github', 'amicus-ci-aliases.json');

const { parsePin, compareVersions, newestSibling } = require('../src/utils/model-id-siblings');

/**
 * @param {Object<string,string>} aliases alias -> pinned id
 * @param {string[]} catalogIds
 * @returns {{drift:Array, missing:Array}}
 */
function auditPins(aliases, catalogIds) {
  const known = new Set(catalogIds);
  const drift = [];
  const missing = [];
  for (const [alias, pinned] of Object.entries(aliases)) {
    if (!known.has(pinned)) { missing.push({ alias, pinned }); continue; }
    const newer = newestSibling(pinned, catalogIds);
    if (newer) { drift.push({ alias, pinned, newer }); }
  }
  return { drift, missing };
}

async function main() {
  const json = process.argv.includes('--json');
  const map = JSON.parse(readFileSync(MAP_PATH, 'utf-8'));
  const aliases = (map && map.aliases) || {};
  const { getCatalog } = require('../src/utils/model-catalog');
  const catalog = await getCatalog();
  const ids = (Array.isArray(catalog) ? catalog : catalog.models || [])
    .map((m) => m && m.id).filter(Boolean);

  if (ids.length === 0) {
    console.error('Model catalog is empty — refresh it first (npm run refresh-models).');
    process.exit(2);
  }

  const report = auditPins(aliases, ids);
  if (json) {
    console.log(JSON.stringify({ checked: Object.keys(aliases).length, ...report }, null, 2));
  } else {
    for (const m of report.missing) {
      console.log(`MISSING: ${m.alias} -> ${m.pinned} is not in the catalog (delisted?)`);
    }
    for (const d of report.drift) {
      console.log(`DRIFTED: ${d.alias} -> ${d.pinned}  (newer sibling: ${d.newer})`);
    }
    if (!report.missing.length && !report.drift.length) {
      console.log(`All ${Object.keys(aliases).length} CI alias pins are current.`);
    }
  }
  process.exit(report.missing.length + report.drift.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(2); });
}

module.exports = { parsePin, compareVersions, newestSibling, auditPins };
