/**
 * Council Workspace — the seat-space PREDICATES (v4.8 PR5b).
 *
 * Extracted from artifact-names.js, which was at 300/300 with zero headroom — and which was
 * itself split out of artifact-guard.js for the same gate one rev earlier. Comment prose was
 * shaved three times during PR5a's fix waves to land defect fixes inside the limit; that was
 * the signal this seam was overdue, not that the comments were too long.
 *
 * Split line: this module answers two QUESTIONS ABOUT A RUN — "is this seat table usable?"
 * and "what has an orphan note proven?" — from run.json fields alone (`seats`, `degrades`,
 * `runId`). It derives no names and knows nothing about artifacts. artifact-names.js keeps
 * every NAME decision and imports both answers.
 *
 * ⚠️ Pure and total: no I/O, no fs, no throw path. Both functions take a schema-free
 * `JSON.parse` of run.json and must tolerate any shape, which is why the conjuncts below are
 * spelled out rather than assumed.
 *
 * ⚠️ The workspace -> council import lives here now (isSeatSpace, src/council/report.js).
 * That direction is deliberate and predates this split: ONE seat-space predicate for the
 * whole tree, never re-spelled — it is defined and exported at
 * src/council/report.js :: isSeatSpace, and
 * src/workspace/matrix-model.js:25 already imports it the same way. Council-4's B3 called the
 * layering an inversion; it is not fixed here, and moving it OUT of the security-critical
 * name-derivation file is a side effect of this split, not a response to that finding.
 */
'use strict';

const { isSeatSpace } = require('../council/report');

/**
 * Is `seats` a seat table this guard may trust?
 *
 * `isSeatSpace` (shared, src/council/report.js) was written for `verdict.seats`, a
 * producer-controlled document. This function reads a schema-free `JSON.parse` of
 * run.json, so it adds three conjuncts `isSeatSpace` has no reason to carry:
 *   - non-empty ids — `{id:''}` otherwise emits `review-.md` and a `""` map key;
 *   - unique ids — the alias path's `new Set` used to guarantee this, and without it
 *     duplicate ids mint a one-element "collision" whose `join(' and ')` renders
 *     malformed English AND suppresses the real run.error banner (workspace-app.js
 *     returns after the collision branch);
 *   - STRING aliases (council-2 C3) — `isSeatSpace` checks only `id`, so `[{id:'a#1'}]` passed
 *     and put the RENDERER in seat space, where roster() resolves `labelByModel[s.alias]` ->
 *     undefined and AmicusRender.display() falls through to `pair.model`, printing the seat id
 *     `a#1` with blind mode ON — which defeats blind mode, a seat id containing its alias. The
 *     renderer now trusts this predicate wholesale (council-1 B1), so a conjunct the ALIAS
 *     path depends on belongs in it.
 * Fails WHOLE: one malformed id sends the run back to the alias branch. Fail-safe but
 * silent, and only reachable from a hand-edited run.json — parseList trims and filters,
 * and the MCP path re-joins through the same code.
 */
function isSeatTable(seats) {
  if (!isSeatSpace(seats)) { return false; }
  const ids = seats.map(s => s.id);
  return ids.every(id => id !== '') && new Set(ids).size === ids.length
    && seats.every(s => typeof s.alias === 'string' && s.alias !== '');
}

