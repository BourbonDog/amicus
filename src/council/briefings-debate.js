// src/council/briefings-debate.js
'use strict';

/**
 * @module council/briefings-debate
 * Pure Stage-2.5 (debate) template builders for the headless council engine
 * (spec §5.3). Adapted from skills/second-opinion/SEAT-BRIEFS.md § Rebuttal-round
 * templates, hardened from the line-based contract to the v4.0 Stage-2
 * trailing-JSON style (prose first, one fenced ```json block last, nothing
 * after it). Every brief opens with the no-tools preamble and the date stamp
 * (spec §4.3). No IO, no model calls.
 */

const { dateLine } = require('./briefings-stage2');

const DEBATE_NO_TOOLS_PREAMBLE =
  'Do NOT use any tools or read any files; everything is in this message; ' +
  'begin immediately with the JSON block.';

/** Defense trailing-JSON contract (spec §5.3a). */
const DEFENSE_CONTRACT = [
  'End your response with a fenced ```json block, with no text after it:',
  '',
  '```json',
  '{',
  '  "responses": [',
  '    { "id": "A1", "action": "defend", "argument": "<strongest evidence-based defense, one paragraph max>" },',
  '    { "id": "A3", "action": "amend", "claim": "<full corrected replacement claim>", "argument": "<why, one sentence>" },',
  '    { "id": "B2", "action": "withdraw" }',
  '  ]',
  '}',
  '```',
  '',
  'Every listed finding id must appear exactly once. `defend` requires `argument`; ' +
  '`amend` requires `claim`; `withdraw` requires neither.',
].join('\n');

/** Re-vote trailing-JSON contract (spec §5.3b). */
const REVOTE_CONTRACT = [
  'End your response with a fenced ```json block, with no text after it:',
  '',
  '```json',
  '{',
  '  "revotes": [',
  '    { "id": "A1", "verdict": "agree", "reason": "<one line>" },',
  '    { "id": "A3", "verdict": "dispute", "reason": "<one line>" }',
  '  ]',
  '}',
  '```',
  '',
  '`verdict` is one of agree | dispute | neutral. Every listed finding id must ' +
  'appear exactly once.',
].join('\n');

/** Count the anonymized peer verdicts carried on a finding. */
function verdictCounts(list) {
  const c = { dispute: 0, agree: 0, neutral: 0 };
  for (const v of list || []) { if (c[v] !== undefined) { c[v] += 1; } }
  return c;
}

function findingBlockDefense(f) {
  const c = verdictCounts(f.peerVerdicts);
  const reasons = (f.disputeReasons || []).filter(Boolean);
  const loc = f.location ? ` @ ${f.location}` : '';
  // Stage-2's adjudication JSON has no `reason` field, so written reasons are usually
  // absent. Report the REAL anonymized peer split instead of inventing a reason string.
  const why = reasons.length
    ? `  Peers disputed it for:\n${reasons.map(r => `    - ${r}`).join('\n')}`
    : '  No written dispute reasons were captured.';
  return `- ${f.id} [${f.severity}]${loc}: ${f.claim}\n`
    + `  Peer verdicts (anonymized): ${c.dispute} dispute, ${c.agree} agree, ${c.neutral} neutral.\n`
    + why;
}

function findingBlockRevote(f) {
  const mark = f.amended ? ' **AMENDED**' : '';
  return `- ${f.id} [${f.severity}]${mark}: ${f.claim}\n  Raiser's response: ${f.argument}`;
}

/** One defense solo per raiser (spec §5.3a). */
function buildDefenseBrief({ findings, date }) {
  const parts = [DEBATE_NO_TOOLS_PREAMBLE];
  if (date) { parts.push(dateLine(date)); }
  parts.push(
    'You reviewed an artifact and raised the findings below. Peer reviewers ' +
    '(anonymous) disputed them for the stated reasons. For EACH finding decide: ' +
    'DEFEND it with evidence, AMEND it with corrected replacement text, or WITHDRAW ' +
    'it. Withdraw anything you cannot defend with evidence — an unsupported repeat ' +
    'of the original claim is weaker than a withdrawal.',
    findings.map(findingBlockDefense).join('\n\n'),
    DEFENSE_CONTRACT,
  );
  return parts.join('\n\n');
}

