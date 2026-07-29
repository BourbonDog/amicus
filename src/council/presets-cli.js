// src/council/presets-cli.js
'use strict';

/**
 * `amicus council save|list|show` — CLI wrappers around the council-preset
 * primitives (src/utils/config.js councils.*, src/utils/council-presets.js
 * built-in benches). Split out of cli-handlers-council.js to keep that file
 * under the 300-line size gate.
 */

const { failJson, ERROR_CODES } = require('../utils/error-doc');
const { listBuiltinCouncilNames } = require('../utils/council-presets');

/**
 * `amicus council save <name> --models a,b,c`
 * Validates >=2 members, each resolvable via the same alias/catalog logic
 * `resolveCouncilMembers` uses (effective aliases, or a raw `provider/model`
 * id containing '/'). Overwrites an existing name with a notice — this is
 * also how a user shadows a built-in bench of the same name.
 * @param {string|undefined} name
 * @param {string|undefined} modelsArg comma-separated aliases/ids
 * @param {boolean} useJson
 * @returns {number} exit code
 */
function runSave(name, modelsArg, useJson) {
  if (!name) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'council save needs a <name>',
      hint: 'amicus council save <name> --models a,b,c' });
  }
  if (typeof modelsArg !== 'string' || !modelsArg.trim()) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'council save needs --models a,b,c',
      hint: 'amicus council save <name> --models a,b,c' });
  }
  const members = modelsArg.split(',').map(m => m.trim()).filter(Boolean);
  if (members.length < 2) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'a council needs at least 2 members',
      hint: 'pass --models with 2 or more comma-separated aliases or provider/model IDs' });
  }
  const { getEffectiveAliases, loadConfig, saveConfig, getCouncil } = require('../utils/config');
  const aliases = getEffectiveAliases();
  const unresolved = members.filter(m => !m.includes('/') && !aliases[m]);
  if (unresolved.length) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `unresolvable member(s): ${unresolved.join(', ')}`,
      hint: 'each member must be a known alias (see `amicus models`) or a provider/model id containing "/"' });
  }
  const overwritten = !!getCouncil(name);
  const cfg = loadConfig() || {};
  if (!cfg.councils) { cfg.councils = {}; }
  cfg.councils[name] = members;
  saveConfig(cfg);
  const doc = { ok: true, name, models: members, overwritten };
  process.stdout.write(useJson ? JSON.stringify(doc, null, 2) + '\n' : renderSave(doc));
  return 0;
}

function renderSave(doc) {
  const notice = doc.overwritten ? ' (overwritten)' : '';
  return `Saved council '${doc.name}'${notice}: ${doc.models.join(', ')}\n` +
    "  for full run configuration — chair, options, templates — see 'amicus pack'\n";
}

/**
 * `amicus council list [--json]` — user-saved councils plus the built-in
 * benches (free/budget/frontier), each entry marked `builtin`. When a user
 * council shares a name with a built-in, BOTH entries are listed: the user
 * entry (builtin:false) is the one actually used by resolveCouncilMembers,
 * and the built-in entry (builtin:true) is marked `shadowed:true`.
 * @param {boolean} useJson
 * @returns {number} exit code
 */
function runList(useJson) {
  const { getCouncils } = require('../utils/config');
  const userCouncils = getCouncils();
  const userNames = new Set(Object.keys(userCouncils));
  const entries = [];
  for (const name of Object.keys(userCouncils).sort()) {
    entries.push({ name, builtin: false, members: userCouncils[name] });
  }
  for (const name of listBuiltinCouncilNames()) {
    const entry = { name, builtin: true };
    if (userNames.has(name)) { entry.shadowed = true; }
    entries.push(entry);
  }
  const doc = { councils: entries };
  process.stdout.write(useJson ? JSON.stringify(doc, null, 2) + '\n' : renderList(entries));
  return 0;
}

function renderList(entries) {
  const lines = entries.map(e => {
    if (e.builtin) { return `  ${e.name.padEnd(16)} [built-in]${e.shadowed ? ' (shadowed by a saved council of the same name)' : ''}`; }
    return `  ${e.name.padEnd(16)} ${e.members.join(', ')}`;
  });
  return 'Councils:\n' + lines.join('\n') + '\n';
}

/**
 * `amicus council show <name> [--json]` — resolves `name` exactly like
 * `resolveCouncilMembers` (user config first, built-in fallback) and
 * displays the raw members plus per-member resolution results (resolved /
 * dropped). Unlike `resolveCouncilMembers` (which the run paths use, and
 * which fails outright below 2 usable members), `show` is diagnostic-only:
 * it always reports the full resolved/dropped split, even for a council
 * that currently has fewer than 2 usable members.
 *
 * v4.5 Wave 2 (post-HOLD chip, task-23-report.md Anomaly 1): the resolved/
 * dropped split now REUSES `classifyCouncilMembers` — the exact alias +
 * catalog-membership + local-provider-tri-state check `resolveCouncilMembers`
 * applies on every real run — instead of a parallel check that only asked
 * "does the alias map to SOME id?" and never consulted the catalog at all
 * (so a member whose alias resolved to a catalog-absent id read as healthy
 * here while every real run silently dropped it). `droppedMembers` carries
 * each dropped member's reason, distinguishing an unresolvable alias from a
 * catalog-absent id — the same distinction `resolveCouncilMembers` computes.
 * @param {string|undefined} name
 * @param {boolean} useJson
 * @returns {number} exit code
 */
function runShow(name, useJson) {
  if (!name) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'council show needs a <name>',
      hint: 'amicus council show <name> [--json]' });
  }
  const { getCouncilWithSource, classifyCouncilMembers } = require('../utils/config');
  const { readCache } = require('../utils/model-catalog');
  const catalog = (readCache() || {}).models || [];
  const { members, builtin } = getCouncilWithSource(name, catalog);
  if (!members) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Unknown council '${name}'`,
      hint: "'amicus council list' shows available councils, or 'amicus council save' to create one" });
  }
  const { models, dropped, droppedMembers } = classifyCouncilMembers(members, catalog);
  const doc = { name, builtin, members, resolved: models, dropped, droppedMembers };
  process.stdout.write(useJson ? JSON.stringify(doc, null, 2) + '\n' : renderShow(doc));
  return 0;
}

function renderShow(doc) {
  const tag = doc.builtin ? ' [built-in]' : '';
  let out = `Council '${doc.name}'${tag}\n  members: ${doc.members.join(', ')}\n  resolved: ${doc.resolved.join(', ')}\n`;
  if (doc.dropped.length) {
    // Per-member reason (v4.5 Wave 2) when available; falls back to the bare
    // ref list so this never throws on a hand-built doc missing the new field.
    const detail = (doc.droppedMembers && doc.droppedMembers.length)
      ? doc.droppedMembers.map(d => `${d.member} (${d.reason})`).join(', ')
      : doc.dropped.join(', ');
    out += `  dropped: ${detail}\n`;
  }
  return out;
}

module.exports = { runSave, runList, runShow };
