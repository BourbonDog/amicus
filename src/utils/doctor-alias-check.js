// src/utils/doctor-alias-check.js
'use strict';

/**
 * @module utils/doctor-alias-check
 * The `aliases` doctor check ("Model aliases"), split out of
 * src/cli-handlers-doctor.js to keep that file under the 300-line gate
 * (mirrors doctor-engine-check.js / doctor-electron-mcp-check.js /
 * doctor-base-url-check.js / doctor-local-providers-check.js -- same reason,
 * a different check).
 *
 * B3 (council review of PR 198, issue 195): `doctor --fix` repairs exactly
 * one narrow class of stored alias -- see alias-audit.js's
 * `findFabricatedAliasRepairs` for the detection rule (classifies `invalid`
 * on the `direct` gateway AND has an unambiguous OpenRouter twin) and why it
 * cannot false-positive a typo, a retired model, or a user-invented id.
 * Repair = rewrite `config.aliases[alias]` to that catalog-confirmed
 * OpenRouter id -- read-modify-write, no-clobber (mirrors
 * `applyProviderDefault`, provider-default-picker.js). Every OTHER
 * stale/drifted alias is left untouched and stays a warning, hinting at
 * `amicus models --check` same as before this PR.
 */

const HINTS = require('./remediation-hints');

/**
 * Rewrite one alias's stored value in place. Read-modify-write / no-clobber
 * -- preserves `config.default` and every other alias/key (same contract as
 * `applyProviderDefault`, provider-default-picker.js).
 * @param {string} alias
 * @param {string} newId verbatim catalog id (an OpenRouter-namespace id from
 *   `pairAcrossGateways` -- never hand-derived by string concatenation)
 */
function repairAlias(alias, newId) {
  const { loadConfig, saveConfig } = require('./config');
  const config = loadConfig() || {};
  if (!config.aliases || typeof config.aliases !== 'object') { config.aliases = {}; }
  config.aliases[alias] = newId;
  saveConfig(config);
}

/** One pass: sources + both existing audits + the repairable set, over the same catalog. */
function computeState(d, catalog) {
  const sources = d.collectAliasSources();
  return {
    sources,
    stale: d.findStaleAliases(sources, catalog),
    drifted: d.findDriftedStoredAliases(sources, catalog),
    repairable: d.findFabricatedAliasRepairs(sources, catalog),
  };
}

/**
 * @param {{readCache: () => ({models?: Array}|null), collectAliasSources: () => Array,
 *   findStaleAliases: (s:Array, c:Array) => Array, findDriftedStoredAliases: (s:Array, c:Array) => Array,
 *   findFabricatedAliasRepairs: (s:Array, c:Array) => Array<{alias:string,oldId:string,newId:string}>,
 *   fix?: boolean, repairAlias?: (alias:string, newId:string) => void}} d
 * @returns {{id,name,status,message,hint,fixed?,fixDetail?}}
 */
function evaluateAliasesCheck(d) {
  const id = 'aliases';
  const name = 'Model aliases';
  const cache = d.readCache();
  const catalog = (cache && cache.models) || [];

  let state = computeState(d, catalog);
  let fixFields = {};

  // Only under --fix, and only when there is something in the narrow,
  // mechanically-unambiguous class to repair (rule 1). A failed individual
  // rewrite is best-effort -- it simply stays a warning, same as one
  // findStaleAliases could never resolve.
  if (d.fix && state.repairable.length > 0) {
    const repaired = [];
    for (const r of state.repairable) {
      try { d.repairAlias(r.alias, r.newId); repaired.push(r); }
      catch { /* best-effort -- an unrepaired alias just stays a warning below */ }
    }
    if (repaired.length > 0) {
      // Rule 6: announce every repair, naming the alias and both ids -- this
      // fixDetail flows into the 'heal' degrade's `why` field (doctor-degrade.js).
      const detail = repaired.map((r) => `'${r.alias}' (${r.oldId} -> ${r.newId})`).join('; ');
      fixFields = {
        fixed: true,
        fixDetail: `rewrote ${repaired.length} fabricated alias(es) to its catalog-confirmed OpenRouter id: ${detail}`,
      };
      // Rule 5 (idempotency): recompute from a fresh config read so both this
      // run's message and a second --fix run see the post-repair reality, not
      // the pre-repair snapshot -- a repaired alias must not still count as
      // stale/repairable below.
      state = computeState(d, catalog);
    }
  }

  const { stale, drifted, repairable } = state;
  if (stale.length === 0 && drifted.length === 0) {
    return {
      id, name, status: 'ok',
      message: catalog.length ? 'all resolve' : 'catalog empty — not checked', hint: null,
      ...fixFields,
    };
  }
  const parts = [];
  if (stale.length) { parts.push(`${stale.length} stale: ${stale.map((s) => s.alias).join(', ')}`); }
  if (drifted.length) { parts.push(`${drifted.length} drifted: ${drifted.map((s) => s.alias).join(', ')}`); }
  // Rule 1: without --fix, report the repairable count and the hint, change nothing.
  if (repairable.length) { parts.push(`${repairable.length} fixable via doctor --fix`); }
  return {
    id, name, status: 'warn', message: parts.join('; '),
    hint: repairable.length > 0 ? HINTS.repairFabricatedAlias : 'amicus models --check',
    ...fixFields,
  };
}

module.exports = { evaluateAliasesCheck, repairAlias };
