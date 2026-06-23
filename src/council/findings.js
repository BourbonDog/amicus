// src/council/findings.js
'use strict';

const SEVERITIES = ['blocker', 'major', 'minor', 'nit'];
const REQUIRED = ['claim', 'location', 'rationale'];

/** Extract the LAST ```json fenced block's body, or null. */
function lastJsonBlock(text) {
  const re = /```json\s*\n([\s\S]*?)```/g;
  let m, last = null;
  while ((m = re.exec(text)) !== null) { last = m[1]; }
  return last;
}

/**
 * Validate a Stage-1 reviewer's fenced findings JSON.
 * @param {string} jsonText full review text (prose + fenced block)
 * @returns {{ok:boolean, findings:Array, errors:Array<{code:string,detail:string}>}}
 */
function validateFindings(jsonText) {
  const errors = [];
  const body = lastJsonBlock(jsonText || '');
  if (body === null) {
    return { ok: false, findings: [], errors: [{ code: 'NO_FENCED_BLOCK', detail: 'no ```json block found' }] };
  }
  let parsed;
  try { parsed = JSON.parse(body); }
  catch (e) { return { ok: false, findings: [], errors: [{ code: 'NOT_PARSEABLE', detail: e.message }] }; }

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  if (findings.length === 0) {
    errors.push({ code: 'EMPTY_FINDINGS', detail: 'findings is missing or empty' });
  }
  const seen = new Set();
  findings.forEach((f, i) => {
    if (seen.has(f.id)) { errors.push({ code: 'DUPLICATE_ID', detail: `id ${f.id} repeats` }); }
    seen.add(f.id);
    if (f.id !== i + 1) { errors.push({ code: 'NON_SEQUENTIAL_ID', detail: `expected id ${i + 1}, got ${f.id}` }); }
    if (!SEVERITIES.includes(f.severity)) { errors.push({ code: 'BAD_SEVERITY', detail: `bad severity '${f.severity}' on id ${f.id}` }); }
    for (const k of REQUIRED) {
      if (typeof f[k] !== 'string' || f[k].trim() === '') { errors.push({ code: 'MISSING_FIELD', detail: `missing ${k} on id ${f.id}` }); }
    }
  });

  return { ok: errors.length === 0, findings: errors.length === 0 ? findings : [], errors };
}

module.exports = { validateFindings, SEVERITIES };
