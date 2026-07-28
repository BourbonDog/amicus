// src/template/render.js
'use strict';

/**
 * @module template/render
 * F9 (v4.5): strict {{variable}} rendering for briefing templates. Expansion
 * happens ONLY in template files (spec carried decision 7) — --prompt text is
 * always literal, so this module never sees non-template input.
 *
 * v4.5 variable set. {{input}} is deliberately ABSENT — it ships with v4.6's
 * --input-from; on v4.5 it fails as an unknown variable, which is accurate.
 * No {{model}}: prompts are built once per wave, model-independent.
 */

const VAR_RE = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g;
const KNOWN_VARIABLES = ['prompt', 'artifact', 'artifact_path', 'date', 'project', 'var.<key>'];

function knownList() {
  return KNOWN_VARIABLES.map((v) => `{{${v}}}`).join(', ');
}

/**
 * Render a template with strict typo-safety rules:
 * unknown variable -> error; slot present without its data -> error; data
 * passed without its slot -> error ("silently dropped"); unused --var -> notice.
 *
 * @param {string} text - raw template text
 * @param {{prompt?: string, artifact?: string, artifactPath?: string,
 *          date: string, project: string, vars?: Object<string,string>}} data
 * @returns {{text: string, notices: string[]} | {error: string}}
 */
function renderTemplate(text, data) {
  const vars = data.vars || {};
  const used = new Set();
  for (const m of String(text).matchAll(VAR_RE)) { used.add(m[1]); }

  for (const name of used) {
    if (name.startsWith('var.')) {
      const key = name.slice(4);
      if (!(key in vars)) {
        return { error: `Error: template uses {{var.${key}}} but no --var ${key}=<value> was given` };
      }
      continue;
    }
    if (!['prompt', 'artifact', 'artifact_path', 'date', 'project'].includes(name)) {
      return { error: `Error: Unknown template variable {{${name}}}. Known: ${knownList()}` };
    }
  }

  if (used.has('prompt') && data.prompt === undefined) {
    return { error: 'Error: template has {{prompt}} but no --prompt/--prompt-file was given' };
  }
  if (!used.has('prompt') && data.prompt !== undefined) {
    return { error: 'Error: --prompt/--prompt-file was given but the template has no {{prompt}} slot — the text would be silently dropped' };
  }
  const usesArtifact = used.has('artifact') || used.has('artifact_path');
  if (used.has('artifact') && data.artifact === undefined) {
    return { error: 'Error: template has {{artifact}} but no --artifact <file> was given' };
  }
  if (used.has('artifact_path') && data.artifactPath === undefined) {
    return { error: 'Error: template has {{artifact_path}} but no --artifact <file> was given' };
  }
  if (!usesArtifact && (data.artifact !== undefined || data.artifactPath !== undefined)) {
    return { error: 'Error: --artifact was given but the template has no {{artifact}}/{{artifact_path}} slot — the file would be silently dropped' };
  }

  const notices = [];
  for (const key of Object.keys(vars)) {
    if (!used.has(`var.${key}`)) {
      notices.push(`Notice: --var ${key}=… is not used by this template`);
    }
  }

  const rendered = String(text).replace(VAR_RE, (_, name) => {
    if (name === 'prompt') { return data.prompt; }
    if (name === 'artifact') { return data.artifact; }
    if (name === 'artifact_path') { return data.artifactPath; }
    if (name === 'date') { return data.date; }
    if (name === 'project') { return data.project; }
    return vars[name.slice(4)];
  });

  return { text: rendered, notices };
}

module.exports = { renderTemplate, KNOWN_VARIABLES };
