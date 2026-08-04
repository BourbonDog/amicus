# v4.6.2 — "the field-report five" — design

**Date:** 2026-08-03 · **Status:** design approved in session (Christian); spec under review ·
**Provenance:** the 2026-08-03 backlog triage's Tier 1 — three entries from BACKLOG.md's "SL-2
live-smoke findings" (base-URL doctor check, seats-panel gap, alias audit), the ROADMAP's
unscheduled "headless no-output fast-fail backstop" (promoted on the v4.6.1 release-gate
evidence), and LC-5 from the v4.4.1→v4.5 deferral table (live evidence observed on run
`0084d48c`, 2026-08-03).

**One sentence:** five small field-proven fixes that make losses diagnose themselves (doctor
check + drift warning + live probe), fail fast with a name (no-output backstop), and show up
where users actually look (seats-panel rows, chair-attempt records) — shipped as five
sequential PRs and cut as v4.6.2.

---

## §1 Why (and why now)

Every item here comes from a real failure in the last 72 hours, and every one serves the north
star's diagnosis half: *when an error occurs it either self-heals or self-diagnoses,
transparently.* The `ANTHROPIC_BASE_URL` host-form value killed run `0084d48c`'s fallback chair
with a bare "Not Found"; the stored `gemini` alias passed `doctor` while every session ran to
timeout (three suites × 130 s at the v4.6.1 release gate); the retried dead critic on run
`2039b2d1` is invisible on the Workspace seats panel; and `run.json` recorded that same run's
three-attempt chair walk as just "chairless". v4.6 built the announcement vocabulary; v4.6.2
closes the places where a loss still has no name, no fast failure, or no surface.

## §2 Rulings taken in the brainstorm (owner, 2026-08-03)

