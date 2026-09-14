/**
 * @module utils/model-id-siblings
 * The tier-safe sibling comparator (#238 D7). A sibling shares a pin's vendor
 * path, its pre-version prefix and its post-version suffix, and differs only in
 * the version number — so `gpt-5.6-terra` is never compared against
 * `gpt-5.6-sol`, and `kimi-k3` never against `kimi-k2.7-code`. Lifted verbatim
 * from scripts/check-ci-alias-pins.js (which still consumes it) so the alias
 * review engine (alias-proposals.js) and `models --check` ask the same question
 * of the shipped pins that the CI drift gate asks of the CI alias map.
 *
 * Known limit: a dash-versioned id — Anthropic's `claude-opus-4-5`, say —
 * parses its trailing `-5` as part of the suffix rather than the version
 * (the version group only extends through a DOTTED numeric run), so two
 * dash-versioned releases are never compared as siblings at all. This
 * under-reports; it never mis-reports, since a suffix mismatch can only
 * suppress a real sibling, never manufacture a false one.
 */

'use strict';

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

module.exports = { parsePin, compareVersions, newestSibling };
