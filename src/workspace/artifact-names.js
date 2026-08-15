/**
 * Council Workspace — artifact NAME derivation (v4.8 PR5a).
 *
 * Split out of artifact-guard.js on the natural seam: this module decides WHICH names a
 * run dir may legitimately hold and who owns each one; artifact-guard.js keeps the two
 * read fences (allowlist membership, realpath containment). The guard grew past the
 * 300-line gate when the seat-space rebuild landed, and the two halves have no shared
 * state beyond the constants re-exported below.
 */
'use strict';

const { sanitizeName } = require('../council/run-launch');
// ⚠️ v4.8 PR5b: the seat-space PREDICATES moved to ./seat-space (this file was at 300/300,
// having itself been split out of artifact-guard.js for that same gate). Imported back, and
// isSeatTable is re-exported below, so every caller and test keeps its existing import path.
const { isSeatTable, orphanExonerations } = require('./seat-space');

// ⚠️ v4.8 PR5a T1b: `review-claude.md` is NOT an engine artifact — the second-opinion skill
// authors it as an INPUT and --out-dir places it in the run dir (v4.1 design §:156). It sat
// unreadable in five real run dirs on the author's machine, so "How Claude's review fared" was
// permanently unopenable in the Workspace. It is a FIXED name rather than a gated one because
// run.json carries no claude marker at all: `claudeInCouncil` is set only on tally/verdict meta
// (run-assemble.js:178) and `claudeReviewFile` never leaves the in-memory options object —
// run-state.js:129 writes a fixed four-key `options` projection. An unconditional entry is
// honest here: the presence manifest already reports four fixed names as absent on a normal run.
const FIXED_ARTIFACTS = Object.freeze(['briefing-stage1.md', 'bundle-stage2.md', 'chair-packet.md', 'chair-output.md', 'tally-input.json', 'review-claude.md']);
// ⚠️ DE-ROT (F28): v4.1's debate stage writes five MORE run-dir artifact kinds the original
// allowlist never named, so the Workspace hard-refused every `--debate` output with
// `artifact not allowed: <name>`. Writers (re-derived v4.8 PR3 — Task 1 moved runRevoteWave):
// tally-provisional.json = src/council/run-debate-stage.js:45; revote-bundle.md =
// run-debate-revote.js:81; debate.json = run-debate.js:221-222; the rebuttal-/revote- pair =
// materializeDebate (run-launch.js:230-240).
// ⚠️ FIVE KINDS, THREE ENTRIES — that is not a miscount (v4.4.1 DOC-7, re-verified). This const
// holds only the three RUN-LEVEL names; the last two of the five, the rebuttal-/revote- pair, are
// appended inside artifactAllowlist below, next to review-/judge-.
const DEBATE_ARTIFACTS = Object.freeze(['tally-provisional.json', 'revote-bundle.md', 'debate.json']);

/**
 * @param {object} run parsed run.json (may be partial)
 * @returns {string[]} the allowlist. When two or more DISTINCT bench entries sanitize to the
 *   same artifact name, a non-enumerable-in-spirit (but plain, test-visible) `collisions`
 *   array is attached: `[{sanitized, models: [rawA, rawB, ...]}, ...]`. See the R4
 *   council-review note below for why this is surfaced rather than silently deduped.
 */
