// src/council/findings.js
'use strict';

const SEVERITIES = ['blocker', 'major', 'minor', 'nit'];
const REQUIRED = ['claim', 'location', 'rationale'];

/**
 * Extract the LAST ```json fenced block's body, or null.
 *
 * ⚠️ v4.4.1 (Task 10). The closing fence is anchored to LINE START — the markdown
 * convention — via the `m` flag. It used to be a bare non-greedy `([\s\S]*?)```,
 * so the first triple-backtick ANYWHERE inside the JSON body ended the match. A
 * findings block whose `claim` quotes a fence — which any review of markdown
 * inevitably writes — was truncated mid-string and then failed JSON.parse as
 * NOT_PARSEABLE, collapsing the seat to `conformance: unstructured`.
 *
 * This is not hypothetical. Measured on the paid md-lite council preserved in
 * output/md-lite-council/: THREE of four seats hit it. `opus` cut at "```/) for
 * both open and" (5 findings lost), `glm` at "```js) is silently disca" (6 lost),
 * `minimax` at a repeated-backtick example (rescued only by the repair wave).
 * Same family as LC-6/LC-10: an output contract that cannot express what the task
 * requires. A council reviewing anything that DISCUSSES markdown silently loses
 * seats, and the chair synthesizes from what survived without knowing.
 *
 * Line-start anchoring is sufficient rather than merely better: a raw newline
 * inside a JSON string is invalid JSON, so no line of a WELL-FORMED body can ever
 * begin with a fence. Leading horizontal whitespace is tolerated on the closing
 * line (CommonMark allows an indented closing fence); a `\n` is still required
 * before it, so a fence sharing a line with body content no longer closes a block.
 *
 * Every Stage-1/Stage-2 extractor funnels through here — validateFindings,
 * countAttemptedFindings, and parse-stage2's parseJudgeOutput / parseDebateDefense
 * / parseRevote — so judge, debate-defense and re-vote parsing all carried the
 * identical defect and are all fixed by this one change.
 */
function lastJsonBlock(text) {
  const re = /```json\s*\n([\s\S]*?)^[ \t]*```/gm;
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

  // ⚠️ LC-10 (owner ruling, 2026-07-26). A review that read the material and found
  // nothing is a VALID review — the anti-sycophancy clause shipped in every Stage-1
  // briefing says so verbatim ("An empty severity category is a valid result"), and
  // rejecting it structurally pressured models into inventing findings to satisfy
  // the schema. costgate01's grok did exactly that, and the fabrication reached
  // tally.json, the street-cred rankings, the chair synthesis and a human decision.
  //
  // The distinction that makes this safe: a BROKEN emit already has its own codes
  // (NO_FENCED_BLOCK, NOT_PARSEABLE) and returns above this line. What reaches here
  // is a cleanly-parsed object. A non-empty `overall` is what separates a deliberate
  // "nothing found" from a model that emitted a hollow shell — the empty-overall case
  // stays an error.
  //
  // The ruling blesses `findings: []` — an array that is PRESENT and empty. A missing
  // or non-array `findings` key is not a declaration of zero and stays an error, which
  // is the same line countAttemptedFindings already draws: an explicit `[]` counts as
  // zero, an absent array returns null (unverifiable). Widening this to "no findings
  // key at all is fine" would let a bare {"overall":"looks good"} — the exact hollow
  // shell the `overall` guard exists to catch — pass as a clean review.
  const declared = Array.isArray(parsed.findings);
  const findings = declared ? parsed.findings : [];
  const overall = typeof parsed.overall === 'string' ? parsed.overall.trim() : '';
  if (!declared) {
    errors.push({ code: 'EMPTY_FINDINGS', detail: 'findings is missing or not an array' });
  } else if (findings.length === 0 && overall === '') {
    errors.push({ code: 'EMPTY_FINDINGS', detail: 'findings is empty and overall is missing or blank' });
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

/**
 * How many findings a review's trailing block ATTEMPTED to declare, regardless of
 * whether they validate.
 *
 * ⚠️ LC-11: the repair prompt's contract is "the same findings, fixed — do not add
 * or remove findings". Cardinality is the checkable half of that contract, and it
 * is the half that matters: a repair which changes the count has produced findings
 * the ORIGINAL PROSE never narrates, and that prose is what the judges read in
 * bundle-stage2.md.
 *
 * Deliberately NOT validateFindings: an invalid block (bad severity, missing
 * field) still declares a cardinality, and that is exactly the case the repair
 * wave exists for.
 *
 * @param {string} text full review text (prose + fenced block)
 * @returns {number|null} null when there is no block or it does not parse — in
 *   which case there is nothing to compare and the caller must mark the result
 *   unverified rather than implying a check happened.
 */
function countAttemptedFindings(text) {
  const body = lastJsonBlock(text || '');
  if (body === null) { return null; }
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed.findings) ? parsed.findings.length : null;
  } catch { return null; }
}

/**
 * A canonical repair that HONORS the contract for a review which declared zero
 * findings: the same (empty) set, with a real `overall`. Probe only — it is never
 * sent to a model.
 */
const EMPTY_SET_REPAIR_PROBE =
  '```json\n{"overall":"I read the material and found nothing to report.","findings":[]}\n```';

/**
 * Can a repair that honors the count contract pass validation at all, given the
 * count the ORIGINAL declared?
 *
 * ⚠️ v4.4.1 review F2. The repair prompt's contract is "the same findings, fixed —
 * do not add or remove findings", and run-stages.js refuses a repair that changed
 * the count. When the original declared ZERO findings, the only contract-honoring
 * repair is another empty set — so if the validator rejects an empty set, every
 * outcome of that repair wave is predetermined: a compliant repair fails
 * validation, a non-compliant one is refused on the count. Up to two PAID solo
 * legs whose only reachable end state is 'unstructured'. Don't buy it.
 *
 * The answer is ASKED of the validator instead of hard-coded so the two rules can
 * never drift. Task 3 (LC-10) makes a well-formed empty set valid; the day it
 * lands this predicate starts returning true on its own, and the malformed empty
 * original (blank or missing `overall`) enters the repair loop again — where a
 * repair can now succeed by re-emitting zero findings with a real `overall`.
 *
 * @param {number|null} attemptedCount countAttemptedFindings(originalText)
 * @returns {boolean} false ⇒ skip the repair loop; the spend cannot buy an outcome.
 *   null (nothing to compare) is always repairable — that is the wave's main
 *   legitimate use.
 */
function repairCanHonorContract(attemptedCount) {
  if (attemptedCount !== 0) { return true; }
  return validateFindings(EMPTY_SET_REPAIR_PROBE).ok;
}

/**
 * v4.0 §7: stamp the council v2 envelope onto a validateFindings result
 * (additive — ok/findings/errors stay top-level; existing key-readers keep
 * working). Used by `amicus council validate --json`.
 * @param {{ok:boolean, findings:Array, errors:Array}} result
 * @returns {object} enveloped validate doc
 */
function buildValidateDoc(result) {
  const { COUNCIL_SCHEMA_VERSION } = require('./tally');
  return { schemaVersion: COUNCIL_SCHEMA_VERSION, type: 'council-validate', ...result };
}

module.exports = {
  validateFindings, buildValidateDoc, SEVERITIES, lastJsonBlock, countAttemptedFindings,
  repairCanHonorContract,
};
