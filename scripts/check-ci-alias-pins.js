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
 * This script asks the other question: is there a NEWER sibling of each pin?
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

/**
 * Split a model id into the parts a sibling comparison needs.
 * `openrouter/z-ai/glm-5.3` -> vendor `openrouter/z-ai`, prefix `glm-`,
 * version [5,3], suffix ``. Returns null when the tail carries no numeric
 * version (nothing to compare) or the id is an OpenRouter floating pointer,
 * whose `~` forms name no concrete release.
 * @param {string} id
 * @returns {{vendor:string, prefix:string, version:number[], suffix:string}|null}
 */
function parsePin(id) {
  if (typeof id !== 'string' || id.includes('~')) { return null; }
  const cut = id.lastIndexOf('/');
  if (cut === -1) { return null; }
  const vendor = id.slice(0, cut);
  const tail = id.slice(cut + 1);
  // First pure numeric-dotted run in the tail is the version. Anything before
  // it is the family prefix, anything after is the tier/variant suffix.
  const m = /^(.*?)(\d+(?:\.\d+)*)(.*)$/.exec(tail);
  if (!m) { return null; }
  return { vendor, prefix: m[1], version: m[2].split('.').map(Number), suffix: m[3] };
}

/** @returns {number} >0 when a is newer than b, <0 when older, 0 when equal */
function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) { return diff; }
  }
  return 0;
}

/**
 * @param {string} pinned a fully-qualified model id
 * @param {string[]} catalogIds every id in the live catalog
 * @returns {string|null} the newest strictly-newer sibling, or null
 */
function newestSibling(pinned, catalogIds) {
  const pin = parsePin(pinned);
  if (!pin) { return null; }
  let best = null;
  let bestVersion = pin.version;
  for (const id of catalogIds) {
    // No blanket `:` skip. `:free` / `:batch` land in `suffix`, so the
    // suffix equality below ALREADY refuses to bump a plain pin to a billing
    // variant — while a blanket skip additionally blinded the checker to a
    // pin that is ITSELF a variant (a `:free` pin could never find a `:free`
    // sibling, and went quietly unwatched forever). Council finding D3.
    const other = parsePin(id);
    if (!other) { continue; }
    if (other.vendor !== pin.vendor) { continue; }
    if (other.prefix !== pin.prefix || other.suffix !== pin.suffix) { continue; }
    if (compareVersions(other.version, bestVersion) > 0) {
      best = id;
      bestVersion = other.version;
    }
  }
  return best;
}

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