function artifactAllowlist(run) {
  const names = [...FIXED_ARTIFACTS];
  const bench = run && Array.isArray(run.bench) ? run.bench : [];
  // ⚠️ DE-ROT (F28): run.json carries a `debate` key ONLY on --debate runs, and it is seeded
  // on the FIRST write (initCouncilRun, src/council/run-state.js:100-103), so this gate is safe
  // and keeps the allowlist tight for the common case.
  const debated = !!(run && run.debate);
  if (debated) { names.push(...DEBATE_ARTIFACTS); }

  // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): sanitizeName is NOT
  // injective — it maps every character outside [a-zA-Z0-9._-] to '-', so two DISTINCT bench
  // entries ('vendor/a', 'vendor?a') both produce 'vendor-a'. Both models would then request
  // the SAME artifact file, and the renderer's `[data-artifact="..."]` lookup (drillIntoJudge)
  // hands back whichever section matches first — prose silently misattributed to the wrong
  // model. That is a run-integrity defect (this run directory genuinely cannot hold both
  // models' review/judge files under distinct names), not a display quirk, so it must be
  // DETECTED and surfaced, never smoothed away by deduping the resulting name list.
  //
  // ⚠️ v4.8 PR5a (R5-13) INVERTS THE INTENT STATED HERE THROUGH v4.7. A bench with repeated
  // identical entries no longer "collapses to one set of rows": since PR3 each such entry is a
  // distinct SEAT and the engine writes a distinct file per seat (seats.js artifactName), so
  // collapsing them is exactly what made both twins' reviews unreadable. What survives from the
  // old intent is the RN-1 machinery below — two DISTINCT raw entries that coincide after
  // sanitizeName is still a genuine run-integrity defect and is still surfaced, never deduped.
  //
  // The entity list is therefore the SEAT ids when run.json carries a usable seat table, and the
  // unique raw bench values otherwise. On a bench with no repeated alias the two are the same
  // list in the same order (seat id === alias, spec §4.2), so the output is byte-identical.
  const entities = isSeatTable(run && run.seats)
    ? [...new Set(run.seats.map(s => s.id))]
    : [...new Set(bench)];
  const rawBySanitized = new Map(); // sanitized name -> first raw model seen for it
  const collisionModels = new Map(); // sanitized name -> Set(raw models) once >1 raw maps to it
  for (const m of entities) {
    const s = sanitizeName(m);
    if (rawBySanitized.has(s)) {
      if (!collisionModels.has(s)) { collisionModels.set(s, new Set([rawBySanitized.get(s)])); }
      collisionModels.get(s).add(m);
    } else {
      rawBySanitized.set(s, m);
    }
  }

  // ⚠️ Task 18 (RN-1): the collision above is a real run-integrity defect — the run directory
  // physically holds ONE file where two models' artifacts should be, and no renderer trick can
  // recover both. What the renderer CAN stop doing is showing model A's prose under model B's
  // name. Deterministic disambiguation: per colliding sanitized name, sort the RAW models
  // (sorting, not insertion order, is what keeps this reproducible across processes/runs); the
  // first (sorted) keeps the bare sanitized name, the rest get `~2`, `~3`, ... The suffixed
  // names deliberately do not exist on disk — the presence manifest (run-detail.js, via
  // fs.statSync over this same allowlist) marks them absent, so the renderer shows the honest
  // "not written yet" empty state for every model but the first, instead of cross-matching.
  const nameFor = new Map(); // raw model -> its (possibly suffixed) sanitized name
  for (const m of entities) {
    let s = sanitizeName(m);
    const collision = collisionModels.get(s);
    if (collision) {
      const sortedRaw = [...collision].sort();
      const index = sortedRaw.indexOf(m);
      if (index > 0) { s = `${s}~${index + 1}`; }
    }
    nameFor.set(m, s);
  }

  // primary name -> the ALIAS of the entity that owns it (its own alias in the legacy
  // branch). Used below to tell "an orphan's file IS this seat's own primary" (harmless,
  // same alias) from "an orphan's file collides with ANOTHER seat's primary" (ambiguous).
  const aliasOfEntity = new Map(
    isSeatTable(run && run.seats) ? run.seats.map(s => [s.id, s.alias]) : bench.map(m => [m, m]),
  );
  const ownerOf = new Map();
  for (const m of entities) {
    const s = nameFor.get(m);
    for (const k of ['review', 'judge', 'rebuttal', 'revote']) {
      ownerOf.set(`${k}-${s}.md`, { entity: m, alias: aliasOfEntity.get(m), stem: s });
    }
    names.push(`review-${s}.md`);
    names.push(`judge-${s}.md`);
    // rebuttal-/revote- ride the SAME entity stem as review-/judge-, so DISTINCT aliases
    // colliding after sanitizeName are disambiguated identically. (The PR3 warning that sat
    // here — "no longer matches what the engine WRITES on a bench that repeats an alias" —
    // described the alias-space loop this rebuild replaced. `s` now derives from the seat id,
    // exactly what materializeDebate's artifactName(seat, prefix) uses, seats.js:165.)
    if (debated) {
      names.push(`rebuttal-${s}.md`);
      names.push(`revote-${s}.md`);
    }
  }
  // v4.8 PR5a (R5-13): names an ORPHANED leg wrote under its alias. Emitted AFTER every
  // primary so the Set below keeps first-occurrence order, which is what preserves
  // byte-identity on every bench that orphaned nothing (the overwhelming majority).
  // Listed so a review that LANDED stays readable (stage1-bind.js:35); never attributed,
  // because bindSeats could not name that leg and guessing is the mis-attribution §4.4 forbids.
  const orphanContested = new Set();   // artifact names attributed to NOBODY (council-3 B4)
  const orphanByStem = new Map();      // sanitized stem -> Set(claimants), deduped for the banner
  // Both loops below default to NOT ASSERTING, in the direction that fails safe for each:
  // LISTING a name nobody wrote costs nothing (the presence manifest marks it absent) while
  // omitting one that exists makes it permanently unreadable, so `orphanKinds` stays wide.
  // CONTESTING is likewise the safe default — an unattributed file is still listed and still
  // bannered, while a wrong attribution serves one seat's prose under another's name. So a
  // kind is contested unless the note PROVES the orphan did not write it (orphanExonerations).
  const orphanKinds = debated ? ['review', 'judge', 'rebuttal', 'revote'] : ['review', 'judge'];
  for (const [alias, exonerated] of orphanExonerations(run)) {
    const stem = sanitizeName(alias);
    for (const kind of orphanKinds) {
      const n = `${kind}-${stem}.md`;
      const owner = ownerOf.get(n);
      // Its own seat's primary — same alias, so nothing is ambiguous.
      if (owner && owner.alias === alias) { continue; }
      if (owner) {
        // ANOTHER entity's primary. Attribution survives ONLY on a positive proof of
        // non-authorship; otherwise the file may be either seat's and is contested.
        if (exonerated.has(kind)) { continue; }
        // The file is one or the other and run.json cannot say which, so it stays listed
        // (the owner's push did that), is attributed to NOBODY, and is surfaced ONCE per
        // stem — the kinds share a stem, and emitting per kind double-counts.
        orphanContested.add(n);
        if (!orphanByStem.has(stem)) { orphanByStem.set(stem, new Set()); }
        orphanByStem.get(stem).add(owner.entity).add(alias);
      } else {
        names.push(n);
      }
    }
  }
  const list = [...new Set(names)];
  if (collisionModels.size || orphanByStem.size) {
    list.collisions = [
      ...[...collisionModels.entries()].map(([sanitized, models]) => ({
        sanitized, models: [...models],
      })),
      // `models` names BOTH claimants of the stem, which is what the banner has to say:
      // the owning ENTITY (a seat id in seat space — `a#1`, since `a`'s alias never wrote
      // `review-a-1.md`) AND the orphan's own ALIAS (`a-1`), the string its writer used.
      // The orphan half is deliberately not projected into entity space: no seat id names
      // it — being unattributable to a seat is what made it an orphan.
      ...[...orphanByStem.entries()].map(([sanitized, who]) => ({
        sanitized, models: [...who], orphan: true,
      })),
    ];
  }
  // Consumed by workspace-panels.js (wireLazyPanels' file lists + drillIntoJudge's artifact
  // lookup), which prefers this map over re-deriving names via sanitizeName(model) directly —
  // that re-derivation is exactly what would ignore the suffixing above and misattribute prose.
  // ⚠️ Fix-wave (review finding 1) residual limit this map cannot close: the BARE (unsuffixed)
  // name is still exactly ONE physical file on disk, and its actual bytes belong to whichever
  // colliding model's writer ran LAST — no map can recover which one that was. The guarantee
  // delivered here is narrower than "attribution is fully sound": at most the sorted-first
  // model can still be misattributed under the bare name; artifactCollisions (the run-integrity
  // banner rendered by workspace-app.js's renderBanners) is what covers that residual case.
  // v4.8 PR5a: keyed by SEAT ID when the run is in seat space (the map and its consumers
  // move together — RULE OF ONE SPACE). A kind whose name an orphan also claims is
  // dropped from the map rather than attributed: the entry would name a file that may
  // hold the other seat's prose, which is the RN-1 defect this whole block exists to kill.
  list.artifactsByModel = Object.fromEntries(
    [...nameFor].map(([m, s]) => {
      const row = {};
      for (const k of ['review', 'judge', 'rebuttal', 'revote']) {
        const n = `${k}-${s}.md`;
        if (!orphanContested.has(n)) { row[k] = n; }
      }
      return [m, row];
    }),
  );
  return list;
}

// `orphanNames` is deliberately gone (council-2 B1): revision 1 left it as a thin wrapper
// with zero callers once artifactAllowlist moved to orphanExonerations. An export nothing
// imports is a second spelling waiting to drift from the one that runs.
// ⚠️ v4.8 PR5b: `isSeatTable` and `orphanExonerations` are RE-EXPORTS of ./seat-space, not
// definitions — the same courtesy artifact-guard.js does for this file. Kept so the split is
// invisible to every caller (run-detail.js reaches them through artifact-guard; four test
// files import from one layer or the other), and pinned by an identity assertion in
// tests/workspace/seat-space.test.js so no layer can ever grow its own copy.
module.exports = {
  artifactAllowlist, isSeatTable, orphanExonerations, FIXED_ARTIFACTS, DEBATE_ARTIFACTS,
};

