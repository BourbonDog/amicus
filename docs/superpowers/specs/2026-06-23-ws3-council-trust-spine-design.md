# WS-3 — Council Trust Spine — Design

_Status: drafted 2026-06-23 (brainstormed with user; hardened via a 6-lens adversarial review
pass). Post-launch enhancement program, workstream 3 of 5. Source audit:
`SecondBrain/output/amicus-enhancement-review-2026-06-23.md` (enhancements #5, #1, #9, #12).
Base: local `main` `3a83af7` (WS-0/1/2 merged, local-only)._

## 1. Problem & intent

Amicus's hero feature — the LLM Council — is **strongest exactly where it is least
verifiable**. Every trust-bearing step (findings structure, anonymized ranking, tier
assignment, street-cred, run-stats) is **manual Claude hand-math against a 31 KB prose
spec, with zero code and zero tests**. It has already drifted in shipped runs. Concrete
evidence from the real `av-receiver` run (`SecondBrain/output/av-receiver-council/`):

- **An undocumented 4th tier ("Disputed")** appears in `crossreview-matrix.md` but is not in
  COUNCIL-DESIGN §5.2 (which defines only Confirmed / Contested / Singleton).
- **An internal contradiction in one file**: finding C2 is tagged `Contested` in the grid and
  listed under `Disputed` in the same file's summary.
- **Self-votes folded into a perfect score**: GPT's `1.00` street-cred includes its own
  self-ranking; the matrix annotates it but still counts it.
- A separate shipped run fabricated a `~96,000 ms` chair duration the spec says never to invent.

A code-free taxonomy mutates run-to-run — corrosive for a product whose pitch is
*consistency and trust*. WS-3 makes the trust machinery **reproducible, regression-guarded
code** while keeping the council a Claude-driven skill: code owns the arithmetic and the
schemas; Claude keeps the judgment and can override at the margins.

## 2. Locked decisions (from brainstorm)

1. **Trust boundary — deterministic helpers, Claude overrides.** A new `amicus council` code
   surface does the pure arithmetic and codifies the rules; Claude still owns council
   selection, anonymization, briefings, synthesis presentation, and may override any tier the
   engine assigns. COUNCIL-DESIGN §2/§9 is amended to carve out "deterministic
   arithmetic/formatting helpers" as compatible with "skill, not app" (exact wording in §8).
2. **Self-vote / self-rank — report both, bench-recs use peers-only.** Street-cred is computed
   two ways (with-self and peers-only); the matrix shows both; the ledger and Stage-0 bench
   recommendations consume **peers-only**.
3. **Tiers are peers-only too.** A finding's tier counts only **independent peer**
   adjudications; the raiser's adjudication of its own finding is excluded (consistent with the
   peers-only street-cred rule).
4. **Ledger scope — model-level metadata only.** The global, append-only reliability ledger
   stores per-model scores/metadata only — **no finding text, no claim strings, no artifact
   body content** ever leaves the run folder. (It does retain a human-meaningful `runId` topic
   slug as metadata — see §7.) Full per-finding detail lives only in the run-folder
   `verdict.json`.

## 3. Architecture

Four units, one new `src/council/` module directory, one new `amicus council` CLI command
group. The council remains an executed skill; these are the deterministic helpers it calls.

| Unit | Enh | New code | Interface (pure unless noted) |
|---|---|---|---|
| A. Findings contract | #5 | `src/council/findings.js` | `validateFindings(jsonText) → {ok, findings[], errors[]}` (repair re-prompt = skill) |
| B. Tally engine | #1 | `src/council/tally.js` | `tally(input) → record` (cascade, street-cred, run-stats validation) |
| C. Decision record | #12 | `src/council/verdict.js` | `buildVerdict(record, decisions) → verdict`; verdict schema lives here (split from tally to stay under the size gate) |
| D. Reliability ledger | #9 | `src/council/ledger.js` | `appendRun(record)`, `deriveReliability()` over `getConfigDir()/council-ledger.jsonl` |

**Command surface** (verified against the repo — corrected from an earlier draft):
- Add `case 'council': exitCode = await handleCouncil(args); break;` to the `switch (command)`
  in **`bin/amicus.js`** (the real dispatcher; cases 75–111), alongside `start`/`fanout`/`models`.
