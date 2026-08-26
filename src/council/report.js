// src/council/report.js
'use strict';

/**
 * @module council/report
 * Pure verdict/disagreement report renderer (the differentiator). Reads a
 * verdict.json (+ optional wave.json for the cost total) and produces a single
 * self-contained Markdown or HTML string. Renders deterministic data only — no
 * scoring, anonymization, or synthesis (that stays in Claude).
 *
 * Since v4.8 Phase 1 T1.2 this file renders NOTHING itself: it builds the
 * neutral model (`toModel`) and `buildReport` dispatches to `./report-md` or
 * `./report-html`, which own the two string formats. That description of
 * `buildReport`'s API above is still exactly true from the outside — it is the
 * file's own job that narrowed.
 */

// v4.9 W8 T-A: the cost table's model lives in ./report-cost (extraction, this
// file's headroom). Eager, not lazy: that module back-requires nothing here.
const { buildCostModel } = require('./report-cost');

const TIER_ORDER = ['Disputed', 'Contested', 'Confirmed', 'Singleton'];
// __proto__: null — an inherited/unknown vote key (e.g. "toString") must fold as unrecognized, never resolve off Object.prototype.
const SYMBOL = { __proto__: null, agree: '✓', dispute: '✗', neutral: '–' };
// v4.8 T-C1 (SI-22.5, ruling R18): the ONE column every vote whose key names no
// column folds into. Deliberately NOT exported: R17 took the narrow option —
// src/workspace/matrix-model.js gets the same rule as a SEPARATE implementation
// in its own task, so nothing is extracted or shared for it here.
const UNATTRIBUTED = 'UNATTRIBUTED';

/**
 * Is a document in SEAT SPACE — does it carry a USABLE seat table?
 *
 * v4.8 PR4c §3.6 (R4c-8): ONE flag decides THREE readers of the seat space —
 * the roster, the vote key, and the RAISER. Gating any two of them ships a
 * self-contradicting artifact: gate the roster and the vote key only and the
 * star vanishes (`'deepseek' === 'deepseek#1'` is false for both columns);
 * gate the raiser only and the Raiser cell renders a seat id while every
 * column header renders the alias. `verdict.seats` is NEW in PR4c while
 * `adjudications[].seat` shipped in PR3, so independent fallbacks would leave
 * EVERY vote cell blank on the twin verdicts already on disk.
 *
 * `Array.isArray`, not `?.`/`??`: `[]` is not nullish, so `??` would delete
 * every judge column, and a non-array `seats` throws where HEAD renders. The
 * per-element check exists because every path that reaches a renderer with an
 * on-disk document is schema-free — `council report <verdict.json>` and
 * `council verdict <tally.json> --render` are raw JSON.parse, and
 * `amicus_verdict` takes `record: z.record(z.any())` — while R4c-5 widened the
 * MCP tally schema to `z.array(z.any()).nullable()` on purpose. So
 * `seats: [null,…]` and `seats: ["deepseek#1",…]` both arrive: the first makes
 * `s.id` THROW where HEAD renders, the second yields `undefined` columns. A
 * malformed table falls back to alias space WHOLE instead.
 *
 * ⚠️ EXPORTED AND SHARED, not copied (council A3/B1). `workspace/matrix-model.js`
 * makes the identical decision over `tally.meta.seats`, and two verbatim copies
 * are a maintenance coupling: edit one and the two renderers disagree about
 * which space a document is in. This is NOT `ledger.js :: CONFORMANCE_RANK`'s
 * documented-copy case — that copy is paid for because `ledger.js` (plus its two
 * extractions) never reaches findings/anonymize/seats, while its sibling pulls
 * all three. Measured here: requiring `workspace/matrix-model.js` already loads
 * four first-party modules (v4.8 Phase 1 T1.2 moved renderMd's own
 * pricing/format-duration/degrade requires out to report-md.js, which this path
 * never reaches — report-md is required lazily from inside buildReport, not at
 * module load) and THIS file is one of them (it has imported SYMBOL since v4.4,
 * for the same single-source reason), so sharing costs ZERO new require edges.
 * Guarded by tests/council/seat-matrix.test.js's A3/B1 table.
 */
