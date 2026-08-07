// src/pack/pack-validate.js
'use strict';

/**
 * @module pack/pack-validate
 * Spec §5.6. Runs at `pack save` (hard-fail), `pack show` (reports, never
 * fails), and run-time resolve (hard-fail through the envelope, pre-spend).
 * Kind matching itself (PACK_KIND_MISMATCH) is the caller's check — this
 * module validates a pack's internal consistency.
 */

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SEMVER_RE = /^\d+\.\d+\.\d+/;
const KINDS = ['council', 'fanout', 'solo'];

/** Per-kind allowed `options` keys (spec §5.1; solo UI-suppression key per Task 0's verified flag set).
 * v4.5 HOLD-gate decision 2 (final-review F1): `agent`/`thinking`/`summaryLength`
 * are inert on EVERY council surface — handleCouncilRun never reads a pack-filled
 * one, and the engine hardcodes agent 'Plan'/summaryLength 'verbose' regardless.
 * Dropped from `council` pre-release rather than shipped as dead weight a pack
 * author would reasonably expect to work; a council pack that still sets one now
 * fails save/run validation (PACK_INVALID) like any other unknown option for the
 * kind. They remain valid (and functional) on `fanout`/`solo`. */
const KIND_OPTIONS = Object.freeze({
  council: ['timeout', 'maxCost', 'gateway', 'debate'],
  fanout: ['timeout', 'maxCost', 'gateway', 'agent', 'thinking', 'summaryLength',
    'noContext', 'contextTurns', 'contextMaxTokens'],
  solo: ['timeout', 'maxCost', 'gateway', 'agent', 'thinking', 'summaryLength',
    'noUi', 'noContext', 'contextTurns', 'contextMaxTokens'],
});

/** Fields allowed per kind beyond the common set. */
const COMMON_FIELDS = ['schemaVersion', 'type', 'name', 'version', 'kind', 'description', 'options', 'briefing'];
const KIND_FIELDS = Object.freeze({
  council: [...COMMON_FIELDS, 'bench', 'chair', 'critic', 'lenses'],
  fanout: [...COMMON_FIELDS, 'bench'],
  solo: [...COMMON_FIELDS, 'model'],
});

/**
 * @param {object} pack
 * @param {{mode: 'save'|'run'}} opts
 * @returns {{ok:true, warnings:string[]} | {ok:false, errors:string[]}}
 */
function validatePack(pack, { mode } = { mode: 'run' }) {
  const errors = [];
  const warnings = [];
  if (!pack || typeof pack !== 'object') { return { ok: false, errors: ['pack is not an object'] }; }
  if (pack.schemaVersion !== 1) { errors.push(`schemaVersion must be 1 (got ${pack.schemaVersion})`); }
  if (pack.type !== 'pack') { errors.push(`type must be 'pack' (got '${pack.type}')`); }
  if (typeof pack.name !== 'string' || !NAME_RE.test(pack.name)) { errors.push(`invalid pack name '${pack.name}'`); }
  if (typeof pack.version !== 'string' || !SEMVER_RE.test(pack.version)) { errors.push(`version must be semver-shaped (got '${pack.version}')`); }
  if (!KINDS.includes(pack.kind)) {
    errors.push(`kind must be one of ${KINDS.join('|')} (got '${pack.kind}')`);
    return { ok: false, errors };
  }

  for (const key of Object.keys(pack)) {
    if (!KIND_FIELDS[pack.kind].includes(key)) { errors.push(`field '${key}' is not valid for kind '${pack.kind}'`); }
  }
  const opts = pack.options || {};
  if (typeof opts !== 'object' || Array.isArray(opts)) { errors.push('options must be an object'); }
  else {
    for (const key of Object.keys(opts)) {
      if (!KIND_OPTIONS[pack.kind].includes(key)) { errors.push(`unknown option '${key}' for kind '${pack.kind}'`); }
    }
  }

  const { getEffectiveAliases, getCouncilWithSource } = require('../utils/config');
  const aliases = getEffectiveAliases();
  const seatOk = (m) => typeof m === 'string' && (m.includes('/') || !!aliases[m]);

  if (pack.kind === 'solo') {
    if (typeof pack.model !== 'string' || !pack.model.trim()) { errors.push('solo pack requires model'); }
    else if (!seatOk(pack.model)) { errors.push(`unresolvable model '${pack.model}'`); }
  } else {
    // T11-d: bench-independent — a by-name bench used to skip this entirely, so a pack
    // could carry both and only fail (mis-attributed) at handler time.
    if (pack.kind === 'council' && pack.critic && pack.lenses) {
      errors.push('critic and lenses are mutually exclusive');
    }
    const bench = pack.bench;
    if (typeof bench === 'string') {
      const { members } = getCouncilWithSource(bench, []);
      if (!members) { errors.push(`bench names unknown council '${bench}'`); }
      else if (pack.kind === 'council' && (pack.lenses || pack.chair || pack.critic)) {
        warnings.push('bench is by-name: member-level checks (chair/critic/lenses vs seats) deferred to run time');
      }
    } else if (Array.isArray(bench) && bench.length >= 2) {
      const bad = bench.filter((m) => !seatOk(m));
      if (bad.length) { errors.push(`unresolvable bench member(s): ${bad.join(', ')}`); }
      if (pack.kind === 'council') {
        if (pack.chair && bench.includes(pack.chair)) { errors.push(`chair '${pack.chair}' is a bench seat — the chair must not review`); }
        if (pack.critic && !bench.includes(pack.critic)) { errors.push(`critic '${pack.critic}' must be one of the bench seats`); }
        if (Array.isArray(pack.lenses) && pack.lenses.length !== bench.length) {
          errors.push(`lenses needs exactly one lens per seat (${bench.length} seats, got ${pack.lenses.length})`);
        }
      }
    } else {
      errors.push('bench must be a council name or an array of 2+ members');
    }
  }

  const tplRef = pack.briefing && pack.briefing.template;
  if (tplRef !== undefined && tplRef !== null) {
    const { resolveTemplate } = require('../template/store');
    const t = resolveTemplate(tplRef);
    if (t.error) {
      if (mode === 'save') { warnings.push(`briefing.template '${tplRef}' does not resolve on this machine (packs travel; it may exist where the pack is used)`); }
      else { errors.push(`briefing.template '${tplRef}' does not resolve`); }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, warnings };
}

module.exports = { validatePack, KIND_OPTIONS, KINDS };
