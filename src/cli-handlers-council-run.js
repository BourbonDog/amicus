// src/cli-handlers-council-run.js
'use strict';

/**
 * CLI `amicus council run` (v4.0 spec §4): flag validation, headless engine
 * invocation, document emission, exit codes. Lives in its own file because
 * cli-handlers-council.js is near the 300-line gate; dispatched from
 * handleCouncil. Pre-flight failures go through the error envelope (exit 1)
 * BEFORE any spend.
 */

const path = require('path');
const { failJson, buildErrorDoc, ERROR_CODES } = require('./utils/error-doc');
const { validateTaskId, validateTag } = require('./utils/validators');
const { GATEWAY_MODES } = require('./utils/model-descriptor');
// v4.6 Plan 4 Task 2: renderRunHuman moved to its own leaf (size gate); this
// file re-exports it below so every existing require() of this path still
// resolves it unchanged.
const { renderRunHuman } = require('./cli-council-run-render');
// v4.9 W13 (PR #203 round 1, A6): CHAIR_DEFAULT and the two seat resolvers moved
// to cli-council-run-bench.js so the alias audit at the resolveBench seam and the
// validation below read ONE definition of each. Re-exported at the bottom of this
// file, so `require('./cli-handlers-council-run').CHAIR_DEFAULT` still resolves.
const {
  parseList, sanitizeCouncilName, resolveBench, resolveChair, resolveCritic, CHAIR_DEFAULT,
} = require('./cli-council-run-bench');
const { applyTemplateForArgs } = require('./cli-template-args');

/**
 * Default real helpers; tests override via depsOverride (mirrors
 * cli-handlers-spend.js's realDeps()/depsOverride convention).
 */
function realDeps() {
  return {
    // #81 (spec §2): same pure presence probe doctor's electron checks use (src/cli-handlers-doctor.js).
    getElectronPath: () => require('./sidecar/interactive-process').getElectronPath(),
  };
}

/**
 * @param {object} args parsed CLI args
 * @param {object} [depsOverride] test seam (getElectronPath)
 * @returns {Promise<number>} exit code
 */
