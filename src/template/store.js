// src/template/store.js
'use strict';

/**
 * @module template/store
 * F9 (v4.5): briefing templates are Markdown files in <configDir>/templates/
 * (peer of packs/). Name = basename sans .md. Built-ins are embedded strings,
 * shadowed by a same-named user file — exactly the built-in-bench precedent
 * (config.js getCouncilWithSource). No save/rm: your editor is the manager.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Lazy so jest.doMock / AMICUS_CONFIG_DIR re-pointing works per-test.
function _getConfigDir() { return require('../utils/config').getConfigDir(); }

/**
 * v4.5 ships `review` only. `critique`/`refine` are {{input}}-centric and
 * arrive with v4.6's chaining (--input-from).
 */
const BUILTIN_TEMPLATES = Object.freeze({
  review: [
    '# Review briefing',
    '',
    'You are reviewing the artifact below against the caller\'s focus.',
    '',
    '## Focus',
    '',
    '{{prompt}}',
    '',
    '## Artifact ({{artifact_path}})',
    '',
    '{{artifact}}',
    '',
    '## Instructions',
    '',
    '- Ground every finding in the artifact text and cite its location.',
    '- Give each finding a severity: critical / major / minor / nit.',
    '- If you find nothing at a severity, say so explicitly.',
    '- End with a one-paragraph overall verdict.',
    '',
  ].join('\n'),
});

/** @returns {string} the user templates directory (peer of packs/) */
function templatesDir() {
  return path.join(_getConfigDir(), 'templates');
}

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 12);
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/**
 * @param {string} nameOrPath - a path when it contains a path separator or
 *   ends in `.md`; otherwise a template name.
 * @returns {{name, path: string|null, text, hash, builtin: boolean} | {error: string}}
 */
function resolveTemplate(nameOrPath) {
  const v = String(nameOrPath);
  const isPath = v.endsWith('.md') || v.includes('/') || v.includes(path.sep);
  if (isPath) {
    const abs = path.resolve(v);
    let text;
    try {
      text = stripBom(fs.readFileSync(abs, 'utf-8'));
    } catch (err) {
      return { error: `Error: cannot read template ${v}: ${err.message}` };
    }
    return { name: path.basename(abs, '.md'), path: abs, text, hash: hashText(text), builtin: false };
  }
  const userFile = path.join(templatesDir(), `${v}.md`);
  try {
    const text = stripBom(fs.readFileSync(userFile, 'utf-8'));
    return { name: v, path: userFile, text, hash: hashText(text), builtin: false };
  } catch { /* fall through to built-ins */ }
  if (Object.prototype.hasOwnProperty.call(BUILTIN_TEMPLATES, v)) {
    const text = BUILTIN_TEMPLATES[v];
    return { name: v, path: null, text, hash: hashText(text), builtin: true };
  }
  return { error: `Error: Template '${v}' not found (looked in ${templatesDir()} and built-ins)` };
}

/** @returns {Array<{name, builtin: boolean, shadowed: boolean}>} name-sorted */
function listTemplates() {
  const out = new Map();
  for (const name of Object.keys(BUILTIN_TEMPLATES)) {
    out.set(name, { name, builtin: true, shadowed: false });
  }
  let entries = [];
  try { entries = fs.readdirSync(templatesDir()); } catch { /* no user dir yet */ }
  for (const f of entries) {
    if (!f.endsWith('.md')) { continue; }
    const name = path.basename(f, '.md');
    out.set(name, { name, builtin: false, shadowed: Object.prototype.hasOwnProperty.call(BUILTIN_TEMPLATES, name) });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { templatesDir, resolveTemplate, listTemplates, BUILTIN_TEMPLATES };