function isSeatSpace(seats) {
  return Array.isArray(seats) && seats.length > 0
    && seats.every(s => s && typeof s.id === 'string');
}

/**
 * A finding's adjudications AS AN ARRAY, whatever the document actually carries.
 *
 * ⚠️ ONE expression, TWO readers, and that is the whole reason it exists.
 * `toModel`'s pre-pass and its per-finding map both walk this list, and for one
 * commit they disagreed about the type: `.some` is Array-only while `for...of`
 * takes any iterable, so `adjudications: "abc"` RENDERED at c8867b48 and THREW at
 * 774dcdc2. Measured at c8867b48: the string rendered
 * `| A1 | major | gpt |   |  * | Contested |  |` with a junk `"undefined"` key in
 * `byJudge`; `{}` and `42` threw there too.
 *
 * `Array.isArray` refuses all three the same way — a malformed value contributes
 * no votes — which renders the string case BYTE-IDENTICALLY to c8867b48 in both
 * formats (measured) and WIDENS `{}`/`42` from throw to that same vote-less
 * render. The widening is deliberate: it is the direction this file already
 * points. `isSeatSpace` above answers a malformed seats table by falling back
 * WHOLE rather than throwing, for the same reason — the three schema-free
 * `JSON.parse` entry points can deliver any shape. Pinned, all three shapes, in
 * tests/council/seat-matrix.test.js.
 *
 * ⚠️ `.filter(Boolean)` is v4.8 T-C4, and it is `matrix-model.js`'s `!adj` guard
 * spelled a SECOND time rather than shared — R17 keeps the rule in two places.
 * A falsy ELEMENT has no `.seat` and no `.judge`, so `columnFor` called it
 * unattributable and grew a column whose cell — `adj.verdict` — was `undefined`
 * too, i.e. blank: a column announcing a vote it could not show. `matrix-model.js`
 * skipped the same element and grew no column, so ONE document rendered two ways.
 * Measured at ed5c0c02: no column on either side, so that desync arrived with
 * this release rather than being inherited.
 * ⚠️ It also drops `null`/`undefined`, which THREW here in both phases. Same
 * throw -> render widening as the container above, named on purpose.
 * ⚠️ `Boolean`, NOT `a && typeof a === 'object'`. Measured over ten element types
 * against the live `matrix-model.js`: this predicate disagrees on 0 of 10, that
 * one on 3 of 10 — it drops TRUTHY non-objects (`42`, `'x'`, `true`) which the
 * other consumer keeps, closing one divergence by opening three. Those shapes
 * still grow a blank column on BOTH consumers; that is filed, and pinned here as
 * the agreement it is, not fixed by one-sided strictness.
 * Named mutant, with its measured red set: tests/council/seat-matrix.test.js :: ELEMKEEP.
 */
function adjOf(f) { return Array.isArray(f.adjudications) ? f.adjudications.filter(Boolean) : []; }

