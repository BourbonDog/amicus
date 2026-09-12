/**
 * @module council/run-seat-tools-verify
 * The engine-rendering tripwire's near-pure pieces (ruling P2-R33), split out
 * of run-seat-tools.js at council #247 round 3 under the 300-line size gate:
 * which directories to check (`verificationDirectories`, ruling P2-R39), how
 * to ask the engine what it registered for one of them (`listEngineAgents`),
 * and whether that answer still matches the allowlist an agent was given
 * (`verifyAgentRendering`, ruling P2-R40/P2-R42's external_directory
 * exemption). `listEngineAgents` and `verifyAgentRendering` are re-exported
 * from run-seat-tools.js so every existing importer keeps working unchanged.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * The unique set of directories the post-registration tripwire checks the
 * engine's OWN rendering against: the run directory, the project tree too
 * when a local tool is opted in (a seat's own working directory), and —
 * ruling P2-R39 (A1, round 3) — `_scratch`, where every SUPPORT leg (judges,
 * debate, chair) actually runs (`project: <runDir>/_scratch`, run-debate-
 * revote.js / run-stage2.js). Without it, an attacker's opencode.json sitting
 * ONLY under `_scratch` renders clean at `o.runDir` and would still reach a
 * support leg unverified. It does not exist yet at verification time —
 * run-stage2.js creates it again once Stage 2 actually starts — so it is
 * created here too, best-effort and with the same `0o700` mode, purely so
 * the engine has a real directory to answer for.
 * @param {{runDir: string, project?: string, seatToolsLocal?: boolean}} o
 * @returns {string[]}
 */
function verificationDirectories(o) {
  const scratchDir = path.join(o.runDir, '_scratch');
  try {
    fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
  } catch {
    // Best-effort: a directory the engine cannot be asked about either
    // degrades or refuses exactly like any other unreachable directory below.
  }
  return [...new Set([o.runDir, scratchDir, ...(o.seatToolsLocal ? [o.project] : [])])];
}

/**
 * The council agents the run's engine actually registered, as rendered rule
 * lists. Mirrors run-server.js :: listEngineToolIds (same `shared.serverClient`
 * access, null on anything wrong, `logger.debug` on failure). Ruling P2-R33:
 * what validateSeatToolsAgainstEngine reads back to catch a tree-supplied
 * opencode.json/.opencode/agent file that widened a council agent (measured
 * 2026-09-12, probe-council-agents.js's PROBE_TREE_JSON).
 * @param {{serverClient: object}|null} shared
 * @param {string} directory
 * @returns {Promise<Array<{name: string, mode: string, permission: Array}>|null>}
 */
async function listEngineAgents(shared, directory) {
  const client = shared && shared.serverClient;
  if (!client || !client.app || typeof client.app.agents !== 'function') { return null; }
  try {
    const res = await client.app.agents({ query: { directory } });
    return (res && Array.isArray(res.data)) ? res.data.slice() : null;
  } catch (err) {
    const { logger } = require('../utils/logger');
    logger.debug('Engine agent list unavailable', { error: err.message });
    return null;
  }
}

/**
 * Ruling P2-R40 (A2/B2, round 3): is this `external_directory` pattern one of
 * the engine's OWN paths, not a tree-supplied allow riding after the wildcard
 * deny? The pinned engine (opencode 1.18.15) appends exactly one such rule
 * after the agent block — its tool-output cache, under its own data
 * directory; denying it would break tool output round-trips, so it (and only
 * it, by directory) is exempted from check (b) below. ANY other specific
 * `external_directory` allow is treated like any other widened rule.
 *
 * Ruling P2-R42 (round-3 nits): the data directory is resolved the same
 * XDG-first way as `src/utils/auth-json.js :: authJsonCandidates` and
 * `src/utils/engine-log.js :: engineLogDirCandidates` (same engine, same
 * data root) — `$XDG_DATA_HOME/opencode` when `XDG_DATA_HOME` is set, else
 * `~/.local/share/opencode`. The original version of this check hard-coded
 * the home form only, so a machine (or sandbox — see
 * scripts/run-integration-keyless.js, which sets `XDG_DATA_HOME` itself)
 * with `XDG_DATA_HOME` actually set would render its tool-output allow
 * somewhere this check did not recognize, misreading a legitimate engine
 * default as a widened agent. Compared after normalizing both sides to
 * forward slashes, case-insensitively on win32; the backslash rewrite itself
 * is win32-only — `\` is a legal filename character on POSIX, so rewriting
 * it there could fold two DIFFERENT paths into comparing equal.
 * @param {string} pattern
 * @returns {boolean}
 */
