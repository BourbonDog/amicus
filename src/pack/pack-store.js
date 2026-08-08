// src/pack/pack-store.js
'use strict';

/**
 * @module pack/pack-store
 * B7/F5 (v4.5): packs are ONE JSON file per pack in <configDir>/packs/ (spec
 * carried decision 2 — shareability wins: send or commit the file). The
 * CONTENT HASH is the truth anchor: sha256 over the canonical form (recursively
 * sorted keys), first 12 hex chars, recorded on every run — a hand-edited pack
 * whose version wasn't bumped still gets a distinct recorded hash.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('../utils/atomic-write');

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function _getConfigDir() { return require('../utils/config').getConfigDir(); }

/** @returns {string} the packs directory (peer of templates/) */
function packsDir() { return path.join(_getConfigDir(), 'packs'); }

function sortKeysDeep(v) {
  if (Array.isArray(v)) { return v.map(sortKeysDeep); }
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) { out[k] = sortKeysDeep(v[k]); }
    return out;
  }
  return v;
}

/** sha256 of the canonical (sorted-keys) JSON form, first 12 hex chars. */
function canonicalHash(pack) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(sortKeysDeep(pack)), 'utf-8').digest('hex').slice(0, 12);
}

/** @returns {{kind:'path',path}|{kind:'name',name}|{error}} */
function resolvePackRef(ref) {
  const v = String(ref);
  if (v.endsWith('.json') || v.includes('/') || v.includes(path.sep)) {
    return { kind: 'path', path: path.resolve(v) };
  }
  if (!NAME_RE.test(v)) {
    return { error: `Error: invalid pack name '${v}' — pack names are 1-64 chars of [a-z0-9._-] starting alphanumeric` };
  }
  return { kind: 'name', name: v };
}

function stripBom(text) { return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; }

/**
 * @returns {{pack, path, source:'dir'|'path', hash}|{error}}
 * All SIX `{error}` returns below — malformed name, name-form unreadable,
 * path-form unreadable, invalid JSON, non-object body, name/filename mismatch —
 * are mapped to PACK_NOT_FOUND by both callers (pack-resolve.js:76,
 * cli-handlers-pack.js:225). A new `{error}` added here inherits that code
 * silently: re-code it deliberately or it lands as "not found".
 * PACK_NOT_FOUND has a THIRD emit site that never calls readPack — `pack rm`
 * (cli-handlers-pack.js:242, via rmPack) — unified there by the v4.5 HOLD-gate
 * decision 3 and pinned by the "rm nonexistent pack -> PACK_NOT_FOUND" describe
 * in tests/pack/cli-pack-cmd.test.js.
 * PACK_INVALID is NOT readPack's: it belongs to validatePack
 * (pack-resolve.js:94, cli-handlers-pack.js:199) and to prepareForward's
 * maxCost guard (pack-forward.js:68-76), which is not a validatePack call.
 */
function readPack(ref) {
  const r = resolvePackRef(ref);
  if (r.error) { return r; }
  const file = r.kind === 'path' ? r.path : path.join(packsDir(), `${r.name}.json`);
  let raw;
  try { raw = stripBom(fs.readFileSync(file, 'utf-8')); }
  catch (err) {
    if (r.kind === 'name') { return { error: `Error: Pack '${r.name}' not found in ${packsDir()}` }; }
    return { error: `Error: cannot read pack ${ref}: ${err.message}` };
  }
  let pack;
  try { pack = JSON.parse(raw); }
  catch (err) { return { error: `Error: pack ${file} is not valid JSON: ${err.message}` }; }
  if (pack === null || typeof pack !== 'object' || Array.isArray(pack)) {
    return { error: `Error: pack ${file} is not a pack object (found ${pack === null ? 'null' : Array.isArray(pack) ? 'an array' : typeof pack})` };
  }
  if (r.kind === 'name' && pack.name !== r.name) {
    return { error: `Error: pack file ${file} declares name '${pack.name}' which does not match its filename — rename one of them` };
  }
  return { pack, path: file, source: r.kind === 'name' ? 'dir' : 'path', hash: canonicalHash(pack) };
}

function bumpPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(String(version));
  if (!m) { return '0.0.1'; }
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/**
 * Write <packsDir>/<pack.name>.json. Existing name: unchanged canonical hash →
 * {noop:true}; changed with the same version string → auto-bump patch (spec
 * carried decision 6). Caller validates the pack first (pack-validate).
 * @returns {{path, hash, overwritten, bumped}|{noop:true, path}}
 */
function writePack(pack) {
  fs.mkdirSync(packsDir(), { recursive: true, mode: 0o700 });
  const file = path.join(packsDir(), `${pack.name}.json`);
  let existing = null;
  try { existing = JSON.parse(stripBom(fs.readFileSync(file, 'utf-8'))); } catch { /* new pack */ }
  const toWrite = { ...pack };
  let bumped = false;
  if (existing) {
    if (canonicalHash(existing) === canonicalHash(toWrite)) { return { noop: true, path: file }; }
    if (existing.version === toWrite.version) {
      toWrite.version = bumpPatch(toWrite.version);
      bumped = true;
    }
  }
  writeFileAtomic(file, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
  return { path: file, hash: canonicalHash(toWrite), overwritten: !!existing, bumped, version: toWrite.version };
}

/** @returns {{packs: Array<{name,kind,version,description}>, warnings: string[]}} name-sorted */
function listPacks() {
  let entries = [];
  try { entries = fs.readdirSync(packsDir()); } catch { /* no dir yet */ }
  const packs = [];
  const warnings = [];
  for (const f of entries) {
    if (!f.endsWith('.json')) { continue; }
    try {
      const p = JSON.parse(stripBom(fs.readFileSync(path.join(packsDir(), f), 'utf-8')));
      packs.push({ name: p.name, kind: p.kind, version: p.version, description: p.description || '' });
    } catch (err) { warnings.push(`${f}: ${err.message}`); }
  }
  packs.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { packs, warnings };
}

/** @returns {{removed: boolean}} */
function rmPack(name) {
  const r = resolvePackRef(name);
  if (r.error || r.kind !== 'name') { return { removed: false }; }
  try { fs.unlinkSync(path.join(packsDir(), `${r.name}.json`)); return { removed: true }; }
  catch { return { removed: false }; }
}

module.exports = { packsDir, canonicalHash, resolvePackRef, readPack, writePack, listPacks, rmPack };
