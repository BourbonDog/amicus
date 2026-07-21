# Manual Orchestration (fallback path)

This is the **fallback path**; the engine is primary since v4.1 (`amicus council run --prompt-file <briefing.md> --models "a,b,c" --chair <model> --json`). Use this doc when: the engine is unavailable or misbehaving, you need a fully custom per-seat brief beyond `--critic`/`--lenses`, you need to inspect or intervene mid-stage, or you are running a 1-model scale-down. SKILL.md's §4.7 fallback rules point here.

---

### Stage 1 (manual)

Each council model reviews **the artifact** independently. Write one Stage-1 briefing file
(`_tmp-briefing-stage1.md` in the run folder) and launch the whole wave as ONE background call:

```
amicus fanout --models "<m1,m2,m3>" --prompt-file <run-folder>/_tmp-briefing-stage1.md --json \
  --agent Plan --no-context --summary-length verbose --timeout <minutes>
```

Always quote the `--models` list — unquoted, PowerShell splits on commas and the CLI receives one mangled alias (instant arg-parse failure).

Run it in the background (`run_in_background: true`); you are notified on completion — do not
poll. `fanout` is headless by definition. The command exits when every leg is terminal and prints
ONE JSON wave document on stdout (`schemaVersion: 2`; the wave's id field is `waveId`, each leg's id is `taskId`): check `status` (`complete` | `partial` |
`error`), `counts`, and each leg in `legs[]` — a leg's `summary` field IS that model's review;
`model`/`modelInput` identify the reviewer (`model` is the resolved id, `modelInput` the alias you passed — use the alias for `review-<model>.md` filenames); `status`/`error` identify failures. Exit code 0 =
all legs complete, 2 = partial (apply the wave-degrade rules below), 1 = error/aborted. (To re-fetch a single leg later: `amicus read <taskId> --json`.)

**Red-team variant:** fanout legs share a single prompt by design. When one model gets a distinct
red-team brief, launch it as a separate concurrent solo run alongside the wave:

```
amicus start --model <redteam-model> --no-ui --json \
  --prompt-file <run-folder>/_tmp-briefing-redteam.md \
  --agent Plan --no-context --summary-length verbose --timeout <minutes>
```

Its stdout is a single run document; the `summary` field is the review.

**Critic seat (optional element, when ON):** one bench member — recommended by Claude at Stage 0, typically a strong reasoner that is not the chair — receives the critic brief from `SEAT-BRIEFS.md § Critic seat brief` **instead of** the standard review brief. Launch it exactly like the red-team variant: a separate concurrent solo run (`_tmp-briefing-critic.md`) alongside the fanout wave of the remaining members — same total review count. Everything downstream is unchanged: same structured-output contract, same `council validate` + repair loop, same anonymization into the Stage-2 bundle (judges are never told a critic seat exists). Record `role: "critic"` on that seat's `runStats` entry. One standing disclosure for `report.md`: the critic model can recognize its own review in the Stage-2 bundle by its adversarial shape, so self-bias wash-out is weakened for that one seat.

**Expert lenses (optional element, when ON):** every seat gets a distinct per-seat brief, so there is no shared-prompt wave — launch **all** legs as concurrent solo runs (`_tmp-briefing-lens-<slug>.md`, one per seat), using the lens templates and panel-scoping rules in `SEAT-BRIEFS.md § Expert lens briefs`. The lens↔model assignment is random and lives only in the private label map — no reviewer learns the other seats' lenses. Same structured-output contract and validation. Record `role: "lens:<slug>"` on each `runStats` entry. Two standing consequences, both disclosed in `report.md`: Stage-2 anonymity is weakened (each judge can spot its own lens-flavored review), and the Stage-2 tally runs `--no-ledger` (lens reviews are not comparable to standard reviews and must not feed cross-run reliability stats). Wave-degrade rules apply to these solos exactly as to fanout legs.

**Cowork / no-Bash environments:** use the MCP tools instead — `amicus_fanout` (briefing via
file) returns `{waveId, taskIds[]}` immediately. Preferred: call `amicus_wait` with the waveId —
one blocking call per wave; re-call it while it returns `timedOut: true`. Fallback: poll
`amicus_status`. Either way, `amicus_read` each leg when done. The council's briefings are always
self-contained (`--no-context`), so MCP transport is equivalent.
Council JSON returned by the MCP tools (`amicus_council_tally`, `amicus_council_stats`, `amicus_verdict`) arrives wrapped in the `<untrusted_sidecar_output>` fence since v4.0 — parse the JSON from inside the fence; CLI `--json` output remains unfenced.