/** Build a neutral, render-agnostic model from a verdict (+ optional wave). */
function toModel(verdict, wave) {
  if (!verdict || !Array.isArray(verdict.findings)) {
    throw new Error('verdict.json must have a findings[] array');
  }
  const council = verdict.council || [];
  // 'council' (verdict.council / meta.models) is the street-cred universe and
  // legitimately includes 'claude' on a --claude-review run (buildTallyInput's
  // run-assemble.js:226, docs/council.md:326). 'judges' is the matrix column
  // set: SKILL.md:448 / run-stage2.js :: runStage2 (the ROSTER-not-bundle
  // derivation of `judges`) guarantee Claude is judged but
  // never judges, so its reserved seat must never grow a matrix column — filter
  // it out ONLY when claudeInCouncil is true. This is name+flag gated, not
  // vote-derived: a bench judge that cast zero adjudications (dead/unstructured
  // leg, run-stages.js:204-207) is still in council/judges and must still get
  // its (blank) column — deriving the roster from "who actually voted" would
  // silently delete that column too and break the byte-unchanged-artifact
  // contract for degraded v4.0.1-shaped runs.
  const aliasJudges = verdict.claudeInCouncil === true ? council.filter(j => j !== 'claude') : council;
  // v4.8 PR4c §3.6 (R4c-8): ONE flag, THREE readers below — the roster, the
  // vote key, and the RAISER. Shared with workspace/matrix-model.js; the whole
  // rationale (and why `??` is wrong) lives on isSeatSpace above.
  const seatSpace = isSeatSpace(verdict.seats);
  // No claude filter needed in seat space: seats[] is bench-only (seats.js
  // excludes the reserved claude seat), so it can never grow a claude column.
  const bench = seatSpace ? verdict.seats.map(s => s.id) : aliasJudges;
  const columns = new Set(bench);
  // v4.8 T-C1 (SI-22.5): REFUSE a key that identifies nothing. PR4c wrote
  // `byJudge[(seatSpace && adj.seat) || adj.judge]` whatever that expression
  // produced, and six shapes were measured at c8867b48 landing as a key no
  // column reads: an orphaned seat id, `''` and an absent `judge` in either
  // space — the absent one arriving as the STRING "undefined", a JS coercion
  // artifact and never a name — and a non-string judge. The three conjuncts
  // refuse, in that order, a non-string, the empty string, and a string naming
  // no column; `columns.has` is the whole orphan test, because the roster is
  // the only thing that makes a key mean a column. A key that survives all
  // three is written exactly where PR4c wrote it: this is a refusal, not a
  // re-key, and ruling R3 leaves the vote counted in `basis` either way.
  // ⚠️ `typeof key === 'string'` does not refuse only junk, and the one shape it
  // COSTS is disclosed rather than discovered: a NUMERIC key coerced to a column
  // at c8867b48 — `council: [42,'gpt']` with `judge: 42` put a ✓ in the `42`
  // column — and now folds instead, leaving that column blank. Brief class 3 says
  // "any non-string" unconditionally; this is that, measured.
  // ⚠️ `key !== ''` is NOT redundant with `columns.has`, and is not asserted from
  // structure: `isSeatSpace` accepts `{id: ''}`, so a roster CAN hold `''`, and on
  // `seats: [{id:''},…]` with `judge: ''` the two spellings measurably diverge —
  // with the conjunct the vote folds, without it `byJudge['']` takes it.
  // Named mutants, with their measured red sets:
  // tests/council/seat-matrix.test.js :: JUNKKEY and
  // tests/council/seat-matrix.test.js :: EMPTYOK.
  const columnFor = (adj) => {
    const key = (seatSpace && adj.seat) || adj.judge;
    return (typeof key === 'string' && key !== '' && columns.has(key)) ? key : UNATTRIBUTED;
  };
  // ⚠️ TWO-PHASE, and it cannot be one: the roster is what CLASSIFIES a vote,
  // and whether any vote was refused is what decides the roster. Phase 1 is the
  // bench roster plus this pre-pass over every finding; phase 2 is the map
  // below, which seeds `byJudge` from the FINAL roster. Deciding inside that map
  // would seed the column onto some findings and not others — which is only
  // OBSERVABLE on a MULTI-finding document, so the pin that separates the two
  // shapes carries two findings on purpose.
  // Named mutant, with its measured red set: tests/council/seat-matrix.test.js :: PERFINDING.
  // ⚠️ CONDITIONAL, the same shape as T2.3's emit-only-when-`> 0`: added
  // unconditionally it grows a column on every report that has no such vote and
  // breaks the byte-unchanged-artifact contract.
  // ⚠️ `concat`, never `push`. In alias space with `claudeInCouncil !== true`,
  // `bench` IS `verdict.council` BY REFERENCE (measured at c8867b48:
  // `toModel(v).judges === v.council` reads true), so appending in place would
  // write the label into the caller's own document and into `header.council` —
  // which both renderers print as `council: …` on the meta line.
  // ⚠️ `!columns.has(...)`: a bench model literally aliased UNATTRIBUTED already
  // owns that column and R18 says ONE column. It then SHARES its cell with the
  // folded votes — disclosed, not fixed, because the roster entry is also the
  // `byJudge` key and separating them needs a renderer change.
  // Named mutant, with its measured red set: tests/council/seat-matrix.test.js :: ALWAYSCOL.
  const folded = verdict.findings.some(f => adjOf(f).some(a => columnFor(a) === UNATTRIBUTED));
  const judges = folded && !columns.has(UNATTRIBUTED) ? bench.concat(UNATTRIBUTED) : bench;
  const findings = verdict.findings.map((f) => {
    const byJudge = {};
    for (const j of judges) { byJudge[j] = null; }
    // LAST-WINS, and still is: two votes sharing one column overwrite each
    // other. Before PR4c (b9a98a0f) this key was the bare alias, which is what
    // collapsed a twin bench — still pinned, on a seat-table-less document, by
    // seat-matrix.test.js's T21 block. T-C1 changed only WHICH key a REFUSED
    // vote gets: every refusal folds into the single UNATTRIBUTED column, so two
    // refused votes on one finding show ONE verdict. Measured, and pinned as
    // measured rather than claimed to be more. `basis` is untouched either way.
    for (const adj of adjOf(f)) { byJudge[columnFor(adj)] = adj.verdict; }
    return {
      // The raiser re-key IS the star fix, and it is why report-html.js needs
      // zero edits: renderMd's cell map and report-html.js's both test
      // `j === f.raiser` against THIS field, so both become seat-correct at
      // once — and the Raiser column follows instead of contradicting them.
      id: f.id, severity: f.severity, raiser: seatSpace ? (f.raiserSeat || f.raiser) : f.raiser, tier: f.tier,
      basis: f.basis || { a: 0, d: 0, n: 0 }, decision: f.decision || null,
      applied: f.applied === true, byJudge, debate: f.debate || null,
      // ⚠️ v4.8 PR5a T6: this literal is CLOSED — it names every key it copies off `f` and
      // copies nothing else, so a field added upstream is invisible to BOTH renderers until
      // it is named here. tally.js has stamped R8's sameModelCorroboration since PR4c and
      // verdict.js carries it, but no renderer could see it. Emit-when-true, matching the
      // producer: it is never written as `false`.
      ...(f.sameModelCorroboration ? { sameModelCorroboration: true } : {}),
    };
  });
  // 'movements' is deliberately re-vote-only (defended/amended): a withdrawn or
  // no-response finding is never bundled into the re-vote (run-debate.js's
  // bundleFor()), so its tier — even if it happens to differ from previousTier —
  // was never "moved after re-vote". Listing it there would read as "still live,
  // just downgraded" when it was actually retracted; withdrawn findings get their
  // own list below so a reader can tell the two apart.
  // no-response findings (spec §5.7: a dead defense leg, or one still
  // unstructured after its single repair, makes that raiser's bundled
  // findings all 'no-response') get their own list, same idiom as withdrawn —
  // silently dropping them would leave a "## Debate round" heading with
  // nothing beneath it whenever a run's only debating raiser never responded.
  const debate = {
    present: findings.some(f => f.debate) === true,
    withdrawn: verdict.findings.filter(f => f.debate && f.debate.action === 'withdrawn')
      .map(f => ({ id: f.id, previousTier: f.debate.previousTier, tier: f.tier })),
    movements: verdict.findings.filter(f => f.debate && f.debate.action !== 'withdrawn' && f.debate.action !== 'no-response'
        && f.debate.previousTier && f.debate.previousTier !== f.tier)
      .map(f => ({ id: f.id, action: f.debate.action, previousTier: f.debate.previousTier, tier: f.tier })),
    noResponse: verdict.findings.filter(f => f.debate && f.debate.action === 'no-response')
      .map(f => ({ id: f.id, previousTier: f.debate.previousTier, tier: f.tier })),
  };
  // v4.9 W8 T-A: ONE read of the run's intent, TWO consumers below — the model's
  // own `intent` (both renderers fork the spec §5.4 concurrence qualifier on it)
  // and the header WORD. `=== 'task'` fails everything else CLOSED to review, the
  // same direction `verdict.js :: buildVerdict` points: it emits the key ONLY as
  // the literal 'task', so every pre-v4.9 and every review verdict takes this
  // default and renders byte-identically to HEAD.
  const intent = verdict.intent === 'task' ? 'task' : 'review';
  return {
    header: {
      // The header WORD, not the key: `runType` is meta's free-form transport
      // string ('headless' on every wired path), which on a task run names how the
      // wave ran and not what it was — and the title is the first thing a reader
      // sees. Forking the VALUE here forks both renderers, which print `h.runType`;
      // renaming the key would edit two files to say the same thing.
      runType: intent === 'task' ? 'task' : (verdict.runType || 'review'),
      runId: verdict.runId, date: verdict.date,
      chair: verdict.chair, council, claudeInCouncil: verdict.claudeInCouncil === true,
    },
    intent,
    tierCounts: verdict.tierCounts || { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 },
    judges, findings, debate,
    streetCred: verdict.streetCred || [],
    // v4.6 Plan 2: additive and OPTIONAL on the verdict (verdict.js only sets
    // it when the run actually degraded), so a clean verdict's model — and
    // therefore its rendered report — is byte-for-byte unchanged.
    // Plan 2 final review F2 + v4.9 W8 T-A: LOSSES ONLY. A heal is announced on
    // stderr/run.json but is not a loss (spec D4, §8), and neither is v4.9's
    // kind:'info' — `ledger-skipped` says a task run wrote no reliability rows,
    // which is speech, not damage. Info records ride `notes`, which both renderers
    // list APART from "What was lost".
    // ⚠️ NOT the positive `kind === 'degrade'`, and the difference is measured: a
    // record with NO kind key — hand-written, or parsed off a verdict older than
    // kinds, which `utils/degrade.js :: formatDegrade` still deliberately serves as
    // 'Notice' — is a loss at HEAD, and the positive spelling drops it from BOTH
    // lists. Pinned in report-intent.test.js (named mutant LEGACYDROP, measured).
    // ⚠️ `verdict-seat-loss.js :: deriveSeatLoss` now spells it the OTHER way — v4.9 W9 moved
    // it to the positive `kind === 'degrade'` — and the two are not the same predicate: that
    // one asks which announcements imply a LOST SEAT, over in-process `makeDegrade` records
    // only, so it can afford the positive test. This one reads verdict.json documents that
    // may predate kinds, which is what LEGACYDROP measures. Do not "align" them.
    degrades: (verdict.degrades || []).filter(d => d.kind !== 'heal' && d.kind !== 'info'),
    notes: (verdict.degrades || []).filter(d => d.kind === 'info'),
    cost: buildCostModel(verdict.runStats || [], wave),
  };
}

/**
 * @param {{verdict:object, wave?:object, tallyRecord?:object}} sources
 * @param {{format:'md'|'html'}} opts
 * @returns {string}
 */
function buildReport(sources, opts = {}) {
  const model = toModel(sources.verdict, sources.wave);
  // ⚠️ Both requires MUST stay lazy — nothing lints this. Each renderer requires ./report back at
  // load for TIER_ORDER/SYMBOL; hoisting either resolves that back-require against THIS file's
  // not-yet-assigned module.exports, so the sibling gets undefined and renders a TypeError.
  if (opts.format === 'html') { return require('./report-html').renderHtml(model); }
  return require('./report-md').renderMd(model);
}

module.exports = { buildReport, toModel, TIER_ORDER, SYMBOL, isSeatSpace };
