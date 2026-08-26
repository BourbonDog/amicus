/**
 * Alias-shadow self-diagnosis — name a local alias that repoints a curated one.
 *
 * (v4.9 W13 Task B — BACKLOG C5, #129's own side observation.)
 *
 * A user-config alias may repoint a CURATED alias at a different model. When it
 * does, everything keyed on the alias NAME — per-model operating notes, the
 * bench a workflow spells, a council preset — quietly describes a model the
 * alias no longer resolves to. Nothing downstream can recover the fact:
 * `config.js :: getEffectiveAliases` returns `{...DEFAULT_ALIASES,
 * ...userAliases}`, so by the time `resolveModel` or
 * `route-launch.js :: resolveRouteForLaunch` sees an id, the two sources have
 * already collapsed into one string. That is why the comparison lives here and
 * reads the two sides SEPARATELY (`loadConfig().aliases` vs `toDefaultAliases()`)
 * rather than being a line inside the merge.
 *
 * ⚠️ DIAGNOSIS ONLY. This module resolves nothing, changes no id, no exit code
 * and no artifact — a local override winning over the curated pin is the
 * DOCUMENTED contract (`getEffectiveAliases`: "user wins"). All this does is say
 * so out loud, once, on stderr.
 *
 * Wired at two sites, both measured (see tests/alias-shadow.test.js's header for
 * the measurement):
 *   1. `cli-council-run-bench.js :: resolveBench` — the one bench-resolution
 *      helper BOTH council transports pass through, because
 *      `mcp-council-run.js:177` always spawns the CLI child with an expanded
 *      `--models` list.
 *   2. `sidecar/models.js :: runCheck` — `amicus models --check`, where the
 *      whole configured alias set is the subject.
 *
 * Named mutants, both with their red sets recorded in tests/alias-shadow.test.js:
 * "SHADOWSILENT" (make `noteAliasShadows` a no-op) and "GATEWAYFORM" (compare
 * raw strings instead of canonical forms below).
 */

'use strict';

/**
 * Aliases whose LOCAL (user-config) value differs from the id amicus ships.
 *
 * @param {string[]} [names] alias names to inspect — a council bench, typically.
 *   Members carrying a `/` are full model ids, not aliases, and are skipped;
 *   members are trimmed and de-duplicated. Omit the argument to inspect every
 *   alias the user has configured (the `models --check` surface).
 * @returns {Array<{alias: string, local: string, curated: string}>} one row per
 *   shadowed alias, in the order the names were given.
 */
function findAliasShadows(names) {
  const { loadConfig } = require('./config');
  const { toDefaultAliases, toCanonicalDefault } = require('./curated-models');
  const cfg = loadConfig();
  const userAliases = (cfg && cfg.aliases && typeof cfg.aliases === 'object') ? cfg.aliases : {};
  // Own keys only: a user config.json can carry a literal `__proto__`/`toString`
  // key, and bare indexing on a plain object would read Object.prototype — the
  // same defect class `getEffectiveAliases`'s `__proto__: null` closed.
  const configured = new Set(Object.keys(userAliases));
  const curated = toDefaultAliases(); // already null-prototype; safe to index
  const wanted = Array.isArray(names) ? names : Object.keys(curated);
  const seen = new Set();
  const out = [];
  for (const raw of wanted) {
    const alias = typeof raw === 'string' ? raw.trim() : '';
    if (!alias || alias.includes('/') || seen.has(alias)) { continue; }
    seen.add(alias);
    if (!configured.has(alias)) { continue; }        // no local override -> silent
    const local = userAliases[alias];
    const shipped = curated[alias];
    if (typeof local !== 'string' || typeof shipped !== 'string') { continue; } // not a curated alias -> silent
    // Compare CANONICAL forms, not raw strings. A direct-capable vendor's
    // curated pin is the bare policy-routed id (`openai/gpt-5.6-terra`), so a
    // config pinning the explicit OpenRouter form of the SAME MODEL differs as a
    // string and not as a model — the same false positive
    // `alias-drift.js`/`findDriftedStoredAliases` already guards against, and it
    // would fire on gpt AND deepseek in this repo's own CI alias map. Gateway
    // ROUTING has its own audit (`models --check`'s per-gateway section); this
    // notice speaks only when the alias names a different MODEL. The rows still
    // report both sides RAW, so the user can grep their own config.
    if (toCanonicalDefault(local) === toCanonicalDefault(shipped)) { continue; }
    out.push({ alias, local, curated: shipped });
  }
  return out;
}

/** @param {{alias: string, local: string, curated: string}} s @returns {string} */
function formatAliasShadow(s) {
  return `Notice: alias '${s.alias}' resolves to ${s.local} (curated ships ${s.curated})\n`;
}

/**
 * Per-PROCESS dedup. A council run is one CLI process (the MCP transport spawns
 * that same child), so "once per alias here" is "once per run" — and a preset
 * bench that names the same alias twice still gets one line.
 */
const spoken = new Set();

/**
 * Say it once. Never throws — a diagnosis that can sink the launch it diagnoses
 * would be worse than the silence it replaces — but it never degrades SILENTLY
 * either: a failed check announces its own failure. That is not defensive
 * decoration. During this task's own development the guard swallowed a real
 * `TypeError: loadConfig is not a function` (a leaked module mock in
 * tests/sidecar/models-command.test.js) and the feature simply went quiet, which
 * is precisely the correct-but-silent degrade the product principle forbids.
 * @param {string[]} [names] see findAliasShadows
 * @param {(line: string) => void} [write] injected for tests; defaults to stderr
 *   so a `--json` document on stdout stays byte-clean.
 */
function noteAliasShadows(names, write) {
  const out = write || ((line) => process.stderr.write(line));
  try {
    for (const s of findAliasShadows(names)) {
      if (spoken.has(s.alias)) { continue; }
      spoken.add(s.alias);
      out(formatAliasShadow(s));
    }
  } catch (err) {
    out(`Notice: could not check whether local aliases shadow the curated table (${err.message})\n`);
  }
}

module.exports = { findAliasShadows, formatAliasShadow, noteAliasShadows };