- Put `handleCouncil` in a new **`src/cli-handlers-council.js`** (mirrors the WS-2
  `cli-handlers-run.js` split), delegating heavy logic to `src/council/`. Sub-subcommand
  (`council tally <input.json>`, `council stats`) parses via the existing `args._[1]/_[2]`
  positionals (cf. `handleKey`).
- Add `'council'` to **`ONE_SHOT_COMMANDS`** in `src/utils/lifecycle.js:15` (local-only: no
  OpenCode server).
- Add a `council` usage block to **`getUsage()` in `src/cli.js`**.
- On `--json` pre-flight failure, call **`failJson(useJson, {code: ERROR_CODES.BAD_ARGS,
  message, hint})`** (`src/utils/error-doc.js:46`) — it builds the WS-2 envelope, writes it to
  stdout, and returns exit 1. (Do not call `buildErrorDoc` directly; `failJson` wraps it.)

Commands:
- `amicus council tally <input.json> [--json]` → emits the analytical `record`.
- `amicus council stats [--json]` → aggregates the ledger into the reviewer-reliability table;
  powers Stage-0 bench recommendations.

`verdict.json` is written by the **skill** at Stage 5 via `buildVerdict()` (schema owned by
code so it cannot drift); no separate command (YAGNI).

### Data flow

```
Stage 1  fanout --json ─→ raw reviews (prose + fenced JSON findings)
                            │  #5 validateFindings(); ≤2 solo re-prompts on malformed;
                            │     else flag `unstructured` + Claude hand-parses
Stage 2  fanout --json ─→ rankings + adjudications (anonymized A/B/C review labels)
                            │  Claude de-anonymizes via the label↔model map and ASSEMBLES the
                            │  tally input (§5.1 assembly recipe)
Stage 3  amicus council tally  ─→ tiers · street-cred(with-self + peers-only) · run-stats
                            │     (Claude may override a margin tier; override recorded)
         chair synthesis (unchanged) → verdict.md (prose)
Stage 4  decisions accept / deny / modify / defer (Claude + user)
Stage 5  buildVerdict(record, decisions) → verdict.json (schema-stamped, atomic write → run folder)
Stage 6  ledger.appendRun(record)  → council-ledger.jsonl (auto; model-level only)
                            │       MODEL-NOTES prose update stays approval-gated
   next run  Stage 0  ──→  amicus council stats feeds the bench recommendation
```

**Boundary invariants:**
- **Anonymization never enters code.** Claude builds the anonymized Stage-2 bundle and
  de-anonymizes before calling `tally`; the engine only ever sees real model ids on labeled
  data. §5.1 stays entirely in the skill.
- **No invented numbers.** `tally` reads real `durationMs` and the WS-2 `usage` block from the
  per-leg run documents (`result-schema.js` v2). It never fabricates a duration or cost;
  missing data renders `null` (§5.4).

## 4. Unit A — #5 Findings contract

**Dual output, prose + fenced JSON.** The Stage-1 briefing (SKILL.md) asks each reviewer for
its normal prose review **and** a trailing fenced ` ```json ` block. Prose is preserved for the
chair and the human; the JSON is what `tally` ultimately consumes. This formalizes the format
COUNCIL-DESIGN §Stage 1 already prescribes.

```json
{
  "overall": "one-paragraph take",
  "findings": [
    { "id": 1, "severity": "blocker",
      "claim": "Cinema 70s is 7.2ch/~50W, uses MultEQ not XT32 — not 9ch/100W",
      "location": "Runner-up section / 'Cinema 70s (9ch, 100W)'",
      "rationale": "Denon spec sheet: 70s is a slimline 7.2 receiver." }
  ]
}
```

- Ids are sequential integers `1..n` **within each review** (call this the review-local id).
  At Stage-2 assembly Claude rewrites each into a **run-global label id** (`A1`, `B1`, …) by
  prefixing the review's anonymized label — that label id is what `tally` input uses (§5.1).
  The field name stays `id`; its type changes from integer (Unit A output) to string (tally
  input) across this boundary by design.
- `severity ∈ {blocker, major, minor, nit}`.

**`validateFindings(jsonText) → {ok, findings[], errors[]}`** (pure, `src/council/findings.js`):
extracts the fenced block, parses JSON, and checks: `findings` non-empty; ids unique and
sequential from 1; `severity` in enum; `claim`/`location`/`rationale` present non-empty strings.
Returns structured `errors` with stable codes — `NOT_PARSEABLE`, `NO_FENCED_BLOCK`,
`EMPTY_FINDINGS`, `DUPLICATE_ID`, `NON_SEQUENTIAL_ID`, `BAD_SEVERITY`, `MISSING_FIELD`. If
multiple fenced ```json blocks exist, the **last** one is the findings block (reviews may quote
JSON in prose).

