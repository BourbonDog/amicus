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
 * ⚠️ THE WRITE HALF LIVES NEXT DOOR, in `alias-shadow-writer.js` (round 4). This
 * file is the CHECK and the RENDERING; that one is `safeWrite`, `armStream` and
 * the default stderr writer, with the measured Node pipe behaviour they defend
 * against. Neither was ever exported from here, so the split changed no import
 * path in the tree.
 *
 * Named mutants, all with their red sets recorded in tests/alias-shadow.test.js:
 * "SHADOWSILENT" (make `noteAliasShadows` a no-op), "GATEWAYFORM" (compare raw
 * strings instead of canonical forms below), "SCOPESTUCK" (give
 * `auditAliasShadows` a shared module-global Set instead of a fresh one),
 * "WRITERFATAL" (drop `safeWrite`'s try/catch — now in alias-shadow-writer.js),
 * "MCPMUTE" (make `auditBenchAliases` a no-op), "STREAMFATAL" (drop
 * `armStream`'s attach-once 'error' handler — round 3, A1, also next door),
 * "MESSAGERAW" (interpolate `err.message` straight into the failure line again —
 * round 3, B1), "NOTICERAW" (interpolate the config-sourced fragments into
 * `formatAliasShadow`'s template unsanitized — round 4, A1), "THROWNRAW" (drop
 * `describeThrown`'s sanitizing pass, leaving the FAILURE line raw and unbounded
 * — round 5, C1) and "STREAMDEAF" (put `armStream`'s pure no-op handler back, so
 * the arming goes deaf to every error class again — round 5, A3/B2/D1/C2, in
 * alias-shadow-writer.js).
 */

'use strict';

// The WRITE half, extracted in round 4 — `safeWrite` is the synchronous guard,
// `writeNoticeToStderr` the armed default writer. See that module for the
// measured Node behaviour both of them exist for.
const { safeWrite, writeNoticeToStderr } = require('./alias-shadow-writer');
// The house sanitizer for third-party text — see `formatAliasShadow` for which
// fragments are third-party and why the pass is per-fragment.
const { collapseExcerpt } = require('./text-sanitize');

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
  const { toDefaultAliases, stripGatewayPrefix } = require('./curated-models');
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
    if (stripGatewayPrefix(local) === stripGatewayPrefix(shipped)) { continue; }
    out.push({ alias, local, curated: shipped });
  }
  return out;
}

/**
 * How much of one quoted config fragment ever reaches the line. MEASURED: the
 * longest id the curated table ships is 39 characters
 * (`openrouter/mistralai/mistral-medium-3-5`) and the longest alias name is 10;
 * past 64 this is not a model id, it is a payload.
 */
const MAX_FRAGMENT_CHARS = 64;

/** One quoted config fragment, safe to paste into the line below. */
const safeFragment = (value) => collapseExcerpt(value, MAX_FRAGMENT_CHARS);

/**
 * The notice, with everything it QUOTES neutralized (PR #207 round 4, A1).
 *
 * This line quotes the user's `config.json` onto a terminal and into the MCP
 * tool result, so each quoted value is third-party text and rides the house
 * sanitizer — `utils/text-sanitize.js :: collapseExcerpt`, the same one
 * `engine-skew.js :: safeVersion` uses at its own cap, for the same reason. ANSI
 * and bidi controls are dropped, remaining control bytes collapse to spaces, and
 * the result is one bounded line: a config value can no longer repaint the
 * terminal, forge a SECOND `Notice:` line after the newline it smuggled in, or
 * reverse the sentence it is quoted into.
 *
 * ⚠️ THE FRAGMENTS, NOT THE COMPOSED LINE. `collapseExcerpt` trims and caps
 * whatever it is given, so passing the finished string would eat the trailing
 * newline both writers depend on and could clip `(curated ships …)` off the end.
 * The quotes, the parens and that newline are OURS; only the values are theirs.
 *
 * ⚠️ MEASURED, which fragment is actually hostile-capable: `local` is a raw
 * config VALUE and is the hole. `alias` is user-supplied too, but a row exists
 * only when the name is byte-identical to a key of the null-prototype curated
 * table, and all 21 shipped names measure `/^[a-z0-9.-]+$/` — an escape-carrying
 * name never becomes a row at all (pinned as an absence control). `curated` is
 * house data. All three go through anyway: "this notice is one line, and its
 * structure is ours" should not depend on that chain of reasoning surviving the
 * next change to the curated table.
 *
 * ⚠️ The ROWS `findAliasShadows` returns stay RAW on purpose (see its docstring)
 * — this is a RENDERING pass, and a caller diffing a row against the config file
 * still sees the bytes that are actually in it.
 * @param {{alias: string, local: string, curated: string}} s
 * @returns {string}
 */
function formatAliasShadow(s) {
  return `Notice: alias '${safeFragment(s.alias)}' resolves to ${safeFragment(s.local)} `
    + `(curated ships ${safeFragment(s.curated)})\n`;
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
 *
 * ⚠️ AND IT IS THIRD-PARTY TEXT (PR #207 round 5, C1). Round 3 made this total;
 * round 4 sanitized the SHADOW notice's fragments and left this one's result
 * raw, so the FAILURE line still pasted an arbitrary thrown message —
 * unsanitized and unbounded — onto a terminal and into an MCP tool result. A
 * thrown value is not house data: it carries provider text, a filesystem path,
 * or the user's own config file (the case that motivated round 4). Same
 * `collapseExcerpt` pass, same reasons, one function later.
 *
 * ⚠️ THE CAP IS THE HOUSE DEFAULT (200), NOT `MAX_FRAGMENT_CHARS` (64). Both are
 * the same discipline — a caller sizing the cap to what its field legitimately
 * holds, as `engine-skew.js :: safeVersion` does at 32 — and the two fields are
 * not the same kind of text. A fragment is a MODEL ID (measured longest: 39), so
 * 64 bounds it with room to spare. A thrown message is a SENTENCE: `EACCES:
 * permission denied, open 'C:\\Users\\…\\config.json'` already exceeds 64, and
 * clipping there would bound the payload by destroying the diagnosis. 200 is
 * what `text-sanitize.js` documents as "long enough for a real engine error",
 * and it leaves this composed line the same order of magnitude as the shadow
 * line's three 64-char fragments.
 *
 * The pass runs INSIDE the try, so a value whose `String()` throws still lands
 * in the catch rather than escaping through the sanitizer's argument.
 * @param {*} err whatever was thrown — an Error, a string, null, anything.
 * @returns {string} one bounded line, safe to paste into the notice.
 */
function describeThrown(err) {
  try { return collapseExcerpt(String((err && err.message) || err)); }
  catch { return 'unprintable error'; }
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
