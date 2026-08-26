# v4.9 W9 — the Workspace dead-seat surface (SI-02 · R4 · PR5b-1 · SI-22.4 rider) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seat that dies unbound stops being invisible: `deriveSeatLoss` and both Workspace
consumers admit the `seat-unbound` family (gated), the critic path keys on seat identity, the
third street-cred renderer joins its two seat-keyed siblings, and the seats-vs-artifacts
document split is disclosed.

**Architecture:** Producer work is ~one line (the partial arm's seat OBJECT is already on the
record). The real work is consumer-side, and the mirror constraint rules it: both renderer
filters move in ONE commit. Measured substrate (v4.9 recon, 2026-08-25, re-verify anchors):
seat identity already rides four of five emitter arms; `seat-unbound` is a SHARED channel
(orphan-leg notes carrying `data.legId`, `reVoteUnboundNote`) — never admit it raw, gate on
the retry-family fields (`retryWaveId || firstFailure`); `firstFailure.seatId` can be
ALIAS-valued on the inexact twin branch, so "has a seatId" never means "has a seat id".

**Spec:** phasing memo §3 (Workspace dead-seat, smaller than filed) + ruling V15 (disclosure
over uniformity) + BACKLOG's PR5b/PR5c sections (design constraints: `data.seat` STAYS the
alias — `verdict.js` compares it to `o.critic`; `deadBenchSeats` output stays alias-strings —
`live-dead-seats.js`'s derivative-absorb rule reads it).

## Global Constraints

- Both renderer filters (`live-dead-seats.js` kind/channel gate, `workspace-seats.js` twin)
  change in the SAME commit — the restored-mirror constraint (`workspace-seats.js` docblock,
  ~:49-59) says two spellings of one rule is council-1 B1's defect class.
