// src/council/findings.js
'use strict';

const SEVERITIES = ['blocker', 'major', 'minor', 'nit'];
const REQUIRED = ['claim', 'location', 'rationale'];

/** The start of a ```json block. Openers are enumerated INDEPENDENTLY — see below. */
const OPENER = /```json\s*\n/g;

/**
 * The two readings of "where does this block close?", primary first.
 *
 * ANCHORED_CLOSE is the primary and the definition of a block: the closing fence
 * starts a line (CommonMark's rule; leading horizontal whitespace allowed). It is
 * what makes a body that CONTAINS a fence extractable at all.
 *
 * The same-line reading — the first triple-backtick anywhere ends the body — is the
 * pre-Task-10 one. As a way to FIND blocks it is broken (it truncates any body that
 * quotes a fence), but as a way to read a body a sloppy emit mis-delimited it is
 * right, and JSON.parse rather than the regex decides which reading was.
 */
const ANCHORED_CLOSE = /^[ \t]*```/m;
const FENCE = '```';

/**
 * How one opener's body can be read, primary first.
 * @param {string} rest the text immediately following an opener
 * @returns {Array<{body: string, anchored: boolean}>} 0–2 readings
 */
function bodyReadings(rest) {
  const out = [];
  const anchored = ANCHORED_CLOSE.exec(rest);
  if (anchored) { out.push({ body: rest.slice(0, anchored.index), anchored: true }); }
  const inline = rest.indexOf(FENCE);
  if (inline !== -1) { out.push({ body: rest.slice(0, inline), anchored: false }); }
  return out;
}

/**
 * Extract the last ```json fenced block that is VALID JSON, or null.
 *
 * ⚠️ OWNER RULING (v4.4.1). "Last block" means the last candidate that PARSES, not
 * the last one that is merely syntactically delimited. One rule closes two traps
 * that no single regex can close at once — both of them measured, not hypothetical:
 *
 * TRAP 1 — a fence INSIDE the body (pre-Task-10). The pattern was
 * `/```json\s*\n([\s\S]*?)```/g`: the first triple-backtick ANYWHERE in the JSON
 * ended the match, so a findings block whose `claim` quotes a fence — which any
 * review of markdown inevitably writes — was truncated mid-string and failed
 * JSON.parse. On the paid md-lite council preserved in output/md-lite-council/,
 * THREE of four seats hit it: `opus` cut at "```/) for both open and" (5 findings
 * lost), `glm` at "```js) is silently disca" (6 lost), `minimax` at a
 * repeated-backtick example. The chair synthesized from what survived, unaware.
 *
 * TRAP 2 — a sloppy block BEFORE a good one (introduced by Task 10's `c5f4a9e`,
 * measured and pinned by Task 11). With the close anchored to line start, a
 * same-line-fenced block's body runs on to the next line-start fence — which is the
 * NEXT block's OPENING fence. A well-formed block behind a sloppy one became
 * unreachable; the old unanchored regex found it.
 *
 * The algorithm, in three moves.
 *
 * 1. OPENERS ARE ENUMERATED INDEPENDENTLY, not by a single scan that resumes after
 *    each match. That alone is what killed trap 2: the old scan's cursor jumped past
 *    the good block's opener because the sloppy block's run-on body had swallowed
 *    it, so the good block was never even a candidate. Every ```json opener now gets
 *    considered on its own terms, whatever the block before it did.
 * 2. EACH OPENER IS READ BOTH WAYS — anchored close (primary) and same-line close
 *    (fallback) — so a sloppy but parseable emit stays reachable.
 * 3. THE LAST OPENER WHOSE BODY PARSES WINS, preferring its anchored reading. A
 *    truncated reading can never beat a whole one, because a truncated body does not
 *    parse; JSON.parse is the arbiter, not the regex.
 *
 * The safety of consulting the sloppy reading at all is structural, not lucky: a raw
 * newline inside a JSON string is invalid JSON, so no line of a WELL-FORMED body can
 * begin with a fence, and no well-formed body can contain a `\n`-terminated ```json
 * opener. The readings therefore agree on every well-formed block and can only
 * disagree about a malformed one.
 *
 * ⚠️ WIDENED BY A SECOND OWNER RULING (v4.4.1, same release). The same-line reading
 * may also DISCOVER a block, not merely recover one. The first cut of this function
 * gated it — "recover, never discover" — so an opener whose ONLY close shared a line
 * with body content returned null even when its JSON was perfect, buying a paid
 * repair leg over a cosmetic closer. The owner widened it: every reading of every
 * opener is a candidate, and JSON.parse arbitrates, full stop. Simulated before the
 * ruling and re-pinned below: a body that QUOTES a fence still parses (trap 1 stays
 * closed — per-opener arbitration keeps the anchored reading winning, because it is
 * the one that parses), and a lone same-line block now parses instead of repairing.
 *
 * Only an opener that never closed AT ALL — no fence of either kind after it, i.e. a
 * cut-off emit — yields no candidate. When no opener yields a candidate, the answer
 * is null: nothing was ever closed, and the text goes to the repair wave.
 *
 * When candidates exist but NOTHING parses, the last opener's preferred (anchored if
 * it has one) body is returned rather than null — deliberately. A malformed emit must
 * not look like an absent one: callers key off that distinction (validateFindings
 * reports NOT_PARSEABLE with a real body instead of NO_FENCED_BLOCK;
 * countAttemptedFindings returns null vs 0, a distinction downstream callers key off).
 *
 * Every Stage-1/Stage-2 extractor funnels through here — validateFindings,
 * countAttemptedFindings, and parse-stage2's parseJudgeOutput / parseDebateDefense
 * / parseRevote — so judge, debate-defense and re-vote parsing carried both defects
 * and are fixed by this one change.
 *
 * @param {string} text full model output (prose + fenced block)
 * @returns {string|null} the winning block body, or null when nothing closed
 */
