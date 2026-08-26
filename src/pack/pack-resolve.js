// src/pack/pack-resolve.js
'use strict';

/**
 * @module pack/pack-resolve
 * B7/F5 (v4.5), Task 11. The pack→args merge engine: the single place that
 * turns a resolved, validated pack into filled-in CLI arg values. Precedence
 * is explicit flag > pack > config default > built-in, achieved by filling
 * `args` ONLY for keys the caller did not type (`explicit`, from parseArgs'
 * `__explicit` — Task 10) — everything else (config defaults, built-in
 * fallbacks, cross-field validation) is left to the handler that calls this,
 * unchanged, so v4.0 pre-flight validation runs on the merged, effective
 * values automatically (spec §5.4).
 *
 * Deliberately does NOT call applyTemplate: a pack's `briefing.template` is
 * just another knob that fills `args.template` (a ref, not rendered text).
 * Rendering stays a single-application-point concern of the CLI handlers
 * (Task 12/13), so a pack-filled --template and a typed --template take
 * exactly the same downstream code path.
 */

const { readPack } = require('./pack-store');
const { validatePack } = require('./pack-validate');
const { ERROR_CODES } = require('../utils/error-doc');

/** `options.*` knobs shared by every kind that defines them (council/fanout/solo).
 * `agent` is deliberately NOT in this table — see the dedicated fill below. */
const COMMON_OPTION_KNOBS = [
  ['timeout', 'timeout'], ['maxCost', 'max-cost'], ['gateway', 'gateway'],
  ['thinking', 'thinking'], ['summaryLength', 'summary-length'],
];
/** `options.*` knobs shared by fanout + solo only (v4.5 F4 context controls). */
const CONTEXT_OPTION_KNOBS = [
  ['noContext', 'no-context'], ['contextTurns', 'context-turns'], ['contextMaxTokens', 'context-max-tokens'],
];
/** Concrete command name per pack kind, for the KIND_MISMATCH message (never "this command"). */
const COMMAND_NAME_BY_KIND = { council: 'council run', fanout: 'fanout', solo: 'start' };
/** MCP tool name per pack kind, for the Finding-2 (Task 15 review) orphan-knob notice below. */
const MCP_TOOL_NAME_BY_KIND = { council: 'amicus_council_run', fanout: 'amicus_fanout', solo: 'amicus_start' };

/**
 * council/fanout only: `bench` fills `args.council` (by-name) or `args.models`
 * (csv), unless the caller already typed one of the two — then it is never
 * silently dropped, it becomes a notice instead.
 * @returns {string|null} a notice string, or null when the bench was applied cleanly.
 */
function resolveBenchKnob(pack, args, explicit) {
  const bench = pack.bench;
  if (bench === undefined || bench === null) { return null; }
  const modelsExplicit = explicit.has('models');
  const councilExplicit = explicit.has('council');
  if (!modelsExplicit && !councilExplicit) {
    if (typeof bench === 'string') { args.council = bench; }
    else if (Array.isArray(bench)) { args.models = bench.join(','); }
    return null;
  }
  // Both-typed names --models here, but every consuming surface — fanout (cli-handlers-fanout.js:77),
  // council run (cli-council-run-bench.js:83), MCP (mcp-council-bench.js:29) — rejects
  // --models+--council with BAD_ARGS after pack apply, so a both-typed notice is never actionable.
  const flag = modelsExplicit ? '--models' : '--council';
  return `Notice: ${flag} overrides the bench from pack '${pack.name}'`;
}

/**
 * @param {{packRef: string, expectedKind: 'council'|'fanout'|'solo', args: object,
 *   explicit: Set<string>, useJson?: boolean}} opts `useJson` is accepted for
 *   call-site symmetry with sibling resolvers (e.g. applyTemplate) but unused
 *   here: this module never writes to stdout/stderr itself — notices are
 *   returned as plain strings and the caller alone decides how to print them.
 * @returns {{packRecord: {name, version, hash, source}, notices: string[]}
 *   | {error: {code, message, hint}}}
 */
