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
 *   3. `sidecar/models.js :: runCheck` — `amicus models --check`, the one site
 *      that passes no name list, so the subject is every CURATED alias the user
 *      has also configured (PR #207 round 3, B2 — the earlier wording here said
 *      "the whole configured alias set", which overstates it by the same margin
 *      the `findAliasShadows` docstring did).
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
 * "WRITERFATAL" (drop `safeWrite`'s try/catch), "MCPMUTE" (make
 * `auditBenchAliases` a no-op), "STREAMFATAL" (drop `armStream`'s attach-once
 * 'error' handler — round 3, A1) and "MESSAGERAW" (interpolate `err.message`
 * straight into the failure line again — round 3, B1).
 */

'use strict';

/**
 * Aliases whose LOCAL (user-config) value differs from the id amicus ships.
 *
 * @param {string[]} [names] alias names to inspect — a council bench, typically.
 *   Members carrying a `/` are full model ids, not aliases, and are skipped;
 *   members are trimmed and de-duplicated. Omit the argument to inspect every
 *   CURATED alias, reporting the ones the user has also configured (the
 *   `models --check` surface).
 *
 *   ⚠️ That is narrower than "every alias the user has configured", which is
 *   what this used to claim (PR #207 round 3, B2), and the narrower scope is the
 *   CORRECT one: a shadow is by definition a local value standing in front of a
 *   curated twin, so an alias the curated table never ships has nothing to
 *   shadow and can never appear here. The same holds for an explicit `names`
 *   list — a purely local member is silently skipped, not reported.
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
 * wrapped `findAliasShadows`, so a writer that threw — a caller-supplied
 * collector that rejects, a stream whose write throws — escaped and killed the
 * launch this diagnosis exists to protect. Worse, on the failure branch it
 * escaped a second time, because that branch announced itself through the SAME
 * broken writer. A notice must never be fatal to what it is describing, so the
 * write is swallowed here and nowhere else.
 *
 * ⚠️ This covers the SYNCHRONOUS half only. A piped stderr fails on a later
 * turn and never throws from `write()` at all — see `armStream` below, which is
 * the other half of the same contract.
 * @param {(line: string) => void} out
 * @param {string} line
 */
function safeWrite(out, line) {
  try { out(line); } catch { /* a diagnosis must never sink the run it diagnoses */ }
}

/**
 * Streams already carrying our no-op 'error' handler. A WeakSet so a swapped-out
 * stream (tests do this) is not retained by us.
 */
const armedStreams = new WeakSet();

/**
 * Make a stream's write failures non-fatal, once (PR #207 round 3, A1).
 *
 * MEASURED, node v24.18.0 on Windows, against a REAL closed pipe (parent spawns
 * a child with `stdio: ['ignore','ignore','pipe']` and destroys the read end;
 * the child then writes to `process.stderr`):
 *
 *   · `write(line)` returns FALSE and throws NOTHING. `safeWrite`'s try/catch
 *     sees nothing at all. The EPIPE arrives on a LATER turn, as an 'error'
 *     event; with no listener, EventEmitter throws it, and that throw is an
 *     uncaughtException that ends the process (measured: exit code 7).
 *   · Passing a write CALLBACK does NOT fix it. The callback received the EPIPE
 *     AND the 'error' event still fired unhandled — same exit 7. This is why
 *     there is no callback here: it would observe the failure without disarming
 *     it, and read like a guard while being none.
 *   · Attaching for the duration of the write and detaching after is not merely
 *     racy, it is always WRONG: delivery is always on a later turn, so the
 *     detach always wins (measured: exit 7 again, with the handler's own log
 *     line showing it was removed before the error landed).
 *   · A persistent listener absorbs it, and a SECOND write raises a SECOND
 *     'error' — so this must be `on`, never `once`.
 *
 * Hence: attach once, per stream object, and leave it. That is a process-wide
 * change to `process.stderr`'s behaviour, so it was checked rather than assumed
 * — nothing in src/, bin/ or scripts/ attaches to or depends on that stream's
 * 'error' event (the `.on('error')` hits in the tree are all on CHILD process
 * streams), `logger.js` already treats an EPIPE from its own write as
 * ignorable, and `electron/main.js` installs precisely this handler for
 * precisely this reason in the GUI process. Adding a listener also removes
 * nobody else's: any handler another module attaches still runs alongside this
 * one. All this removes is the unhandled-'error' throw — which for a CLI
 * writing an advisory line into `| head` was never the right outcome.
 *
 * ⚠️ Scoped to the module's OWN default writer. An INJECTED writer (every test
 * collector, and the MCP notices array) never reaches here, so nothing is armed
 * on its behalf.
 * @param {NodeJS.WritableStream} stream
 */
function armStream(stream) {
  if (!stream || typeof stream.on !== 'function' || armedStreams.has(stream)) { return; }
  armedStreams.add(stream);
  stream.on('error', () => { /* a diagnosis must never sink the run it diagnoses */ });
}

/** The default writer: stderr, armed against its own asynchronous failure. */
function writeNoticeToStderr(line) {
  const stream = process.stderr;
  armStream(stream);
  stream.write(line);
}

/**
 * Describe a caught throw without becoming the next one (PR #207 round 3, B1).
 *
 * The failure branch below used to interpolate `err.message` directly, so the
 * template was evaluated BEFORE `safeWrite` ever ran: a thrown `null` or
 * `undefined` raised a fresh TypeError inside the catch and escaped
 * `noteAliasShadows` entirely — the exact failure the catch exists to prevent,
 * re-entering through the catch's own announcement. A thrown bare string was the
 * quieter half: strings carry no `.message`, so a real reason printed as
 * `(undefined)`.
 *
 * ⚠️ `String(x)` is not total either — MEASURED: `String(Object.create(null))`
 * throws `TypeError: Cannot convert object to primitive value` — so the
 * conversion carries its own guard. Nothing in a catch block may throw,
 * including the code that describes what was caught.
 * @param {*} err whatever was thrown — an Error, a string, null, anything.
 * @returns {string}
 */
function describeThrown(err) {
  try { return String((err && err.message) || err); } catch { return 'unprintable error'; }
}

/**
 * Say it once per SCOPE. Never throws — not the check, not the write, and (round
 * 3, A1) not the write's own delayed failure either.
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
  const out = write || writeNoticeToStderr;
  const spoken = scope instanceof Set ? scope : new Set();
  try {
    for (const s of findAliasShadows(names)) {
      if (spoken.has(s.alias)) { continue; }
      spoken.add(s.alias);
      safeWrite(out, formatAliasShadow(s));
    }
  } catch (err) {
    // `describeThrown` FIRST, and outside the template, so the announcement
    // cannot become the second escape (round 3, B1).
    const why = describeThrown(err);
    safeWrite(out, `Notice: could not check whether local aliases shadow the curated table (${why})\n`);
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
