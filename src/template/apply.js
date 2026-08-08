// src/template/apply.js
'use strict';

/**
 * @module template/apply
 * F9 (v4.5): the one seam that turns (--template, --prompt, --artifact, --var)
 * into a rendered briefing + template-sourced promptMeta. Used by the three CLI
 * run commands and by pack-resolve for a pack's briefing.template (which is how
 * templates reach MCP callers — MCP has no template params of its own).
 */

const fs = require('fs');
const path = require('path');
const { ERROR_CODES } = require('../utils/error-doc');
const { resolveTemplate } = require('./store');
const { renderTemplate } = require('./render');

const ARTIFACT_CAP_BYTES = 256 * 1024;

/**
 * @param {{templateRef: string, prompt?: string, artifactFile?: string,
 *          varList?: string[], project: string}} opts
 * @returns {{prompt, promptMeta, notices} | {error: {code, message, hint}}}
 */
function applyTemplate({ templateRef, prompt, artifactFile, varList, project }) {
  const tpl = resolveTemplate(templateRef);
  if (tpl.error) {
    return { error: { code: ERROR_CODES.TEMPLATE_NOT_FOUND, message: tpl.error, hint: 'amicus template list' } };
  }

  const vars = {};
  // F4 (Task-5 review): parseArgs' inline `--var=k=v` form takes the single-value
  // branch, not the array-accumulation one, so varList arrives as a bare string
  // instead of a one-element array — wrap it rather than let `for..of` iterate
  // its characters. parseArgs itself is unchanged (plan-mandated, shared with
  // --exclude-mcp); this coercion is the seam that absorbs both shapes.
  const varArr = Array.isArray(varList)
    ? varList
    : (varList !== undefined && varList !== null) ? [varList] : [];
  for (const entry of varArr) {
    const eq = String(entry).indexOf('=');
    if (eq < 1) {
      return { error: { code: ERROR_CODES.BAD_ARGS, message: `Error: --var expects key=value, got '${entry}'`, hint: null } };
    }
    vars[String(entry).slice(0, eq)] = String(entry).slice(eq + 1);
  }

  let artifact; let artifactPath;
  if (artifactFile !== undefined) {
    artifactPath = path.resolve(String(artifactFile));
    let raw;
    try {
      raw = fs.readFileSync(artifactPath);
    } catch (err) {
      return { error: { code: ERROR_CODES.TEMPLATE_RENDER, message: `Error: cannot read --artifact ${artifactFile}: ${err.message}`, hint: 'Check that the --artifact path exists and is readable — relative paths resolve from the current working directory.' } };
    }
    if (raw.length > ARTIFACT_CAP_BYTES) {
      return { error: { code: ERROR_CODES.TEMPLATE_RENDER, message: `Error: --artifact ${artifactFile} is ${raw.length} bytes; the cap is 256 KB`, hint: 'Trim --artifact to under 256 KB, or point it at a smaller excerpt.' } };
    }
    artifact = raw.toString('utf-8');
    if (artifact.charCodeAt(0) === 0xFEFF) { artifact = artifact.slice(1); }
  }

  const res = renderTemplate(tpl.text, {
    prompt,
    artifact,
    artifactPath,
    date: new Date().toISOString().slice(0, 10),
    project: path.resolve(String(project)),
    vars,
  });
  if (res.error) {
    // No variable list here on purpose: renderTemplate's own message already ends
    // with a knownList()-derived "Known: ..." line. A copy would be a third
    // hand-maintained KNOWN_VARIABLES mirror, which BACKLOG's T3-m2 hard gate forbids.
    return { error: { code: ERROR_CODES.TEMPLATE_RENDER, message: res.error, hint: 'amicus template show <name>' } };
  }

  return {
    prompt: res.text,
    promptMeta: {
      source: 'template',
      file: tpl.path,
      chars: res.text.length,
      template: { name: tpl.name, hash: tpl.hash },
    },
    notices: res.notices,
  };
}

module.exports = { applyTemplate, ARTIFACT_CAP_BYTES };
