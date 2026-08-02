// src/utils/known-flags.js
'use strict';

/**
 * @module utils/known-flags
 * The set of `--flags` amicus accepts, and the check that rejects the rest.
 *
 * WHY THIS EXISTS. `parseArgs` (src/cli.js) treats ANY `--token` as a flag: an
 * unrecognized one lands on the parsed object, no handler reads it, and the
 * command proceeds as if it were never typed. Found in the field while smoke-
 * testing v4.5.2 — `amicus start -m deepseek --prompt "…" --headless` printed no
 * error and exited 0, but `start` has no `--headless`. The run silently took the
 * INTERACTIVE path, ignored `-m`, and left a session running against the default
 * model. A typo (`--modl`), a flag borrowed from another command, or an invented
 * one all behave the same way, and an unknown flag followed by a positional
 * SWALLOWS it as its value.
 *
 * amicus already handles an unknown COMMAND correctly — error, "Did you mean",
 * usage, exit 1. This gives flags the same treatment.
 *
 * DERIVED, NOT HAND-MAINTAINED. The bulk of the set is scraped from the usage
 * text, which is the same source `getCommandNames()` uses and for the same
 * stated reason: a second hand-maintained list would rot out of sync with the
 * first. Only flags that are deliberately absent from usage are listed here, and
 * each says why.
 */

/**
 * Real flags that appear in NO usage block. Rejecting any of these would break
 * working callers, so they are enumerated deliberately rather than derived.
 *
 * ⚠️ These are spawned by the MCP server onto its own CLI children
 * (src/mcp-server.js, src/mcp-council-run.js). They are not user-facing and are
 * intentionally undocumented — but they are on the argv of every MCP-launched
 * run, so rejecting them would break the entire MCP surface.
 */
const INTERNAL_FLAGS = new Set([
  'task-id',         // MCP → `start`/`continue`: pins the child's task id
  'run-id',          // MCP → `council run`: pins the child's run id
  'council-name',    // MCP → `council run`: preset name for ledger attribution
  'cowork-process',  // MCP → `start`: Cowork process handle for context capture
  'dropped-members', // MCP → 'council run': per-member preset drops as JSON (v4.6 Plan 4)

  // User-facing but undocumented, and read by real handlers today. Listed so the
  // rejection is a bug fix and not a silent removal of working behaviour; if any
  // of these should be dropped, that is a separate, deliberate change.
  'briefing',        // src/cli-handlers-resume-continue.js — alias for --prompt
  'mode',            // src/cli-handlers-run.js — legacy alias for --agent
  'quiet',           // src/cli-handlers.js — suppresses the interactive prompt
  'help',            // handled before dispatch; never reaches a usage block body
]);

/**
 * Every flag amicus accepts: usage-derived ∪ boolean flags ∪ INTERNAL_FLAGS.
 *
 * Computed on each call rather than cached at module load, because `getUsage()`
 * is itself composed at call time and a cached copy would pin whatever the first
 * caller happened to see.
 *
 * @returns {Set<string>} kebab-case flag names, without the leading `--`
 */
function getKnownFlags() {
  // Required lazily: src/cli.js is the module that will consume this one, and a
  // top-level require here would close a cycle.
  const { getUsage, getBooleanFlags } = require('../cli');
  const known = new Set(INTERNAL_FLAGS);
  for (const m of getUsage().matchAll(/--([a-z][a-z0-9-]*)/gi)) {
    known.add(m[1].toLowerCase());
  }
  for (const f of getBooleanFlags()) { known.add(f); }
  return known;
}

/**
 * The unknown flags present on a parsed-argv object, in the order they were
 * typed.
 *
 * Reads `__explicit` — the set parseArgs fills with every key it saw on the
 * command line — so defaults (which are merged in from DEFAULTS and were never
 * typed) are correctly ignored.
 *
 * @param {object} parsed result of parseArgs()
 * @returns {string[]} kebab-case flag names, without the leading `--`
 */
function unknownFlags(parsed) {
  if (!parsed || !parsed.__explicit) { return []; }
  const known = getKnownFlags();
  return [...parsed.__explicit].filter(f => !known.has(String(f).toLowerCase()));
}

module.exports = { getKnownFlags, unknownFlags, INTERNAL_FLAGS };
