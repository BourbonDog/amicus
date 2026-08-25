# v4.9.0 — recon, rulings, and phasing (2026-08-25)

**Measured against `main` = `102302d4`** (chore(release): v4.8.1), clean, zero open PRs.
Suite baseline **556 suites / 8121 passed / 8 skipped / 0 failed** (~211 s); size gate, lint,
docs gates all exit 0. Three gated files sit at exactly 300/300: `src/council/run-retry.js`,
`src/pack/pack-resolve.js`, `src/sidecar/electron-install.js`.

This is a **scoping memo, not an implementation plan.** Plans are written just-in-time, one per
wave, immediately before that wave is built. Every claim below was established by execution — a
grep, an opened file, a run command, or a vm-evaluated probe — by a 10-agent recon workflow
whose two load-bearing outputs (the task-mode surface map and the carried-item dispositions)
were each independently re-measured by an adversarial refuter. The refuters confirmed 37/37 map
entries and 12/12 dispositions, found 3 missed dispatch sites, and refuted 3 commit hashes
(pre-squash branch commits recorded in BACKLOG as the shipping commit — see Traps).

**Ruling authority note:** the owner (Christian) instructed "Ship v4.9.0" and is not in the
loop mid-flight. Rulings V1–V18 below are release-engineer rulings made under that mandate,
each with its reasoning stated so the owner can audit or reverse them post-hoc. None reverses
a standing owner ruling; where a v4.8 owner ruling covers the question (R10, R11, R12-of-4.8
spec, W1-4), it is carried, not re-decided.

---

## 0. The headline

> **v4.9.0 ships task mode (#134 + #130 + #146) on the seat-identity substrate v4.8.0 built,
> plus the Workspace dead-seat surface (SI-02, R4, PR5b-1) and the carried repairs.**

Theme: **"The council does new work"** (sentence-case, the `##`-minor convention).

The design is the ruled Workstream B of
`docs/superpowers/specs/2026-08-10-v4.8-ask-anything-count-everyone-design.md` (§5, §6, §7.4)
— that design survives intact; what rotted was its §5.7 surface map ("the nine dispatch
sites") and every line count. Both are re-derived below.

## 1. The task-mode surface map — re-derived, refuted, converged

The spec's nine sites re-anchor to the current tree with three moves (v4.8's PR0/T-A2 splits):
retry re-briefing is now `run-retry-launch.js :: briefingFor`; the ledger gate is now
`run-finish.js :: finishRun`; the unconditional `VERDICT_SCALE_ADDENDUM` append is now
`briefings-chair.js:231`. The full converged map is **~40 sites**; the enumeration with
evidence lives in the recon record. The classes, by fork kind:

- **Frame text:** `briefings.js` (seat/critic/lens roles, `FINDINGS_TWO_PART_FRAMING`),
  `run-stage1-launch.js` (three dispatches), `run-retry-launch.js :: briefingFor` (three
  branches — a retried task seat is otherwise re-briefed as a reviewer), `run.js:138`
  (`briefing-stage1.md` audit write), `briefings-debate.js :: buildDefenseBrief` /
  `buildRevoteBundle` (sites 10/11).
- **Gloss:** `FINDINGS_JSON_SHAPE` + `buildFindingsRepairPrompt` (task twin needed or a repair
  silently replaces a task answer with review-schema JSON), the judge bundle strings in
  `briefings-stage2.js`, the chair repair prompt.
- **Parser:** `parse-stage2.js :: CHAIR_VERDICTS` / `parseChairVerdict` — and note the scale is
  hard-coded **twice** with no shared constant (`briefings-chair.js:20` is an independent
  copy). Fork both in lockstep or a healthy task run exits 2 via the traced chain
  (null verdict → paid ch4 → `unstructured` → `chair-failed` degrade).
- **Gate:** exactly **three** `appendRun` call sites (grep-confirmed):
  `run-finish.js:51-54`, `cli-handlers-council.js:39`, `mcp-server.js:1427`. The debate entry
  gate is `run-debate-stage.js:42`.
- **Packet:** `run.js :: mkInput` (:245-254 — the single seam `intent` enters `meta` through;
  the ONLY production `buildTallyInput` caller), `run-assemble.js :: buildChairPacketFile`,
  `briefings-chair.js :: buildChairPacket`.
- **Schema:** `mcp-tools.js` council_run inputSchema (no `intent` anywhere in src/ today —
  grep zero), and the tally `meta` z.object (declares `seats`, **not** `intent`; zod ^3 strips
  it silently — the same transport fork the seats declaration closed, one key later).
- **Missed by the spec, found by refutation:** (i) the built-in `review` template
  (`src/template/store.js:23-45`) enters review-frame prose through the template/pack channel;
  (ii) `anonymize.js:51`'s `Review <letter>` label mint (judge-bundle vocabulary + blind-mode
  exact-string consumer); (iii) the `--claude-review` channel (review N+1 with no task
  meaning). Ruled in §2.
