// src/council/parse-stage2.js
'use strict';

/**
 * @module council/parse-stage2
 * Stage-2 output parsing for the headless council engine (spec §5): the
 * judge's trailing JSON block ({ranking, adjudications}) and the chair's final
 * terminal line — `VERDICT:` on a review run, `ANSWER:` on a task run (v4.9
 * W7 #146). Shares last-JSON-block extraction with findings.js.
 * Pure — the ≤2-repair loop lives in run-stages.js; the tri-state
 * (clean|repaired|unstructured) is recorded by the driver.
 */

const { lastJsonBlock } = require('./findings');

const JUDGE_VERDICTS = ['agree', 'dispute', 'neutral'];
const CHAIR_VERDICTS = ['Ship it', 'Fix these first', 'Fundamental rethink'];
/**
 * The TASK chair's scale (v4.9 W7, #146). Independently spelled from
 * briefings-chair-task.js :: CHAIR_ANSWER_VALUES exactly as CHAIR_VERDICTS is
 * from briefings-chair.js :: CHAIR_VERDICT_VALUES; both pairs are drift-pinned
 * in tests/council/chair-scale-drift.test.js (named mutant ANSWERSCALEDRIFT).
 * ⚠️ The two scales MUST stay disjoint — that disjointness plus the distinct
 * keyword is what makes parseChairVerdict and parseChairAnswer unable to read
 * each other's terminal line.
 */