**Required structured output from every model.** Instruct each council model to produce:

1. A **prose review** — the reviewer's full narrative assessment of the artifact.

2. A **trailing fenced ` ```json ` block** immediately after the prose, containing:
   ```json
   {
     "overall": "one-paragraph take",
     "findings": [
       { "id": 1, "severity": "blocker",
         "claim": "…", "location": "…", "rationale": "…" }
     ]
   }
   ```
   - `id` — sequential integer within this review (`1..n`); at Stage-2 assembly Claude rewrites each into a **run-global label id** (`A1`, `B1`, …) by prefixing the review's anonymized label.
   - `severity ∈ {blocker, major, minor, nit}`
   - `claim`, `location`, `rationale` — non-empty strings.

Instruct models to emit the structured JSON verbatim after the prose, without preamble, so it parses cleanly.

**Every Stage-1 briefing — standard seats included — must contain the standard anti-sycophancy clause from `SEAT-BRIEFS.md` verbatim** (do not soften, lead with the most severe finding, no praise cushions, no padding — an empty severity category is a valid result). This is briefing hygiene, not an optional element.

Save each leg's full output (prose + findings block) to the run folder as `review-<model>.md`
(one file per reviewer) before moving on.

**After the wave returns, validate each leg's findings block** by running `amicus council validate <leg-file> --json` (a thin CLI wrapper over `validateFindings`, Unit A — `src/council/findings.js`). It reads the leg's saved `review-<model>.md` and prints `{ok, findings, errors}`. Exit codes are a **tri-state** contract: `0` when `ok:true` (well-formed, proceed), `2` when `ok:false` (validation failed — a distinct, scriptable outcome, not a crash), `1` (`BAD_ARGS`) for a missing/unreadable file. If a leg's JSON fails validation (`ok:false` / exit 2):
1. Issue a **solo `start --json`** re-prompt to that one model: "re-emit only the findings JSON, fixing: \<errors\>." Keep the first-pass prose. (Solo `start` passes through the **same budget gate** as `fanout`. If launching the wave required `--max-cost <$>` or `--no-cost-gate`, pass the **same flag on every repair re-prompt and on the chair call** — otherwise the gate can refuse a repair or the chair mid-council.)
2. If still malformed, retry **once more** (cap = **2** re-prompts total).
3. If still malformed after 2 retries, mark the review `unstructured` and hand-parse its prose into the schema. The review proceeds — never dropped for a formatting miss.

Record per-model **conformance** (`clean` | `repaired` | `unstructured`) for inclusion in the tally input's `runStats` and the Stage-6 MODEL-NOTES note.

**"Claude in the council" (when toggled on):** Claude also produces a **fresh** Stage-1 review on the artifact in the identical findings format — a new structured pass on the artifact, not a formalization of anything said upstream. This review is added to the bundle as one more anonymous entry. Claude does not rank or adjudicate in Stage 2 (it holds the label map), and does not chair in Stage 3. Save it as `review-claude.md`.

**Wave-degrade rules (Stage 1).** Read failures from the wave document — never silently ignore
them:
- All legs `complete` → proceed normally.
- A leg ends `error`/`timeout`/`crashed`/`aborted` but **≥ 2 reviews survive** → proceed with the
  survivors; name the dead leg and its `error` when presenting; the bench shrinks accordingly. If this leaves exactly 2 surviving reviews, the run is now effectively a 2-model council — apply the thin-ranking disclosure (Stage 0 / Stage 4) from here on.
- **Fewer than 2 reviews survive** → offer the user a re-run of the dead leg(s) (solo
  `amicus start --json`, same briefing file) or a disclosed downgrade to single-pass mode
  (Stage 2 and Stage 3 skipped, per the scale-down rules).

---

### Stage 2 (manual)

This is the peer-validation step. Claude builds one shared anonymized bundle, distributes it to every council model for ranking and finding adjudication, then de-anonymizes for scoring.

**Build the shared anonymized bundle.** After all Stage-1 reviews are in hand, Claude:
1. Assigns stable labels: **Review A**, **Review B**, **Review C**, … (one per review, including Claude's if the toggle is on).
2. Keeps a **private label↔model map** (e.g., `Review A → deepseek`, `Review B → gemini`, `Review C → claude`) that is never sent to any sidecar model.
3. Assembles one bundle document containing all labeled reviews. The bundle is identical for every judge.

Each model **unknowingly ranks and adjudicates its own review** — this is the anti-favoritism mechanism, not a bug. Because no model knows which review is its own, self-bias washes out symmetrically across judges.

**Distribute the same bundle to every council model** — this is exactly fanout's shared-prompt
model. Write the bundle + judging instructions to `_tmp-bundle-stage2.md` and launch one wave:

```
amicus fanout --models "<m1,m2,m3>" --prompt-file <run-folder>/_tmp-bundle-stage2.md --json \
  --agent Plan --no-context --summary-length verbose --timeout <minutes>