/**
 * The alias names an ORPHANED leg wrote, taken from run.json's own degrade notes.
 *
 * The engine names an artifact from the seat when a leg binds and from the leg's
 * `modelInput || model` when it does not (run-launch.js :: materializeReviews).
 * Only the second case puts
 * an alias-named file on disk, and `run-degrade.js` records exactly that case: channel
 * 'seat-unbound' with `data.legId` set. `data.seat` on such a note IS the string the writer
 * used, so the name derived here matches the file byte-for-byte — including where the leg
 * reported no modelInput and the writer fell back to the resolved model id, which no
 * seat.alias could have reproduced. Gating fallbacks on the NOTE, rather than emitting one
 * per seat alias, is what keeps a healthy run (twin, --debate, or with a merely-dead seat)
 * from claiming names nobody wrote and raising a run-integrity banner for it.
 *
 * ⚠️ Fix-wave revision 2 (council-1 B2, then council-2 A1/C1 which refuted revision 1).
 * Contesting DROPS the owning seat's attribution, so the question is never "can the orphan
 * own this kind?" — absence of evidence is not evidence, and reading it that way handed a
 * bound seat a `rebuttal-` an orphan may have written, re-arming RN-1 in the debate
 * namespace (MEASURED; the one regression this fix wave introduced). The question is:
 * does the note POSITIVELY PROVE the orphan did NOT write this kind? Exactly one such
 * proof exists. `orphanLegNote` has three call sites — run-stages.js:71 and :140 (Stage-1
 * and its retry) and run-stage2.js :: bindStage2Seats (the -s2 judge wave) — and
 * `data.waveId` separates them EXACTLY, not heuristically: run-stage2.js :: bindStage2Seats
 * and the launch site in run-stage2.js :: runStage2 both build it as `${runId}-s2` from
 * the runId this run.json carries. A -s2 note says the leg BOUND in Stage 1, so its review
 * landed under a SEAT name: `review-<alias>.md` is provably not its. Nothing else is
 * provable, and the near misses are why:
 *   - a Stage-1 note exonerates NOTHING, not even judge-: that orphan is re-admitted to
 *     Stage 2 under a PLACEHOLDER seat that stage1-bind.js :: bindPaddedWave pads in and
 *     drops from `judgeSeatOf` (called from run-stage2.js :: bindStage2Seats since the
 *     v4.9 W2 split), so its judge leg takes the alias branch too — and emits no -s2 note,
 *     because it BOUND. Measured: run-stages.test.js :: "M2: the placeholder never becomes…".
 *   - rebuttal-/revote- are never exonerated: a debate leg whose raiser/judge key names no
 *     seat takes materializeDebate's alias branch (run-debate.js :: runDefenseWave;
 *     run-debate-revote.js :: runRevoteWave, `seat = seatOf.get(leg) || null`). A rebuttal
 *     leg's unbound raiser still has no note recording it. A revote leg's unbound judge
 *     SOMETIMES gets one, since v4.8 T5.1 (channel `seat-unbound`, run-debate-revote.js's
 *     reVoteUnboundNote). ⚠️ SOMETIMES, not always — this read "DOES" until the
 *     whole-branch fix wave, and that was FALSE. The bullet's subject is EVERY debate leg
 *     with `seat === null`, and that set is STRICTLY LARGER than the set that gets a note.
 *     Two shapes land here SILENTLY — measured through the real runRevoteWave, not
 *     reasoned: a leg bound to a §3.4 PLACEHOLDER, and a leg bound to nothing whose
 *     bare-alias key IS one of the `judgeKeys` this wave launched. runRevoteWave publishes
 *     BOTH and notes neither, while
 *     `seatOf` still filters the placeholder back out — so `seat` is null in all three
 *     shapes and a note exists for exactly one of them.
 *     ⚠️ The PREDICATE that publishes both is `judgeKeys.includes(key)` ALONE. This read
 *     `boundLegs.has(leg) || judgeKeys.includes(key)` until v4.8 T5.5 deleted the first
 *     arm; the §3.4 placeholder shape survives that deletion on the SECOND arm, because a
 *     roster hole's own bare alias IS one of the judgeKeys — so both shapes above still
 *     land here, and this bullet is unchanged in substance. What no longer lands silently
 *     is a placeholder-bound leg carrying a FOREIGN alias: it is now refused and noted
 *     (run-debate.test.js's "T5.5: a taskId-bound leg carrying a FOREIGN alias is
 *     REFUSED" block), so the silent set shrank by exactly that shape. Pinned by run-debate.test.js's
 *     test named "roster hole whose leg is ALSO unbindable: the key IS published and the
 *     re-vote still applies", whose `ctx.degrade.all()` is `[]`; the placeholder shape is
 *     pinned for its seat (`['gpt', null]`) by that file's "§3.4 placeholder contract at
 *     the -rv call site" block, which asserts nothing about notes either way.
 *     ⚠️ The CONCLUSION is identical in all three shapes, which is why this bullet still
 *     holds: even when the note IS emitted, its `data` deliberately omits `seat`, carrying
 *     only `judge`/`key`, so this function's own `const alias = d.data.seat;` read (below)
 *     still finds nothing and this leg stays un-exonerated, the same net effect as before
 *     (reVoteUnboundNote's own docblock states why `seat` is withheld on purpose).
 *   - an unmatchable waveId exonerates nothing.
 * @returns {Map<string, Set<string>>} orphan alias -> the kinds it provably did NOT write,
 *   in first-occurrence order (what keeps the emitted name list byte-identical).
 */
const S2_EXONERATES = Object.freeze(['review']);
function orphanExonerations(run) {
  const degrades = run && Array.isArray(run.degrades) ? run.degrades : [];
  const s2WaveId = run && typeof run.runId === 'string' ? `${run.runId}-s2` : null;
  const byAlias = new Map();
  for (const d of degrades) {
    if (!d || d.channel !== 'seat-unbound' || !d.data || !d.data.legId) { continue; }
    const alias = d.data.seat;
    if (typeof alias !== 'string' || alias === '') { continue; }
    // ⚠️ `has`, not `||` (council-3 B1): an empty Set is TRUTHY, so `||` worked — a cleared
    // set stayed cleared — but read as default-when-missing. A `.size` check re-opens the union.
    const proven = byAlias.has(alias) ? byAlias.get(alias) : new Set(S2_EXONERATES);
    // INTERSECTION across an alias's notes, never union: two notes for one alias means two
    // orphaned legs, and a Stage-1 one proves nothing about the review the -s2 one exonerates.
    if (!(s2WaveId && d.data.waveId === s2WaveId)) { proven.clear(); }
    byAlias.set(alias, proven);
  }
  return byAlias;
}

module.exports = { isSeatTable, orphanExonerations };