- **Production constraint stronger than the spec stated:** `src/sidecar/list-search.js:14`
  hard-codes `--- MATERIAL / BRIEFING ---` and reads `briefing-stage1.md` post-separator —
  compose()'s separator protects production list/search, not just a test.
- **Existing mode-ish channel the spec never mentions:** `meta.runType` (hard-coded
  `'headless'` at `run-assemble.js:130`, per-row in the ledger, defaulted `|| 'review'` in the
  report header). Ruled in §2 (V8).

## 2. Rulings (release-engineer, 2026-08-25)

| # | Question | Ruling |
|---|---|---|
| V1 | Scope | Task mode ships **first-class** per R10-of-4.8: engine + CLI + MCP + docs + skill. Spec Workstream B as ruled (CUT 1: no vocabulary rename; CUT 2: no `location`→`support` swap; `findings.js` changes by zero lines; `intent` `.optional()` never `.default()`) |
| V2 | Task + debate | **Fork, not block.** The debate machinery (defend/amend/withdraw on claims, re-vote) is coherent over task claims — "does this claim hold" is exactly what a defense round tests. Blocking would make task mode second-class against R10. Sites 10/11 get task twins; parsers are frame-neutral (measured) and need no fork |
| V3 | Where the answer lands | **No new artifact.** The seat's deliverable is its prose (already durable in `review-<seat>.md`); the chair's synthesis is the run's answer and already lands in `chair-output.md` + verdict/report. `verdict.intent` is mandatory (spec §5.3); renderers fork headings on it |
| V4 | Chair scale (#146) | `ANSWER: Converged \| Split \| Insufficient` per spec §5.5, disjoint from `VERDICT:` by construction. `overallVerdict` widens to the six-value union (spec-verified safe: no runtime consumer compares it to a literal). Fork BOTH hard-coded constants in lockstep and pin them against each other with a drift test |
| V5 | Ledger | R11-of-4.8 carries: task runs write **zero** ledger rows, gated at all three `appendRun` sites. The no-street-cred limitation is **announced without degrading** — design the non-degrading note at plan time (`kind: 'heal'` is the existing non-degrading kind; a new kind is schema surface, prefer not) |
| V6 | Repair loop in task mode | **Same validator, same loop, forked gloss.** CUT 1/2 keep one schema in both modes, so `validateFindings` and the ≤2-repair loop apply unchanged; only the repair prompt's framing and the JSON-shape gloss fork. The repair-count contract applies in both modes |
| V7 | Stage-2 shape | **Keep adjudications.** Task Task-B adjudicates "does this claim hold" over the same findings shape; ranking axis reworded per spec §5.4; task bundle includes the briefing (judges can't rank answers without the question); review bundle stays brief-free |
| V8 | `intent` vs `runType` | `intent` is a **new** meta field beside `runType` (spec §6: one intent per run, on `meta`, never on the seat). `runType` untouched. `report.js`'s `\|\| 'review'` header default forks on `verdict.intent` in the renderer wave |
| V9 | Pack-settability | **Not pack-settable in v4.9** — carried stated limitation. `pack-resolve.js` is 300/300 and `intent` is a per-run property; `--intent` composes beside `--council <pack>`. No pack-resolve extraction is paid |
| V10 | Template channel | Template content below the separator is **user material, out of engine scope** — documented in the task-mode docs ("a review-framed template fights a task intent; don't combine them"). No engine gate; no built-in task template this rev (composition is parked per R2-of-4.8) |
| V11 | `Review <letter>` labels | **Keep in both modes** — one vocabulary, accepted cosmetic. The task judge bundle introduces the blocks as "the responses below (labelled Review A…N)". Forking the noun means a three-way lockstep (mint, contract example, blind-mode exact match) for zero measured gain |
| V12 | `--claude-review` in task mode | **Block pre-spend** with `BAD_ARGS` — a review-shaped input channel with no task meaning. Generalizing to a claude-answer file is future work, filed |
| V13 | `--critic` in task mode | **Fork the critic brief.** A designated skeptic is more valuable on generative work, not less; the four review passes become claim/assumption/edge/actionability passes over the asks in the brief |
| V14 | Degrade prose ("seat X did not review") | **Accepted cosmetic for v4.9, filed.** Rewording churns pinned degrade fixtures for wording only; nothing model-facing is affected |
| V15 | PR5b-1 authority | **Disclosure over uniformity.** Measured: `seatTableRejected` reads `run.json` only; tally rows are stamped from the in-memory roster and are truthful on a hand-edited run. The seats panel stays on tally; the existing banner discloses that the artifact panels dropped to alias space |
| V16 | Council B2 | **Option B1** — on `model_not_found` for an alias-sourced bare id, attach the existing `repairFabricatedAlias` hint to the route error (self-diagnose at the failure site). Revalidate-on-key-add (Option A) filed as follow-up. The offer-under-`unknown` stays deliberate |
| V17 | Council A4 | **Option 1** — single catalog snapshot across the two IPC handlers (`ipc-setup.js` save-key / set-provider-default), closing the TOCTOU structurally. `directFormIfProven` and its A4 pin stay byte-untouched |
| V18 | PR1F-3 design call | Write the literal `'unstructured'` at the two repair-loop pushes (`run-stages.js:222`, `run-stage2.js:178`) where `res.ok`/`parsed.ok` are provably false — explicit intent, zero behavior change, kills the drift hazard. The `\|\| 'clean'` default is NOT flipped (two primary error-row sites depend on it) |

## 3. Dispositions of every carried item (verified + refuted)

- **DROPPED, never-specified (T6.5/W1-3 precedent):** `#135 C4` (born in the phasing doc's
  deferral line, defined nowhere, no C-taxonomy in issue #135; C0 shipped via squash
  `919cb202`, and the real #135 remainder is C5 + the C2 probe per W1-4) and `#138 Piece 3`
  (exhaustive `git log --all -S` — three commits, none gives it content).
- **ALREADY-SHIPPED, struck from the carried list:** "the prune check" / sessions-index growth
  — shipped as `dda1b8cf` (squash of PR #187; BACKLOG's recorded hash `0a6a8032` is a dangling
  pre-squash commit, corrected in the hygiene wave).
- **OPEN, carried into waves below:** PR1F-2 unification (extraction prerequisite shipped
  `49fd7de8`; three residual builders: `run-debate-revote.js :: legRow`,
  `debate.js :: debateRunStatsRows :: mk`, `run-assemble.js :: claudeRunStatsRow`; byte-order
  pins required — existing pins are order-insensitive), PR1F-3 (V18), F-1 (19/105 MCP param
  keys undocumented, measured; per-key document-vs-allowlist decisions required), F-5
  (routing.tier docs — home: `docs/configuration.md` Routing section), KNOWN_VARIABLES
  (`render.js:17` vs `:49` — plus a THIRD enumeration at `:78-84` the filing never counted),
  CLI `list` merge (decisions: each surface owns its truncation width — CLI re-truncates to
  its 30; MODEL cell renders `council (<stage>)` mirroring `wave (N legs)`), W1-M4
  (`mcp-server.js:669`, zero anchor rot; Task-7-shaped fix + repro drive), seatKey
  consolidation (Count 1 = 8 confirmed; Count 2 census STALE — grown by 2-5 sites since
  2026-08-21; re-census first), SI-16 splits (measured seams: `run-stage2.js:89-124` →
  `bindStage2Seats`; `run-debate.js:141-162` → `runDefenseWave`;
  `run-debate-revote.js:196-219` → `repairRevoteLeg`).
- **Workspace dead-seat surface — smaller than filed.** BACKLOG's five-arm table rotted: seat
  identity is now available on **four of five** emitter arms (PR5c shipped `data.seatId` on
  `srcLegStillDeadNote` and `data.seats[]` on the dead-wave arm). Producer work is ~one line
  (the seat-unbound partial arm; the seat OBJECT is already on the record at
  `stage1-bind.js:77`). The real work is consumer-side: admit `seat-unbound` **with a
  retry-family gate** (the channel is shared with orphan-leg notes and `reVoteUnboundNote` —
  never admit it raw) in `verdict.js :: deriveSeatLoss` + both renderer filters **in one
  commit** (the restored-mirror constraint, `workspace-seats.js:49-59`); R4 via
  `runMeta.criticSeat` (no new emission — `run.json` already checkpoints it); the SI-22.4
  rider is a one-liner (`s.seat || s.model` in `workspace-matrix.js:148-149`) with an explicit
  blind-mode decision (a raw seat id contains its alias — render the label when blind).
  Also: `dead-seat-twins.test.js` T6's header comment rotted (R5 shipped; the live payload
  now carries seat identity) — re-derive T6's status and close BACKLOG's unchecked R5 entry.
- **#133 Pieces 2-3 — design measured.** Piece 2: the single-file `opencode.log` premise is
  STALE — the current engine writes per-process timestamped logs; resolve the log dir
  XDG-first (the `auth-json.js` precedent), pick newest by mtime across BOTH schemes,
  correlate by `ses_<id>` substring (works in both formats), filter ERROR, quote `error=`;
  enrich at the backstop firing sites (`headless.js:597/:877` where `sessionId` is in scope),
  **appending after the `NO_OUTPUT_BACKSTOP:` prefix** (`models-probe.js:42` classifies on
  it); clean fallback = today's string unchanged. Piece 3: capture `result.data.version` in
  `createSession` (the SDK's `Session.version` — currently discarded) and compare against the
  running install's own engine version (`readEngineVersion`) — no global baseline needed
  (the doctor check's global baseline is structurally silent on this very machine).
  `headless.js:167`'s stale single-file path comment: sweep the literal when touching.
- **MAX_CATALOG_AGE_MS:** shared import beats a drift test — export `DEFAULT_MAX_AGE_MS` from
  `model-catalog.js` (currently a third unexported twin) and import it in both doctor files;
  the documented require cycle is doctor↔alias-check only, both-import-model-catalog is
  acyclic (measured).
- **mcp-headless-e2e:** the 4.8.1 live-tier failures are **live-LLM flake** (fresh tmpdir per
  run, afterAll closes on all paths, no state survives); the standing "Jest did not exit"
  warning is a **real, deterministic timer leak** in the copied `createMcpClient` helper —
  `request()`'s 10 s timeout never cleared on resolve, `close()`'s 3 s SIGKILL timer never
  cleared — in THREE suites (`mcp-headless-e2e`, `mcp-protocol`, `shared-server-e2e`;
  measured: six open handles via the keyless rail). Fix all three; also abort a still-running
  task in `afterAll` on failure paths (bounded real-money leak), and fix the stale
  `--forceExit` comment (the live rail has no `--forceExit`).
- **kimi/qwen pin — NOT implicated; do not repin, do not drop from the bench.** The 4.8.1
  failures are a CI-side provider-stall class (NO_OUTPUT_BACKSTOP: session opens, assistant
  message exists, zero tokens in 300 s), on BOTH kimi pins, with glm hitting the identical
  first-attempt error in 3 of 5 runs and surviving only via its single retry. Highest-leverage
  fix is workflow-side backstop headroom (this rev: `AMICUS_NO_OUTPUT_BACKSTOP_MS` in
  council-review.yml) + a filed issue for retry policy (second retry / staggered launch).
  Corrections to the working premise: FIVE councils in the window; qwen hard-failed twice;
  \#196's verdict ran on a 2-of-4 bench. Also: the curated CARDLESS pins (kimi→k2.6,
  qwen→qwen3.7-max) are one generation behind both the owner's machine and CI — refresh them.
- **The `models` two-spellings trap is already triple-pinned** —
  `tests/scripts/council-review-workflow.test.js` derives and compares both spellings (the
  cb7c90fd incident is the PARENT the fail_on test was cloned from). No work.
- **site-src `sk-or-` "key":** measured 9 characters (`sk-or-v1-` + mask glyphs) — a
  decorative mock, not a credential. Nothing to rotate. No 20+-char key-like string exists
  anywhere in site-src/.
- **Small repairs carried in:** second-opinion Stage-4 gloss headings (2 lines + runtime-copy
  sync + past-tense ticks), `fmtProbeLine` "(accepted but not serving)" (1 line + pin +
  `docs/usage.md:406` co-edit — the doc quotes the runtime string verbatim), setup-ui
  `defaultAliasesJson` far-side null-prototype seed (1 line + vm-eval pin — measured RED at
  HEAD).

## 4. Explicitly NOT in v4.9.0

- **#130's divergence heuristic detector** (location-population classifier, per-population
  tiers, Singleton-cause split). Task mode + Stage-2 conformance + the concurrence qualifier
  close the root cause for declared runs; the undeclared case needs the calibration the
  BACKLOG itself warns about. Filed as follow-up; #130 closes with task mode per R4-of-4.8.
- **#136** — needs its design session (unchanged from v4.8).
- **Mixed-mode bench** (spec §6), **pack-settable intent** (V9), **#135 C2 full derivation**
  (the probe ships; derivation waits for probe data per R12-of-4.8), **composition/F6**.

## 5. The wave train

Order chosen so restructures land before the semantic work that would collide with them, and
the headline chain starts as early as possible. One JIT plan per wave, committed on-branch.

```
W0  kickoff: this memo + BACKLOG hygiene (doc-only)            [this branch]
W1  small-repairs batch: gloss headings, fmtProbeLine+usage,
    setup-ui seed, MAX_CATALOG_AGE_MS import, PR1F-3 literal,
    KNOWN_VARIABLES, test timer leaks, B2 hint, A4 snapshot    [no semantic collisions]
W2  SI-16 splits (restructure, own PR)                          [before task-mode Stage-2 work]
W3  seatKey consolidation (re-census first; own PR)             [before task-mode joins]
W4  task-mode prerequisite extractions (run-chair 294/300,
    report.js 296/300; run-stages measured at plan time)        [zero behavior]
W5  intent plumbing: --intent, MCP schema (council_run + tally
    meta), run.json/meta/verdict intent, three ledger gates,
    non-degrading announcement, --claude-review block (V12)     [needs W4]
W6  Stage-1 task frames + glosses: briefings.js twins (seat/
    critic/lens/two-part/JSON-shape/repair), launch + retry
    dispatch, briefing-stage1.md write                          [needs W5]
W7  Stage-2 + chair + debate: task judge bundle, chair packet/
    scale/parser/repair (ANSWER line), debate brief twins       [needs W6]
W8  task renderers: concurrence qualifier, report headings,
    fold/workspace verify, COUNCIL_INTENT_MISMATCH guards       [needs W7]
W9  Workspace dead-seat surface (SI-02 + R4 + PR5b-1 + SI-22.4
    rider + T6 re-derivation)                                   [independent of W5-W8]
W10 #133 Pieces 2-3                                             [independent]
W11 PR1F-2 unification (own TDD pass, byte-order pins first)    [independent]
W12 F-1 + F-5 + CLI list merge + W1-M4                          [independent]
W13 #135 TTFT probe + C5 alias-shadow warning + curated
    kimi/qwen refresh + CI backstop headroom + retry-policy
    issue filing                                                [independent]
W14 docs + skill + ROADMAP (add the missing v4.8 record section
    AND the v4.9 section) + CHANGELOG + release prep + prune
    plans + release ritual (docs/publishing.md, all steps
    including 3b live tier)                                     [last]
```

Substantive waves (W5-W9 at minimum) go up as labelled PRs so the CI council reviews them;
small waves merge on green ci.yml without a council. Every wave: `npm test` + lint + size gate
+ `check-citations --all` + the three-axis sweep (phrase written / symbol moved / bare
`file.js:NNN` pointers into touched files) before merge.

## 6. Traps, all verified this cycle

1. **Pre-squash hashes in BACKLOG.** `0a6a8032` (R16) and `4391f0b4`/`b0d8e232` (#135 C0) are
   dangling; the shipping commits are `dda1b8cf` (#187) and `919cb202` (#182). This repo mixes
   true merges and squashes — verify `merge-base --is-ancestor` per hash, never trust a DONE
   record's hash.
2. **The chair scale is duplicated** (`briefings-chair.js:20` / `parse-stage2.js:16`) with no
   shared constant — the exact mirrored-constant class that produced the fail_on bug. W7 must
   fork both and add the drift pin.
3. **`seat-unbound` is a shared channel** — orphan-leg notes (`data.legId`, consumed by
   `orphanExonerations`) and `reVoteUnboundNote` (deliberately seat-less) ride it too.
   Admitting it raw into the dead-seat surface ingests non-dead-seat records.
4. **`firstFailure.seatId` can be ALIAS-valued** on the inexact twin branch
   (`run-retry-group.js:134-151`) — "has a seatId" never means "has a seat id".
5. **Renderer modules cannot `require()` from src/** (contextIsolation, no module system) —
   any consolidation for electron/ sites is a new script-list file or nothing.
6. **A literal `#NNN` in any electron/** file trips the hex-colour guard** — write "issue NNN".
7. **The live rail spends money and does not self-skip on this machine** (`~/.config/amicus/.env`
   has a key). Keyless measurement goes through `scripts/run-integration-keyless.js`.
8. **`npm test | tail -5` is blind** — the 4-line posttest hook pushes the Jest summary out;
   use `tail -10` or grep `^Test Suites:`.
9. **The v4.8.1 release commit deleted the plan docs** — every BACKLOG citation into
   `docs/superpowers/plans/2026-08-16-…` or `…issue-138…` now dangles; recover via
   `git show v4.8.0:…`. W0 annotates these.
10. **`.husky` pre-push needs `.test-passed` at HEAD** — run the suite before any push.

## 7. Provenance

One recon workflow, 10 agents (~1.5 M tokens), two adversarial refuters over the load-bearing
halves; every disposition and anchor above re-measured against `102302d4`, not inherited from
BACKLOG prose. Full structured outputs are in the session scratchpad
(`recon-agent*.json`); the surface map and its refutation are the canonical enumeration for
W5-W8's JIT plans.