function applyPackToArgs({ packRef, expectedKind, args, explicit }) {
  const rp = readPack(packRef);
  if (rp.error) {
    return { error: { code: ERROR_CODES.PACK_NOT_FOUND, message: rp.error, hint: 'amicus pack list' } };
  }
  const { pack, source, hash } = rp;

  if (pack.kind !== expectedKind) {
    return {
      error: {
        code: ERROR_CODES.PACK_KIND_MISMATCH,
        message: `Error: pack '${pack.name}' is kind '${pack.kind}' — ${COMMAND_NAME_BY_KIND[expectedKind] || 'this command'} accepts kind '${expectedKind}'; make two packs if you want both shapes`,
        hint: null,
      },
    };
  }

  const validation = validatePack(pack, { mode: 'run' });
  if (!validation.ok) {
    return {
      error: {
        code: ERROR_CODES.PACK_INVALID,
        message: `Error: pack '${pack.name}' failed validation: ${validation.errors.join('; ')}`,
        hint: null,
      },
    };
  }

  const opts = pack.options || {};
  const notices = [];
  const fill = (argKey, value) => {
    if (!explicit.has(argKey) && value !== undefined && value !== null) {
      args[argKey] = value;
    }
  };

  if (pack.kind === 'council') {
    fill('chair', pack.chair);
  }
  if (pack.kind === 'solo') {
    fill('model', pack.model);
    fill('no-ui', opts.noUi);
  }

  for (const [optKey, argKey] of COMMON_OPTION_KNOBS) { fill(argKey, opts[optKey]); }

  // v4.5 final-review F4: cli-handlers-run.js normalizes a legacy --mode flag
  // into args.agent AFTER this merge runs (`args.agent = args.agent ||
  // args.mode`, handleStart/handleFanout only — council has no --mode flag).
  // A typed --mode with no --agent lands 'mode' in `explicit` but not 'agent',
  // so the generic fill() above would silently overwrite a pack's
  // options.agent onto args.agent before that fallback ever sees args.mode —
  // the user's typed value loses to the pack, invisibly. Count --mode as
  // agent-explicit too (same shape as the debate/no-debate negation check
  // below, which also treats an alternate typed form as full explicitness).
  const agentExplicit = explicit.has('agent') || explicit.has('mode');
  if (!agentExplicit && opts.agent !== undefined && opts.agent !== null) { args.agent = opts.agent; }

  if (pack.kind === 'council') {
    // Task 10 ruling: negations record only the literal typed key, so a
    // negatable boolean's "was this explicit" check must test both forms.
    const debateExplicit = explicit.has('debate') || explicit.has('no-debate');
    if (!debateExplicit && opts.debate !== undefined && opts.debate !== null) {
      args.debate = opts.debate;
    }
    // 2026-07-28 ruling: skip filling pack critic when --lenses is explicit —
    // it would trip the handler's critic/lenses mutual-exclusion pre-flight.
    if (!explicit.has('lenses')) { fill('critic', pack.critic); }
    // 2026-07-28 ruling: skip filling pack lenses when --critic is explicit —
    // same mutual-exclusion pre-flight, mirrored direction.
    if (!explicit.has('critic')) {
      fill('lenses', Array.isArray(pack.lenses) ? pack.lenses.join(',') : pack.lenses);
    }
  }

  if (pack.kind === 'fanout' || pack.kind === 'solo') {
    for (const [optKey, argKey] of CONTEXT_OPTION_KNOBS) { fill(argKey, opts[optKey]); }
  }

  if (pack.kind === 'council' || pack.kind === 'fanout') {
    const notice = resolveBenchKnob(pack, args, explicit);
    if (notice) { notices.push(notice); }
  }

  fill('template', pack.briefing && pack.briefing.template);

  return {
    packRecord: { name: pack.name, version: pack.version, hash, source },
    notices,
  };
}

/** argKeys whose CLI-side value is a comma-joined string but whose MCP-side
 * value is an array (`models`, `lenses`) — the two shapes multi-value knobs
 * have always used on their respective sides, round-tripped by the bridge
 * below so `applyPackToArgs`'s tables never need to know about MCP shapes. */