function isEngineDataDirPattern(pattern) {
  const forSlash = (p) => (process.platform === 'win32' ? String(p).replace(/\\/g, '/') : String(p));
  const forCompare = (p) => (process.platform === 'win32' ? forSlash(p).toLowerCase() : forSlash(p));
  const roots = [];
  if (process.env.XDG_DATA_HOME) { roots.push(path.join(process.env.XDG_DATA_HOME, 'opencode')); }
  roots.push(path.join(os.homedir(), '.local', 'share', 'opencode'));
  const cmp = forCompare(pattern);
  return roots.some((root) => cmp.startsWith(`${forCompare(root)}/`));
}

/**
 * Pure tripwire (ruling P2-R33): does an ENGINE-RENDERED rule list for a
 * council agent behave the way its allowlist says it should? A reviewed
 * tree's own opencode.json (or .opencode/agent/<name>.md) merges INTO the
 * server-registered agent by KEY ORDER (measured 2026-09-12 against opencode
 * 1.18.15): server values win per key, but a TREE-ONLY key keeps the tree's
 * position — after the tree's own `"*"`, it renders AFTER the server's
 * `*=deny` and wins under findLast (`council-support: { tools: { "*": true,
 * "task": true } }` renders `*=deny task=allow …` — task ALLOWED). A tree
 * that re-lists a GRANTED key (e.g. `read`) can instead move ITS allow
 * before `*=deny`, silently losing it. Neither shape is visible from what
 * this run registered — only from what the engine says it rendered.
 * @param {Array<{permission: string, pattern: string, action: string}>} rules
 * @param {string[]} allowlist ids this agent should have allowed (`o.seatTools`
 *   for council-seat, `[]` for council-support)
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
function verifyAgentRendering(rules, allowlist) {
  // Ruling P2-R40/P2-R42 narrow this from "every non-'*' external_directory
  // rule is exempt" to only the engine's OWN data-dir rule
  // (isEngineDataDirPattern) — any other specific pattern (a tree's
  // `/tmp/*`, say) now falls through to the per-rule check below like any
  // other widened rule.
  const list = (Array.isArray(rules) ? rules : [])
    .filter((r) => !(r.permission === 'external_directory' && r.pattern !== '*' && isEngineDataDirPattern(r.pattern)));
  let starIndex = -1;
  list.forEach((r, i) => { if (r.permission === '*' && r.pattern === '*') { starIndex = i; } });
  if (starIndex < 0 || list[starIndex].action !== 'deny') { return { ok: false, reason: 'no wildcard deny' }; }
  // Named mutant TRIPWIREBLIND: dropping this loop leaves an extra allow
  // OUTSIDE the allowlist (support attack: task=allow after *=deny) undetected.
  for (let i = starIndex + 1; i < list.length; i++) {
    const r = list[i];
    if (r.action === 'deny') { continue; }
    if (r.pattern !== '*' || !allowlist.includes(r.permission) || r.action !== 'allow') {
      return { ok: false, reason: `${r.permission}[${r.pattern}]=${r.action} is allowed after the wildcard deny` };
    }
  }
  for (const id of allowlist) {
    const granted = list.slice(starIndex + 1).some((r) => r.permission === id && r.pattern === '*' && r.action === 'allow');
    if (!granted) { return { ok: false, reason: `granted tool ${id} is not allowed after the wildcard deny` }; }
  }
  return { ok: true };
}

module.exports = { verificationDirectories, listEngineAgents, verifyAgentRendering };