```

(Background, same JSON handling as Stage 1.) Each judge's leg `summary` is its ranking +
adjudication response. **Stage-2 degrade:** a judge leg dies → tally over the surviving judges
(≥ 1) and disclose the reduced bench in `crossreview-matrix.md`; tier definitions are unchanged
(they already count "judges engaged").

**Judge-briefing hardening (required).** Open `_tmp-bundle-stage2.md` with this preamble, verbatim, as its first line:

> Do NOT use any tools or read any files; everything is in this message; begin immediately with A1:

Plan-agent judges have wandered to tools mid-adjudication (reading files instead of judging and returning only narration), and a tool-capable judge can read the de-anonymized `review-<model>.md` files in the run folder — an anonymization leak. The preamble closes both. **Scratch-cwd (optional second layer):** launch the Stage-2 wave (and the Stage-3 chair call) with `--cwd <run-folder>/_scratch/` — create the empty directory first — so even a wandering agent finds nothing to read. Caveat: those legs' session records then live under `_scratch/.claude/amicus_sessions/`, so any later `amicus read <taskId>` for them needs the same `--cwd`.

Each judge is asked to do two things on the bundle:

**Task A — Rank.** Order the reviews from most to least accurate and insightful. End the response with a parseable block in exactly this format (no other text on those lines):

```
FINAL RANKING:
1. Review C
2. Review A
3. Review B
```

**Task B — Adjudicate findings.** For every finding in the bundle, state: `agree | dispute | neutral` plus one-line reason. Reference each finding as **review-label + finding-id** — for example, `A2` means Review A's 2nd finding, `B1` means Review B's 1st finding. An "I missed this — it's valid" counts as `agree`.

**When critic seat or expert lenses are ON:** the bundle and judging instructions must not mention seats, lenses, or briefs — judges rank and adjudicate on accuracy and insight only. The element briefs are Stage-1 information; leaking them into Stage 2 tells every judge which review is which.

As each judge's ranking + adjudication response returns, collect it (the raw per-judge responses are working intermediates, not separate run-folder artifacts). Once all are in, **assemble the de-anonymized tally input** and then call `amicus council tally`:

**Stage-2 → tally assembly recipe (Claude's work before calling `tally`):**
0. **Build `meta` and `findings[]` first — `tally` requires both** (missing either fails with `BAD_ARGS: Cannot read properties of undefined (reading 'map')`):
   - `meta` = `{ "runId": "<run-folder stem>", "models": [<every reviewed model id, including "claude" when the toggle is on — this is the street-cred universe>], "chair": "<confirmed chair model id>", "claudeInCouncil": <Stage-0 toggle> }`. Optional extras: `runType`, `date`.
   - `findings[]` = one entry per finding across ALL reviews: `{ "id": "<run-global label id from step 1, e.g. A1>", "raiser": "<de-anonymized model that raised it>", "severity": "<from the review JSON>" }` (`claim` may be carried along but is not required).
1. **Rewrite finding ids to run-global label ids.** Each Stage-1 review's local integer ids (`1`, `2`, `3`…) become `A1`, `A2`, `A3`… (where `A` is that review's anonymized label). The label↔model map (`Review A → deepseek`, etc.) is the key.
2. **Build `adjudications`** — for every judge across all findings: `findingId` = run-global label id; `judge` = the model id (de-anonymized via the map); `verdict ∈ {agree, dispute, neutral}`. Include every judge's verdict on every finding. The raiser's own adjudication of its own finding is **included in the input** (the tally engine excludes it when computing peers-only tiers — do not pre-filter it).
3. **Translate each judge's `FINAL RANKING:` block** — convert the label order (`1. Review C / 2. Review A / 3. Review B`) into a model `order` array via the same map (e.g. `{C→mistral, A→deepseek, B→gpt}` ⇒ `order: ["mistral","deepseek","gpt"]`). This is each entry in `rankings[]`.
4. **Populate `runStats`** from the per-leg run documents emitted by `fanout --json` (and any solo red-team/chair `start --json` docs): copy `model`, `status`, `durationMs`, `usage` verbatim. Any leg with no run doc gets `durationMs: null` and `usage: null` — never invent a value. Attach `role` (`council` | `redteam` | `claude`), `wasChair`, and `conformance` (`clean` | `repaired` | `unstructured`) as council-domain labels.

**Five-keys checklist — verify `tally-input.json` has ALL of:** `meta` (with `meta.models`), `findings`, `adjudications`, `rankings`, `runStats` (`runStats` may be `[]`; the other four are required). Do not call `tally` until all five are present.

Then call, saving the printed `record` to `<run-folder>/tally.json` (Stage 5's `amicus council verdict` reads it back from disk):

```
amicus council tally <run-folder>/tally-input.json --json > <run-folder>/tally.json
```

**Ledger flags for optional elements:** when **expert lenses** are ON, always pass `--no-ledger` — lens runs never feed cross-run reliability stats. When **debate mode** is ON, this Stage-2 tally is *provisional* — pass `--no-ledger` here; the final, ledger-recorded tally happens at the end of Stage 2.5 (the critic seat and Claude-in-the-council change nothing about ledger handling).

**Windows PowerShell 5.1 caveat:** that `>` redirect writes UTF-16 under legacy Windows PowerShell 5.1 (fine on pwsh 7+ or bash), which corrupts `tally.json` for Stage 5's `amicus council verdict` and surfaces as a confusing `BAD_ARGS` there instead of here — on 5.1 pipe through `| Out-File -Encoding utf8` (or run under pwsh 7+) instead of a bare `>`.

The output `record` carries the deterministic tiers (Disputed / Confirmed / Contested / Singleton), `confidence` (`solid` | `thin`), both street-cred numbers (`withSelf` and `peersOnly`), the validated `runStats`, and `tierCounts`. **Claude may override a `thin`-confidence tier at the margins** before Stage 4 — record the override in `tierOverride: {from, to, reason}`; the matrix and `verdict.json` surface it. De-anonymize and write the tally results to `crossreview-matrix.md` — the adjudication grid plus the street-cred table. This data feeds Stage 3 (chair briefing) and is never re-anonymized or forwarded to any council model.

---

### Stage 2.5 (manual rebuttal round)

One structured challenge round on the findings the bench did not settle: every **Contested** and **Disputed** finding goes back to its raiser to defend, amend, or withdraw; the judges that disputed it re-vote; then the final tally. **Exactly ONE round, ever** — never iterate further; whatever remains unsettled after the re-vote keeps its final tier. Briefing templates are in `SEAT-BRIEFS.md § Rebuttal-round templates`; every rebuttal briefing opens with the no-tools preamble, same as Stage 2.

The Stage-2 tally above ran `--no-ledger` (provisional). If it produced **zero Contested + Disputed findings**, skip the rebuttal waves entirely: re-run the tally on the unchanged input *without* `--no-ledger` to record it, note "debate mode: nothing to debate" for `report.md`, and proceed to Stage 3.

**1. Defense mini-wave.** For each raiser with ≥ 1 Contested/Disputed finding, write `_tmp-rebuttal-<label>.md`: its findings (run-global ids and claims), each with the peers' dispute reasons — anonymized, no judge identities. Launch one concurrent solo run per raiser (same flags and budget-gate handling as the Stage-1 solos). Parse each response line: `<id>: DEFEND — …` | `<id>: AMEND — <replacement claim>` | `<id>: WITHDRAW`. A missing or unparseable line = the original claim stands undefended (original verdicts carry).

**2. Re-vote mini-wave.** Build ONE shared `_tmp-revote-bundle.md` holding every defended or amended finding plus its (anonymous) defense. Send it as a single fanout wave to the judges that disputed at least one of those findings — judges that never disputed sit this round out. Parse verdict lines `<id>: agree | dispute | neutral — <reason>`; a judge's missing line = its original verdict stands.

**3. Final tally.** Re-assemble the tally input: re-vote verdicts replace those judges' original adjudications on those findings; AMENDED claims replace the originals (`id`, `raiser`, and `severity` unchanged); WITHDRAWN findings **stay in `findings[]`** (they were raised) and take whatever tier the final cascade assigns. Run `amicus council tally` **without** `--no-ledger` (unless expert lenses are also ON — lens runs never ledger) and save this record as the run's `tally.json`. This final record — not the provisional one — is what Stages 3–5 consume; the chair packet and `crossreview-matrix.md` are built from it, with verdict changes from the re-vote called out before/after.

**Withdrawals downstream:** WITHDRAWN findings are auto-recorded in `decisions.json` as `{"id": …, "decision": "denied"}` — never presented for a user decision in Stage 4 — and listed in `report.md` under "Withdrawn by raiser (debate mode)".

**Degrade rules:** a dead defense leg → all of that raiser's contested findings stand undefended. A dead re-vote leg → that judge's original verdicts carry. Never re-run the round.

**Cost/shape:** adds up to 2 short waves (≤ N defense solos + 1 re-vote fanout), disclosed at Stage 0. If the actual rebuttal surface turns out much larger than estimated (many contested findings), say so before launching the mini-waves.

---

### Stage 3 (manual chair)

A designated **non-Claude** chair synthesizes the verdict across all reviews, rankings, and adjudications. The chair produces an independent verdict that Claude then presents — Claude does not paraphrase, edit, or re-synthesize it.

**Chair selection (confirmed in Stage 0).** Default: Claude recommends the strongest reasoner in the council (guided by `amicus council stats` (peers-only street-cred) and the qualitative quirks in `MODEL-NOTES.md`) and the user confirms before the run launches. The chair may be a council member who already participated in Stages 1 and 2 — it receives the de-anonymized full bundle, all ranking outputs, and all adjudications so it has the complete picture.

**Fallback order if the chair fails:**
1. Re-run the chair call (transient failure — `MODEL-NOTES.md` mitigations apply).
2. Promote the next-best non-Claude council model as chair.
3. **Claude chairs only as last resort — with explicit disclosure** that the verdict is no longer fully independent of the orchestrator.

**Chair briefing.** Write the chair packet to `_tmp-chair-packet.md` and send one solo run
(background):

```
amicus start --model <chair> --no-ui --json \
  --prompt-file <run-folder>/_tmp-chair-packet.md \
  --agent Plan --no-context --summary-length verbose --timeout <minutes>
