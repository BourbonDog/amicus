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
 * Wired at three sites, all measured (see tests/alias-shadow.test.js's header
 * for the measurement):
 *   1. `cli-council-run-bench.js :: resolveBench` — the one bench-resolution
 *      helper BOTH council transports EXECUTE, because `mcp-council-run.js`
 *      always spawns the CLI child with an expanded `--models` list. The bench,
 *      the chair (explicit or default) and the critic are all inspected there:
 *      they resolve through this same table, so a shadow on any of them is
 *      equally invisible (PR #203 round 1, A6).
 *   2. `mcp-council-bench.js :: auditBenchAliases`, called by
 *      `mcp-council-run.js :: handleCouncilRunTool` — the MCP SURFACE (PR #207
 *      round 2, A1). Site 1 executes on the MCP path but surfaces nothing there
 *      (see below); this one writes into the tool result's notice array, so the
 *      client actually sees it. Same three seats, same entry point.
 *   3. `sidecar/models.js :: runCheck` — `amicus models --check`, where the
 *      whole configured alias set is the subject.
 *
 * ⚠️ SURFACE vs EXECUTION, measured (PR #203 round 1 A4; resolved PR #207 round
 * 2 A1). Site 1 EXECUTES on both transports but SURFACES on only one: the
 * council child's stderr is not a pipe the MCP server reads. `mcp-server.js ::
 * spawnSidecarProcess` spawns it with `stdio: ['ignore', 'ignore', <fd>]`, the
 * fd being an open handle on `<runDir>/debug.log` (or `'ignore'` when that dir
 * cannot be created), then `unref`s it. So on the CLI the notice lands on the
 * user's terminal; from site 1 alone an MCP caller would have to open
 * `<runDir>/debug.log` to find it. Site 2 exists to close exactly that gap, and
 * it is a different SURFACE rather than a second copy of the same one — the
 * child still writes its line to `debug.log`, the parent writes its own to the
 * tool result, and no single surface ever shows it twice. The same limitation
 * still applies to every OTHER stderr notice the council child writes.
 *
 * Named mutants, all with their red sets recorded in tests/alias-shadow.test.js:
 * "SHADOWSILENT" (make `noteAliasShadows` a no-op), "GATEWAYFORM" (compare raw
 * strings instead of canonical forms below), "SCOPESTUCK" (give
 * `auditAliasShadows` a shared module-global Set instead of a fresh one),
 * "WRITERFATAL" (drop `safeWrite`'s try/catch) and "MCPMUTE" (make
 * `auditBenchAliases` a no-op).
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
 * Write a notice without ever letting the writer sink the run (round 2, B1).
 *
 * The 'never throws' contract below used to cover only the CHECK: the guard
 * wrapped `findAliasShadows`, so a writer that threw — a closed stderr/EPIPE, a
 * caller-supplied collector that rejects — escaped and killed the launch this
 * diagnosis exists to protect. Worse, on the failure branch it escaped a second
 * time, because that branch announced itself through the SAME broken writer.
 * A notice must never be fatal to what it is describing, so the write is
 * swallowed here and nowhere else.
 * @param {(line: string) => void} out
 * @param {string} line
 */
function safeWrite(out, line) {
  try { out(line); } catch { /* a diagnosis must never sink the run it diagnoses */ }
}

/**
 * Say it once per SCOPE. Never throws — neither the check nor the write.
 *
 * It never degrades SILENTLY either: a failed check announces its own failure.
 * That is not defensive decoration. During this task's own development the
 * guard swallowed a real `TypeError: loadConfig is not a function` (a leaked
 * module mock in tests/sidecar/models-command.test.js) and the feature simply
 * went quiet, which is precisely the correct-but-silent degrade the product
 * principle forbids.
 *
 * ⚠️ The dedup scope is the caller's, passed in (PR #207 council round 2, B3).
 * It used to be a module-global `spoken` Set that `auditAliasShadows` cleared
 * wholesale — so one caller's dedup state was reachable, and erasable, by every
 * other caller in the process. There is no module-global state here now: two
 * scope-less calls are two independent scopes.
 * @param {string[]} [names] see findAliasShadows
 * @param {(line: string) => void} [write] injected for tests; defaults to stderr
 *   so a `--json` document on stdout stays byte-clean.
 * @param {Set<string>} [scope] alias names already spoken. Omit for a fresh
 *   one-shot scope; pass a shared Set to collapse several calls into one run.
 */
function noteAliasShadows(names, write, scope) {
  const out = write || ((line) => process.stderr.write(line));
  const spoken = scope instanceof Set ? scope : new Set();
  try {
    for (const s of findAliasShadows(names)) {
      if (spoken.has(s.alias)) { continue; }
      spoken.add(s.alias);
      safeWrite(out, formatAliasShadow(s));
    }
  } catch (err) {
    safeWrite(out, `Notice: could not check whether local aliases shadow the curated table (${err.message})\n`);
  }
}

/**
 * THE WIRING ENTRY POINT: open a fresh notice scope, then speak.
 *
 * Every wired site calls this and nothing else, in ONE statement, so the scope
 * can never be opened by one caller and forgotten by the next — a two-step
 * "reset, then note" would have made the A5 defect re-introducible by omission,
 * which for a self-diagnosis feature means going quiet with a green suite.
 *
 * PR #203 A5 asked for a re-openable scope; round 2 (B3) supplied the shape
 * that makes it structural rather than disciplined: the fresh `Set` IS the
 * scope, so there is no shared latch to get stuck and none to clear.
 * `noteAliasShadows` stays exported as the scope-respecting primitive (two
 * calls sharing one scope still produce one line per alias).
 * @param {string[]} [names] see findAliasShadows
 * @param {(line: string) => void} [write] see noteAliasShadows
 */
function auditAliasShadows(names, write) {
  noteAliasShadows(names, write, new Set());
}

module.exports = {
  findAliasShadows, formatAliasShadow, noteAliasShadows, auditAliasShadows,
};
