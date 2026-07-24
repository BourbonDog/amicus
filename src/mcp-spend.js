// src/mcp-spend.js
'use strict';

/**
 * @module mcp-spend
 * Read-only `amicus_spend` MCP tool (spec §7.3, resolved Q1). Mirrors the CLI
 * `amicus spend` query flags over spend-ledger.jsonl. No fence: spend docs are
 * ids/numbers/paths by construction (never model-generated text) — the schema
 * commits to keeping it that way, so unlike other sidecar-facing MCP tools
 * this handler never calls fenceSidecarOutput. `buildSpendResult` is the pure
 * core (dir/cwd DI seam, no I/O beyond readSpendRows); `amicus_spend` is the
 * async MCP entry the server dispatch loop calls.
 *
 * Every query primitive (filterRows/groupRows/computeWasted/GROUP_DIMS/
 * ROWS_CAP from ./spend-query, aggregateSpend/buildSpendDoc from
 * ./cli-handlers-spend) is reused verbatim from Task 4 — nothing here
 * reimplements filtering, grouping, or the wasted rollup.
 *
 * Row-filter naming note: the CLI's `--project` flag mirrors 1:1 onto every
 * other filter EXCEPT this one, which is `filterProject` here rather than
 * `project`. The MCP dispatch wrapper (mcp-server.js) treats an input key
 * literally named `project` as the tool's own working-directory selector and
 * resolves/validates it against the allowed project roots BEFORE the handler
 * ever runs — throwing for a path outside them. That's the right behavior for
 * a cwd selector; it is wrong for this field, which is a pure ledger-row
 * filter that must be able to name ANY project the ledger has ever recorded
 * spend for (the ledger itself is global, keyed by config dir, not by cwd —
 * see readSpendRows). Reusing `project` here would make filtering by an
 * out-of-roots historical project throw instead of returning rows. Hence the
 * distinct name.
 */

const { readSpendRows } = require('./utils/spend-ledger');
const { aggregateSpend, buildSpendDoc, parseSinceDays } = require('./cli-handlers-spend');
const { filterRows, groupRows, computeWasted, GROUP_DIMS, ROWS_CAP } = require('./spend-query');
const { buildErrorDoc, ERROR_CODES } = require('./utils/error-doc');

/** @param {string} message @param {string} hint @returns {{content:Array, isError:true}} */
function errorResult(message, hint) {
  const doc = buildErrorDoc({ code: ERROR_CODES.BAD_ARGS, message, hint });
  return { content: [{ type: 'text', text: JSON.stringify(doc) }], isError: true };
}

/**
 * Pure core: build the spend-doc MCP result for a given input + test seam.
 * @param {{since?:string, wave?:string, council?:string, filterProject?:string,
 *   model?:string, op?:string, failed?:boolean, groupBy?:string, rows?:boolean}} [input]
 * @param {{dir?:string, cwd?:string, now?:()=>number}} [ctx] test/DI seam — dir
 *   overrides the ledger's config dir (readSpendRows); cwd is the resolved
 *   project dir used to expand a literal '.' filterProject (CLI --project .
 *   parity); now overrides the clock used for `since` windowing (CLI --since
 *   test parity).
 * @returns {{content:[{type:'text', text:string}], isError?:true}}
 */
function buildSpendResult(input = {}, ctx = {}) {
  const groupBy = input.groupBy || 'model';
  if (!GROUP_DIMS.includes(groupBy)) {
    return errorResult(
      `invalid groupBy '${groupBy}'`,
      `groupBy one of: ${GROUP_DIMS.join('|')}`
    );
  }

  let windowDays = null;
  if (input.since !== undefined) {
    windowDays = parseSinceDays(input.since);
    if (windowDays === null) {
      return errorResult(
        `invalid since '${input.since}'`,
        "since must be an integer followed by 'd' (e.g. '7d')"
      );
    }
  }

  const rows = readSpendRows(ctx.dir);
  const filters = {
    wave: input.wave,
    council: input.council,
    model: input.model,
    op: input.op,
    failed: !!input.failed,
    project: input.filterProject === '.' ? (ctx.cwd || process.cwd()) : input.filterProject,
  };
  const now = windowDays !== null ? (ctx.now ? ctx.now() : Date.now()) : undefined;
  const filtered = filterRows(rows, { ...filters, since: windowDays, now });
  const { total, byModel } = aggregateSpend(filtered);
  const groups = groupRows(filtered, groupBy);
  const wasted = computeWasted(filtered);

  const doc = buildSpendDoc({
    // credit stays null over MCP: the OpenRouter credit footer is a
    // best-effort network probe the CLI path accepts blocking on —
    // deliberately skipped here so a read-only local-file query never waits
    // on the network. `since`/windowDays, by contrast, is a pure local
    // filter (filterRows) with no network involved, so it IS threaded here.
    total, byModel, windowDays, credit: null,
    filters, groupBy, groups, wasted,
    rows: input.rows ? filtered.slice(0, ROWS_CAP) : undefined,
    rowsTruncated: input.rows ? filtered.length > ROWS_CAP : undefined,
  });

  // Spec §7.3: spend docs are ids/numbers/paths only, by construction — never
  // fenced (contrast amicus_council_stats etc., which DO fence because they
  // summarize model-raised prose).
  return { content: [{ type: 'text', text: JSON.stringify(doc) }] };
}

/**
 * MCP entry point. `project` is the dispatch-resolved cwd (mcp-server.js
 * calls `handlers[name](input, project, server)`); this tool has no
 * `project` input of its own (see module docblock), so it only uses it to
 * expand a literal '.' `filterProject`. The 3rd positional slot is `server`
 * in production (read only for `.dir`/`.now`, which it never has — a no-op)
 * and a `{dir, now}` test seam in tests, mirroring handleSpend's
 * depsOverride shape.
 * @param {object} [input]
 * @param {string} [project]
 * @param {{dir?:string, now?:()=>number}} [testOverride]
 * @returns {Promise<{content:Array, isError?:true}>}
 */
async function amicus_spend(input, project, testOverride = {}) {
  return buildSpendResult(input || {}, { cwd: project, dir: testOverride.dir, now: testOverride.now });
}

module.exports = { amicus_spend, buildSpendResult };