```

(The budget gate applies to this solo call too — if Stage 0 needed `--max-cost <$>` or `--no-cost-gate` to launch the wave, the chair call needs the same flag.)

The run document's `summary` is the verdict. The packet contains:
- All Stage-1 reviews (de-anonymized — model attribution restored)
- All cross-review ranking outputs (with model attribution)
- All adjudication outputs (with model attribution and `agree | dispute | neutral` verdicts per finding)

Open `_tmp-chair-packet.md` with the no-tools preamble, adjusted for the chair: *'Do NOT use any tools or read any files; everything is in this message; begin immediately with the verdict.'* The packet is complete by construction — the chair must never go looking for files.

Instruct the chair to write a **synthesized verdict** that:
- Weighs each reviewer's findings by their peer-validated standing (street-cred rank and adjudication pattern)
- Distinguishes findings the bench broadly endorsed from contested or singleton claims
- Arrives at an overall assessment of the artifact

**Chair verdict scale (optional element, when ON):** append the addendum from `SEAT-BRIEFS.md § Chair verdict-scale addendum` to the chair packet — the chair must close with 3–5 **hard questions** the artifact's author probably hasn't asked themselves, then a final parseable line: `VERDICT: Ship it | Fix these first | Fundamental rethink`. Surface that line verbatim at the top of `report.md` and in the inline chat presentation. When debate mode is also ON, the chair packet is built from the *final* (post-rebuttal) tally and includes the defense/re-vote outcomes.

Save the chair's output to the run folder as `verdict.md`.

---

### Stage 5 artifacts (manual)

**Editable source** (the artifact is a file you can write — `.md`, `.docx`, `.py`, any text format):
- Apply only the **accepted findings** from Stage 4.
- Write the result as `<stem>-reviewed.<ext>` **next to the original file** — same directory, same extension, `-reviewed` appended before the extension.
- Before writing, validate structural integrity: check that headings are balanced, code blocks close, front-matter is valid, etc. Fix any structural integrity issues **your edits introduce** — do not touch pre-existing issues in the original. Do not alter any content beyond the accepted findings.

**Fixed source** (the artifact is a link, PDF, or something you cannot directly edit):
- Do not attempt to produce a modified copy.
- Write a **standalone reviewed report** instead: the full decision log, the chair's verdict, and clear callouts of what should be changed and where — formatted so the user can apply the changes manually.

**Run-folder artifacts — always write these** regardless of source type. The full artifact set and naming conventions are defined in the *Output & naming* section of this skill; write every artifact specified there. The canonical run-folder files are:
- `review-<model>.md` × N (already saved in Stage 1)
- `crossreview-matrix.md` — the de-anonymized adjudication grid and street-cred table
- `verdict.md` (already saved in Stage 3)
- `verdict.json` — write by running `amicus council verdict <run-folder>/tally.json --decisions <run-folder>/decisions.json -o <run-folder>/verdict.json` (a thin CLI wrapper over `buildVerdict(record, decisions)` + `writeVerdictAtomic`, `src/council/verdict.js`). `<run-folder>/tally.json` is the `record` saved from the Stage-2 `amicus council tally` call. `<run-folder>/decisions.json` is a **JSON array**, one object per finding: `{id, decision, applied?, duplicateOf?, tierOverride?}` — `id` is the run-global label id (e.g. `A1`); `decision` is the Stage-4 outcome (accepted / denied / modified / deferred); `applied` (optional bool) marks whether the accepted change was actually applied to the artifact in Stage 5; `duplicateOf` (optional) links to another finding's id when Claude identified a duplicate; `tierOverride` (optional) carries any `{from, to, reason}` override recorded in Stage 2. Save this array to `<run-folder>/decisions.json` first, then run the command — it parses the tally record and the decisions file, calls `buildVerdict`, and writes the schema-stamped machine-readable record to the run folder via the same atomic tmp+rename convention the function always used.
- `report.md` — the chair's synthesis + the full Stage-4 decision log + a summary of what was
  applied (+ the "How Claude's review fared" readout when "Claude in the council" is on) + an
  **Optional elements** section whenever any element was ON: which elements ran; the chair's
  `VERDICT:` line verbatim at the top of the report (chair verdict scale); the "Withdrawn by
  raiser (debate mode)" list and re-vote verdict changes (debate mode); and the standing
  disclosures — critic self-identification in cross-review (critic seat), weakened anonymity +
  non-comparable street-cred + `--no-ledger` (expert lenses) + a
  **run-stats table**: one row per model call — **stage** (which stage you launched the call for)
  plus **model, status, durationMs, and cost** read from the wave/run JSON `usage`
  block. Cost is `usage.cost.amount` (USD); mark it with its `usage.cost.source`
  — exact for `reported`, `~` for `estimated`, `?` for `unknown` — and never
  invent a figure. Add a wave **total cost** row from the wave document's
  `usage.cost` (`source: reported|estimated|mixed|unknown`). Any leg with no run doc → `durationMs: null`, `usage: null`; never invent a value.
  - **Renderer:** once `verdict.json` is written, run
    `amicus council report <run-folder>/verdict.json --html > <run-folder>/report.html` — a
    **separate, deterministic** artifact, not report.md itself. **`report.html` is the default
    final artifact to hand the user** — a self-contained, shareable page. This emits the
    adjudication matrix (finding × judge), the peers-only street-cred table, the
    findings-by-tier groupings (Disputed-first), and the per-model + wave cost —
    deterministic data only. To assemble report.md, also run
    `amicus council report <run-folder>/verdict.json --md` (no redirect — read its stdout) and
    paste that Markdown into report.md as one section; reserve the rest of report.md's prose for
    the chair's synthesis and the decision log. Prefer the renderer's Markdown over
    hand-assembling the matrix by hand.

Tell the user exactly which files were written and where, leading with `report.html`, **and present the verdict inline in chat** — the chair's overall assessment (verbatim or lightly trimmed) plus the tier counts (Confirmed/Disputed/Contested/Singleton) and what was applied. Never hand over only file paths.