function lastJsonBlock(text) {
  const src = String(text ?? '');
  const perOpener = [];
  OPENER.lastIndex = 0;
  let m;
  while ((m = OPENER.exec(src)) !== null) {
    const readings = bodyReadings(src.slice(m.index + m[0].length));
    if (readings.length > 0) { perOpener.push(readings); } // an opener that never closed is no candidate
  }
  if (perOpener.length === 0) { return null; }              // nothing ever closed
  for (let i = perOpener.length - 1; i >= 0; i--) {
    for (const reading of perOpener[i]) {
      try { JSON.parse(reading.body); return reading.body; }
      catch { /* not this reading — keep walking backwards */ }
    }
  }
  return perOpener[perOpener.length - 1][0].body;           // malformed ≠ absent
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

  // ⚠️ v4.4.1 FINAL-REVIEW C — a body that parses to nothing usable.
  // `JSON.parse('null')` SUCCEEDS: it returns null and throws nothing, so the catch
  // above never sees it and every `parsed.<key>` below threw
  // `TypeError: Cannot read properties of null`. Because run-stages.js:164 calls this
  // from inside run.js's try/catch, ONE seat emitting a `null` body aborted an entire
  // PAID council as exit 1 rather than degrading that seat — the fail-closed shape
  // this release exists to remove.
  //
  // Same guard parse-stage2.js:129 and :167 already carried; this was an asymmetry
  // among five consumers of one extractor, not a new rule. `!parsed` (their idiom)
  // rather than `parsed === null`, so the other contentless bodies — 0, false, "" —
  // land here too: each carries no object at all, each was already ok:false via
  // EMPTY_FINDINGS, and NOT_PARSEABLE is the truer story to hand the repair prompt.
  // A truthy scalar (123, "text") never crashed and is left on its existing path.
  //
  // NOT_PARSEABLE, not NO_FENCED_BLOCK: the distinction is load-bearing. The model
  // emitted something broken, not nothing — and countAttemptedFindings must keep
  // answering null (unverifiable) rather than 0 (a declared empty set): its own
  // JSON.parse succeeds on `null`, and `Array.isArray(null.findings)` throws into
  // its catch.
  if (!parsed) {
    return { ok: false, findings: [], errors: [{ code: 'NOT_PARSEABLE',
      detail: `block body is ${JSON.stringify(parsed)}, not an object` }] };
  }

  // ⚠️ LC-10 (owner ruling, 2026-07-26). A review that read the material and found
  // nothing is a VALID review — the anti-sycophancy clause shipped in every Stage-1
  // review briefing says so verbatim ("An empty severity category is a valid result";
  // task briefings state the same rule in claims wording — v4.9 W6), and
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
};
