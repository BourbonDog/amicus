/**
 * Bench and input resolution for the council run command.
 *
 * Exports parseList, sanitizeCouncilName, resolveBench — extracted verbatim
 * from cli-handlers-council-run.js (v4.7 PR0). ⚠️ v4.9 W13 split `resolveBench`
 * into a private `resolveBenchCore` (the extracted body, still verbatim) plus a
 * thin exported wrapper that owns the ONE alias-shadow notice site; the export
 * name, its arguments and its return shapes are unchanged.
 * ⚠️ The top-level cli*.js name is LOAD-BEARING: the known-flags source scan
 * covers only src/cli*.js, and resolveBenchCore reads args['dropped-members'].
 */

'use strict';

const { failJson, ERROR_CODES } = require('./utils/error-doc');

/**
 * The chair a council gets when nobody names one.
 *
 * ⚠️ Lives HERE, in the bench/seat-resolution leaf, and is imported by
 * `cli-handlers-council-run.js` (which re-exports it, so existing importers are
 * unchanged) and by `mcp-council-run.js`. PR #203 round 1 (A6) needed the
 * default at this seam to audit the chair; two spellings already existed and a
 * third would have been the "wrong lever" mistake — one owner, three readers.
 */
const CHAIR_DEFAULT = 'deepseek';

function parseList(value) {
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * The chair this run will use: a trimmed `--chair`, else CHAIR_DEFAULT.
 * Extracted so the alias audit below and the handler that enforces the
 * chair-not-in-bench rule read ONE definition. @param {object} args
 * @returns {string}
 */
function resolveChair(args) {
  return (typeof args.chair === 'string' && args.chair.trim()) ? args.chair.trim() : CHAIR_DEFAULT;
}

/** The critic seat, or null when this run has none. Same one-definition
 * rationale as resolveChair. @param {object} args @returns {string|null} */
function resolveCritic(args) {
  return (typeof args.critic === 'string' && args.critic.trim()) ? args.critic.trim() : null;
}

/**
 * Sanitize the internal `--council-name` passthrough before it can reach the
 * spend ledger's `councilName` column (v4.3 Task 4 review fix, spec §7.3:
 * spend docs hold only ids/numbers/paths "by construction"). That value is
 * user-supplied (via mcp-council-run.js, ultimately an MCP caller's `input`),
 * unbounded, and unvalidated — unlike a real `--council <preset>`, which is
 * catalog-validated upstream. Strips control/non-printable characters, trims,
 * and caps length so a hostile/malformed passthrough can't land raw in a
 * `--group-by council` rollup. Precedence is untouched by this: it's applied
 * only to the passthrough branch, never to the catalog-validated preset name.
 * @param {string} name @returns {string|null} sanitized name, or null if empty after cleanup
 */
function sanitizeCouncilName(name) {
  // eslint-disable-next-line no-control-regex -- deliberately stripping C0/DEL control chars
  const cleaned = String(name).replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 64);
  return cleaned || null;
}

/**
 * Resolve bench models from --models XOR --council (mirrors handleFanout).
 * Also returns `presetName` (v4.3 Task 3, spec §7.1: trimmed --council name,
 * else null) and `droppedMembers`: a preset's own drops, or — bare --models —
 * the parsed `--dropped-members` MCP→child passthrough (v4.6 Plan 4 Task 4b).
 * Parallel twin: mcp-council-bench.js's `resolveBenchInput` hand-rolls the same
 * models-XOR-council wrapper around the shared `resolveCouncilMembers` core.
 * They have already diverged (this side has a third guard for a valueless
 * --council, and the min-seat rule lives in both callers, not here) — change
 * a validation rule on one side, change the other.
 *
 * ⚠️ Not exported directly — `resolveBench` below wraps it so the alias-shadow
 * notice has exactly ONE site. Keep new return shapes going through that wrapper.
 */
function resolveBenchCore(args, useJson) {
  const hasModels = typeof args.models === 'string' && args.models.trim();
  const hasCouncil = args.council !== undefined && args.council !== false;
  if (hasModels && hasCouncil) {
    return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: pass exactly one of --models / --council, not both' }) };
  }
  if (!hasModels && !hasCouncil) {
    return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: council run needs --models a,b,c or --council <preset> (at least 2 seats)' }) };
  }
  if (hasCouncil) {
    if (typeof args.council !== 'string' || !args.council.trim()) {
      return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
        message: 'Error: --council requires a council name (e.g. --council budget)' }) };
    }
    const { resolveCouncilMembers } = require('./utils/config');
    const { readCache } = require('./utils/model-catalog');
    const catalog = (readCache() || {}).models || [];
    const presetName = args.council.trim();
    const expanded = resolveCouncilMembers(presetName, catalog);
    if (expanded.error) {
      return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: ${expanded.error}` }) };
    }
    // v4.5 Wave 2 → Plan 4 Task 4: threaded into runCouncil's options — the
    // sink now announces each dropped member, with reason, on every transport and surface.
    return { bench: expanded.models, presetName, droppedMembers: expanded.droppedMembers || [] };
  }
  if (args['dropped-members'] === undefined) {
    return { bench: parseList(args.models), presetName: null, droppedMembers: [] };
  }
  let dm; try { dm = JSON.parse(args['dropped-members']); } catch { dm = null; }
  if (!Array.isArray(dm) || !dm.every(d => d && typeof d.member === 'string' && typeof d.reason === 'string')) {
    return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: --dropped-members must be a JSON array of {member, reason} entries' }) };
  }
  return { bench: parseList(args.models), presetName: null, droppedMembers: dm };
}

/**
 * `resolveBenchCore` plus the ONE alias-shadow notice site (v4.9 W13 Task B,
 * BACKLOG C5). This is the shared bench-resolution helper BOTH council
 * transports execute: `mcp-council-run.js` always spawns the CLI child with an
 * already-expanded `--models` list (never `--council`), so the MCP path
 * re-enters here exactly like a hand-typed `amicus council run`. Measured, not
 * assumed — see tests/alias-shadow.test.js's header, and see alias-shadow.js's
 * own docblock for where the resulting line does and does NOT surface.
 *
 * Wrapped rather than called from each `return`, so the rule cannot grow a twin
 * as branches are added. A rejected bench carries no `bench` key and is
 * therefore silent by construction: nothing was resolved, so nothing is
 * diagnosed. Diagnosis only — the returned value is byte-identical to what
 * `resolveBenchCore` produced.
 *
 * v4.9 W13, PR #203 council round 1:
 *   A5 — `auditAliasShadows` (not `noteAliasShadows`) opens a fresh notice scope
 *        first, so a host process that resolves two councils in a row audits
 *        BOTH instead of silently auditing only the first. This call is reached
 *        exactly once per council run, which is what makes "one scope" mean
 *        "one run".
 *   A6 — the audited names are the bench PLUS the chair (explicit or default)
 *        and the critic. All three resolve through the same alias table, so a
 *        shadow on any of them is equally invisible downstream. Order matters
 *        only cosmetically (rows come back in the order given), and the audit
 *        de-dups, so a critic — which a valid run always draws from the bench —
 *        adds a row only when it is outside it.
 */
function resolveBench(args, useJson) {
  const res = resolveBenchCore(args, useJson);
  if (Array.isArray(res.bench)) {
    const critic = resolveCritic(args);
    require('./utils/alias-shadow').auditAliasShadows(
      [...res.bench, resolveChair(args), ...(critic ? [critic] : [])]);
  }
  return res;
}

module.exports = {
  parseList, sanitizeCouncilName, resolveBench, resolveChair, resolveCritic, CHAIR_DEFAULT,
};
