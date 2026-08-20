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

const { sumWaveUsage } = require('../utils/pricing');

const TIER_ORDER = ['Disputed', 'Contested', 'Confirmed', 'Singleton'];
const SYMBOL = { agree: '✓', dispute: '✗', neutral: '–' };
// v4.8 T-C1 (SI-12, ruling R18): the ONE column every vote whose key names no
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
 * which space a document is in. This is NOT `ledger.js:61-69`'s
 * documented-copy case — that copy is paid for because `ledger.js` requires
 * only fs/path/utils-config while its sibling pulls findings → anonymize →
 * seats. Measured here: requiring `workspace/matrix-model.js` already loads
 * four first-party modules (v4.8 Phase 1 T1.2 moved renderMd's own
 * pricing/format-duration/degrade requires out to report-md.js, which this
 * path never reaches — report-md is required lazily from inside buildReport,
 * not at module load) and THIS file is one of them (it has imported SYMBOL
 * since v4.4, for the same single-source reason), so sharing costs ZERO new
 * require edges. Guarded by tests/council/seat-matrix.test.js's A3/B1 table.
 */
function isSeatSpace(seats) {
  return Array.isArray(seats) && seats.length > 0
    && seats.every(s => s && typeof s.id === 'string');
}

/** Build a neutral, render-agnostic model from a verdict (+ optional wave). */
function toModel(verdict, wave) {
  if (!verdict || !Array.isArray(verdict.findings)) {
    throw new Error('verdict.json must have a findings[] array');
  }
  const council = verdict.council || [];
  // 'council' (verdict.council / meta.models) is the street-cred universe and
  // legitimately includes 'claude' on a --claude-review run (buildTallyInput's
  // run-assemble.js:226, docs/council.md:326). 'judges' is the matrix column
  // set: SKILL.md:448 / run-stage2.js:61-62 guarantee Claude is judged but
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
  // v4.8 T-C1 (SI-12): REFUSE a key that identifies nothing. PR4c wrote
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
  // Named mutant, with its measured red set: tests/council/seat-matrix.test.js :: JUNKKEY.
  const columnFor = (adj) => {
    const key = (seatSpace && adj.seat) || adj.judge;
    return (typeof key === 'string' && key !== '' && columns.has(key)) ? key : UNATTRIBUTED;
  };
  // ⚠️ TWO-PHASE, and it cannot be one: the roster is what CLASSIFIES a vote,
  // and whether any vote was refused is what decides the roster. Phase 1 is the
  // bench roster plus this pre-pass over every finding; phase 2 is the map
  // below, which seeds `byJudge` from the FINAL roster. Deciding inside that map
  // would seed the column onto some findings and not others.
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
  const folded = verdict.findings.some(f => (f.adjudications || []).some(a => columnFor(a) === UNATTRIBUTED));
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
    for (const adj of (f.adjudications || [])) { byJudge[columnFor(adj)] = adj.verdict; }
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
  const runStats = verdict.runStats || [];
  // Cost-row role tag (Plan 2 final review F1, extended v4.7 D6): #83 gave
  // judges their own runStats row, so a bench model can now appear twice
  // (seat + judge), indistinguishable by `model` alone. v4.7's row-per-launch
  // producers (chair-attempt/repair/superseded) create the exact same
  // collision for their model. Tag ONLY these four roles — old verdicts have
  // none of them, so chair/critic/lens/seat rows stay byte-identical to their
  // historical rendering (report.test.js:189-199 pins the judge case exactly).
  // Object.create(null): a plain `{...}` literal inherits Object.prototype, so a role
  // literally named 'constructor'/'toString'/etc would resolve to an inherited (truthy)
  // function via bracket lookup instead of `undefined` — silently corrupting that row's
  // rendered model label. A null-prototype object has no inherited keys to collide with.
  const ROLE_SUFFIX = Object.create(null);
  ROLE_SUFFIX.judge = 'judge';
  ROLE_SUFFIX['chair-attempt'] = 'chair-attempt';
  ROLE_SUFFIX.repair = 'repair';
  ROLE_SUFFIX.superseded = 'superseded';
  // v4.8 PR5a T5: name the row by its SEAT when it has one. On a twin bench the four
  // seat/judge rows were previously indistinguishable. Depends on T4 — with T5 alone only
  // the two seat rows separate, because judge rows carried no seat until then.
  // ⚠️ Only seat and judge rows carry one: repair, superseded and debate rows still
  // collapse on a twin, and the chair row is not a bench seat at all. Disclosed, not fixed.
  const costRows = runStats.map(r => ({
    model: ROLE_SUFFIX[r.role] ? `${r.seat || r.model} (${ROLE_SUFFIX[r.role]})` : (r.seat || r.model),
    status: r.status, durationMs: r.durationMs,
    cost: r.usage && r.usage.cost ? r.usage.cost : null,
  }));
  const total = (wave && wave.usage && wave.usage.cost) ? wave.usage.cost : sumWaveUsage(runStats).cost;
  return {
    header: {
      runType: verdict.runType || 'review', runId: verdict.runId, date: verdict.date,
      chair: verdict.chair, council, claudeInCouncil: verdict.claudeInCouncil === true,
    },
    tierCounts: verdict.tierCounts || { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 },
    judges, findings, debate,
    streetCred: verdict.streetCred || [],
    // v4.6 Plan 2: additive and OPTIONAL on the verdict (verdict.js only sets
    // it when the run actually degraded), so a clean verdict's model — and
    // therefore its rendered report — is byte-for-byte unchanged.
    // Plan 2 final review F2: LOSSES ONLY — a heal is announced on stderr/run.json but
    // is not a loss (spec D4, §8), so it must never render under "What was
    // lost". deriveSeatLoss (verdict.js) applies the same kind !== 'heal' filter.
    degrades: (verdict.degrades || []).filter(d => d.kind !== 'heal'),
    cost: { rows: costRows, total },
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