- electron/**: "issue NNN", never `#`+digits. Renderer modules cannot require src/.
- W8 just edited `workspace-matrix.js` (the chip) and `run-detail.js` — RE-ANCHOR every line
  number in this plan by opening the file.
- No git mutations; focused suites, `--maxWorkers=2`; sizes/citations clean.

---

### Task A: producer + the three consumers + R4 + T6 (one keyspace, one commit)

**Files:** Modify `src/council/run-retry-notes.js` (partial arm), `src/council/verdict.js`
(`deriveSeatLoss`), `electron/workspace-ui/live-dead-seats.js`,
`electron/workspace-ui/workspace-seats.js`, `tests/workspace/dead-seat-twins.test.js`,
`tests/council/degrade-channels.test.js` (only if a shape pin moves — recon predicted
NEITHER existing toEqual breaks), the seat-unbound shape suites
(`run-retry-seat-keys`, `degrade-contract`, `run-stages`, `stage1-bind` tests — budget
updates), `BACKLOG.md` (the ticks for SI-02/R4/R5-T6).
- [ ] P1 (producer, ~1 line): `waveStillDeadNote`'s partial/seat-unbound arm emits
  `seatId: ((w.seats || [])[0] && (w.seats || [])[0].id) || null` beside the alias-valued
  `seat` (the seat OBJECT rides the record from `stage1-bind.js :: missingSeatDeadWave`).
  `data.seat` stays the ALIAS (the pinned constraint). RED-first shape pin.
- [ ] Consumers admit `seat-unbound` WITH the retry-family gate
  (`data.retryWaveId || data.firstFailure`, plus a `seatId`/`seat` presence guard):
  - `verdict.js :: deriveSeatLoss`: unify the kind predicate to `kind === 'degrade'`
    (aligning the three consumers — also future-proofs the `info` kind, the W5.1 handoff);
    admit gated seat-unbound records as lost seats; `deadBenchSeats` OUTPUT stays
    alias-strings (derive the alias from the record; the seat id is for dedup/keying only).
  - `live-dead-seats.js :: deadSeats` + `workspace-seats.js :: retriedSeats`: admit the
    channel with the SAME gate in BOTH files, one commit; keep the render-vs-badge asymmetry
    the docblock declares deliberate.
  - Controls: an orphan-leg `seat-unbound` note (`data.legId`, no retry-family fields) and a
    `reVoteUnboundNote` remain EXCLUDED everywhere — pin all three consumers on both
    directions.
- [ ] R4 (critic path seat-keyed): thread `run.criticSeat` into the consumers' `runMeta`
  (built at `workspace-seats.js` ~:120/:267 — re-anchor); tag `role: 'critic'` by
  `lk === runMeta.criticSeat` when the record carries a seat id (alias equality stays the
  legacy fallback); key the `byRole` critic suppression on seat identity where available.
  FLIP the R4 KNOWN-WRONG pin in `dead-seat-twins.test.js` (~:164-169) to assert the fixed
  behavior: a dead bench twin beside a live critic twin renders ONE row, correctly labelled.
  Mirror `deriveSeatLoss`'s critic test the same way ONLY if it shares the defect — measure
  first (`verdict.js` compares `data.seat === critic`, alias space — decide whether the
  verdict side needs the seat-key too, with `criticSeat` available on the record; report
  the decision).
- [ ] T6 re-derivation: `dead-seat-twins.test.js`'s T6 header (~:237-247) claims the live
  payload carries no seat field — FALSE since v4.8 R5. Re-derive T6's status: the pinned
  shape is a LEGACY payload, not a live defect. Reword the header + the pin's framing (keep
  the pin if it guards the legacy path honestly); tick BACKLOG's unchecked R5 entry
  (locate: the `R5 · The live tick cannot suppress` entry) past-tense with the measured
  state.
- [ ] Named mutants: `UNBOUNDBLIND` (drop the seat-unbound admission from ONE renderer —
  must red the mirror pins), `GATERAW` (admit the channel without the retry-family gate —
  must red the orphan-leg/revote controls). Red sets recorded in-file.
- [ ] BACKLOG ticks, past tense, same commit: SI-02 (status-table row 02 lives in the
  deleted phasing doc — tick the BACKLOG deferral mentions instead), the R4 re-filed entry,
  R5/T6. The five-arm table annotation (2026-08-25) already records the substrate.

### Task B: SI-22.4 rider + PR5b-1 disclosure

**Files:** Modify `electron/workspace-ui/workspace-matrix.js` (street-cred rows — W8 moved
lines, re-anchor ~:148-155 by content `opts.labelOf(s.model)`),
the seatTableRejected banner's text source (measure: `src/workspace/run-detail.js` computes
`seatTableRejected`; find where the banner STRING renders — likely `workspace-lazy.js` or a
workspace-ui renderer), their test suites. Do NOT edit BACKLOG.md (report your tick text;
the lead applies it).
- [ ] SI-22.4 rider: the third street-cred renderer displays `s.seat || s.model`, with the
  blind-mode rule: when blind and a label exists, show the LABEL (a raw seat id contains its
  alias and would defeat blind mode — the `seat-space.js` precedent); `opts.labelOf` stays
  alias-keyed (`labelByModel`), signature unchanged. Own pin per the R22.4-6 rule (each
  renderer gets its own test; a twin bench renders seat ids; blind renders labels; a
  unique-alias bench is byte-identical).
- [ ] PR5b-1 (V15, disclosure over uniformity): extend the seatTableRejected banner text to
  state the split honestly — the artifact panels dropped to alias space; the seats panel
  still renders tally's per-seat rows (which are truthful — stamped from the in-memory
  roster at assembly). One sentence added to the existing banner string; pin the wording.
  The seats panel is NOT forced to `derived.seatSpace` — that would discard truthful data
  (the measured V15 rationale).
- [ ] Named mutant `RIDERALIAS` (rider renders `s.model` unconditionally) — red set in-file.

### Task C (lead): wave gates
- [ ] Full `npm test` tail -10, lint, sizes, citations, docs check; three-axis sweep;
  BACKLOG tick from Task B's report; commit; hold the push until PR #200's council settles
  (stacked branch).