/** One shared re-vote bundle, fanned out to disputing judges (spec §5.3b). */
function buildRevoteBundle({ findings, date }) {
  const parts = [DEBATE_NO_TOOLS_PREAMBLE];
  if (date) { parts.push(dateLine(date)); }
  parts.push(
    'You previously adjudicated findings on this artifact and disputed at least ' +
    'one of those below. The (anonymous) raiser has now responded. Re-adjudicate ' +
    'ONLY the findings listed, in light of each response. Changing your verdict ' +
    'when the defense is convincing is good judging, not weakness; so is holding ' +
    'your dispute when it isn\'t.',
    findings.map(findingBlockRevote).join('\n\n'),
    REVOTE_CONTRACT,
  );
  return parts.join('\n\n');
}

/**
 * ⚠️ LC-12: same omission as LC-6 one stage earlier — a repair solo is a FRESH
 * session and cannot see the response it is repairing unless we hand it over.
 * `prior` is embedded verbatim and uncapped; the absent case is stated rather
 * than papered over with an empty block, so a model with nothing to correct is
 * told to say so instead of left to invent a position.
 * @param {string} kind 'defense' | 're-vote'
 * @param {string} contract the trailing-JSON contract for that kind
 * @param {Array<{code:string,detail:string}>} errors
 * @param {string} [prior] the text that ACTUALLY failed validation
 */
function repair(kind, contract, errors, prior) {
  const lines = (errors || []).map(e => `- ${e.code}: ${e.detail}`).join('\n');
  const text = typeof prior === 'string' ? prior.trim() : '';
  const block = text
    ? [`--- YOUR PREVIOUS ${kind.toUpperCase()} (verbatim — this is the text to correct) ---`,
      text,
      `--- END OF YOUR PREVIOUS ${kind.toUpperCase()} ---`].join('\n')
    : `Your previous ${kind} response was empty — there is no prior text to correct. `
      + 'Do not invent a position to satisfy the schema: say so in your output.';
  return [
    'Do NOT use any tools or read any files; everything is in this message; begin '
    + 'immediately with the JSON block.',
    block,
    `That ${kind} response's trailing JSON failed validation with these errors:`,
    lines,
    'Re-emit ONLY the corrected JSON block (the same position, fixed — do not change '
    + 'your votes), as a single fenced ```json block:',
    contract,
  ].join('\n\n');
}

function buildDefenseRepairPrompt({ errors, defense }) { return repair('defense', DEFENSE_CONTRACT, errors, defense); }
function buildRevoteRepairPrompt({ errors, revote }) { return repair('re-vote', REVOTE_CONTRACT, errors, revote); }

/**
 * Chair-packet "Debate round outcomes" section (spec §5.3c). De-anonymized —
 * built by run.js from debate.json + both tally records. `priorVerdicts` is the
 * finding's ACTUAL Stage-2 adjudication map from the provisional tally record and
 * `revotes` the map of judges who re-voted; `before` is derived here so no caller
 * can assume it. A re-vote recipient qualified by disputing SOME bundled finding,
 * so its prior verdict on THIS finding is often 'agree' or 'neutral'.
 * @param {{outcomes: Array<{id, originalClaim, action, amendedClaim,
 *   priorVerdicts: Object<string,string>, revotes: Object<string,string>}>}} args
 */
function buildDebateAddendum({ outcomes }) {
  const blocks = outcomes.map(o => {
    const head = `- ${o.id}: "${o.originalClaim}" → ${o.action}`;
    const amended = o.action === 'amended' && o.amendedClaim ? `\n  Amended claim: "${o.amendedClaim}"` : '';
    const prior = o.priorVerdicts || {};
    const revotes = o.revotes || {};
    const judges = Object.keys(revotes);
    const changes = judges.length
      ? '\n  Re-vote changes: ' + judges.map(
        j => `${j}: ${prior[j] || 'no prior verdict'} → ${revotes[j]}`).join('; ')
      : '\n  Re-vote changes: none';
    return head + amended + changes;
  }).join('\n');
  return ['--- Debate round outcomes ---', blocks].join('\n\n');
}

module.exports = {
  DEBATE_NO_TOOLS_PREAMBLE, DEFENSE_CONTRACT, REVOTE_CONTRACT,
  buildDefenseBrief, buildRevoteBundle,
  buildDefenseRepairPrompt, buildRevoteRepairPrompt, buildDebateAddendum,
};
