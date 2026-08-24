#!/usr/bin/env node

/**
 * Extract the workflow-level and job-level `env:` blocks of a GitHub Actions
 * workflow, for the council briefing (council-review.yml).
 *
 * WHY THIS EXISTS: a `run:` block's env vars are DEFINED in an `env:` block the
 * PR usually does not change, so they never appear in a diff. PR #193 was
 * reviewed twice and both benches unanimously raised a blocker that $GH_REPO /
 * $MODELS / $CHAIR were undefined. They were defined; the definitions simply
 * never reached the bench.
 *
 * WHY IT HAND-ROLLS RATHER THAN USING A YAML LIBRARY (the #194 bench asked, and
 * the answer is a real constraint, not preference): council-review.yml runs with
 * NO checkout, and amicus — the only package the runner installs — depends on no
 * YAML parser. There is nothing to require. The workflow therefore fetches THIS
 * FILE from the base ref at run time, which is what lets one tested source serve
 * both the repo and the runner.
 *
 * WHY IT NEVER OMITS SILENTLY: the #194 bench's sharpest point was that a feature
 * built to stop the bench missing env definitions had the same silent-omission
 * failure mode in its own parser. So every construct this parser does not
 * understand is REPORTED in the output, loudly, instead of being dropped. A
 * reader always learns that something exists and was not shown.
 *
 * Usage:  node scripts/extract-workflow-env.js <label> <file>
 */

'use strict';

const { readFileSync } = require('node:fs');

/** Key names whose LITERAL value is withheld. An expression is a reference, not data. */
const SENSITIVE_KEY = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_AUTH|AUTH_|APIKEY|API_KEY|_KEY|KEY_)/i;

/** @returns {number} count of leading spaces */
function indentOf(line) {
  return line.length - line.replace(/^ */, '').length;
}

/**
 * Values reach an external model provider, so a literal under a sensitive key is
 * withheld. A pure `${{ ... }}` value is kept: the file holds the REFERENCE, and
 * the secret it names is never in the file to begin with.
 *
 * The repo-wide `check:secrets` gate already scans every tracked workflow (all 8
 * today) and catches a literal key inside an `env:` block, so this is a second
 * layer, not the only one.
 * @param {string} key @param {string} value @returns {string}
 */
function redactValue(key, value) {
  if (!SENSITIVE_KEY.test(key)) { return value; }
  const withoutExpressions = value.replace(/\$\{\{[^}]*\}\}/g, '').trim();
  if (withoutExpressions === '') { return value; }
  return '<literal withheld: key matches ' + SENSITIVE_KEY.source.slice(0, 24) + '…>';
}

/**
 * Parse one `KEY: value` mapping entry, tolerating quoted keys and trailing
 * comments. Returns null when the line is not a simple mapping entry.
 * @param {string} line @returns {{key:string, value:string}|null}
 */
function parseEntry(line) {
  const m = /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][A-Za-z0-9_.-]*))\s*:(.*)$/.exec(line);
  if (!m) { return null; }
  const key = m[1] || m[2] || m[3];
  let value = m[4];
  // A trailing comment must be preceded by whitespace, or `a#b` would be cut.
  // Never strip inside quotes or inside a ${{ }} expression.
  let inSingle = false, inDouble = false, depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "'" && !inDouble) { inSingle = !inSingle; }
    else if (c === '"' && !inSingle) { inDouble = !inDouble; }
    else if (!inSingle && !inDouble && c === '{' && value[i - 1] === '$' && value[i + 1] === '{') { depth++; }
    else if (!inSingle && !inDouble && c === '}' && value[i + 1] === '}') { if (depth > 0) { depth--; } }
    else if (!inSingle && !inDouble && depth === 0 && c === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
      value = value.slice(0, i);
      break;
    }
  }
  return { key, value: value.trim() };
}

/**
 * @param {string} label path shown in the heading
 * @param {string} text  the workflow file's contents
 * @returns {{blocks:Array, warnings:string[]}}
 */
function extractEnvBlocks(label, text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  const warnings = [];
  let inJobs = false;
  let job = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bare = line.trim();
    if (!bare || bare.startsWith('#')) { continue; }
    const ind = indentOf(line);

    if (ind === 0) {
      inJobs = bare === 'jobs:';
      job = null;
    } else if (inJobs && ind === 2 && /^(?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+):$/.test(bare)) {
      job = bare.slice(0, -1).replace(/^["']|["']$/g, '');
    }

    const entry = parseEntry(line);
    if (!entry || entry.key !== 'env') { continue; }
    // Workflow-level (0) and job-level (4) only. A step-level env: sits deeper
    // and travels with its own step, so it is already inside the diff hunk.
    if (ind > 4) { continue; }
    const where = job ? ('job ' + job) : 'workflow level';
    const at = label + ' (' + where + ', env: at line ' + (i + 1) + ')';

    // Flow style: `env: { A: 1, B: 2 }` — legal YAML that an indentation scan
    // would silently read as an empty block. Reported, not dropped.
    if (entry.value !== '') {
      if (/^\{.*\}$/.test(entry.value)) {
        const inner = entry.value.slice(1, -1);
        const pairs = inner.split(',').map((s) => s.trim()).filter(Boolean);
        const rows = [];
        let ok = true;
        for (const pair of pairs) {
          const kv = parseEntry(pair);
          if (!kv) { ok = false; break; }
          rows.push('      ' + kv.key + ': ' + redactValue(kv.key, kv.value));
        }
        if (ok && rows.length) { blocks.push({ at, body: rows }); continue; }
      }
      warnings.push(at + ' — value is not a block mapping this parser handles ('
        + entry.value.slice(0, 40) + '); NOT shown below');
      continue;
    }

    const body = [];
    let unparsed = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      const nextBare = next.trim();
      if (!nextBare) { continue; }
      // A comment dedented below the block does NOT end it — YAML ignores comment
      // indentation. An indentation-only scan ended the block here and dropped
      // every entry after it.
      if (nextBare.startsWith('#')) { continue; }
      if (indentOf(next) <= ind) { break; }
      const kv = parseEntry(next);
      if (!kv) { unparsed++; continue; }
      body.push('      ' + kv.key + ': ' + redactValue(kv.key, kv.value));
    }
    if (unparsed) {
      warnings.push(at + ' — ' + unparsed + ' line(s) in this block were not simple'
        + ' KEY: value entries and are NOT shown (multi-line scalars, anchors or tags)');
    }
    if (body.length) { blocks.push({ at, body }); }
  }
  return { blocks, warnings };
}

/** @returns {string} the briefing section body for one workflow file */
function render(label, text) {
  const { blocks, warnings } = extractEnvBlocks(label, text);
  const out = [];
  for (const b of blocks) {
    out.push(b.at, '', ...b.body, '');
  }
  for (const w of warnings) {
    out.push('!! ' + w, '');
  }
  return out.join('\n');
}

if (require.main === module) {
  const [, , label, file] = process.argv;
  if (!label || !file) {
    console.error('usage: extract-workflow-env.js <label> <file>');
    process.exit(2);
  }
  process.stdout.write(render(label, readFileSync(file, 'utf-8')));
}

module.exports = { extractEnvBlocks, render, parseEntry, redactValue, indentOf };