**Repair = up to two tightly-scoped retries, then graceful fallback** (skill behavior):
1. Leg's JSON fails → skill issues a **solo `start --json`** re-prompt to *that one model*:
   "re-emit only the findings JSON, fixing: \<errors\>." Prose from the first pass is kept.
   (Solo `start` is **not** subject to the WS-2 fanout cost gate — see §9 — so a repair can't be
   refused mid-council.)
2. Retry once more if still malformed (cap **2**).
3. Still malformed → flag that review `unstructured`; Claude best-effort-parses its prose into
   the schema by hand; the review proceeds (never dropped for a formatting miss).

Per-model **conformance** (`clean` | `repaired` | `unstructured`) is recorded and carried into
the tally input's `runStats` (§5.1) → Stage-6 MODEL-NOTES note + a structural-reliability signal
in the ledger.

The **red-team** leg obeys the same contract (one schema for all reviewers).

## 5. Unit B — #1 Deterministic tally engine

### 5.1 Input / output + the Stage-2 → tally assembly recipe

`tally(input)` is a pure function. Claude assembles the **de-anonymized** input from the Stage-1
findings and the Stage-2 wave. The two load-bearing de-anonymization steps the skill performs:

- **`adjudications`**: every judge adjudicates **all** findings across **all** reviews. So one
  judge contributes many rows. `findingId` is the **run-global label id** (`A1`, `B1`, …); the
  raiser of `A1` resolves through the label↔model map (`A → deepseek`).