| # | Ruling |
|---|---|
| **R1** | **Base URL: check + announced normalization** — not check-only. Host-form is never valid for OpenCode's direct-Anthropic legs (it appends `/messages`), so appending `/v1` can only fix broken configs. A heal beats a hint. |
| **R2** | **Alias audit ships BOTH halves in 4.6.2** — the stored-drift warning *and* the opt-in `models --check --live` probe tier. |
| **R3** | **Five separate sequential PRs**, order **1+2A → 3 → 2B → 4 → 5** (the 2B-after-3 resequence approved with the design: the probe reuses the backstop's no-output detector). Release cut when all five land, or earlier on owner call. |

Design-level decisions (mine — veto by editing this doc):

| # | Decision |
|---|---|
| **D1** | **Normalization fires only on host-form** (URL path `''` or `'/'`). `/v1`-suffixed passes untouched; any other path passes untouched (stated by the doctor row, never rewritten — an exotic proxy serving `/messages` at a custom root stays possible). Escape hatch: `AMICUS_BASE_URL_NORMALIZE=0` disables normalization entirely. |
| **D2** | **Normalization mutates the CHILD env only** — the value handed to the spawned OpenCode server. `process.env` of amicus itself is never written. Announced once per process (stderr notice + logger line, one voice); the doctor row states the value it sees *and* the treatment it will get. |
| **D3** | **The drift warning resolves "current" through `toStorableRoute()`** — the guarded 4.1.2 helper — never bare `toCanonicalDefault()`. This item must not re-introduce the divergent-vendor footgun it sits next to. Existing suppression rules (curated-route) honored. |
| **D4** | **The backstop fires as the existing dead-leg vocabulary** — no new degrade channel. The leg fails with a named error (`NO_OUTPUT_BACKSTOP`) whose reason text names the window and the likely cause; council runs then get the SL-2 retry, the sink announcement, and exit 2 for free. Disarm signal = the first true tick of the existing `anyActivity` predicate. |
| **D5** | **Probe legs are ordinary engine legs** — real session dirs, real spend-ledger rows, nothing bespoke. Window = the backstop mechanism with a 30 s probe override (`PROBE_WINDOW_MS` constant); prompt is a fixed tiny "Reply with exactly: OK" with a small output cap. Classification: **served** (first activity in window) / **accepted-but-silent** (backstop fired — the gemini class) / **error** (routing/auth/404). Exits 1 if any stored alias is non-served (CI-able); never spends without `--live`. |
| **D6** | **A dead-seat row renders ONLY when the seat has zero usable legs** — i.e. the live model's seat map has no row for that seat. Derived from `degrades[]`/`seatLoss`, not from wave docs. No collision with the model-keyed live rows (the F35/RN-11 lessons); blind-mode masking applies to the name. |
| **D7** | **`chairAttempts[]` is additive on `run.json`** — schemaVersion unchanged (the `seatLoss` precedent). Every attempt is recorded including the successful one (happy path = length 1), so the field is self-documenting next to `"chair"`. `verdict.json` is untouched (it already carries `degrades[]`); the report's "What was lost" cites the per-attempt causes when the chair degraded. |
| **D8** | **Extraction-first honored:** PR4 extracts seats rendering out of `workspace-panels.js` (295/300) into a new `workspace-seats.js` *before* the feature change, in the file's existing ES5 style (the no-var rewrite stays its own ruled task). PR5 extracts from `run-stages.js` (298/300) first if its seam needs edits there. |

## §3 Measured reality (verified against `main` @ `f8b9627`, 2026-08-03)

- **`ANTHROPIC_BASE_URL` appears nowhere in `src/`** — it reaches OpenCode purely as inherited
  process env. The convention split is field-proven by a control pair: the identical
  `fanout --models opus` call fails "Not Found" on the host form and completes with `/v1`
  (BACKLOG, SL-2 live-smoke findings).
- **`buildServerOptions` (`src/opencode-client.js:480`, consumed at `:728`) is the single
  server-spawn options seam** — `headless.js:277` and `sidecar/session-utils.js:231,:257` both
  route through it. `opencode-client.js` is on the size-gate's grandfathered exclude list.
- **Doctor checks register as `guard`/`guardAsync` rows** in `runDoctorChecks`
  (`src/cli-handlers-doctor.js:103-214`), one util module per check family
  (`doctor-mcp-checks.js` 91 lines, `doctor-electron-mcp-check.js` pattern).
  `cli-handlers-doctor.js` measured **274/300** — a registration fits without extraction.
- **`alias-audit.js` is 111/300**; its suppression currently keys on `curated-route` sources
  (BACKLOG `:82` reference). **The `models` command exists** (`bin/amicus.js:128`,
  usage block `cli.js:497`).
- **The headless activity predicate** is `headless.js:704-729` — text growth, tool results, new
  messages, new assistant ids, reasoning growth (`:516`, `:720-721`, the B53/F6d treatment), and
  tool-settle activity, OR-ed into `anyActivity`. The backstop arms at loop start and disarms on
  its first true tick. `headless.js` (1323 lines) is grandfathered — no size-gate issue.
- **A backstopped council leg inherits everything:** dead legs retry once (SL-2,
  `run-retry.js` 280/300), announce through the sink, and exit degraded (2) by construction.
- **The chair chain lives in `run-chair.js` (173/300)** — it walks fallbacks and checkpoints
  (`:125`), and already composes the chairless reason (`:163`). `run-stages.js` is **298/300**,
  at the extraction-first threshold.
- **Seats rendering:** `renderSeatsPanel` at `workspace-panels.js:40` (**295/300**);
  `workspace-render.js` 287/300; `live-model.js` (112/300) keys seat rows on model (F35 note at
  `:81-95`).
- **Live evidence anchors:** run `0084d48c` (chair chain `ch1→ch3` walked, `run.json`
  chairless-only; the base-URL 404), run `2039b2d1` (retried dead critic, no seats-panel row),
  v4.6.1 release gate (stored `gemini` listed-but-not-serving).
- **Plan-time pins** (each PR's plan re-measures per the anti-rot rule): the exact env-passing
  shape inside `buildServerOptions` → `createOpencodeServer`; `models --check`'s current output
  shape; where the live model exposes `degrades[]` to the renderer; the `run.json` checkpoint
  writer `chairAttempts` rides; all file sizes.

## §4 PR1 — the diagnosis pair (items 1 + 2A)

**Base-URL check.** New `src/utils/base-url-classify.js`: pure `classifyBaseUrl(value)` →
`{ form: 'absent' | 'host' | 'v1' | 'other', normalized }` (host-form: URL path `''`/`'/'`;
`normalized` = value with `/v1` appended, trailing-slash-safe). New
`src/utils/doctor-base-url-check.js`: `evaluateAnthropicBaseUrl(deps)` reads
`process.env.ANTHROPIC_BASE_URL` and returns: absent → pass · `v1` → pass (value shown) ·
`host` → **warn**, printing the exact value seen, the convention split (Anthropic SDKs treat
the var as a host and append `/v1`; OpenCode treats it as the full prefix), and the treatment
("amicus will pass `<value>/v1` to the engine"; or "normalization disabled" when the knob is
off) · `other` → pass-with-note (value shown, passed through unchanged). Verifiable voice
throughout — this check states only what it inspected. Registered as row id
`anthropic-base-url` in `runDoctorChecks`.

**Normalization.** In `buildServerOptions`: when the resolved child env would carry a host-form
`ANTHROPIC_BASE_URL` and `AMICUS_BASE_URL_NORMALIZE` ≠ `0`, the child env gets the normalized
value. One announcement per process (module-level once-guard): stderr notice + logger, e.g.
`Notice: ANTHROPIC_BASE_URL is host-form ("https://…"); passing "https://…/v1" to the engine
(Anthropic SDKs append /v1 themselves; OpenCode treats the value as a full prefix; set
AMICUS_BASE_URL_NORMALIZE=0 to disable).`

**Drift warning (2A).** `alias-audit.js` gains a `stored-drift` row class: for each stored
alias whose target is catalog-listed, compare against the current family resolution via
`toStorableRoute()`; on mismatch, warn:
`stored alias gemini → google/gemini-3.1-…; current resolution is google/gemini-3.6-flash
(stored aliases don't follow catalog updates — refresh with: amicus setup --add-alias
gemini=<current>)`. Surfaces through the existing `aliases` doctor row and `models` output
wherever the audit already prints.

## §5 PR2 — the no-output backstop (item 3)

In `runHeadless`'s polling loop: arm a backstop at loop start — `AMICUS_NO_OUTPUT_BACKSTOP_MS`,
default **120 000**, `≤0` disables (env-num convention, docblock note). On the first true
`anyActivity` tick, disarm permanently (a 30–90 s cold-prefill local model is never affected).
If it fires: the leg fails with error code `NO_OUTPUT_BACKSTOP`, reason
`model produced no output, reasoning, or tool calls in 120s — likely a listed-but-not-serving
model or a dead endpoint`. No new announcement machinery: the leg death flows into the existing
dead-leg path (fanout leg doc / council dead-leg → SL-2 retry → sink → exit 2). The v4.6.1
gemini incident becomes a named ~120 s failure instead of three 130 s timeouts.

## §6 PR3 — the live probe (item 2B)

`models --check --live`: for each **stored** alias (the incident class; curated defaults are
out of scope), launch one ordinary engine leg — fixed prompt `Reply with exactly: OK`, small
output cap, backstop overridden to `PROBE_WINDOW_MS = 30 000`. Classify per D5, print a
per-alias table (alias → target → outcome → cost) + total, support `--json`, exit 1 if any
alias is non-served. Without `--live`, `models --check` behaves exactly as today — the flag is
the spend gate, stated in usage. Probe legs write normal spend-ledger rows.

## §7 PR4 — dead-seat rows (item 4)

First, the D8 extraction: seats rendering moves from `workspace-panels.js` to a new
`electron/workspace-ui/workspace-seats.js` (same IIFE/namespace pattern as its siblings),
behavior-identical, fake-DOM suite green before the feature commit. Then: seats the live model
knows were announced dead — from `degrades[]` (`dead-leg`/`dead-wave` records carry the seat
model; `retryWaveId`/`firstFailure` mark the SL-2 walk) and `seatLoss` (the critic) — render a
row when and only when the seat has zero usable legs: model name (blind-masked as usual),
status text `did not review — retried once` (retry present) or `did not review`, no cost cell,
a distinct muted/struck style. No ghost when a retry succeeded (the seat then HAS a usable
leg). The v4.6 announcement invariant now holds on the surface users actually watch.

## §8 PR5 — chair-attempt records (item 5, LC-5)

`run-chair.js` records each attempt of the fallback walk as
`{ waveId, model, outcome: 'completed' | 'error' | 'timeout' | 'no-output', reason }` into an
additive `chairAttempts[]` on `run.json`, checkpointed with the existing chair checkpoint (so
a mid-walk kill preserves the attempts so far). Happy path = one `completed` entry. The
report's "What was lost" chair line cites the per-attempt causes when the chair degraded
(`ch1 minimax: OpenRouter spend limit · ch2 minimax: …`). `run.schema.json` updated
(additive, schemaVersion unchanged) + the three-way `degrades`/schema lockstep suite extended
to pin the new field's shape. Closes the failed-chair half of CA-4's remainder; repair solos
stay open there.

## §9 Testing

TDD throughout (superpowers flow: failing test first, per-PR review before merge request).
Per PR: **PR1** — unit `classifyBaseUrl` (absent/host/`/v1`/other/trailing-slash/idempotence),
unit the doctor row (all four forms + knob-off voice), spawn-site test asserting child-env
mutation + once-per-process announcement + knob-off passthrough; unit `stored-drift` (drift /
no-drift / delisted-target / suppression). **PR2** — fake-timer unit (fires at window, disarms
on first activity, `0` disables), a mocked no-output session integration, council-path test
pinning backstop→dead-leg→retry interplay. **PR3** — mocked-engine probe tests for the three
classifications + exit code + `--json` shape + no-spend-without-`--live`; no paid tests in the
suite. **PR4** — extraction-equivalence pass, then fake-DOM: dead-critic fixture renders the
row, retried-then-recovered seat renders NO dead row, blind-mode masks the name. **PR5** —
unit the walk recording (1-attempt happy path / N-attempt walk / chairless), kill-mid-walk
checkpoint test, schema lockstep extension. One manual live smoke per PR before its merge
request (the ~$0.013 deepseek `SMOKE OK` fanout recipe, plus PR-specific: a host-form env run
for PR1, a dead-alias probe for PR3).

## §10 Docs (each PR carries its own)

`docs/configuration.md`: `AMICUS_BASE_URL_NORMALIZE`, `AMICUS_NO_OUTPUT_BACKSTOP_MS` rows.
`docs/usage.md`: the new doctor row, `models --check --live`. README command table touch where
surfaces changed. `CHANGELOG.md` `[Unreleased]` per PR (sequential PRs — the #91/#92
CHANGELOG-race hazard doesn't apply). `node scripts/generate-docs.js` whenever a new `src/`
module lands (PR1's two utils; PR4's electron file is outside the marker tree — plan verifies).

## §11 Out of scope (stated so nobody re-litigates)

SL-1 (stagger — measure first), SL-3 (open by ruling, awaiting field data), SL-4
(`run-<runId>.json` layout change), the `toCanonicalDefault()` fold-in refactor (Tier 3 — D3
merely *uses* the guarded helper), the workspace-ui no-var rewrite (own ruled task), the
`<untrusted_sidecar_output>` fence rename, probing curated defaults, `--dry-run` cost preview.

## §12 Release

v4.6.2 cut after PR5 lands (or earlier partial on owner call): CHANGELOG roll-up of the five
`[Unreleased]` blocks, the standard release recipe (docs/publishing.md), full gates + keyless +
live rails green. Expected user-visible deltas: a new doctor row, two new env knobs, a new
opt-in `models` flag, dead-seat rows in the Workspace, `chairAttempts[]` on `run.json`, and
host-form base URLs healing themselves with a notice.
