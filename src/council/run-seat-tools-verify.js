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
const { SEAT_READ_DENY_PATTERNS } = require('./seat-tools');

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
 * Ruling P2-R40 (A2/B2, round 3): is this `external_directory` pattern the
 * engine's OWN tool-output cache rule, not a tree-supplied allow riding after
 * the wildcard deny? The pinned engine (opencode 1.18.15) appends exactly one
 * such rule after the agent block — under its own data directory's
 * `tool-output/` subdirectory; denying it would break tool output
 * round-trips, so it (and only it, by directory) is exempted from check (b)
 * below. ANY other specific `external_directory` allow is treated like any
 * other widened rule.
 *
 * Ruling P2-R45 (round 4, B1/C1): narrowed from "anywhere under the data
 * root" to "under the data root's `tool-output/` subdirectory only" —
 * measured T6: a tree's `external_directory: {'<dataroot>/secrets/*':
 * 'allow'}` on council-seat is replaced WHOLESALE by the server's plain
 * string `external_directory: 'deny'` (no per-key merge happens for this key
 * on the pinned engine), so the wider exemption was already unreachable in
 * practice — this narrowing is defense-in-depth against the exemption ever
 * covering more than the ONE rule it exists for (the data root also holds
 * the engine's `auth.json`). Named mutant EXEMPTBROAD: reverting to the bare
 * data-root prefix (dropping the `tool-output` join below) lets a tree's
 * `<dataroot>/secrets/*` allow read as this exemption again.
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
function isEngineToolOutputPattern(pattern) {
  const forSlash = (p) => (process.platform === 'win32' ? String(p).replace(/\\/g, '/') : String(p));
  const forCompare = (p) => (process.platform === 'win32' ? forSlash(p).toLowerCase() : forSlash(p));
  const roots = [];
  if (process.env.XDG_DATA_HOME) { roots.push(path.join(process.env.XDG_DATA_HOME, 'opencode')); }
  roots.push(path.join(os.homedir(), '.local', 'share', 'opencode'));
  const cmp = forCompare(pattern);
  return roots.some((root) => cmp.startsWith(`${forCompare(path.join(root, 'tool-output'))}/`));
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
 *
 * Ruling P2-R44 (round 4, C4): order-verified, not merely existence-verified,
 * for `read`'s three deny patterns. Measured 2026-09-12 (T1): a tree that
 * re-lists council-seat's `permission.read` sub-keys (e.g. granting
 * `*.env`/`*.env.*`/`*.envrc`) keeps the TREE's sub-key order in the merged
 * rendering — the server's VALUES still win (the three patterns still say
 * `deny`), but they render BEFORE `read[*]=allow` instead of after it, so
 * under the engine's findLast evaluation `.env`/`.env.*`/`.envrc` are all
 * ALLOWED even though every rule this tripwire used to check for
 * (existence, never position) is present. Step 5 below closes that hole by
 * checking WHERE each deny sits relative to the seat's own read allow, not
 * merely whether it exists after the wildcard.
 * @param {Array<{permission: string, pattern: string, action: string}>} rules
 * @param {string[]} allowlist ids this agent should have allowed (`o.seatTools`
 *   for council-seat, `[]` for council-support)
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
function verifyAgentRendering(rules, allowlist) {
  // Ruling P2-R40/P2-R42/P2-R45 narrow this from "every non-'*' external_directory
  // rule is exempt" to only the engine's OWN tool-output rule
  // (isEngineToolOutputPattern) — any other specific pattern (a tree's
  // `/tmp/*`, say) now falls through to the per-rule check below like any
  // other widened rule.
  const list = (Array.isArray(rules) ? rules : [])
    .filter((r) => !(r.permission === 'external_directory' && r.pattern !== '*' && isEngineToolOutputPattern(r.pattern)));
  let starIndex = -1;
  list.forEach((r, i) => { if (r.permission === '*' && r.pattern === '*') { starIndex = i; } });
  if (starIndex < 0 || list[starIndex].action !== 'deny') { return { ok: false, reason: 'no wildcard deny' }; }
  // Named mutant TRIPWIREBLIND: dropping this loop leaves an extra allow
  // OUTSIDE the allowlist (support attack: task=allow after *=deny) undetected.
  // Named mutant GRANTDENYBLIND: dropping the deny branch below (treating
  // every deny as harmless, as the pre-round-4 loop did) lets a granted tool
  // be silently re-denied by a non-`.env` pattern after its own allow (e.g.
  // `grep[*]=allow` then `grep[*]=deny`) — step 4 below still finds the
  // earlier allow and never notices the later deny.
  for (let i = starIndex + 1; i < list.length; i++) {
    const r = list[i];
    if (r.action === 'deny') {
      if (allowlist.includes(r.permission) && !(r.permission === 'read' && SEAT_READ_DENY_PATTERNS.includes(r.pattern))) {
        return { ok: false, reason: `${r.permission}[${r.pattern}]=deny narrows granted tool ${r.permission} after the wildcard deny` };
      }
      continue;
    }
    if (r.pattern !== '*' || !allowlist.includes(r.permission) || r.action !== 'allow') {
      return { ok: false, reason: `${r.permission}[${r.pattern}]=${r.action} is allowed after the wildcard deny` };
    }
  }
  for (const id of allowlist) {
    const granted = list.slice(starIndex + 1).some((r) => r.permission === id && r.pattern === '*' && r.action === 'allow');
    if (!granted) { return { ok: false, reason: `granted tool ${id} is not allowed after the wildcard deny` }; }
  }
  // Named mutant ENVORDERBLIND: dropping this block lets a tree reorder the
  // seat's read denies BEFORE its read allow (measured 2026-09-12, T1) go
  // undetected — every check above only asks whether a rule EXISTS after the
  // wildcard, never in what order, so this function would still return
  // {ok: true} while `.env`/`.env.*`/`.envrc` render ALLOWED on the engine.
  if (allowlist.includes('read')) {
    const after = list.slice(starIndex + 1);
    let lastAllow = -1;
    after.forEach((r, i) => { if (r.permission === 'read' && r.pattern === '*' && r.action === 'allow') { lastAllow = i; } });
    for (const p of SEAT_READ_DENY_PATTERNS) {
      let lastDeny = -1;
      after.forEach((r, i) => { if (r.permission === 'read' && r.pattern === p) { lastDeny = i; } });
      if (lastDeny < 0 || after[lastDeny].action !== 'deny' || lastDeny <= lastAllow) {
        return { ok: false, reason: `read[${p}]=deny is missing or does not follow the seat's read allow` };
      }
    }
  }
  return { ok: true };
}

module.exports = { verificationDirectories, listEngineAgents, verifyAgentRendering };
