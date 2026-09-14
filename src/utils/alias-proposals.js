/**
 * @module utils/alias-proposals
 * The alias review ENGINE (#238 §2): pure, no I/O, no prompts. Turns
 * (config.aliases, DEFAULT_ALIASES, catalogInfo, dismissed, retired, notable)
 * into ONE proposal per alias (Q4), for the CLI picker and the Electron
 * "Needs review" section to render and for their sinks to write.
 *
 * Only PINNED aliases propose (D1): a following alias resolves to the shipped
 * pin and cannot drift. The §5 DISPLAY gate is applied here: candidates never
 * come from a non-authoritative row or a rejected namespace, and a sibling
 * (model-id-siblings.js) is always strictly newer. A stale pin's
 * `replacement` candidates are ranked by similarity (not recency) and sit
 * after `follow` for a curated alias. The WRITE gate (a fresh catalog) is the
 * renderer's, at accept time.
 *
 * Own keys only: a `__proto__`/`toString` alias is a custom row here as it is
 * everywhere else in the alias tables.
 */

'use strict';

const { listAliasRows } = require('./alias-state');
const { newestSibling } = require('./model-id-siblings');
const { findStaleAliases, suggestReplacements } = require('./alias-audit');
const { stripGatewayPrefix } = require('./curated-models');

const own = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
const providerOf = (id) => (typeof id === 'string' ? id.split('/')[0] : '');
const sameModel = (a, b) => typeof a === 'string' && typeof b === 'string' && stripGatewayPrefix(a) === stripGatewayPrefix(b);

/** §5 rules 1–2: rows a proposal may name. */
function candidateRows(models, failures) {
  return models.filter(m => m && typeof m.id === 'string' && m.authoritative !== false && !failures.has(providerOf(m.id)));
}

function proposeForRow(r, ctx) {
  if (r.state !== 'pinned' || own(ctx.retired, r.alias)) { return null; }
  if (ctx.failures.has(providerOf(r.id))) { return null; }             // its namespace cannot be judged
  const stale = findStaleAliases([{ alias: r.alias, model: r.id, source: 'user-config' }], ctx.models).length === 1;
  const sibling = newestSibling(r.id, ctx.candidateIds);
  const differs = r.curated && !sameModel(r.shipped, r.id);
  const reasons = [];
  if (stale) { reasons.push('stale'); }
  if (sibling) { reasons.push('newer-sibling'); }
  if (differs) { reasons.push('differs-from-shipped'); }
  if (reasons.length === 0) { return null; }
  // Order (fix round 1, Finding 3): sibling first, UNLESS it is the shipped
  // model itself — `follow` already names that id, so listing it twice as
  // both "newer-sibling" and "follow" would be a display duplicate. `follow`
  // outranks similarity-ranked replacements: a human-curated shipped pin is
  // a better answer than a same-vendor guess, and a sibling was already
  // found (even if hidden here as identical to `follow`) means the
  // structurally-aware comparator has already answered "what's newer" —
  // replacements are only offered when that comparator found nothing at all.
  const candidates = [];
  if (sibling && !sameModel(sibling, r.shipped)) { candidates.push({ id: sibling, why: 'newer-sibling', evidence: {} }); }
  if (differs) { candidates.push({ id: r.shipped, why: 'follow', evidence: {} }); }
  if (stale && !sibling) {
    for (const id of suggestReplacements(r.id, ctx.candidates)) { candidates.push({ id, why: 'replacement', evidence: {} }); }
  }
  const dismissKey = `${r.alias}@${candidates.length ? candidates[0].id : r.id}`;
  if (own(ctx.dismissed, dismissKey)) { return null; }
  return { alias: r.alias, state: 'pinned', current: r.id, shipped: r.shipped, curated: r.curated, reasons, candidates, dismissKey };
}

function proposeNotable(entry, ctx) {
  if (!entry || typeof entry.id !== 'string' || typeof entry.suggestedAlias !== 'string') { return null; }
  if (own(ctx.retired, entry.suggestedAlias) || !ctx.candidateIds.includes(entry.id)) { return null; }
  // Fix round 1, Finding 1: a notable must not shadow an alias NAME that
  // already exists (curated or user, pinned or following) — rule 10 checked
  // only the model, not the name, so a notable naming an already-pinned or
  // already-taken alias produced a second, conflicting proposal for the same
  // name (an 'unmapped' one beside the real 'pinned'/'following' one, in the
  // worst case sharing a dismissKey with it).
  if (ctx.names.has(entry.suggestedAlias)) { return null; }
  if (ctx.mapped.some(id => sameModel(id, entry.id))) { return null; }
  const dismissKey = `${entry.suggestedAlias}@${entry.id}`;
  if (own(ctx.dismissed, dismissKey)) { return null; }
  return { alias: entry.suggestedAlias, state: 'unmapped', current: null, shipped: null, curated: false,
    reasons: ['notable-unmapped'], candidates: [{ id: entry.id, why: 'notable', evidence: { note: entry.note || '' } }], dismissKey };
}

/**
 * @param {{userAliases: object|null, defaults: object, catalogInfo: {models?: Array, providerFailures?: Array}|null,
 *   retired?: object, notable?: Array<{id:string, suggestedAlias:string, note?:string}>, dismissed?: object}} input
 * @returns {Array<object>} proposals — see the module docblock for the shape
 */
function buildAliasProposals({ userAliases, defaults, catalogInfo, retired = {}, notable = [], dismissed = {} }) {
  const models = (catalogInfo && Array.isArray(catalogInfo.models)) ? catalogInfo.models : [];
  if (models.length === 0 || !defaults) { return []; }
  // Fix round 1, Finding 2 (rule 11 "never throws on odd input"): a truthy
  // non-array providerFailures (e.g. `{}`) must not reach `.map`.
  const rawFailures = catalogInfo.providerFailures;
  const failures = new Set((Array.isArray(rawFailures) ? rawFailures : []).map(f => f && f.provider).filter(Boolean));
  const candidates = candidateRows(models, failures);
  const rows = listAliasRows(userAliases, defaults);
  const ctx = {
    models, failures, candidates, candidateIds: candidates.map(m => m.id),
    retired: retired || {}, dismissed: dismissed || {},
    mapped: rows.map(r => r.id), names: new Set(rows.map(r => r.alias)),
  };
  const out = [];
  for (const r of rows) { const p = proposeForRow(r, ctx); if (p) { out.push(p); } }
  for (const n of (Array.isArray(notable) ? notable : [])) { const p = proposeNotable(n, ctx); if (p) { out.push(p); } }
  return out;
}

module.exports = { buildAliasProposals };