const CSV_ARG_KEYS = new Set(['models', 'lenses']);

/** Reverse of the knob tables above (argKey -> pack's own camelCase option
 * key), used ONLY in notice text (v4.5 decision 1b, T15-m10) — naming a
 * pack's own key is less confusing than the CLI's kebab-case arg-key. Most
 * bespoke (non-table) knobs — chair/critic/lenses/agent/debate — share their
 * argKey/option-key spelling, so the plain-argKey fallback is correct for
 * them; `no-ui` does NOT (pack-side `noUi`) and is listed explicitly. `bench`
 * fills EITHER args.council or args.models (never an argKey of its own) —
 * accepted because both always have a real MCP destination, so a
 * bench-derived value never actually reaches the notice path. */
const ARG_KEY_TO_OPT_KEY = Object.assign(
  Object.fromEntries([...COMMON_OPTION_KNOBS, ...CONTEXT_OPTION_KNOBS].map(([optKey, argKey]) => [argKey, optKey])),
  { 'no-ui': 'noUi' },
);

/** argKeys forwarded instead of notice'd when a tool's paramMap has no
 * destination for them (v4.5 decision 1): a pack's maxCost/template must
 * still apply on `amicus_fanout`/`amicus_start` for CLI parity, even with no
 * schema param for either. `amicus_council_run` already has real destinations
 * for both (COUNCIL_PACK_PARAM_MAP), so it never reaches this path. Context
 * knobs are deliberately excluded — ruled notice-only, out of scope. */
const FORWARDABLE_ARG_KEYS = new Set(['max-cost', 'template']);

function toArgValue(argKey, value) {
  return (CSV_ARG_KEYS.has(argKey) && Array.isArray(value)) ? value.join(',') : value;
}
function fromArgValue(argKey, value) {
  return (CSV_ARG_KEYS.has(argKey) && typeof value === 'string')
    ? value.split(',').map((s) => s.trim()).filter(Boolean)
    : value;
}

/**
 * MCP entry point (Task 15, B7/F5): the same merge as `applyPackToArgs`, for a
 * caller whose knobs live on an `input` object with MCP-shaped key names
 * (camelCase, some renamed/inverted vs. the CLI's kebab-case arg keys) rather
 * than parsed CLI `args`. Builds an args-shaped bridge object via `paramMap`,
 * reuses `applyPackToArgs` UNCHANGED (same knob tables, same precedence, same
 * notices), then copies pack-filled values back onto `input` under their
 * MCP-facing names. An mcpKey already present on `input` is never touched
 * (explicit wins) — `explicit` is built from the caller's OWN `Object.keys(input)`,
 * mapped through `paramMap`, mirroring `args.__explicit` on the CLI side.
 *
 * Deliberately contains NO pack-domain knowledge (no knob names, no bench/chair/
 * timeout logic) beyond the key-renaming in `paramMap` — that stays entirely in
 * `applyPackToArgs`'s tables above. Re-deriving "is this pack-filled" outside
 * pack-resolve is exactly the mistake a prior review caught (progress.md,
 * Task-12 entry: "packSuffix is council-local; if fanout/solo need attribution,
 * centralize 'pack-filled' in pack-resolve rather than re-deriving").
 *
 * Fix wave 2 (Task 15 review, Finding 2): a pack knob `applyPackToArgs` fills
 * but `paramMap` has no MCP destination for (e.g. fanout's `contextTurns`/
 * `contextMaxTokens`) would otherwise be a silent dead-fill — written into the
 * local `args` bridge, then dropped on the floor because the write-back loop
 * below only ever visits `paramMap` entries. Made loud instead: every `args`
 * key with no `paramMap` destination becomes one notice, naming the pack, the
 * knob (by the pack's own camelCase option key — v4.5 HOLD-gate decision 1b,
 * T15-m10), and the MCP tool.
 *
 * v4.5 decision 1: two otherwise-orphaned knobs — maxCost/template — are NOT
 * turned into a notice on `amicus_fanout`/`amicus_start` (no schema param for
 * either); CLI parity requires them to still apply, so their pack-filled
 * values come back on `forward` instead, for the caller (mcp-server.js) to
 * apply itself: forwarded to a spawned child's argv as plain flags, or (the
 * in-process shared-server path) via the same budget-gate/template-render
 * code the CLI uses. `amicus_council_run` already has real destinations for
 * both, so `forward` is always `{}` there.
 * @param {{packRef: string, expectedKind: 'council'|'fanout'|'solo',
 *   input: object, paramMap: Object<string, string|{argKey: string, invert: true}>}} opts
 *   `paramMap` maps each MCP input key a tool exposes to the CLI arg-key name
 *   the same knob uses in the tables above (e.g. council's `timeoutMinutes` →
 *   `'timeout'`, plain string = same-polarity rename/identity). An
 *   `{argKey, invert: true}` entry flips a boolean both ways (fanout/solo's
 *   `includeContext` vs. the CLI/pack-side `no-context` polarity). An MCP key
 *   with no pack-fillable knob (e.g. `briefingFile`, `project`) is simply
 *   omitted from `paramMap` and left untouched by this function.
 * @returns {{packRecord: {name, version, hash, source}, notices: string[],
 *   forward: {maxCost?: number, template?: string}} | {error: {code, message, hint}}}
 */
