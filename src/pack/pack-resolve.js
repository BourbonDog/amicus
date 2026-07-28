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

/** `options.*` knobs shared by every kind that defines them (council/fanout/solo). */
const COMMON_OPTION_KNOBS = [
  ['timeout', 'timeout'], ['maxCost', 'max-cost'], ['gateway', 'gateway'],
  ['agent', 'agent'], ['thinking', 'thinking'], ['summaryLength', 'summary-length'],
];
/** `options.*` knobs shared by fanout + solo only (v4.5 F4 context controls). */
const CONTEXT_OPTION_KNOBS = [
  ['noContext', 'no-context'], ['contextTurns', 'context-turns'], ['contextMaxTokens', 'context-max-tokens'],
];
/** Concrete command name per pack kind, for the KIND_MISMATCH message (never "this command"). */
const COMMAND_NAME_BY_KIND = { council: 'council run', fanout: 'fanout', solo: 'start' };

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

module.exports = { applyPackToArgs };
