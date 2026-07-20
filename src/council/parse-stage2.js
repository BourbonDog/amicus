// src/council/parse-stage2.js
'use strict';

/**
 * @module council/parse-stage2
 * Stage-2 output parsing for the headless council engine (spec §5): the
 * judge's trailing JSON block ({ranking, adjudications}) and the chair's
 * final `VERDICT:` line. Shares last-JSON-block extraction with findings.js.
 * Pure — the ≤2-repair loop lives in run-stages.js; the tri-state
 * (clean|repaired|unstructured) is recorded by the driver.
 */

const { lastJsonBlock } = require('./findings');

const JUDGE_VERDICTS = ['agree', 'dispute', 'neutral'];
const CHAIR_VERDICTS = ['Ship it', 'Fix these first', 'Fundamental rethink'];

/**
 * Parse + shape-validate one judge's output.
 * @param {string} text raw judge output (prose + trailing ```json block)
 * @param {{labels: string[], findingIds: string[]}} ctx known labels/ids
 * @returns {{ok: boolean, ranking: Array|null, adjudications: Array|null,
 *   errors: Array<{code: string, detail: string}>}}
 */
function parseJudgeOutput(text, { labels, findingIds }) {
  const fail = (errors) => ({ ok: false, ranking: null, adjudications: null, errors });
  const body = lastJsonBlock(text || '');
  if (body === null) {
    return fail([{ code: 'NO_FENCED_BLOCK', detail: 'no ```json block found' }]);
  }
  let parsed;
  try { parsed = JSON.parse(body); }
  catch (e) { return fail([{ code: 'NOT_PARSEABLE', detail: e.message }]); }

  const errors = [];
  const known = new Set(labels);
  const flat = [];
  if (!Array.isArray(parsed.ranking) || parsed.ranking.length === 0) {
    errors.push({ code: 'BAD_RANKING', detail: 'ranking must be a non-empty array of review labels' });
  } else {
    for (const slot of parsed.ranking) {
      for (const label of (Array.isArray(slot) ? slot : [slot])) {
        if (!known.has(label)) {
          errors.push({ code: 'UNKNOWN_LABEL', detail: `unknown review label '${label}'` });
        }
        flat.push(label);
      }
    }
    if (new Set(flat).size !== flat.length) {
      errors.push({ code: 'DUPLICATE_LABEL', detail: 'a review label appears more than once' });
    }
  }

  const knownIds = new Set(findingIds);
  if (!Array.isArray(parsed.adjudications)) {
    errors.push({ code: 'BAD_ADJUDICATIONS', detail: 'adjudications must be an array' });
  } else {
    for (const a of parsed.adjudications) {
      const id = a && a.id;
      if (!knownIds.has(id)) {
        errors.push({ code: 'UNKNOWN_FINDING_ID', detail: `unknown finding id '${id}'` });
      }
      if (!a || !JUDGE_VERDICTS.includes(a.verdict)) {
        errors.push({ code: 'BAD_VERDICT', detail: `bad verdict '${a && a.verdict}' on '${id}'` });
      }
    }
  }

  if (errors.length) { return fail(errors); }
  return { ok: true, ranking: parsed.ranking, adjudications: parsed.adjudications, errors: [] };
}

/** Per-phrase `^<phrase>(?![A-Za-z0-9])` matchers — prefix-anchored, case-sensitive. */
const CHAIR_VERDICT_PREFIXES = CHAIR_VERDICTS.map(
  (v) => new RegExp('^' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])')
);

/**
 * Parse the chair's final verdict line. Last matching `VERDICT:` line wins. A
 * line matches when the text after `VERDICT:` equals a canonical phrase, or
 * starts with one followed by a word boundary (trailing rationale, e.g.
 * `VERDICT: Fix these first — <gaps>`). Returns the canonical phrase, not the
 * trailing text.
 * @param {string} text
 * @returns {string|null} one of CHAIR_VERDICTS, or null
 */
function parseChairVerdict(text) {
  let found = null;
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*VERDICT:\s*(.+?)\s*$/);
    if (!m) { continue; }
    const rest = m[1];
    for (let i = 0; i < CHAIR_VERDICTS.length; i++) {
      if (rest === CHAIR_VERDICTS[i] || CHAIR_VERDICT_PREFIXES[i].test(rest)) {
        found = CHAIR_VERDICTS[i];
        break;
      }
    }
  }
  return found;
}

module.exports = { parseJudgeOutput, parseChairVerdict, CHAIR_VERDICTS, JUDGE_VERDICTS };
