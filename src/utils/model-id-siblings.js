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
 * Known limits, both under-report by design (a suppressed sibling, never a
 * manufactured one) — INVARIANT: neither rule can ever turn two DIFFERENT
 * models into siblings, only fail to notice two of the SAME family are:
 *   1. A dash-versioned id — Anthropic's `claude-opus-4-5`, say — parses its
 *      trailing `-5` as part of the suffix rather than the version (the
 *      version group only extends through a DOTTED numeric run), so two
 *      dash-versioned releases are never compared as siblings at all.
 *   2. A numeric run glued to a following ASCII letter is a size/variant
 *      token, never a version (#249 r2 B2) — `gpt-oss-20b` and
 *      `gpt-oss-120b` parse to prefix `gpt-oss-`, no version, since `20`/
 *      `120` are each immediately followed by `b`. MEASURED against a
 *      638-id live catalog cache: 129 ids carry a glued run (`24b`, `70b`,
 *      `a3b`, `8x22b`, `4o`, …) — without this rule `gpt-oss-120b` reads as
 *      a "newer same-tier sibling" of `gpt-oss-20b`, a different model
 *      wearing a bigger size, not a newer version. A run preceded by a
 *      letter is unaffected (`kimi-k3`, `deepseek-v4-pro`, `qwen3.8-max`
 *      keep parsing exactly as before) — only the character AFTER the run
 *      is examined.
 * `scripts/check-ci-alias-pins.js`'s CI drift gate consumes `parsePin`
 * unchanged, so it inherits rule 2 automatically.
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
  // Scan every numeric-dotted run left to right; the first one NOT glued to
  // a following ASCII letter is the version (#249 r2 B2 -- see the module
  // docblock's known limit 2). A glued run is a size/variant token (`20b`,
  // `8x22b`) and is skipped, falling through to whatever comes after it --
  // which, once a version is found, is everything the plain suffix already
  // captured, glued runs included.
  for (const m of tail.matchAll(/\d+(?:\.\d+)*/g)) {
    const end = m.index + m[0].length;
    if (/[A-Za-z]/.test(tail[end] || '')) { continue; }
    return { vendor, prefix: tail.slice(0, m.index), version: m[0].split('.').map(Number), suffix: tail.slice(end) };
  }
  return null;
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