function applyPackToMcpInput({ packRef, expectedKind, input, paramMap }) {
  const args = {};
  const explicit = new Set();
  for (const mcpKey of Object.keys(input)) {
    const entry = paramMap[mcpKey];
    if (!entry) { continue; }
    const argKey = typeof entry === 'string' ? entry : entry.argKey;
    const invert = typeof entry === 'object' && !!entry.invert;
    args[argKey] = invert ? !input[mcpKey] : toArgValue(argKey, input[mcpKey]);
    explicit.add(argKey);
  }

  const pr = applyPackToArgs({ packRef, expectedKind, args, explicit });
  if (pr.error) { return { error: pr.error }; }

  // Finding 2: diff every key applyPackToArgs touched (explicit bridge seeds +
  // pack fills) against paramMap's own destination argKeys. The bridging loop
  // above only ever seeds `args` from a paramMap destination, so anything left
  // over here was added by a pack fill, never a caller value — always a
  // genuine dead-fill, never a false positive on an explicit param.
  const destArgKeys = new Set(
    Object.values(paramMap).map((entry) => (typeof entry === 'string' ? entry : entry.argKey))
  );
  const notices = [...pr.notices];
  const toolName = MCP_TOOL_NAME_BY_KIND[expectedKind] || `amicus (${expectedKind})`;
  // v4.5 HOLD-gate decision 1: maxCost/template have no MCP schema destination
  // on fanout/start, but must still apply (CLI parity) — collected here for the
  // caller to apply itself, instead of turned into an ignore-notice. Council
  // already has real destinations for both (destArgKeys.has(argKey) is true
  // there), so this loop never adds to `forward` for council calls.
  const forward = {};
  for (const argKey of Object.keys(args)) {
    if (destArgKeys.has(argKey)) { continue; }
    if (FORWARDABLE_ARG_KEYS.has(argKey)) {
      forward[ARG_KEY_TO_OPT_KEY[argKey] || argKey] = args[argKey];
      continue;
    }
    const optKey = ARG_KEY_TO_OPT_KEY[argKey] || argKey;
    notices.push(`Notice: pack '${pr.packRecord.name}' sets ${optKey}, which ${toolName} does not support over MCP — ignored.`);
  }

  for (const [mcpKey, entry] of Object.entries(paramMap)) {
    const argKey = typeof entry === 'string' ? entry : entry.argKey;
    if (explicit.has(argKey) || !(argKey in args)) { continue; }
    const invert = typeof entry === 'object' && !!entry.invert;
    input[mcpKey] = invert ? !args[argKey] : fromArgValue(argKey, args[argKey]);
  }

  return { packRecord: pr.packRecord, notices, forward };
}

module.exports = { applyPackToArgs, applyPackToMcpInput };