async function handleCouncilRun(args, depsOverride = {}) {
  const useJson = !!args.json;
  const deps = { ...realDeps(), ...depsOverride };

  // v4.5 Task 12 (B7/F5): resolve --pack FIRST, above the Task-5 template
  // block, so a pack-filled args.template renders through that single
  // existing application point exactly like a typed --template.
  let packRecord = null;
  const explicitKeys = args.__explicit || new Set();
  // v4.7 PR6: these all parse as boolean `true` when typed without a value
  // (src/cli.js:101) and reached runCouncil as `true`, a NaN, or a bogus path.
  // Voice matches the R5 -o/--out precedent (cli-handlers-council.js:183).
  for (const flag of ['out-dir', 'claude-review', 'run-id']) {
    if (!explicitKeys.has(flag)) { continue; }
    const v = args[flag];
    if (typeof v !== 'string' || v === '') {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: --${flag} requires a value` });
    }
    if (v.startsWith('-')) {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: --${flag} cannot start with '-': got '${v}'` });
    }
  }
  // --timeout is DEFAULTS-seeded to 15 (src/cli.js:31), so `!== undefined` proves
  // nothing; NaN is the real hole — it passes the `<= 0` guard below.
  if (explicitKeys.has('timeout') && (typeof args.timeout !== 'number' || !Number.isFinite(args.timeout))) {
    // Do NOT echo args.timeout: parseArgs already ran parseInt, so a typed
    // `--timeout abc` reads back as NaN and quoting it shows the user a value
    // they never typed. Boolean `true` (bare flag) has the same problem.
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --timeout requires a number' });
  }
  if (args.pack !== undefined) {
    const { applyPackToArgs } = require('./pack/pack-resolve');
    const pr = applyPackToArgs({
      packRef: args.pack, expectedKind: 'council', args,
      explicit: explicitKeys, useJson,
    });
    if (pr.error) { return failJson(useJson, pr.error); }
    for (const n of pr.notices) { process.stderr.write(n + '\n'); }
    packRecord = pr.packRecord;
  }
  // 2026-07-28 ruling (Task-11 review): attribute a pre-flight failure to the
  // pack that supplied the failing value — ONLY when the pack filled it (an
  // explicit flag always wins and is never "blamed" on the pack).
  const packSuffix = (key) => (packRecord && args[key] !== undefined && !explicitKeys.has(key))
    ? ` (set by pack '${packRecord.name}')` : '';

  // --prompt-file required; inline --prompt rejected (councils always have
  // real briefings — same rationale as MCP fanout's briefing-via-file).
  if (args.prompt !== undefined) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: council run takes --prompt-file only (no inline --prompt)',
      hint: 'write the briefing to a file and pass --prompt-file <path>' });
  }
  const { resolvePromptSource } = require('./utils/prompt-source');
  // F9 (v4.5): with --template and no {{prompt}} slot, --prompt-file may be
  // absent (mirrors handleFanout's guard); byte-identical without --template.
  let promptRes;
  if (args.prompt !== undefined || args['prompt-file'] !== undefined || args.template === undefined) {
    promptRes = resolvePromptSource(args);
    if (promptRes.error) { return failJson(useJson, { code: ERROR_CODES.MISSING_PROMPT, message: promptRes.error }); }
  } else {
    promptRes = { prompt: undefined, promptMeta: null };
  }
  let templateMeta = null;
  const tpl = applyTemplateForArgs(args, promptRes.prompt, useJson);
  if (tpl.fail !== undefined) { return tpl.fail; }
  // The trailing `templateMeta =` is NOT copy-paste drift against handleFanout's
  // otherwise-identical call: it feeds `template: templateMeta` on the run.json
  // seed below (the `template:` field of the runCouncil options object). Drop it
  // and every --template council run silently records
  // `template: null`. handleFanout has no such field, which is why its call is shorter.
  if (tpl.applied) { promptRes = { prompt: tpl.prompt, promptMeta: tpl.promptMeta }; templateMeta = tpl.templateMeta; }

  const benchRes = resolveBench(args, useJson);
  if (benchRes.fail !== undefined) { return benchRes.fail; }
  const bench = benchRes.bench;
  // v4.3 Task 3 (spec §7.1): the preset name, when this run came from a real
  // --council <preset>. `--council-name` is an internal, undocumented passthrough
  // set by mcp-council-run.js — the MCP handler always expands a preset to
  // `--models` before spawning (so `--council`/`--models` stay mutually exclusive
  // on this CLI surface), which would otherwise strand the preset name with no
  // way to reach this process. Never fabricated: --models with neither flag
  // stays null, matching spec §7.1 ("preset name … else null"). The
  // passthrough branch is sanitized (see sanitizeCouncilName docblock) — the
  // preset-name branch is catalog-validated upstream and never touched here,
  // so precedence (a real --council preset always outranks the passthrough)
  // is unchanged.
  const councilName = benchRes.presetName
    || (typeof args['council-name'] === 'string' ? sanitizeCouncilName(args['council-name']) : null);
  if (bench.length < 2) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: a council needs at least 2 seats (fanout semantics)' });
  }

  const chair = resolveChair(args);
  if (bench.includes(chair)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `Error: chair '${chair}' is a bench seat — the chair must not review${packSuffix('chair')}`,
      hint: `pick a chair outside --models (default: ${CHAIR_DEFAULT}), or remove '${chair}' from the bench` });
  }
  const critic = resolveCritic(args);
  if (critic && !bench.includes(critic)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `Error: critic '${critic}' must be one of the bench seats${packSuffix('critic')}`,
      hint: `--critic swaps one seat's brief; pass one of: ${bench.join(', ')}` });
  }
  const lenses = (typeof args.lenses === 'string' && args.lenses.trim()) ? parseList(args.lenses) : null;
  if (critic && lenses) {
    // T11-d: no packSuffix() here (unlike the chair/critic-in-bench checks
    // above) — it would only ever contribute ''. pack-validate.js now rejects
    // a pack supplying both critic and lenses before this handler ever runs
    // (PACK_INVALID, pre-spend, via pack-resolve.js's validatePack call), and
    // pack-resolve.js:140/143 already suppress the mixed pack-field x
    // explicit-flag crossings (a pack-filled critic is skipped when --lenses
    // is explicit, and vice versa). So whenever this branch fires, both
    // critic and lenses are always explicit flags, never pack-attributed.
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: --critic and --lenses are mutually exclusive in v4.0' });
  }
  if (lenses && lenses.length !== bench.length) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `Error: --lenses needs exactly one lens per seat (${bench.length} seats, got ${lenses.length})` });
  }
  // v4.7 PR6: this check is POST-pack-merge and ungated, so it is the only one a
  // pack-filled value passes through — `timeout` is a legal council pack option
  // (pack-validate.js KIND_OPTIONS) and validatePack checks the key name, never
  // the value type. The old `<= 0` test alone let `{timeout: true}` past (true
  // coerces to 1) and `{timeout: "abc"}` past as NaN, reproducing the very bug
  // the typed-flag guard above closes. Same shape as --max-cost's check below.
  if (args.timeout !== undefined
      && (typeof args.timeout !== 'number' || !Number.isFinite(args.timeout) || args.timeout <= 0)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --timeout must be a positive number' });
  }
  const mc = args['max-cost'];
  if (mc !== undefined && (typeof mc !== 'number' || !Number.isFinite(mc) || mc <= 0)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --max-cost must be a positive number' });
  }
  if (args.gateway !== undefined && !GATEWAY_MODES.includes(args.gateway)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `Error: --gateway must be one of: ${GATEWAY_MODES.join(', ')}` });
  }
  // v4.7 F8 (D13): reject-style (unlike sanitizeCouncilName, which cleans) —
  // a stored tag is a user-chosen search key, so silent truncation/stripping
  // would make --search/--group-by tag miss it.
  if (args.tag !== undefined) {
    const tagCheck = validateTag(args.tag);
    if (!tagCheck.ok) {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: tagCheck.error });
    }
  }
  // v4.9 W5.2 (spec §5.3): emit-when-'task' everywhere — 'review' is the
  // default spelled out and is never materialized on the options object.
  if (args.intent !== undefined && args.intent !== 'review' && args.intent !== 'task') {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: --intent must be review or task',
      hint: "review (the default) may be omitted; only '--intent task' changes the run" });
  }
  let runId;
  if (args['run-id']) {
    const check = validateTaskId(String(args['run-id']));
    if (!check.valid) {
      return failJson(useJson, { code: ERROR_CODES.BAD_SESSION, message: check.error });
    }
    runId = String(args['run-id']);
  } else {
    runId = require('./sidecar/start').generateTaskId();
  }

  const project = args.cwd || process.cwd();
  const runDir = args['out-dir']
    ? path.resolve(project, String(args['out-dir']))
    : path.resolve(project, `council-${runId}`);
  // v4.7 PR6: MCP has fenced this since v4.5 (mcp-council-run.js:137-141); the CLI
  // never did, so `--out-dir ../../x` wrote outside the project and exited 0.
  const { isPathInside } = require('./project-root-allowlist');
  if (!isPathInside(runDir, project)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: --out-dir must stay inside the project: '${args['out-dir']}' resolves outside ${project}` });
  }

  const { resolveGatewayMode, loadConfig } = require('./utils/config');
  const { resolveFallbackConfig } = require('./sidecar/fallback-chains');
  const { readCache } = require('./utils/model-catalog');
  const { runCouncil } = require('./council/run');
  const cfg = loadConfig() || {};

  // #81 (spec §2): the GUI's existence was announced on NO surface from the
  // CLI path — MCP launches auto-open, the CLI stayed silent. Auto-open
  // parity is a product decision (deliberately not taken here); the SILENCE
  // is the spec's to fix. Presence probe only — never launches. Placed here
  // (runId/runDir already resolved, still before the engine await) so the
  // notice is useful WHILE the run is live, not just after it finishes.
  if (!useJson && deps.getElectronPath()) {
    process.stderr.write(`Notice: the Council Workspace can render this run live — open it with: amicus watch ${runId} --ui\n`);
  }

  const { exitCode, run } = await runCouncil({
    briefing: promptRes.prompt, models: bench, chair, critic, lenses,
    project, runId, runDir,
    timeout: args.timeout, maxCost: mc !== undefined ? mc : null,
    gateway: resolveGatewayMode(args.gateway),
    noValidateModel: !!args['no-validate-model'],
    date: new Date().toISOString().slice(0, 10),
    councilName,
    template: templateMeta, // F9 (v4.5): null when no --template; additive on the run.json seed (run-state.js).
    pack: packRecord, // v4.5 Task 12 (B7/F5): null when no --pack; additive on the run.json seed (run-state.js).
    tag: args.tag, // v4.7 F8: undefined when no --tag; Task 3 stores it on the run.json seed.
    // v4.9 W5.2: o.intent is 'task' or ABSENT, never 'review' (validated above).
    ...(args.intent === 'task' ? { intent: 'task' } : {}),
    droppedMembers: benchRes.droppedMembers, // v4.5 Wave 2: [] when nothing dropped; additive on the run.json seed (run-state.js).
    // v4.1 §4.5b/§4.5d. `--claude-review` is resolved here but VALIDATED by the
    // engine's preflightClaudeReview (run-assemble.js): the reserved-seat and
    // 'claude may not chair' guards live there on purpose so MCP, the GitHub
    // Action and direct `require('./council/run')` callers hit the same rule and
    // the same COUNCIL_CLAUDE_REVIEW_INVALID code. Re-checking them here would
    // give the identical mistake two different error codes by entry point.
    debate: !!args.debate,
    claudeReviewFile: args['claude-review'] ? path.resolve(args['claude-review']) : null,
    noCostGate: !!args['no-cost-gate'],
    // v4.3 Task 13: --follow's json-vs-human mode mirrors the same --json this
    // handler already resolved for the final run doc, so `--json --follow`
    // NDJSON on stderr and the `--json` final doc on stdout agree.
    follow: !!args.follow,
    json: useJson,
    onComplete: args['on-complete'],
    // v4.3 Task 18 (spec §6.2): opt-in cheaper-model substitution for STAGE
    // legs only (run-stages.js threads it through; the chair is excluded —
    // see run-chair.js). --fallback forces on, --no-fallback forces off;
    // unset defers to config `fallbacks.enabled`.
    fallback: resolveFallbackConfig({
      flagFallback: args.fallback === true ? true : (args['no-fallback'] ? false : undefined),
      config: cfg,
    }),
    catalog: (readCache() || {}).models || [],
  });

  if (useJson) {
    // Spec §4: exit-1 rows fail through the error envelope; 0/2 emit the manifest.
    if (exitCode === 1 && run && run.error) {
      process.stdout.write(JSON.stringify(buildErrorDoc({
        code: run.error.code, message: run.error.message, command: 'council run',
      }), null, 2) + '\n');
    } else {
      process.stdout.write(JSON.stringify(run, null, 2) + '\n');
    }
  } else {
    process.stdout.write(renderRunHuman(run));
  }
  return exitCode;
}

module.exports = { handleCouncilRun, renderRunHuman, CHAIR_DEFAULT };