- **`rankings[].order`**: the skill's raw Stage-2 output is `FINAL RANKING: 1. Review C / 2.
  Review A / 3. Review B` over **review labels**. Claude translates the label order into a
  **model** sequence via the same map. Worked example — GPT's block `1. Review C, 2. Review A,
  3. Review B` with `{C→mistral, A→deepseek, B→gpt}` ⇒ `order: ["mistral","deepseek","gpt"]`.

```json
{
  "meta": { "runId": "av-receiver-council", "runType": "product-recommendation",
            "date": "2026-06-23T15:00:00Z", "models": ["…gpt","…deepseek","…mistral"],
            "chair": "…deepseek", "claudeInCouncil": false },
  "findings": [
    { "id": "A1", "raiser": "…deepseek", "severity": "blocker", "claim": "…" }
  ],
  "rankings": [
    { "judge": "…gpt",      "order": ["…gpt","…deepseek","…mistral"] },
    { "judge": "…deepseek", "order": ["…gpt","…deepseek","…mistral"] }
  ],
  "adjudications": [
    { "judge": "…gpt", "findingId": "A1", "verdict": "agree" },
    { "judge": "…gpt", "findingId": "A2", "verdict": "agree" },
    { "judge": "…gpt", "findingId": "B1", "verdict": "agree" }
  ],
  "runStats": [
    { "model": "…gpt", "role": "council", "wasChair": false, "conformance": "clean",
      "status": "complete", "durationMs": null, "usage": null }
  ]
}
```

- `verdict ∈ {agree, dispute, neutral}` (maps to the `a`/`d`/`n` counters in §5.2).
- `role ∈ {council, redteam, claude}` — the **review function**, orthogonal to chair-ness;
  `wasChair` is a separate boolean (a council reviewer can also chair). `model`, `status`,
  `durationMs`, `usage` are read **verbatim** from the per-leg run docs; `role`, `wasChair`, and
  `conformance` are council-domain labels Claude **attaches** during assembly (the engine
  validates their shape, never derives them).

Output `record`:

```json
{
  "schemaVersion": 1,
  "meta": { "…echoed verbatim from input.meta…": true },
  "streetCred": [ { "model": "…gpt", "withSelf": 1.0, "peersOnly": 1.0,
                    "perJudgeRank": { "…deepseek": 1, "…gpt": 1, "…mistral": 1 } } ],
  "findings": [ { "id": "A1", "raiser": "…deepseek", "severity": "blocker",
                  "tier": "Confirmed", "basis": { "a": 2, "d": 0, "n": 0 },
                  "confidence": "solid", "tierOverride": null,
                  "adjudications": [ { "judge": "…gpt", "verdict": "agree" } ] } ],
  "runStats": [ /* validated echo of input.runStats incl. role/wasChair/conformance */ ],
  "tierCounts": { "Confirmed": 19, "Contested": 2, "Singleton": 11, "Disputed": 3 }
}
```

The `meta` block is echoed so `buildVerdict` (§6) and `ledger.appendRun` (§7) can populate their
top-level fields (`runId`, `runType`, `date`, `chair`, `models`, `claudeInCouncil`) from the
record alone. `meta.date` originates as the run-finalize ISO timestamp the skill supplies.
`tally` does **not** consume `duplicateOf` (that is a Stage-4 Claude judgment — §6).

### 5.2 Tier taxonomy (4 canonical tiers, peers-only)

For a finding raised by model `R`, the **peers** are all judges except `R`. Among peers:
`a` = agrees, `d` = disputes, `n` = neutrals. The raiser's own adjudication is **excluded**
(decision 3). Tier is assigned by this priority cascade (exhaustive and mutually exclusive over
all `(a,d)`):

| Priority | Tier | Rule | Meaning |
|---|---|---|---|
| 1 | **Disputed** | `d ≥ 2` and `d > a` | Strong peer pushback — the finding itself is likely wrong |
| 2 | **Confirmed** | `a ≥ 2` and `a > d` | ≥2 independent corroborations, agrees dominate |
| 3 | **Contested** | `d ≥ 1` (whatever remains) | At least one live dispute — in question |
| 4 | **Singleton** | else — reached only when `d = 0` and `a < 2` | At most one endorsement, no pushback — thin |

- `confidence` is `thin` when total engaged peers `a + d ≤ 1` — i.e. cells **`(0,0)`, `(1,0)`,
  `(0,1)`** — else `solid`. **Claude may override `tier` at `thin` margins**; an override sets
  `tierOverride: {from, to, reason}` and is surfaced in the matrix and verdict.json.
- **Large-bench tie** (`a = d`, both `≥ 2`, e.g. 4+ peers): falls through to Contested by the
  cascade — a deliberate choice (no winner). The av-receiver fixture has only 2 peers per
  finding, so this cell is covered by a dedicated unit-test row, not the golden fixture.

**Consequence to expect (a feature, not a regression):** in a 3-model council each finding has
only 2 peers, so **Confirmed requires both peers to agree.** Findings that read "Confirmed"
today only because the raiser's self-agree was counted (one peer agree + one neutral) become
**Singleton** by default. Claude can promote a clearly-valid thin finding via a recorded
override, and Stage 4 presents Singletons individually anyway.

### 5.3 Street-cred (both numbers)

Per judge's `FINAL RANKING:` block (translated to a model `order`), each model gets a rank
position (1 = best). For each model:
- **withSelf** = mean rank across **all** judges' rankings.
- **peersOnly** = mean rank across judges **other than** that model.
- **Ranking ties** within one judge's block get **fractional ranking** (the mean of the
  positions they span, e.g. a tie for 2nd–3rd → 2.5 each).
- **Zero/one-peer cases (defined, not undefined):**
  - `peersOnly = null` when the non-self judge count is `0` (e.g. a degraded single-surviving-
    judge bench). The ledger records `peersOnly: null` and `deriveReliability` excludes nulls
    from its averaging (consistent with the low-N flag).
  - A model that casts **no** ranking (Claude-in-council never ranks) is in nobody's exclusion
    set, so `withSelf == peersOnly` for it — stated explicitly, not a coincidence.
  - If a model is **absent** from a judge's `FINAL RANKING` block, that judge is **skipped** for
    that model's averages (not treated as worst).

The matrix shows both; ledger + bench-recs use `peersOnly`.

### 5.4 Run-stats — real data only, with explicit provenance

`runStats` is a **caller-supplied** field that `tally` validates and echoes — it never invents.
Provenance: Claude populates it by reading the per-leg run documents emitted by `fanout --json`
(and the solo red-team/chair `start --json` docs), **concatenating the three council waves'
legs**. `model`/`status`/`durationMs`/`usage` are copied verbatim; any leg with **no** run doc
gets `durationMs: null` (and `usage: null`), never a guess. This structurally kills the
`~96,000 ms` fabrication: there is no code path, and the discipline ("read the doc or write
null") is the contract.

> Note: the `av-receiver` run folder contains only `.md` artifacts (no `wave.json`/
> `metadata.json`), so the golden fixture's run-stats use `durationMs: null` — and deliberately
> include a `null` leg to exercise the null path (§5.6).

### 5.5 Duplicate, rate & edge handling (codified)

- **Cross-review duplicates** (e.g. `A1=B1=C1=C15`, all "Cinema 70s"): each finding is tallied
  **independently** for tiers. De-duplication into unique issues is a **Stage-4 Claude
  judgment**; Claude may set `duplicateOf` (carried into verdict.json by `buildVerdict`, §6),
  but the canonical tally treats each finding separately.
- **`confirmRate` / `factErrorRate` are computed over RAW `findingsRaised`** (not de-duped), so
  they stay deterministic and independent of Claude's `duplicateOf` calls. Denominator = **all**
  of the model's raised findings; `confirmRate` = share ending Confirmed, `factErrorRate` =
  share ending Disputed (the remainder is Contested/Singleton). **Known limitation:** a model
  that self-raises duplicates of a true issue (Mistral's C1/C15 restate A1) inflates both
  numerator and denominator — documented here and in §13 so it isn't later read as a bug; a
  `duplicateOf`-collapsed rate is a possible future refinement, not in scope.
- **All-neutral finding** (`a=0, d=0`) → Singleton, `confidence: thin`.
- **Single-model run** → no Stage 2 → `tally` is **not called**; verdict.json records findings +
  decisions with `tier: "single-pass"`; the ledger row is `judged:false` (§7).
- **Degraded bench** (a judge leg died) → `tally` computes over surviving judges only; fewer
  peers ⇒ more `thin` flags and possibly `peersOnly: null` (§5.3). The reduced bench is
  disclosed in the matrix.
- **Chair is also a council member** → `role:"council"` + `wasChair:true`.
- **Claude-in-council** (opt-in) → Claude's review is judged like any other (gets a tier split
  and `withSelf == peersOnly` street-cred) but Claude casts no ranking/adjudication; its ledger
  row is `role:"claude"` and is excluded from non-Claude bench recommendations.

### 5.6 Golden-fixture eval — the complete contract

`tests/council/tally.test.js` (jest, deterministic, no LLM) encodes the real `av-receiver`
Stage-1/Stage-2 data as `tally` input → the **corrected** expected output, asserting the tier
for **every** finding. The fixture contract (peers-only, raiser column excluded; `a/d/n` are the
two peer columns):

| Finding | Raiser | a | d | n | Tier | Conf. |
|---|---|---|---|---|---|---|
| A1 | DeepSeek | 2 | 0 | 0 | Confirmed | solid |
| A2 | DeepSeek | 2 | 0 | 0 | Confirmed | solid |
| A3 | DeepSeek | 1 | 0 | 1 | Singleton | thin |
| A4 | DeepSeek | 2 | 0 | 0 | Confirmed | solid |
| A5 | DeepSeek | 2 | 0 | 0 | Confirmed | solid |
| A6 | DeepSeek | 1 | 0 | 1 | Singleton | thin |
| A7 | DeepSeek | 0 | 0 | 2 | Singleton | thin |
| A8 | DeepSeek | 2 | 0 | 0 | Confirmed | solid |
| B1–B6 | GPT | 2 | 0 | 0 | Confirmed | solid |
| B7 | GPT | 1 | 0 | 1 | Singleton | thin |
| B8 | GPT | 1 | 0 | 1 | Singleton | thin |
| B9 | GPT | 2 | 0 | 0 | Confirmed | solid |
| B10 | GPT | 1 | 0 | 1 | Singleton | thin |
| B11 | GPT | 1 | 0 | 1 | Singleton | thin |
| B12 | GPT | 1 | 0 | 1 | Singleton | thin |
| C1 | Mistral | 2 | 0 | 0 | Confirmed | solid |
| C2 | Mistral | 0 | 1 | 1 | Contested | thin |
| C3 | Mistral | 1 | 1 | 0 | Contested | solid |
| C4 | Mistral | 2 | 0 | 0 | Confirmed | solid |
| C5 | Mistral | 1 | 0 | 1 | Singleton | thin |
| C6 | Mistral | 0 | 2 | 0 | Disputed | solid |
| C7 | Mistral | 0 | 2 | 0 | Disputed | solid |
| C8 | Mistral | 2 | 0 | 0 | Confirmed | solid |
| C9 | Mistral | 1 | 0 | 1 | Singleton | thin |
| C10 | Mistral | 1 | 0 | 1 | Singleton | thin |
| C11 | Mistral | 2 | 0 | 0 | Confirmed | solid |
| C12 | Mistral | 0 | 2 | 0 | Disputed | solid |
| C13 | Mistral | 2 | 0 | 0 | Confirmed | solid |
| C14 | Mistral | 2 | 0 | 0 | Confirmed | solid |
| C15 | Mistral | 2 | 0 | 0 | Confirmed | solid |

→ **`tierCounts = {Confirmed:19, Contested:2, Singleton:11, Disputed:3}` (sum 35).** Test
comments document the deltas from today's hand-math artifact: the eight Confirmed→Singleton
downgrades (A3, A6, B7, B8, B10, B11, B12, C9) caused by excluding the raiser's self-agree, and
**C2 — which was already `Contested` in the grid and stays `Contested` here; the engine doesn't
reclassify it, it removes the grid-vs-summary contradiction** (the summary wrongly filed C2
under Disputed). Per-raiser raw rates from this table: DeepSeek confirm 5/8≈0.63, GPT 7/12≈0.58,
Mistral 7/15≈0.47, fact-error Mistral 3/15=0.20 (the rest 0).

**Street-cred needs a separate, non-degenerate fixture.** In `av-receiver` every judge ranked
GPT 1 / DeepSeek 2 / Mistral 3 identically, so `peersOnly == withSelf` for all models and there
are no ties — the dataset cannot detect a peers-only-exclusion bug or exercise the fractional-
rank rule. Add a **synthetic** street-cred case in `tally.test.js` where (a) a model's self-rank
differs from how peers rank it (`withSelf ≠ peersOnly`) and (b) one judge's block has a tie (to
assert the 2.5-style fractional rank). The av-receiver fixture validates **tiers**; the synthetic
fixture validates **street-cred**.

## 6. Unit C — #12 verdict.json (`src/council/verdict.js`)

The machine-readable sibling of the human artifacts. `verdict.md` stays the chair's **prose**
synthesis; `verdict.json` is the **schema-stamped record** of the tally + the Stage-4 decisions,
assembled by `buildVerdict(record, decisions)` (reads `record.meta`, `record.findings`,
`record.streetCred`, `record.runStats`, and the Claude/Stage-4 `decisions` — including any
`duplicateOf` links, which originate on the decisions side). Written by the skill to
`<runFolder>/verdict.json` via an **atomic write (tmp + rename, matching the repo's `wave.json`
convention)**, overwriting on re-run. The name `verdict.json` is **locked** (resolves §13).

```json
{
  "schemaVersion": 1,
  "runId": "av-receiver-council", "runType": "product-recommendation", "date": "2026-06-23T15:00:00Z",
  "chair": "…deepseek", "council": ["…gpt","…deepseek","…mistral"], "claudeInCouncil": false,
  "findings": [
    { "id": "A1", "raiser": "…deepseek", "severity": "blocker", "tier": "Confirmed",
      "basis": {"a":2,"d":0,"n":0}, "confidence": "solid", "tierOverride": null,
      "duplicateOf": null,
      "adjudications": [ {"judge":"…gpt","verdict":"agree"}, {"judge":"…mistral","verdict":"agree"} ],
      "decision": "accepted", "applied": true }
  ],
  "streetCred": [ {"model":"…gpt","withSelf":1.0,"peersOnly":1.0} ],
  "runStats":  [ {"model":"…gpt","role":"council","wasChair":false,"status":"complete","durationMs":null,"usage":null} ],
  "tierCounts": {"Confirmed":19,"Contested":2,"Singleton":11,"Disputed":3}
}
```

`decision ∈ {accepted, denied, modified, deferred}`; `applied` = whether the change reached the
reviewed copy. Schema-stamped to enable a future `amicus council diff` ("did the revision
resolve the Contested findings?") — that command is **out of scope** here, only enabled.

## 7. Unit D — #9 Reliability ledger (`src/council/ledger.js`)

**File:** append-only `council-ledger.jsonl` under `getConfigDir()` (the legacy `~/.config/
sidecar` fallback resolves on this machine via the deprecated `amicus-shim`; new installs use
`~/.config/amicus`). Model-level metadata only (decision 4). One row per (run × model), built
deterministically by `ledger.appendRun(record)` from the tally `record`:

```json
{
  "schemaVersion": 1,
  "runId": "av-receiver-council",
  "date": "2026-06-23T15:00:00Z",
  "runType": "product-recommendation",
  "model": "…gpt",
  "role": "council",            // council | redteam | claude  (NOT chair)
  "wasChair": false,            // orthogonal: a council/redteam model may also have chaired
  "judged": true,              // false for single-pass runs
  "streetCredWithSelf": 1.00,
  "streetCredPeersOnly": 1.00, // null when there were 0 non-self peers
  "findingsRaised": 12,
  "bySeverity": { "blocker": 1, "major": 5, "minor": 5, "nit": 1 },
  "confirmRate": 0.58,         // peers-only, over RAW findingsRaised: 7/12
  "factErrorRate": 0.0,        // peers-only, over RAW findingsRaised: 0/12
  "conformance": "clean"       // clean | repaired | unstructured
}
```

- **`deriveReliability()` / `amicus council stats`** aggregates per model across runs: runs,
  avg peers-only street-cred (nulls excluded), lifetime confirm-rate, fact-error rate,
  conformance distribution, per-`runType` breakdown; **flags low-N models** (`runs < 3`) so a
  one-run fluke can't masquerade as a track record. `--json` for skill consumption.
- **Source-of-truth inversion:** the COUNCIL-DESIGN §7 / MODEL-NOTES reliability table is today
  hand-edited (itself a drift vector). WS-3 makes the **ledger authoritative quantitative
  data**; MODEL-NOTES keeps only *qualitative* per-model quirks and may embed a generated
  snapshot. Stage 6 stops hand-editing reliability numbers.
- **Auto-append vs approval-gate:** the ledger append is **automatic** at run finalize (a
  deterministic, content-free record, shown in the run summary). The **MODEL-NOTES prose update
  stays approval-gated**, preserving the §9 "no automatic MODEL-NOTES writes" rule.
- **Judged-only contribution:** only runs with ≥2 peers contribute street-cred/confirm/fact-error;
  single-pass runs append a minimal `judged:false` row (conformance only). Claude rows are
  recorded but excluded from non-Claude bench recommendations.
- **`runId` is a topic slug** (the run-folder stem, e.g. `av-receiver-council`) — human-meaningful
  metadata, consistent with decision 4's tightened wording (no finding/claim/artifact-body text).
- **Migration note (non-blocking):** if/when `getConfigDir()` flips from the legacy `sidecar`
  dir to `~/.config/amicus`, the ledger must move with it (a pre-existing `council-ledger.jsonl`
  would otherwise be silently orphaned). `ledger.js` should resolve its dir once and document
  this; a one-time migration is a follow-up if the deprecated shim is ever removed.
- **Concurrency:** two councils finalizing at once both append to one file. Use an append-only
  write of a single serialized line per row (atomic `appendFile` of `JSON.stringify(row)+'\n'`);
  `deriveReliability` tolerates a trailing partial line (skips unpar. a malformed last line)
  rather than throwing.

## 8. Skill-side doc edits

- **COUNCIL-DESIGN.md** — rewrite §5.2 with the 4-tier taxonomy + peers-only rule + the cascade;
  replace the §7 manual table with "ledger authoritative, MODEL-NOTES qualitative"; §8 run-stats
  read real data. Amend §2/§9 with this exact carve-out sentence: _"Deterministic
  arithmetic/formatting/schema helpers under `amicus council` (findings validation, tier tally,
  street-cred, ledger) are sanctioned; judgment, synthesis, anonymization, and de-anonymization
  remain Claude's inline work."_
- **SKILL.md** — Stage 1 findings-contract briefing (dual prose+JSON + the ≤2-retry repair
  loop); Stage 2 → the §5.1 assembly recipe → `amicus council tally`; Stage 5 writes
  `verdict.json`; Stage 6 auto-appends the ledger row, prose update stays approval-gated; Stage 0
  consults `amicus council stats`.
- **MODEL-NOTES.md** — reliability numbers → generated from the ledger; keep per-model
  qualitative quirks + structural-conformance notes.

## 9. Versioning, degradation & failure handling

- Every new schema (findings / tally-`record` / verdict / ledger-row) carries its own
  `schemaVersion` starting at **1**, **independent** of the embedded WS-2 `result-schema`
  version (currently **2**): the `runStats`/`usage` sub-objects retain their own WS-2
  `schemaVersion` and are normalized by the WS-2 layer, not the council layer.
- The ledger is append-only and recomputable, so early rows survive a future bump
  (`deriveReliability` tolerates/normalizes mixed versions).
- Wave-degrade rules (COUNCIL-DESIGN §8) are unchanged; `tally` computes over surviving legs.
  Below 2 judges mid-run → degrade to single-pass and disclose.
- **Budget-gate interaction (documented, currently safe):** the WS-2 cost gate lives in
  `fanout.js` only; solo `start --json` (the repair re-prompt path) is **not** gated, so a repair
  cannot fail with `BUDGET_EXCEEDED`. Council fanouts remain gated normally. If a future refactor
  hoists the gate into `start.js`, the repair loop must be re-examined.
- `amicus council tally` validates its input and, on `--json`, emits a `failJson` /
  `buildErrorDoc` envelope on stdout for malformed input (`ERROR_CODES.BAD_ARGS`).

## 10. Testing

- **jest unit (deterministic, `tests/council/`):**
  - `findings.test.js` — every error code; last-block selection; valid passthrough.
  - `tally.test.js` — the §5.6 av-receiver golden table (all 35 tiers + `tierCounts`); a
    **synthetic** street-cred case (`withSelf ≠ peersOnly` + a tie); a **large-bench tie**
    (`a=d≥2 → Contested`) row; a **`durationMs: null`** leg; the **A1=B1=C1=C15** self-duplicate
    cluster's effect on each raiser's raw rate; override recording.
  - `verdict.test.js` — `buildVerdict` populates top-level fields from `record.meta`; `duplicateOf`
    carried from decisions; atomic-write behavior.
  - `ledger.test.js` — append; derive/aggregate; low-N flag; `judged:false` rows; **`peersOnly:
    null`** exclusion; mixed `schemaVersion` tolerance; trailing-partial-line tolerance;
    config-dir resolution.
- **real-LLM council smoke (F7-style, foreground, key-gated):** full pipeline end-to-end
  including a **deliberately malformed findings block** to exercise the repair retries and the
  `unstructured` fallback.
- New modules stay under the 300-line size gate (the split into `tally.js` + `verdict.js` is
  partly to honor this; split further if needed). `check-secrets` + `check-sizes` green; the WS-1
  CI workflow runs it all. (Tests under `tests/council/` are matched by the existing `testMatch`
  and are not size-gated.)

## 11. Build sequencing (feeds the plan)

`#5 findings.js` → `#1 tally.js` (+ §5.6 golden + synthetic fixtures) → `#12 verdict.js`
(record/verdict schema + `buildVerdict`) → `#9 ledger.js` + `amicus council stats` →
`cli-handlers-council.js` + wiring (`bin/amicus.js` switch, `ONE_SHOT_COMMANDS`, `getUsage`) →
docs (SKILL / COUNCIL-DESIGN / MODEL-NOTES) → real-LLM smoke + Opus holistic review → merge to
local `main` (worktree `amicus-ws3` off `3a83af7`, node_modules junctioned so hooks fire,
**local-only** per program policy).

## 12. Out of scope (YAGNI)

- `amicus council diff` (#12 bench item; enabled, not built).
- A numeric peer-confidence score (keep the 4 tiers — COUNCIL-DESIGN §10 open question).
- A `duplicateOf`-collapsed confirm-rate (raw rate ships; refinement deferred).
- MCP wrappers for `tally`/`stats` (CLI-first; add later if a Cowork flow needs them).
- Backfilling the ledger from past run folders (start fresh).

## 13. Open questions / calibration

- **Margin-cell tier defaults** (`(1,0)` → Singleton, `(0,1)` → Contested, both `thin` +
  override-eligible): the §5.6 golden table is the calibration anchor; revisit only if real runs
  show the defaults misfire often.
- **`verdict.json` naming**: locked to `verdict.json` (sibling of `verdict.md`); the earlier
  `record.json` alternative is dropped.