const CHAIR_ANSWERS = ['Converged', 'Split', 'Insufficient'];

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
  // ⚠️ v4.4.1 FINAL-REVIEW C. `JSON.parse('null')` SUCCEEDS — it returns null and
  // throws nothing — so a body of literal `null` sailed past the catch above and
  // `parsed.ranking` threw `TypeError: Cannot read properties of null`. parseDebateDefense
  // (parse-stage2.js :: parseDebateDefense) and parseRevote (parse-stage2.js :: parseRevote) below already carried this `!parsed` guard; the judge
  // path and findings.js's validateFindings did not, which made it an asymmetry among
  // five consumers of one extractor rather than a new rule. Guarded on BOTH derefs so
  // a `null` body reports exactly what a keyless `{}` body already reported —
  // BAD_RANKING + BAD_ADJUDICATIONS — and no new error code enters a repair prompt.
  if (!parsed || !Array.isArray(parsed.ranking) || parsed.ranking.length === 0) {
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
  if (!parsed || !Array.isArray(parsed.adjudications)) {   // see the `!parsed` note above
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
const phrasePrefixes = (phrases) => phrases.map(
  (v) => new RegExp('^' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])')
);
const CHAIR_VERDICT_PREFIXES = phrasePrefixes(CHAIR_VERDICTS);
const CHAIR_ANSWER_PREFIXES = phrasePrefixes(CHAIR_ANSWERS);
const VERDICT_LINE = /^\s*VERDICT:\s*(.+?)\s*$/;
const ANSWER_LINE = /^\s*ANSWER:\s*(.+?)\s*$/;

/**
 * The chair's terminal line, whichever keyword carries it. Last matching line
 * wins. A line matches when the text after the keyword equals a canonical
 * phrase, or starts with one followed by a word boundary (trailing rationale,
 * e.g. `VERDICT: Fix these first — <gaps>`). Returns the canonical phrase,
 * never the trailing text.
 *
 * v4.9 W7 generalized the matcher rather than copying it, on the W6
 * `composeWith` precedent: the review path delegates, so it is byte-identical
 * by construction and every tolerance this parser earned in production
 * (live-gate bug runId b89b67d1 among them) holds for both intents at once.
 */
function parseTerminalLine(text, lineRe, phrases, prefixes) {
  let found = null;
  for (const line of String(text || '').split('\n')) {
    const m = line.match(lineRe);
    if (!m) { continue; }
    const rest = m[1];
    for (let i = 0; i < phrases.length; i++) {
      if (rest === phrases[i] || prefixes[i].test(rest)) {
        found = phrases[i];
        break;
      }
    }
  }
  return found;
}

/**
 * Parse the chair's final `VERDICT:` line (review intent).
 * @param {string} text
 * @returns {string|null} one of CHAIR_VERDICTS, or null
 */
function parseChairVerdict(text) {
  return parseTerminalLine(text, VERDICT_LINE, CHAIR_VERDICTS, CHAIR_VERDICT_PREFIXES);
}

/**
 * Parse the chair's final `ANSWER:` line (task intent, #146).
 * @param {string} text
 * @returns {string|null} one of CHAIR_ANSWERS, or null
 */
function parseChairAnswer(text) {
  return parseTerminalLine(text, ANSWER_LINE, CHAIR_ANSWERS, CHAIR_ANSWER_PREFIXES);
}

/**
 * The run-intent dispatcher run-chair.js parses through. `intent` is the W5
 * channel (`'task'` | absent); anything else reads the VERDICT line
 * (fail-closed), so a review run is byte-identical to the direct call.
 * @param {string} text
 * @param {string} [intent]
 */
function parseChairTerminal(text, intent) {
  return intent === 'task' ? parseChairAnswer(text) : parseChairVerdict(text);
}

const DEBATE_ACTIONS = ['defend', 'amend', 'withdraw'];
const REVOTE_VERDICTS = ['agree', 'dispute', 'neutral'];

/**
 * Parse a debate defense solo (spec §5.4). Every expected id ends up in byId:
 * a present-and-valid entry keeps its action/argument/claim; anything absent or
 * individually invalid becomes {action:'no-response'} (the spec-mandated
 * "original stands" fallback). A block-level failure sets ok:false so the
 * caller issues exactly ONE repair; after that, every id is 'no-response'.
 * @param {string} text raw defense output (prose + trailing ```json block)
 * @param {string[]} expectedIds run-global ids sent to this raiser
 * @returns {{byId: Object, ok: boolean, errors: Array<{code, detail}>}}
 */
function parseDebateDefense(text, expectedIds) {
  const allNoResponse = () => {
    const byId = {};
    for (const id of expectedIds) { byId[id] = { action: 'no-response' }; }
    return byId;
  };
  const body = lastJsonBlock(text || '');
  if (body === null) {
    return { byId: allNoResponse(), ok: false, errors: [{ code: 'NO_FENCED_BLOCK', detail: 'no ```json block found' }] };
  }
  let parsed;
  try { parsed = JSON.parse(body); }
  catch (e) { return { byId: allNoResponse(), ok: false, errors: [{ code: 'NOT_PARSEABLE', detail: e.message }] }; }
  if (!parsed || !Array.isArray(parsed.responses)) {
    return { byId: allNoResponse(), ok: false, errors: [{ code: 'BAD_RESPONSES', detail: 'responses must be an array' }] };
  }
  const expected = new Set(expectedIds);
  const byId = allNoResponse();
  for (const r of parsed.responses) {
    const id = r && r.id;
    if (!expected.has(id)) { continue; }                 // unknown id ignored
    if (r.action === 'defend' && typeof r.argument === 'string' && r.argument.trim()) {
      byId[id] = { action: 'defend', argument: r.argument };
    } else if (r.action === 'amend' && typeof r.claim === 'string' && r.claim.trim()) {
      const entry = { action: 'amend', claim: r.claim };
      if (typeof r.argument === 'string' && r.argument.trim()) { entry.argument = r.argument; }
      byId[id] = entry;
    } else if (r.action === 'withdraw') {
      byId[id] = { action: 'withdraw' };
    } // else leave as no-response
  }
  return { byId, ok: true, errors: [] };
}

/**
 * Parse a re-vote leg (spec §5.4). byId holds ONLY present-and-valid ids; an
 * absent or invalid entry is omitted so the judge's original verdict stands.
 * Block-level failure sets ok:false (caller issues one repair, then originals
 * stand for all bundled ids).
 * @param {string} text raw re-vote output
 * @param {string[]} expectedIds bundled run-global ids
 * @returns {{byId: Object, ok: boolean, errors: Array<{code, detail}>}}
 */
function parseRevote(text, expectedIds) {
  const body = lastJsonBlock(text || '');
  if (body === null) {
    return { byId: {}, ok: false, errors: [{ code: 'NO_FENCED_BLOCK', detail: 'no ```json block found' }] };
  }
  let parsed;
  try { parsed = JSON.parse(body); }
  catch (e) { return { byId: {}, ok: false, errors: [{ code: 'NOT_PARSEABLE', detail: e.message }] }; }
  if (!parsed || !Array.isArray(parsed.revotes)) {
    return { byId: {}, ok: false, errors: [{ code: 'BAD_REVOTES', detail: 'revotes must be an array' }] };
  }
  const expected = new Set(expectedIds);
  const byId = {};
  for (const r of parsed.revotes) {
    const id = r && r.id;
    if (!expected.has(id) || !REVOTE_VERDICTS.includes(r.verdict)) { continue; }
    const entry = { verdict: r.verdict };
    if (typeof r.reason === 'string' && r.reason.trim()) { entry.reason = r.reason; }
    byId[id] = entry;
  }
  return { byId, ok: true, errors: [] };
}

module.exports = {
  parseJudgeOutput, parseChairVerdict, CHAIR_VERDICTS, JUDGE_VERDICTS,
  parseChairAnswer, parseChairTerminal, CHAIR_ANSWERS,
  parseDebateDefense, parseRevote, DEBATE_ACTIONS, REVOTE_VERDICTS,
};
