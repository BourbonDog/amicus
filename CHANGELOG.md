# Changelog

All notable changes to Amicus are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver.

## [Unreleased]

## [4.1.0] - 2026-07-21

The `second-opinion` skill stops hand-driving councils. Stages 1–3 and the Stage-5 artifacts
collapse into a single `amicus council run`, leaving Claude only the stages that genuinely need
judgement — intake, decisions, and lessons. The engine gains an optional rebuttal round so a
finding's author can answer the reviewers who disputed it, and Claude can now enter its own review
into the bundle without ever being launched as a model leg.

### Added

- **Skill fast path.** `skills/second-opinion/SKILL.md` now delegates Stages 1–3 (and the Stage-5
  artifact materialization) to one `amicus council run` invocation; the human stages (0 intake,
  4 decisions, 6 lessons) stay Claude-orchestrated. The manual mechanics are preserved verbatim in
  the new `skills/second-opinion/MANUAL-ORCHESTRATION.md` as the documented fallback for when the
  engine is unavailable or a case the fast path cannot express.
- **Headless debate mode** — `amicus council run --debate` / `amicus_council_run {debate:true}`.
  A Stage-2.5 rebuttal round runs between cross-review and the final tally: findings that came out
  Contested or Disputed go back to the model that raised them, which defends, amends, or withdraws
  each; the judges who disputed them then re-vote; a final tally folds the outcome in. Exactly one
  round, structurally — there is no edge back into a debate stage. `run.json` gains an additive
  `debate` summary, tally/verdict findings gain a `debate` decoration, and both report renderers
  gain a "Debate round" section. The Council Review Action gains a `debate` input (default off),
  and withdrawn findings are excluded from its PR annotations.
- **`--claude-review <file>` / `claudeReviewFile`.** Enters Claude's own review as judged review
  N+1 from a file. No model leg is ever launched for it and it may never chair — `claude` is a
  reserved seat name that is rejected pre-flight in `--models`, `--chair` and `--critic` on such a
  run.
- **`--render` on `council verdict`, `render:true` on `amicus_verdict`.** Refreshes `report.html`
  from the decided verdict. The MCP tool also returns the markdown rendering; it writes only when
  an `outDir` inside the project is supplied, and its `readOnlyHint` is now correctly `false`.
- **`--no-cost-gate` on `council run`.** Disables the per-leg price gate for the whole run —
  repairs, chair chain and debate legs included — in one place instead of per invocation.

### Fixed

- **The Council Review Action no longer defaults to a bench that cannot lose a leg.** Its default
  `models` were `deepseek,gemini,glm` with `deepseek` as chair; because the chair is excluded from
  the bench, that left **two** seats against a quorum minimum of two, so one stalled leg failed the
  entire review. The default is now four seats (`gpt,qwen,minimax,grok`), leaving real slack.
- **`postinstall` now installs `SEAT-BRIEFS.md`.** It shipped in the tarball but was never copied
  into `~/.claude/skills/second-opinion/`, so the seat briefing reference has been missing from
  every installation to date.
- **`amicus council verdict` no longer discards the chair's verdict.** Writing the decided verdict
  over the engine's one dropped `overallVerdict` to `null`, because the tally record it is built
  from does not carry it. `runVerdict` now recovers it from the run folder — the engine's
  `verdict.json` when present (guarded on `runId`, so a foreign file cannot inject another run's
  verdict), otherwise by re-parsing `chair-output.md` with the engine's own chair parser. A run
  whose chair was skipped still yields `null`; nothing is ever invented. `amicus_verdict` had the
  same loss on the Cowork path and gains an explicit optional `overallVerdict` input, since the MCP
  tool receives a record inline with no run folder to recover from.

### Documentation

- **The skill's Stage 4 and Stage 5 now name where finding claims actually live.** Both stages
  instructed the reader to show each finding's claim while pointing only at `tally.json`, whose
  findings carry tiers and adjudications but no `claim`. The claim and location live in
  `tally-input.json`; both stages now state the join (on finding `id`) explicitly.

### Changed

- **`claude` can no longer be promoted as fallback chair on any run.** When a configured chair
  dies, the engine promotes another model by reliability; `claude` is now excluded unconditionally.
  This affects runs that never use `--claude-review`, because the reliability ledger has no way to
  distinguish a file-sourced `claude` row from a real leg — and promoting it would select a chair
  the engine cannot launch.
- **`npm i -g amicus@4.1` rewrites the installed `SKILL.md`** to the fast path (existing
  product-code overwrite policy). `MODEL-NOTES.md` remains machine-local and is never overwritten.
  Rollback is a reinstall of 4.0.x.

### Notes

- All changes are additive: the council document family stays `schemaVersion: 2`, the MCP tool
  count stays 15 (new inputs only), and a run using none of the new flags produces byte-identical
  artifacts to 4.0.1. No migration is required.

## [4.0.1] - 2026-07-20

Follow-up fixes to the v4.0.0 council engine: `amicus abort` and `amicus status` now see every
sub-wave a stage launched, a council run that dies before its first checkpoint is recoverable
instead of stranded, and neither command can be thrown by a malformed wave record.

### Fixed

- **`amicus abort` now cascades to every in-flight council leg, not just the primary wave of
  each stage.** A stage can own several sub-waves — the chair's `ch1..ch4` retry/fallback/repair
  chain, one solo per lens, a critic solo beside the seat wave, and the bounded Stage-1/Stage-2
  repair re-prompts — but only a single `waveId` was recorded per stage (and the chair stage
  recorded none at all), so the targeted cascade skipped those legs and left them to the
  `waitThenKill` process-tree fallback. They were still killed, so this was never a leak or a
  hang; what was lost were the per-leg `aborted` markers, an accurate `legsAborted` count, and a
  faithful per-stage audit trail in `run.json`. Stage entries now carry a `waveIds` array
  recording every sub-wave at launch time (documented in `schemas/council-run.schema.json`), and
  the cascade targets the union of `waveId` + `waveIds`. In lens mode `stage1` previously
  advertised only a phantom `-s1` wave that never launches, so *no* Stage-1 leg was reachable;
  lens runs no longer record that `waveId` at all.
- **`amicus status` now rolls up council legs across every sub-wave of the active stage.** It
  counted only the stage's primary `waveId`, so a lens run — which has no seat wave — always
  reported `legsTotal: null`, and a run with a critic omitted the critic's leg from the count
  (e.g. `2` instead of `3` for two seats plus a critic). Note that `legsTotal` can now rise
  mid-stage when a bounded repair re-prompt launches, which is a real additional model call.
- **A council run spawned through `amicus_council_run` that died before its first checkpoint no
  longer strands an unrecoverable record.** The MCP handler wrote `run.json` with
  `status: "running"` and no `pid`, leaving the spawned CLI child to record its own pid at
  startup; a child that died inside that window left a pid-less `running` run that `amicus
  status` skipped entirely (its crash detection is guarded on `run.pid`) and that `amicus abort`
  could not fall back to killing, so the run was recoverable only by hand. The handler now
  captures the pid from the spawned child and checkpoints it immediately — the same value the
  engine writes itself, recorded a beat earlier. The pid is written to its own
  `spawn.pid` file rather than patched into `run.json`: the spawning process and the engine
  child both write `run.json`, and `checkpoint` is a read-merge-write with no cross-process
  lock, so a pid patch could clobber (or be clobbered by) the child's first checkpoint. Readers
  prefer `run.json`'s own pid and fall back to `spawn.pid`.
- **A malformed wave `metadata.json` no longer throws out of `amicus status` or `amicus abort`.**
  `countWaveLegs` and `cascadeWave` both assumed the `legs` field was an array if it was present
  at all, so a half-written or hand-edited record raised a `TypeError` past its caller. Both now
  treat a non-array `legs` as no legs. `cascadeWave`'s wave-level abort mark is also guarded, so
  a failure there can no longer discard the count of legs it had already marked.

## [4.0.0] - 2026-07-20

The **headless council engine** release. `amicus council run` (CLI) and `amicus_council_run`
(MCP) execute the full adjudicated pipeline — Stage-1 independent reviews → anonymized peer
cross-review → deterministic tally → non-Claude chair verdict — with **no Claude runtime**,
reusing the existing pure primitives (`validateFindings`, `tally`, `buildVerdict`, the report
renderers, the ledger) under a run-directory state machine. On top of it, the **Council Review
GitHub Action v2** posts a real adjudicated verdict on labeled PRs (check run + annotations,
sticky comment, evidence artifact, opt-in gating). The major bump exists for the three trust
changes below — see **Migration**.

### Migration (v3 → v4)

| v3 behavior | v4 behavior / remedy |
| --- | --- |
| MCP council tools (`amicus_council_tally`, `amicus_council_stats`, `amicus_verdict`) returned **bare JSON** tool text | Their JSON is now wrapped in the `<untrusted_sidecar_output>` fence (same mechanism as `amicus_read`), and the new `amicus_council_run` returns fenced text too. MCP consumers that parse the tool text must unwrap the fence first; the JSON inside is byte-intact. **CLI `--json` output is unchanged and stays the byte-stable programmatic channel.** |
| `amicus council stats --json` printed a **bare array** of per-model rows | It now prints `{"schemaVersion": 2, "type": "council-stats", "models": [...]}` — the one breaking shape change in the envelope unification. Update scripts to read `.models`. Every other envelope change is additive (`schemaVersion`/`type` injected onto existing docs; council family bumps 1 → 2; `verdict.json` gains nullable `overallVerdict`). |
| Some `--json` failure paths printed **plain text on stderr** (no model configured, model-selection cancelled, route errors, `status` with a missing/invalid task id; MCP validation/route errors as unstructured text) | Under `--json` these now emit the standard **error envelope on stdout** with the documented exit codes; MCP error text is error-doc-shaped (`{schemaVersion, type: "error", ...}`). Scripts that scraped stderr strings must read the stdout envelope. Human-mode (no `--json`) stderr behavior is unchanged. |
| Bare `[SIDECAR_FOLD]` markers were still written/parsed on legacy internal paths | The fold marker is **nonce-required** end to end: the bare literal survives only as the prefix inside the nonced form, resume replay strips residual fold-marker lines, and the internal legacy bare-marker finder/writer fallbacks are removed (`docs/SHIMS.md` updated). Wire-format consumers of the **nonced** form are unaffected. |
| Council Review Action v1 (fanout + synthesis; `max_cost` default `1.00`) | Action v2 runs `amicus council run` and posts an adjudicated verdict. `workflow_call` callers: new optional inputs `chair` (default `deepseek`), `critic`, `fail_on` (`none`\|`fix`\|`rethink`, default `none` = report-only); **`max_cost` default is now `2.00`** (a council is ~2 waves + chair + repairs vs v1's wave + synthesis) — pass `max_cost: '1.00'` explicitly to keep the old ceiling. `models`/`require_label`/secrets semantics unchanged. A chair listed in `models` is excluded from the bench at run time (the engine requires the chair not to be seated). |

### Added

- **`amicus council run`** — the headless council engine (CLI): `--prompt-file` briefing,
  `--models`/`--council` bench (≥2 seats), `--chair` (default `deepseek`, never a bench seat),
  optional `--critic` / `--lenses` (mutually exclusive), whole-run `--max-cost`, per-leg
  `--timeout`, durable `--out-dir` run directory (`review-*.md`, `bundle-stage2.md`,
  `judge-*.md`, `chair-output.md`, `tally-input.json`, `tally.json`, `verdict.json` with
  **`overallVerdict`**, `report.html`, `run.json`), exit contract `0` full / `2` degraded /
  `1` failed, SIGINT/SIGTERM finalization, and `status`/`wait`/`list`/`abort` integration via a
  sessions-dir pointer file. Stage 4 stays human: the engine is report-only.
- **`amicus_council_run`** MCP tool (15th tool): briefing-via-file like `amicus_fanout`, returns
  `{runId, runDir}` immediately (async).
- **Council Review GitHub Action v2** (`.github/workflows/council-review.yml`): adjudicated
  verdict as a **check run** ("Council Review") with Confirmed-finding annotations (best-effort
  `file:line` parse, 50-per-request chunking, file-level fallback, unmapped findings listed in
  the summary), **sticky comment v2** (chair verdict line, tier table, per-tier lists,
  street-cred table, cost line, artifact link), **evidence artifact** (the full run directory),
  and opt-in gating via `fail_on`. Label gate, fork soft-skip, no-checkout, and the duplicated
  `neutralize()` rules carry forward from v1.
- **Published JSON Schemas** (`schemas/`, draft 2020-12, one file per doc type) shipped in the
  npm tarball and documented in `docs/schemas.md`; every builder's real output is
  schema-validated in tests (ajv as a devDependency only).
- `docs/council.md` § `amicus council run` (headless reference), usage.md/README coverage, and a
  headless-context pointer in the `second-opinion` skill.

### Changed

- **Unified JSON envelope convention:** every emitted doc carries `{schemaVersion, type}`; the
  council family bumps **1 → 2** (additive fields, no re-nesting); `council validate --json`
  gains the envelope fields; CLI `status --json` gains `schemaVersion`; MCP success returns get
  `schemaVersion`/`type` injected additively. Ledger JSONL stays internal at v1 (documented
  exclusion). Interactive-only commands (`setup`, `update`, `key`) are documented envelope
  exclusions.
- `--json` failure paths routed through the error envelope on stdout (see Migration).
- MCP council-tool JSON is fenced with `<untrusted_sidecar_output>` (see Migration);
  `untrusted-fence.js`'s module doc and the skill's Cowork-transport note updated to match.

### Removed

- The legacy bare fold-marker internals: `findLegacyBareTrailingMarker` and the bare-writer
  fallback in `formatFoldOutput` (`nonce` is now a required argument). See Migration.

## [3.2.3] - 2026-07-18

### Fixed

- **The Electron repair lockfile key is per-install again.** `lockPathFor()`
  derived its temp-lockfile key from only the first 8 characters of the Electron
  dir path (its hex encoding truncated to 16 chars), so distinct installs that
  share a leading path segment (`C:\Users…`, `/home/us…`) collapsed onto a single
  shared lockfile — defeating the intended per-install isolation and causing
  intermittent cross-worktree test failures, where suites run from different
  `.claude/worktrees/*` raced on the same lock. The key now hashes the full
  Electron dir with sha1, mirroring the engine-lock fix shipped in v3.2.2. The
  public `acquireRepairLock` interface is unchanged, so there is no downstream
  impact; stale lockfiles from the old key simply age out (#69).

## [3.2.2] - 2026-07-17

### Fixed

- **A missing `opencode` engine now self-heals instead of failing every call.**
  When the engine binary is absent at a fanout/start — a skipped
  optional-dependency install or an antivirus quarantine of the npx-cache copy
  the MCP launches — amicus recovers in place by copying the `opencode-*`
  packages from a healthy sibling install (running, global, or another npx
  copy), then proceeds, instead of throwing `engineMissing` on every leg
  (report #2).

### Added

- **`amicus doctor --fix` repairs broken npx-cache engine copies**, self-healing
  the copies the MCP actually launches, not just the running install.

## [3.2.1] - 2026-07-17

### Fixed

- **`opencode` engine now resolves under the npx-launched MCP.** The MCP server is
  registered as `npx -y amicus@latest mcp`, which npm installs with the
  `opencode-windows-*` engine packages **hoisted** beside `amicus/` rather than
  nested under it. The resolver only probed the nested location, so a present,
  runnable engine read as missing and every `amicus_fanout` / `amicus_start` leg
  failed instantly with `engineMissing`. Both the PATH builder and the shared
  binary resolver now probe the hoisted root too (#69).
- **The AVX2 (default) `opencode` build is searched before the `-baseline`
  fallback.** `ensureNodeModulesBinInPath()` prepended PATH one entry at a time, so
  the search order was the reverse of the source order and AVX2-capable machines
  silently ran the slower pre-AVX2 baseline build. PATH is now built as one ordered
  group (default → baseline → `.bin`, across every candidate root).

### Added

- **`amicus doctor` cross-install engine check.** A new "OpenCode engine (MCP launch
  path)" check enumerates every install that could serve the MCP — running, global,
  and each npx-cache copy — and verifies the engine in each, so a green doctor can
  no longer hide a broken copy the MCP actually launches. A broken single npx copy
  (the unambiguous failure) is an error; ambiguous cases warn and name the exact
  path.
- The runtime `engineMissing` error now prints the roots it searched, making an
  npx-cache-vs-global install divergence visible at the point of failure.

## [3.2.0] - 2026-07-16

### Added

- **Cost-aware per-provider default model picker at key-add.** Adding a provider API key (`amicus key
  <provider>`, the setup wizard, or the Electron key step) now offers a picker that pre-selects a
  **balanced**-tier model instead of the priciest flagship, shows live `$/M` input pricing, and writes
  your choice as a vendor-named alias (e.g. `--model anthropic`) — seeding your overall default
  (`config.default`) on your first key. Applies to direct model vendors (OpenAI, Anthropic, Google,
  DeepSeek).
- **`routing.tier` preference** (`frontier` | `balanced` | `economy`, default `balanced`) biasing the
  picker's per-vendor pre-selection.
- A one-time onboarding tip on `amicus start` pointing existing users to the new picker.

### Changed

- Model aliases now resolve their per-gateway executable ids **by model**, so user-defined and
  vendor-named aliases route correctly across the direct and OpenRouter gateways (extends the v3.1.1
  gateway-correct-ids fix beyond the curated defaults). An alias whose value is an explicit
  `openrouter/…` id still forces OpenRouter.

## [3.1.1] - 2026-07-16

### Fixed

- **Anthropic model aliases now route correctly for direct-Anthropic-key users.** `--model opus` /
  `haiku` / `claude` / `sonnet` previously resolved to OpenRouter's dot-form id (e.g.
  `anthropic/claude-opus-4.8`), which the direct Anthropic API rejects with `model_not_found` (it uses
  dashes/date suffixes: `claude-opus-4-8`, `claude-haiku-4-5-20251001`). Aliases now carry per-gateway
  executable ids and the router emits the selected gateway's native id. OpenRouter-only users were
  unaffected.

### Changed

- `--model claude` / `--model sonnet` default target moves from Claude Sonnet 4.6 to **Claude Sonnet
  5**; the offline model floor was refreshed to the current Anthropic family.
- Availability-aware routing: a model not served on the selected gateway (e.g. Fable, which is
  OpenRouter-only) routes to the gateway that has it, or errors clearly under an explicit `--gateway`.

### Added

- `amicus models --check --strict` exits non-zero on curated default-alias drift; a scheduled
  `model-drift` CI workflow audits the per-gateway ids against the live (keyless) OpenRouter catalog.

## [3.1.0] - 2026-07-15

### Added

- **Direct-first gateway routing** (#61): bare `provider/model` model IDs (e.g. `anthropic/claude-opus-4-5`)
  now route to your **direct** provider key when one is configured, falling back to OpenRouter only when
  it isn't. An explicit `openrouter/...`-prefixed model ID remains a force-OpenRouter override — that
  literal form never changes behavior.
  - New `--gateway auto|direct|openrouter` CLI flag on `start`, `fanout`, and `continue` (`auto` is the
    direct-first default) and a matching `gateway` enum on the MCP `amicus_start` / `amicus_fanout` /
    `amicus_continue` tools.
  - New `routing.prefer` config key (`"direct"` default | `"openrouter"`) sets the global default; the
    per-call `--gateway`/`gateway` param overrides it for that run.
  - Non-interactive CLI (`--json`) and MCP now emit a structured `model_route_error` (`type`, `field`,
    `requested`, `reason`) instead of an ad hoc message when a request can't be routed — identical shape
    on both surfaces.
  - Interactive runs get a picker with alternatives when a direct route misses (e.g. key missing or model
    not on that vendor's live catalog), instead of failing outright.
  - Live Anthropic model fetcher: the model catalog now queries Anthropic's API directly for the current
    model list, the same live-fetch treatment OpenAI and Google already had.
- Session provenance (resume/continue) preserves the gateway a run originally resolved to, even if keys
  or `routing.prefer` change in between.

### Changed

- **Default aliases for direct-capable vendors** (`openai`, `google`, `anthropic`, `deepseek`) now resolve
  to bare canonical model IDs instead of `openrouter/...`-prefixed ones, so they participate in
  direct-first routing out of the box. Gateway-only vendors (`qwen`, `grok`, `glm`, and other
  OpenRouter-exclusive families) are unchanged — they still resolve through OpenRouter, since there's no
  direct key path for them.
  - **Migration:** if you hold both an OpenRouter key and a direct key for one of the four vendors above,
    the next run against that vendor moves you to the direct route and prints a one-time notice; it's
    silent after that. Set `routing.prefer: "openrouter"` in config (or pass `--gateway openrouter` /
    `gateway: "openrouter"` per call) to keep routing everything through OpenRouter as before. Aliases you
    already overrode via `amicus setup --add-alias` are untouched.

### Notes

- Builds on the #61 gateway-routing foundation (router core, resolution modes, key discovery) merged to
  main ahead of this release; this release wires that router into the live launch path (CLI + MCP), adds
  the control surface (`--gateway` / `gateway` / `routing.prefer`), and switches default guidance to the
  direct-first form.

## [3.0.0] - 2026-07-15

### ⚠️ Breaking

- **Node >=22.12 is now required** (`engines.node`). Amicus 3.0 fails fast on older Node with a
  clear message instead of a confusing error deep in provisioning. This is driven by
  `@electron/get` 5.x (ESM-only, requires Node >=22.12), which the Electron self-heal depends on.
  Node 18/20 users — **including headless / council-only users who never touch the GUI** — must
  upgrade Node.
- **Electron upgraded 28 -> 43.1.1**, which drops OS support for **Windows 8/8.1, Windows Server
  2012/2012 R2, and macOS 11**. The interactive GUI will not run there; headless runs and the
  council are unaffected.

### Changed

- **Electron 28.3.3 -> 43.1.1**, clearing the outstanding high-severity `npm audit` finding
  (ASAR Integrity Bypass, GHSA-vmqv-hx8q-j7mg). Amicus runs Electron **unpackaged**, so the
  ASAR-integrity attack class never applied to its deployment — the concrete effect is a clean
  audit and staying on a supported Electron line.
- **Content view migrated from the deprecated `BrowserView` to `WebContentsView`**
  (`mainWindow.contentView.addChildView`). All four windows now set `sandbox` explicitly.
- **`@electron/get` 2.x -> 5.x** (now a direct `dependency`, ESM-only). The self-heal defers a
  lazy dynamic `import()` to the network path and bounds the download with an `AbortSignal`
  timeout (5.x dropped the old `got`-style timeout).
- CI matrices raised to Node 22/24.

### Fixed

- Runtime Node-version guard (`src/utils/node-version-guard.js`) fires early in `bin/amicus.js`,
  before heavy imports, so an unsupported Node fails with an actionable message.

### Known limitations

- `@electron/get` 5.x uses native `fetch`, which does **not** honor `HTTPS_PROXY` / `NO_PROXY`.
  Provisioning Electron behind a corporate proxy needs a manual cache copy or `ELECTRON_MIRROR`
  (see `docs/troubleshooting.md`). Headless runs and the council never download Electron.

## [2.2.0] - 2026-07-14

### Added

- **Optional council elements** (second-opinion skill): four new opt-in behaviors, presented
  together with Claude-in-the-council as a single numbered Stage-0 menu — all default OFF, enabled
  only when the user names them, and the launch confirmation must enumerate what's on:
  - **Critic seat** — one bench member swaps to a four-pass adversarial brief (adversarial pass,
    edge-case hunt, consistency check, executability test), launched as a concurrent solo beside
    the fanout wave (`role: "critic"`). Its findings enter the same anonymized bundle and are
    peer-adjudicated like any other seat's — the council disciplines the critic.
  - **Expert lenses** — each seat reviews through a distinct expert perspective (panel domain
    scoped with the user: business/technical/customer/financial/custom). Lens runs always tally
    `--no-ledger` and the report discloses the weakened cross-review anonymity.
  - **Debate mode** — a new Stage 2.5 rebuttal round: Contested/Disputed findings go back to their
    raisers to DEFEND / AMEND / WITHDRAW, disputing judges re-vote, then the final ledger-recorded
    tally. Exactly one round; withdrawn findings are auto-denied and listed in the report.
  - **Chair verdict scale** — the chair closes with 3–5 hard questions and a final parseable
    `VERDICT: Ship it | Fix these first | Fundamental rethink` line, surfaced at the top of the
    report.
- New `skills/second-opinion/SEAT-BRIEFS.md` — briefing boilerplate for the elements plus a
  standard anti-sycophancy clause now required in **every** Stage-1 briefing. Critic and lens
  methodologies adapted from the `/critic` and `/debate` agents in John Renaldi's product-kit
  (MIT), with deliberate deviations documented (no findings quota; verdict moved to the chair).
- Zero engine changes: free-form `runStats[].role` labels, tally-input re-assembly, and the
  existing `--no-ledger` flag cover all four elements.

### Changed

- `COUNCIL-DESIGN.md` gains §12 documenting the elements, their caveats (critic
  self-identification in cross-review; lens anonymity/ledger trade-offs), and parallel panels as
  future work. The `/council` command accepts pre-requested elements in its arguments.
- MODEL-NOTES seed: fold-back of the v2.2.0 verification council — claim-class dedup
  adjudication limit, minimax debut (strong critic seat), qwen-coder debut.

### Fixed

- Resurrected both Windows e2e integration suites, silently dead since before the rebrand:
  Node's `spawn()` cannot execute `node_modules/.bin` `.cmd` shims on Windows, so the Electron
  toolbar suite (electron shim) and the OpenCode server test helper ENOENT'd without a visible
  error. The helper now uses the shared `ensureNodeModulesBinInPath()` (which adds the platform
  `opencode.exe` dirs to PATH) and the toolbar suite spawns the real binary via
  `require('electron')`. Also refreshed two stale pins the dead suites never caught: the wave
  document's `schemaVersion` (now pinned to the shared `SCHEMA_VERSION` constant instead of a
  literal `1`) and the pre-rebrand `Sidecar` toolbar brand assertion (now `Amicus`).

## [2.1.0] - 2026-07-04

### Added

- `--json` on `resume`, `continue`, and `abort`. `amicus resume <id> --no-ui --json` and
  `amicus continue <id> --prompt "..." --no-ui --json` emit the same versioned run document as
  `start --json` (a `continue` run's document carries the new continuation task id, not the old
  one). `amicus abort <id|--all> --json` emits a new `type: 'abort'` document
  (`{ schemaVersion, type, ok, scope, taskId, aborted, count }`) covering single-session, wave, and
  `--all` aborts, success and failure alike — stdout carries exactly one parseable document either
  way, and non-`--json` human output is unchanged (byte-identical pinned messages still hold).
- Did-you-mean suggestions for unknown CLI commands: a near-miss typo like `amicus contnue` now
  prints `Unknown command: contnue` followed by `Did you mean: continue` on stderr (still exits 1).
  Suggestions are capped at 3 and only shown within edit-distance 2 of a known command; unrelated
  garbage input gets no suggestion.

### Changed

- Agent-facing polling guidance now recommends `amicus_wait` first across every headless-flow
  reminder, tool description, and guide section (MCP system-reminders, `amicus_start`/`amicus_resume`/
  `amicus_continue`/`amicus_fanout` descriptions, `amicus_guide`'s headless workflow, and the
  `second-opinion`/`sidecar` skill docs) — one blocking call replaces the sleep+status poll loop.
  `sleep 25` + `amicus_status` polling remains documented as the explicit fallback for clients
  without the `amicus_wait` tool; it is never presented as the only mechanism.

### Fixed

- `amicus doctor`'s MCP registration check no longer false-negatives on a healthy Claude Code
  registration. The check's only signal was `discoverClaudeCodeMcps()`, which always strips every
  `amicus`/`sidecar`-shaped entry as its own recursive-spawn guard — so the check could never see
  its own registration and warned "not registered in Claude Code" even when one existed. The check
  now reads the same config sources directly (unstripped) to answer "is amicus registered?".

### CI / Security

- `council-review.yml`: both fanout legs (review wave and synthesis) now request
  `--summary-length normal` instead of `verbose`. `--summary-length` only shapes the prompt (there is
  no engine-side output-token cap), so `verbose` was asking every model in the wave — on a paid CI
  key — for maximally long output on every PR.
- `council-review.yml`: the model-to-model handoff from the review wave into the synthesis leg is
  now neutralized. The synthesis briefing previously concatenated raw model review text
  (`reviews.md`) straight into another model's prompt with no sanitization; it now runs the same
  neutralization (byte-identical sed rules, duplicated into the synthesis step's own shell) used on
  the human-facing PR comment, and wraps the reviews in an explicit untrusted-data block before
  handing them to the synthesis model. The comment path itself is unchanged.
- `ci.yml`: the `quality` job now runs [actionlint](https://github.com/rhysd/actionlint) (pinned to
  v1.7.7) over `.github/workflows/`, which also shellchecks every `run:` block via ubuntu-latest's
  preinstalled shellcheck. Verified locally with the actionlint + shellcheck Windows binaries before
  landing; both are clean against all 5 workflows (0 findings), so no suppression config was needed.

### Documentation

- Corrected the `--agent` default docs in `skills/sidecar/SKILL.md`: the flag defaults to `Chat`
  only in interactive mode — headless (`--no-ui`) runs default to `Build`, since `chat` stalls
  without user interaction. The file previously claimed an unqualified "defaults to Chat" in
  several spots while also correctly documenting the headless-`Build` default elsewhere,
  contradicting itself; `docs/usage.md` was already correct and unchanged.
- Corrected `commands/council.md`'s description of the council pipeline order: `amicus council
  validate` runs per-leg during Stage 1 (independent reviews), and `amicus council tally` runs
  after Stage 2 (cross-review) and before Stage 3 (chair synthesis) — not, as previously worded,
  both after all three review waves.

## [2.0.0] - 2026-07-03

Amicus's first major release: the **`sidecar*` shim removal** (#19). v1.x carried a full
compatibility surface so installs and integrations from before the Amicus rebrand kept working —
legacy env vars, CLI bin names, config/session directory fallbacks, MCP tool aliases, and deprecated
public-API exports. v2.0.0 removes all of it in one pass; see **Migration** below for the exact old
form → new form for every removed shim, including the one that needs a manual one-time step. Most
installs need zero action (config/session data auto-migrated forward across v1.x; plugin-channel
installs float to the latest version automatically). Beyond the shim removal, this release rolls up
five phases of engine and docs work that shipped since 1.9.1: a fully deterministic council CLI
transport (`validate`/`verdict`/presets/spend ledger), `amicus_read` paging for large content, a
per-tool-call stall detector, per-run-nonced fold markers, atomic metadata writes throughout, POSIX
server teardown hardening, and a full documentation overhaul (`docs/council.md`, restructured
README, "where things live" config-dir reference).

### Migration (from any sidecar*-era setup)

Full removal record and rationale: [docs/SHIMS.md](docs/SHIMS.md). Per-shim remedy:

| Old form (sidecar*-era) | New form / remedy |
| --- | --- |
| `SIDECAR_*` env vars (`SIDECAR_ENV_DIR`, `SIDECAR_IDLE_TIMEOUT*`, `SIDECAR_DEBUG_PORT`, `SIDECAR_MOCK_UPDATE`) | Rename to the `AMICUS_*` equivalent (`AMICUS_ENV_DIR`, `AMICUS_IDLE_TIMEOUT*`, `AMICUS_DEBUG_PORT`, `AMICUS_MOCK_UPDATE`). Unrenamed vars are now silently ignored — no warning, no fallback. |
| `SIDECAR_MAX_SESSIONS` | Rename to `AMICUS_MAX_SESSIONS` — this was the last legacy-prefixed env var read anywhere in the codebase. |
| `sidecar` / `claude-sidecar` CLI commands | Use `amicus` (or the `am` short alias). An `EEXIST` on `npm install -g amicus` naming an old `claude-sidecar`/`sidecar` file means a *stale* global install of the old upstream package, not this shim — see [docs/troubleshooting.md](docs/troubleshooting.md#install-fails-with-eexist--claude-sidecar). |
| `~/.config/sidecar` config dir | No action for most users — every v1.x launch auto-copied `~/.config/sidecar/` into `~/.config/amicus/` once, non-destructively. Only if you skipped every v1.x release and jump straight from pre-rebrand to v2.0.0: copy `~/.config/sidecar/` to `~/.config/amicus/` by hand — `getConfigDir()` no longer reads the old location at all. |
| `.claude/sidecar_sessions/` | Not auto-migrated (per-project). Rename to `.claude/amicus_sessions/` in any project whose history you want `amicus list`/`amicus read` to see again. |
| `[SIDECAR_CONFIG_UPDATE]` stderr marker / `sidecar-config-hash` HTML-comment | The `sidecar` skill now instructs the canonical forms only: `[AMICUS_CONFIG_UPDATE]` / `<!-- amicus-config-hash: ... -->`. A stale `<!-- sidecar-config-hash: ... -->` comment in an old CLAUDE.md is simply no longer recognized; the next `amicus setup` alias change writes a fresh one, and the stale comment can be deleted by hand. |
| `sidecar_*` MCP tool names / `AMICUS_LEGACY_ALIASES=1` | The tool surface is `amicus_*` only, unconditionally — `AMICUS_LEGACY_ALIASES=1` is now a no-op (regression-pinned in `tests/mcp-server-legacy-aliases.test.js`). Update any MCP client config or tooling that still calls a `sidecar_*` tool name. |
| `startSidecar`/`listSidecars`/`resumeSidecar`/`continueSidecar`/`readSidecar` (package-root exports) | These were deprecated aliases present on npm through v1.9.1. Only `startAmicus`/`listAmicus`/`resumeAmicus`/`continueAmicus`/`readAmicus` remain exported from `amicus`'s package root — rename any import. |

**Kept, not removed** (not part of this migration): the `[SIDECAR_FOLD]`/`[SIDECAR_FOLD:<nonce>]`
wire-format token (deliberate transport continuity, unrelated to the compat shims), the `sidecar`
chat-skill's directory name, and the one-shot legacy-`'sidecar'`-MCP-entry cleanup in
`src/utils/legacy-mcp-migration.js` (re-scoped as a permanent healing tool for stale pre-1.8.0
dual-registrations — it only removes a `'sidecar'` MCP entry verified identical-in-effect to the
`'amicus'` one; a customized entry is left alone). The `mcp-self-identity` recursive-spawn guard also
continues to recognize the old `sidecar`/`claude-sidecar` bin/server names — a defense against a
stale PATH or MCP config causing amicus to spawn itself, not a restoration of removed behavior.

**Plugin-channel installs float automatically.** If you installed Amicus via the Claude Code plugin
channel, `.claude-plugin/plugin.json` runs `npx -y amicus@latest mcp` — you adopt v2.0.0 on your
next MCP server start with no upgrade action required. The only thing that can still break for you:
if your client config or tooling relies on `sidecar_*` tool names or sets
`AMICUS_LEGACY_ALIASES=1` expecting it to do something, update it — that opt-in is now a no-op and
the legacy tool names are gone.

### Added
- **`docs/council.md` — the council pipeline documented end-to-end**: the stage flow, the tally-input and
  tally-record schemas field-by-field (test-locked against the real validators), verdict.json provenance,
  presets, and a complete worked example whose every command and output was executed against the binary.
- **"Where things live"** (docs/configuration.md): the full config-dir tree (config.json shape, catalog
  cache + refresh-outcome fields, both ledgers, tmp files and the doctor sweep), per-client session
  storage, log reality (stderr-only — `LOG_LEVEL` never writes a file), and honest uninstall instructions
  covering what `npm uninstall -g` does NOT clean.
- README now leads with the **two install channels** (npm global vs Claude Code plugin, with the
  `npx -y amicus@latest` translation note) and surfaces **`/amicus:council`** in the quick start and
  council sections.
- **`amicus council validate <file>` and `amicus council verdict <tally.json>`** — thin CLI wrappers over the
  existing findings-validation and verdict-builder internals, making the second-opinion skill's council
  transport fully deterministic. `validate` exits 0 (ok) / 2 (validation failed) / 1 (bad args); `verdict`
  writes atomically to `-o` (default `./verdict.json`), `--decisions` optional. The skill's Stage-1 and
  Stage-5 instructions now invoke these commands, and the Stage-2 recipe persists the tally record to
  `<run-folder>/tally.json` (previously it existed only on stdout — the verdict step had nothing to read).
- **Council presets: `amicus council save/list/show <name>` + built-in `free`/`budget`/`frontier` benches.**
  Built-ins resolve only when the name isn't in your config (your saved councils shadow them; `list` marks
  shadowing). `free` resolves dynamically against the catalog (pinned offline fallback); `budget` and
  `frontier` are alias-based (cheapest / most premium distinct-vendor picks) so alias drift tooling covers
  them. `show` resolves against the cached catalog, including the dynamic free pick.
- **Per-run cost ledger + `amicus spend`.** Every completed run (headless, interactive, fanout legs)
  appends a best-effort JSONL row (`spend-ledger.jsonl` in the config dir); `amicus spend` rolls up total
  and per-model cost/tokens/source-mix with `--since <N>d` windowing and `--json`, plus an OpenRouter
  remaining-credit footer when a key is configured. Ledger appends can never fail a run.
- **`amicus_read` paging and size caps.** Responses are capped at ~50KB (default: the TAIL of the content,
  with a truncation notice reporting true byte counts at the start of the body); new optional `offset`,
  `limit`, and `tail` params page through large content. Under-cap reads are byte-identical to before;
  slicing happens before the untrusted-output fence is applied; `metadata` mode is param-exempt but
  defensively capped.
- **Per-tool-call stall detector in headless runs.** A wedged tool call (pending `tool_use`, no result, no
  other progress for `AMICUS_TOOL_CALL_STALL_MS`, default 3 min) now fails fast with a distinct
  `Tool call stalled: …` reason instead of burning the full run timeout. Fanout legs inherit automatically.
- **`amicus doctor --fix` sweeps orphaned sessions-index tmp files** (atomic-write artifacts from killed
  processes; only files older than 60s are removed).

### Changed
- **README restructured for audience separation**: discovery + quick start + compact command table with
  pointers; `docs/usage.md` is now the complete CLI reference (the ~30% duplicated content has one
  canonical home each — nothing was dropped); deep dives live under `docs/`.
- The second-opinion skill's Stage-2 briefing prose reads cleanly again (hardening sentence moved before
  the sentence it interrupted), and `report.md`'s contract is stated once, coherently: `report.html` is
  the deterministic renderer default; `report.md` is the chair-synthesis document that embeds the
  rendered Markdown as one section.
- **The fold completion marker is now per-run nonced: `[SIDECAR_FOLD:<nonce>]`.** Model output that
  genuinely ends with a bare `[SIDECAR_FOLD]` can no longer force premature completion — the detector
  requires the run's own nonce (BL-7's final hardening layer). The nonce is crypto-random, threaded through
  every mode (headless, fanout, MCP shared-server, interactive GUI), and instructed to the model in the
  prompt; `amicus resume` re-derives it from the transcript.
- **All session/wave metadata writes are atomic** (`writeFileAtomic` tmp+rename), retiring the torn-read
  race class that pollers previously tolerated via missed-tick workarounds.

### Fixed
- `amicus council --help` now lists `save`/`list`/`show` (the Phase-16 usage-string omission caught by
  a later binary-verification pass).
- **Setup wizard Step 3 (alias editor) now consumes the same TTL-cached catalog as Step 2** (#12) — one
  catalog load for the whole wizard instead of a separate uncached network fetch per run; the redundant
  `fetch-models` IPC channel is removed.
- **Stale catalog data is now labeled** (#13): a failed refresh records the attempt and reason in the cache
  doc (never touching the good data), `amicus models` shows a stale memo when refreshing keeps failing,
  `amicus models refresh` reports failure honestly instead of "Refreshed catalog: 0 models" (and its
  `--json` reports the real stale `fetchedAt` instead of `null`), and the wizard shows a stale hint.
- **The free-council picker is readable** (#27): models grouped by provider with friendly names (raw id as
  the mono secondary line), a roomier scroll area, and a provider count — selection values remain raw model
  ids throughout.
- **Orphaned `opencode serve` processes on macOS/Linux.** Server teardown now SIGTERMs the Go binary
  directly and escalates to SIGKILL after a bounded grace window on a ref'd poll (the old unref'd 2s timer
  silently died with fast-exiting parents). Windows semantics unchanged.
- **Aborting a wave immediately after starting it can no longer flip its status back to `running`** — the
  wave metadata merge now honors abort-wins precedence (same rule the per-leg writer already had).
- **`kill(pid, 0)` throwing `EPERM` now classifies a process as ALIVE** (signal denied ≠ dead) in
  `isProcessAlive`/`checkSessionLiveness` and both MCP crash-detection probes. EPERM no longer marks
  healthy sessions crashed.
- **A committed successful terminal status can no longer be clobbered to `error`** by a cleanup-step
  failure in the MCP shared-server finalize chain (the Phase-5 review's residual gap).
- **`discoverCoworkMcps` now checks `%APPDATA%\Claude` on Windows** instead of the XDG path — Claude
  Desktop discovery and doctor's Cowork signal were always wrong on win32.

### Removed
- **Every pre-rebrand `sidecar*` compatibility shim** — see **Migration** above for the full old-form →
  new-form mapping. Also removed: **`sidecar_*` MCP tool aliases + the `AMICUS_LEGACY_ALIASES=1` opt-in**
  (`src/mcp-server.js`) and the **public API `*Sidecar` aliases** (`src/index.js` `module.exports`) —
  both covered in Migration.

### Documentation
- Full sweep of every doc describing the shims as live (README, docs/usage.md, docs/configuration.md,
  docs/testing.md, docs/troubleshooting.md, docs/opencode-integration.md, docs/architecture.md,
  skills/sidecar/SKILL.md, skills/second-opinion/MODEL-NOTES.md) rewritten to v2.0.0 reality.
  `docs/SHIMS.md` re-scoped from a live shim inventory into the removal record the Migration section
  above is built from.

## [1.9.1] - 2026-07-03

### Fixed
- **`server.json`'s description now fits the MCP Registry's 100-character cap.** The registry rejected
  v1.9.0's publish (its first-ever attempt) with HTTP 422 — the description was 199 chars against a
  100-char limit the schema doesn't advertise. Shortened to 98 chars; the cap is pinned by
  `tests/scripts/package-manifest.test.js` (characters and UTF-8 bytes), and `docs/DISTRIBUTION.md` §3 now
  documents that content-level 422s are not recoverable by workflow re-run (the re-run checks out the tag)
  — fix `server.json` on main and use the manual path or the next tag. v1.9.0 itself shipped fully to npm
  and GitHub Releases; this patch exists to land the registry publish.

## [1.9.0] - 2026-07-03

Engine pull-forwards, release-rail hardening, docs sync, and a new Council Review GitHub Action.

### Added
- **`/amicus:council` slash command and a `/amicus:sidecar <model> <prompt…>` argument surface.** `commands/council.md`
  wraps the `second-opinion` skill end-to-end via `$ARGUMENTS`; `skills/sidecar/SKILL.md` gained an
  `argument-hint` and a slash-invocation section binding `$1` (model alias, falling back to gemini for
  non-model-looking input) and `$ARGUMENTS` (full prompt). **Slash commands are plugin-channel-only:**
  `commands/` ships in the npm tarball (via `package.json`'s `files` array) but the npm/`install.sh`/
  `install.ps1` postinstall flow never copies it into a Claude Code commands directory — only
  `skills/sidecar` and `skills/second-opinion` are installed that way. npm/postinstall users do not get
  `/amicus:council` or `/amicus:sidecar`; only plugin installs (`claude plugin install`) do. This is a
  known, accepted gap, not a bug — carried forward from the 9.1 review as a note that must keep
  reappearing in release-facing docs so it doesn't get silently "fixed" into a false claim.
- **MCP Registry wiring.** `package.json` gained `mcpName: "io.github.BourbonDog/amicus"`; `server.json`
  (repo root) describes the stdio launch (`npx amicus mcp`). `.github/workflows/publish.yml` now publishes
  to `registry.modelcontextprotocol.io` via `mcp-publisher`, authenticated over the same GitHub OIDC token
  used for npm Trusted Publishing — no registry secret required. This fires automatically on every `v*` tag
  push, strictly after `npm publish` succeeds (npm-side ownership validation reads the published
  `package.json`). See `docs/DISTRIBUTION.md` §3 for the full flow, the release-order dependency on the
  Phase 4 tool-surface de-bloat, and the manual recovery path if the registry publish fails in CI.
- **Marketplace submission runbook and preflight guard.** `docs/DISTRIBUTION.md` documents the
  `claude-community` submission process (individual-author Console form route), the preflight checklist
  (`claude plugin validate . --strict`, `claude --plugin-dir .` smoke test, `npm test`), and what the
  Anthropic review pipeline is expected to check.
- **Council Review GitHub Action (v1).** A new reusable, label-gated workflow (`.github/workflows/council-review.yml`)
  runs an `amicus fanout` review wave (default cheap bench `deepseek,gemini,glm`, cost- and time-bounded) over a
  pull request's diff and posts one sticky synthesis comment with the individual reviews collapsed underneath. v1 is
  fanout-only — independent reviews plus a one-leg synthesis, no adjudicated verdict (that needs the skill-orchestrated
  Stage-2 cross-review, which a code-only pipeline can't produce; deferred to v2). Fork-safe and no-checkout by
  design: PR code is never checked out or executed, only its diff (capped, via `gh pr diff`) is read; the job soft-skips
  with a notice when `OPENROUTER_API_KEY` is unavailable (e.g. a fork PR without repo secrets) rather than failing the
  check; every use of PR-controlled text (title/body) reaches the shell only through `env:` indirection, never inlined
  into a `run:` script. Untrusted model output is neutralized before it enters the PR comment — case-insensitive,
  whitespace-tolerant rules strip anything that could forge the sticky-comment marker (and hijack the next run's
  update), forge the "not an adjudicated verdict" footer disclosure, or break out of the comment's own `<details>`
  wrapper — and the real footer is echoed last, after all model text, so its position can't be forged. The label
  gate (`council-review`) is enforced with a string-safe comparison (`format('{0}', inputs.require_label) == 'false'`)
  to avoid a loose-equality bug where GitHub coerces an empty `pull_request`-event input to falsy and would otherwise
  bypass the gate on every same-repo PR. **Inert by default:** the workflow only runs once a repo both adds the
  `OPENROUTER_API_KEY` Actions secret and applies the `council-review` label to a PR — installing it does nothing on
  its own. Locked by `tests/scripts/council-review-workflow.test.js`.

### Changed
- **Every prose channel that returns another model's output is now wrapped in the
  `<untrusted_sidecar_output>` fence** (`amicus_status`/`amicus_list` previews remain sanitized-and-truncated
  instead, by design — `sanitizePreview()` in `src/sidecar/progress-fields.js` defangs fence/tag characters
  and caps length so the full untrusted text is only ever reachable through the fenced `amicus_read` path),
  extending the protection `amicus_read` summaries already had: MCP wave and conversation reads, CLI
  `amicus read` summary/conversation/wave output, and the foreground summary echo after
  `start`/`continue`/`resume`. This is visible in CLI output. JSON output (`--json`), metadata mode, and
  on-disk artifacts (`wave.json`, `summary.md`, `conversation.jsonl`) are byte-identical to before — the
  fence is applied only at output time, never at write time.
- Internal: `interactive.js`'s Electron process helpers extracted to `src/sidecar/interactive-process.js`
  (size-gate headroom; no behavior change).

### Fixed
- **`plugin.json`'s unrecognized `bugs` field removed.** `claude plugin validate . --strict` now passes
  clean (exit 0); it previously reported an unknown-field warning that `--strict` promotes to an error.
- **The Fold handoff is now documented operationally** (README + usage.md): the `[SIDECAR_FOLD]` stdout
  block, where the summary lands (`summary.md`), and how the orchestrator reads it back (fenced, via
  `amicus read`/`amicus_read`).
- **README↔usage.md drift corrected against the binary:** `amicus fanout` documents `--council`
  (mutually exclusive with `--models`, exactly one required) in both files; `amicus list --status`
  documents the full 7-value set (`running, complete, error, timed-out, aborted, crashed, idle-timeout`)
  — note the `--json` schema's distinct `timeout` vocabulary is deliberately unchanged; fanout
  `--session-id` support documented; `amicus status` gained real human and `--json` output examples;
  `start --setup` documented as NOT relaxing the `--prompt`/`--prompt-file` requirement (with the exact
  error string users see).
- **OpenRouter 402 recovery** added to the README troubleshooting table and docs/troubleshooting.md:
  key save/validation never checks account balance, so the first council review / `start` / `fanout` call
  can 402 (the `amicus council` subcommand itself is deterministic math and never calls a model) — recovery
  via openrouter.ai/credits, `:free` models, and the non-blocking `amicus doctor` credit probe.
- docs/DISTRIBUTION.md's stale `/v0.1/` registry API path synced to `/v0/`.
- All of the above locked by `tests/docs-quick-sync.test.js` (17 pins).
- **Closing the GUI window no longer loses the session summary.** Closing without folding previously
  destroyed the window immediately — the session finalized as `complete` with a placeholder summary, and
  closing during an in-flight fold discarded the summary about to land. The window close is now intercepted
  by a close guard (`electron/close-guard.js`): a close with no fold auto-triggers the same fold flow
  (overlay + summary + `[SIDECAR_FOLD]` handoff) and then closes; a close during an in-flight fold lets it
  finish — regardless of whether the fold was close-initiated or started from the toolbar/shortcut — instead
  of falling through and destroying the window mid-summary; a failed or timed-out fold still closes the
  window (the user is never trapped). This relies on `electron/fold.js` exposing a finer-grained
  `isFolding()`/`hasCompleted()` split (a fold is "in flight" from the moment `triggerFold` is entered until
  its `[SIDECAR_FOLD]` stdout write actually succeeds) alongside the original `hasFolded()`, so the guard can
  tell "still running" apart from "actually done" — and a fold that settles without completing (including a
  synchronous throw from the post-write nudge-overlay update, which the old code's `.catch()` couldn't
  observe) still safely falls back to closing the window rather than leaving it permanently stuck open.
  External abort remains immediate and never waits on a fold.
- **The MCP server no longer hardcodes `--client cowork`.** Under Claude Code — the primary caller — that
  hardcode silently broke `includeContext:true` (empty context), parent-MCP discovery, and session-dir
  resolution. The server now detects its caller from the MCP handshake's `clientInfo` (claude-code →
  `code-local`; Claude Desktop/Cowork → `cowork`; unknown callers keep today's `cowork` behavior with a
  one-time stderr notice) and threads the detected client through every spawn path and the in-process
  shared-server path. A new `AMICUS_MCP_CLIENT` env var (set it in the MCP registration's `env` block)
  explicitly overrides detection. One consequence: MCP-spawned GUI chat sessions under Claude Code now keep
  the default SE-focused base prompt — `opencode-client.js`'s Cowork-specific general-purpose prompt swap
  (`buildCoworkAgentPrompt()`) only fires when `options.client === 'cowork'`, which no longer matches a
  Claude Code caller now that it's correctly tagged `code-local`.
- **Release-workflow re-runs now recover a half-published release instead of dead-ending.** A `publish.yml`
  re-run after a post-`npm publish` failure previously died on `EPUBLISHCONFLICT` before ever reaching the
  step that failed. Now the npm publish is skipped (loudly) when `amicus@<version>` is already live (E404
  means not-published and proceeds; any other `npm view` error fails loud rather than skipping), a
  tag↔`package.json` lockstep check fails fast before anything publishes, the MCP Registry publish is
  skipped when the version is already registered (pre-check tolerates transport-level failures and falls
  through to publishing), `mcp-publisher login github-oidc` gained the same 5×20s retry the publish call
  already had, and `gh release create` is guarded by an existence check. `docs/DISTRIBUTION.md` §3 now
  documents re-run as the primary recovery path, with the manual path as fallback. Locked by
  `tests/scripts/publish-workflow.test.js`.
- **The `second-opinion` skill's frontmatter description no longer exceeds Claude Code's 1024-char cap.**
  It was 1441 chars, so the router silently truncated the tail — which was the NOT-clause routing quick
  single-model asks ("ask Gemini…", "what does DeepSeek think") to the `sidecar` skill. Rewritten to
  988 chars with every trigger phrase and the NOT boundary intact (same fix pattern as the sidecar skill's
  1.8.1 overhaul); locked by `tests/skill-second-opinion-docs.test.js`. Existing installs pick the fix up
  when postinstall refreshes skill copies on the next upgrade.

## [1.8.1] - 2026-07-02

Docs & skills accuracy sprint from the Phase-8 whole-branch review — no engine changes. Every item fixed a claim
that actively misdirected Claude or users, plus one headless completion-state bugfix.

### Changed
- **`report.html` is now the default final council artifact**, and an inline verdict summary in chat is
  MANDATORY at Stage 5 of the second-opinion skill.
- **The `sidecar` skill's frontmatter dropped the "second opinion from another model" trigger** — those requests
  now route to the `second-opinion` skill instead.
- **MODEL-NOTES seed updated** with durable lessons from council runs 4-7 (new Grok/Kimi/Mistral/Claude-in-council
  sections; shipped/local split defined). Existing installs: the machine-local copy is installed only-if-missing —
  merge/refresh manually by pointing at the shipped file.
- **Council mechanics hardened:** mandatory no-tools preamble for judges and chair (plus scratch-cwd advice);
  `--max-cost` / `--no-cost-gate` pass-through documented for repair and chair calls (the false solo-start
  cost-gate exemption was removed); `--models` lists quoted in every example; current-date injection rule for
  time-sensitive artifacts.

### Fixed
- **Plugin quick-start now states the truth:** plugin installs do not put `amicus` on `PATH`; use
  `npx -y amicus@latest <cmd>`. Both skills gained an npx-fallback/transport rule.
- **README/usage now document `doctor`, `key`, and `council`;** troubleshooting leads with `amicus doctor`; the
  false "`amicus list` shows active servers" claim is replaced with real `netstat`/`lsof` guidance.
- **Headless runs that finish via idle detection no longer write `status:"error"` / `reason:"Incomplete"` to
  `metadata.json`.** The poll loop's two genuine idle-completion exits — the SDK-authoritative `session.status`
  idle signal and the stable-poll activity heuristic (both gated on real output, F1 #16) — broke out of the loop
  without setting `completed`, so `resolveTerminalState` fell through to error and poisoned `amicus_list` /
  `amicus_status` / wave rollups for successful runs, while the stdout `--json` doc correctly said
  `status:"complete"`. Both exits now mark the run completed, matching the fold-marker branch. Dead-server
  classification is unchanged: the consecutive-poll-failure fast-exit (F4) and crash paths still report an error.

## [1.8.0] - 2026-07-02

### Added
- **`amicus_wait` MCP tool: blocking wait for a session or fan-out wave.** Blocks inside one tool call until the
  target reaches a terminal state or the wait window closes, replacing the sleep+`amicus_status` polling loop with
  a single call. Returns the same JSON shape as `amicus_status` plus `waitedMs` and `{timedOut: true}` (with a
  `hint`) on expiry — re-call it while it keeps returning `timedOut: true`. Works for sessions or waves started by
  other processes, not just the caller. Torn-read tolerant: a transient read of `metadata.json` mid-write is
  treated as a missed poll tick, not a hard failure. Legacy alias `sidecar_wait` is available under
  `AMICUS_LEGACY_ALIASES=1`.
- **Agent-visible progress.** A new `amicus status <task_id>` (or `--wave <id>`) one-shot CLI command delegates
  directly to the MCP status handler — same crash detection and wave-leg rollup, zero duplicated logic.
  `amicus_status` and `amicus_list` are enriched with agent-facing `mode`, `phase`, `messageCount`,
  `lastActivityAt`, and `latestPreview` (the pinned raw `stage` field is unchanged for back-compat; wave legs
  additionally surface the raw `stage` alongside the coarse `phase`). Interactive (Electron GUI) runs now write
  the same lifecycle progress stages headless runs always have (`initializing`, `server_ready`, `session_created`,
  `prompt_sent`), and long-thinking turns emit periodic thinking-delta progress ticks instead of at most one ever
  — so a live GUI run no longer reads "Starting up... | 0 messages" forever.
- **`amicus doctor` duplicate-registration check.** A new `mcp-legacy` check flags plugin-channel installs
  (`AMICUS_SKIP_POSTINSTALL=1`) that never ran the postinstall migration and still carry a duplicate legacy
  `sidecar` MCP registration; `doctor --fix` cleans it up.

### Fixed
- **`amicus abort` now actually stops interactive sessions and wave legs.** Marker-first, honest output — reports
  what really happened including the unkillable-pid case — and no-ops cleanly with a clear message when the
  target isn't running.
- **Legacy-MCP remediation's `claude mcp add-json` (CLI) path no longer drops a user's custom `env`** on
  re-registration — it now merges the previous registration's `env` the same way the file-fallback path already did.

### Changed
- **Legacy `sidecar_*` MCP tool aliases are now opt-in** via `AMICUS_LEGACY_ALIASES=1` (breaking-adjacent —
  carrying release must be a MINOR, v1.8.0). The default client-visible surface is the `amicus_*` toolset (14
  tools as of this release); saved allowlists that still reference `mcp__amicus__sidecar_*` stop resolving unless
  you opt back in.
- **Postinstall no longer registers a separate `sidecar` MCP server** and auto-removes a verified-identical
  duplicate left over from pre-1.8 installs. A customized `sidecar` entry or a sole `sidecar` registration (no
  `amicus` twin) is never touched.

## [1.7.7] - 2026-07-01

Correctness patch from the 2026-07-01 full product review (multi-agent review, every finding adversarially
verified against source), executed subagent-driven with per-task adversarial review plus a final whole-branch review.

### Fixed
- **Terminal errors now show their actionable hint.** Human-mode errors printed only the message while `--json`
  carried a `hint` field; the hint now prints on a second `  → …` line. Budget-gate refusals finally tell you the
  offending model, the threshold, and the `--max-cost` / `--no-cost-gate` overrides.
- **Spawned sidecars no longer inherit Amicus's own MCP server.** The recursive-spawn guard only excluded a server
  literally named `sidecar`, but the product registers as `amicus` — so every child model inherited the full
  Amicus toolset and could spawn recursively. Children now exclude any inherited entry that *is* Amicus, matched
  by name **or** by what the command actually runs (`amicus mcp`, `npx … amicus … mcp`, a `bin/amicus.js … mcp`
  path). Note: this strip has no opt-out — a deliberately configured nested Amicus MCP entry is also removed from
  spawned children.
- **Shared-server crash detection actually works.** The crash/restart machinery listened on an event emitter the
  real server handle never exposed, so it was dead code — a dead engine silently degraded every later session.
  A pid liveness poll now drives detection and restart, and shutting down during the restart backoff cancels the
  pending restart instead of spawning a server nobody asked for.

### Changed
- **`amicus continue` and `amicus resume` now report failures truthfully** (behavior change): error exits 1,
  timeout exits 2, abort exits 130/143/2 — previously both always exited 0 and recorded the session as
  `complete` even when the model errored or timed out. The session record now finalizes `error`/`timed-out`
  accordingly (interactive sessions that legitimately end with an empty summary still finalize `complete`).
  Scripts that gated on exit code 0 for these verbs will now see real failures.

## [1.7.6] - 2026-07-01

A second independent review (GLM 5.2), adversarially verified against source, then fixed across 11 lanes.
20 of 22 confirmed findings fixed; 2 partial (deferred as follow-ups). Full unit suite green.

### Security
- **The `project`/`cwd` MCP input is now sandboxed.** Previously any caller could pass an arbitrary directory
  (e.g. a system path) and Amicus would create session files and spawn a sidecar there. A new project-root
  allow-list rejects out-of-bounds paths **before** any filesystem write or spawn, while still allowing paths
  under your home directory, the current working directory, `AMICUS_PROJECT_DIR`/`AMICUS_PROJECT_ROOTS`, or the
  MCP client's advertised root — so legitimate `--cwd` use is unaffected.
- **Folded-back sidecar summaries are fenced as untrusted output.** `amicus_read`'s returned summary — produced
  by an arbitrary model — is now wrapped in a read-only fence (mirroring the outbound conversation fence), so
  model prose entering the orchestrator's context is marked as data, not instructions.
- **The Electron content view no longer shares the privileged bridge.** The embedded OpenCode web view gets a
  minimal preload that exposes nothing privileged, and IPC handlers validate the sender, so only the toolbar can
  trigger update/settings actions.

### Fixed
- **A crashed OpenCode server is now detected.** The shared-server crash/restart machinery was unreachable (no
  exit listener was ever attached); a server exit is now wired to the restart path.
- **Session metadata is written atomically** (temp file + rename), so a crash mid-write can no longer corrupt
  `metadata.json` and silently mask an abort marker.
- **Port lookup works on Windows.** The stale-process cleanup used a hardcoded `lsof` (a no-op on Windows); it
  now uses the cross-platform `netstat`-based lookup.
- **A fan-out leg whose setup throws no longer sinks the whole wave** — the leg is turned into an error result
  and `wave.json` is still written.
- **The setup window can't hang on a spawn failure** — a spawn error now resolves cleanly instead of leaving the
  launch promise pending forever, and the Electron child is killed on parent exit.
- **Project-scoped `opencode.json` resolves against the target project**, not the launcher's working directory.
- Smaller correctness/cleanup fixes: single-peer-agreed council findings now count as corroborated; unknown
  council verdicts are guarded; tool-call turns render a summary instead of blank; quote-aware `--mcp` command
  parsing; a model-object shape guard; a single shared duration formatter; timed mirror teardown; a lock on the
  continuation session; and canonical session-route separators.

### Known follow-ups
- Fencing `amicus_council_tally`/`amicus_verdict` (they return JSON records, so they need a field-level fence).
- Removing the now-dead top-level `tool_use` formatter branch (blocked on an unrelated test assertion).

## [1.7.5] - 2026-07-01

A batch of fixes from an independent DeepSeek V4 Pro code review, each verified against source.

### Fixed
- **Long prompts no longer truncate on Windows.** The `amicus_start` and `amicus_continue` MCP
  handlers passed the full prompt inline on the spawned command line, which silently truncated once
  it crossed Windows's ~32 KB argument cap — so a sidecar could run against a corrupted briefing with
  no error. Both paths now write the prompt to a `briefing.md` in the session directory and pass
  `--prompt-file`, matching the existing fanout handler; the CLI `continue` command learned
  `--prompt-file` as well.
- **`getMessages` no longer masks SDK error responses.** An error-shaped response with no `data`
  array was indistinguishable from "zero messages" in the poll loop; it now logs a warning carrying
  the session id and surfaced error while still returning `[]`.
- **`getSessionDir` rejects path-traversal task ids.** A defense-in-depth containment guard (the same
  check style used elsewhere in the codebase) throws on a task id that would escape the sessions dir.
- **Cross-platform `auth.json` discovery.** The one-time OpenCode key-import path was hardcoded to the
  Unix XDG location; it now probes `$XDG_DATA_HOME`, `~/.local/share`, and `%APPDATA%` (Windows) and
  uses the first that exists.

### Changed
- **The fold-completion marker is harder to spoof.** A bare `[SIDECAR_FOLD]` echoed mid-output (e.g. a
  model reproducing these instructions or summarizing a prior sidecar session) no longer forces a
  premature fold — the marker now completes a run only when it is the final non-empty line of output,
  with the existing idle/timeout fallbacks unchanged so a run can never hang.
- **The conversation-mirror tool-call buffer is bounded.** Capped at 2000 entries with a separate
  dedup set, so a very long tool-heavy session can't grow it without limit.
- **Unknown `--no-*` flags are treated as boolean.** They no longer swallow the following positional
  argument (`--no-x=value` still records its inline value; allowlisted flags are unchanged).
- **`--prompt-file` validation is order-independent.** `validateStartArgs` now resolves the prompt
  source itself, so validation no longer depends on the handler having resolved it first.

### Docs
- **Corrected the `tiktoken` dependency note.** It is declared but unused; token sizing uses a
  `length/4` heuristic. Added caveat comments at both estimators. (Removing the unused dependency is
  tracked as a follow-up.)

## [1.7.4] - 2026-06-30

### Fixed
- **The Electron GUI self-heal survives a stalled `extract-zip` on Node 24.** On some Node 24 boxes the
  bundled `extract-zip@2.0.1` (its latest release — it cannot be bumped) stalls mid-extract: its promise
  never resolves *and* never rejects. Because the self-heal `await`s it, the event loop drains and the
  process exits `0` with a half-extracted `dist/` and **no `electron.exe`** — so the repair looked like it
  "did nothing." Extraction is now hardened two ways: `extract-zip` is bounded by an idle + max timer (a
  stall becomes a caught error instead of a silent hang, and the live timer prevents the premature exit),
  and if it stalls, throws, or produces no files, amicus falls back to a **native OS unzip** (Windows:
  bundled `bsdtar`, then PowerShell `Expand-Archive`; macOS: `ditto`, then `unzip`; Linux: `unzip`, then
  `tar`) — each verified to extract the exact Electron zip that `extract-zip` choked on. Success is still
  reported **only** when the real binary lands on disk (the existing exe-stat verify is unchanged), so no
  path can claim a false repair.

## [1.7.3] - 2026-06-30

### Fixed
- **The Electron self-heal no longer wedges itself.** A repair that was killed or hung mid-run (or a
  pre-1.7.3 build) could leave an orphaned single-flight lockfile, after which *every* subsequent repair
  — including `amicus doctor --fix` and the GUI launch — reported "another electron repair is already in
  progress" and did nothing. The lock now records the holder's PID + timestamp and reclaims an orphaned
  lock (dead holder, older than a 15-minute TTL, or the old empty format), so the GUI can self-heal
  again; a live, recent holder still yields honest contention (no double-extract). The controlled
  download is time-boxed (and the last-resort installer bounded) so a stalled fetch can't recreate the
  stuck lock. **After upgrading, an already-stuck lock clears itself on the next repair.**

## [1.7.2] - 2026-06-30

The Electron self-heal now tells the truth, heals the cases it can, and clearly explains the ones it can't.

### Fixed
- **The Electron self-heal no longer claims success when it didn't heal.** `repairElectron`'s
  installer-fallback path always reported the GUI as "provisioned"/"fixed" even when the binary wasn't
  actually on disk — so `amicus doctor --fix` and the install-time prewarm could falsely report
  success. Every self-heal / provision path now declares success **only** when the Electron binary is
  verified present on disk.

### Changed
- **The GUI repair is now controlled and introspectable.** Instead of blindly re-running Electron's own
  installer (the postinstall npm had already silently suppressed), the repair downloads and extracts the
  binary itself (via `@electron/get`) and verifies the result; a corrupt cached download is cleared and
  re-fetched once.
- **Antivirus quarantine is detected and explained, not retried forever.** When Windows Defender / AV
  removes `electron.exe` right after extraction (the common Windows failure), amicus now tells you to
  allow-list the binary and re-run `amicus doctor --fix`, instead of silently looping a repair that
  cannot win.
- **Clear, actionable error when the OpenCode engine binary is missing.** The engine ships via
  per-platform binaries that npm can silently skip (or AV can quarantine); when it's absent, amicus now
  surfaces a specific instruction (run `amicus doctor`, reinstall, allow-list `opencode.exe`) instead of
  an opaque spawn failure.

## [1.7.1] - 2026-06-30

### Fixed
- **The Electron GUI now shows the current rail-yard brand mark.** The window/taskbar icon, the setup
  wizard's header and footer, and the session toolbar were still rendering the pre-redesign squiggle
  mark; they now use the shipped clay→gold rail-yard mark (matching the site favicon). The inline
  glyphs stay token-bound (clay tracks / gold mainline) so they follow the design system.

## [1.7.0] - 2026-06-30

Electron self-heal, a real `amicus doctor`, and the GUI on the design system — plus MCP/diagnostics correctness.

### Added
- **Electron self-heal.** Amicus now detects a broken or quarantined Electron install (a half-extracted
  or AV-removed binary) and repairs it from the local download cache — **fully offline**. New
  `amicus doctor --fix` heals in place, the GUI lazily provisions itself on first use, and an opt-in
  `AMICUS_PREFETCH_ELECTRON=1` aggressively prewarms it. Install-time provisioning is cache-only (no
  network during `npm install`) and never fails the install.
- **`amicus doctor` is now a recovery hub.** Checks carry copy-paste remediation hints, report
  OpenRouter credit/free-tier status, and warn when the resolved project root looks like an app/install
  directory rather than your repo.
- **Running version in MCP responses.** `amicus_status` / `amicus_guide` now report the running amicus
  version and warn when the on-disk package is newer (restart your MCP client to load it).
- **The GUI is on the design system.** The embedded OpenCode session UI is themed to the clay/gold
  tokens, the load-failsafe error page and window backgrounds are token-driven, and a drift guard keeps
  new hardcoded colors/fonts out of `electron/`.

### Fixed
- **Electron no longer reads "installed" when the binary is missing.** Runtime checks (including
  `amicus doctor` and the GUI launch path) now stat the actual executable instead of trusting
  `path.txt`, so a quarantined/half-extracted Electron is correctly detected — the root cause of the
  silently-broken setup wizard.
- **`amicus_fanout` forwards Cowork session pinning** (`--cowork-process` / parent session) to its
  spawned legs, so context-inheriting fan-outs pin the right parent.
- **`amicus_status` annotation corrected** — it is no longer declared read-only/idempotent, since its
  wave branch updates metadata during crash detection.
- **Wave counts account for crashed / idle-timeout legs** (documented remainder rule), so consumers
  summing the named buckets no longer mismatch the total.

## [1.6.1] - 2026-06-30

Project-directory and session-addressing correctness — agents, sessions, and the interactive GUI now agree on which project they're in.

### Added
- **`AMICUS_PROJECT_DIR` + MCP `roots` support.** When the project is not passed explicitly, the MCP
  server now resolves the working directory from the client's first `file://` workspace root (falling
  back to `AMICUS_PROJECT_DIR`, then the process cwd) — so a stdio MCP server spawned by a desktop
  client no longer roots agents in the app install directory where they can't see your files.
- **Global session index.** `amicus_status` / `amicus_read` / `amicus_list` now consult a global
  `taskId -> project` index on a per-project miss, so a session created in one project is still found
  when looked up from another.
- **Per-command help for the rest of the CLI.** `amicus council --help` (and `continue`, `resume`,
  `doctor`, `setup`, `key`, `mcp`) now print their own scoped usage instead of the full global help.

### Fixed
- **Interactive `--cwd`: follow-up prompts no longer fail "unable to retrieve session."** When the
  launch directory differs from `--cwd` (the normal sidecar-skill pattern), the OpenCode session is now
  scoped to the project directory and the Electron Web-UI route is built from the **server-echoed**
  session directory rather than a guessed one, so turn 2+ resolve correctly.
- **Shared-server MCP sessions are scoped to the project directory** — every create and follow-up call
  carries the directory, so headless MCP sessions are found on a server shared across projects.
- **`amicus_read` surfaces the failure reason** for crashed / timed-out / aborted runs that wrote no
  summary, instead of a bare "No summary available."
- **`amicus_abort`'s "session not found"** now names the resolved project, matching `status` / `read`.
- Internal: a single `canonicalProjectPath()` now normalizes project paths (slash direction, drive-letter
  case, trailing slash, UNC shares) so creation and lookup always agree.

## [1.6.0] - 2026-06-30

Install resilience and council-failure correctness — the first two blocks of the post-1.5 backlog program.

### Added
- **Per-subcommand help.** `amicus <command> --help` now prints only that command's options instead of
  the full global usage; bare `amicus --help` is unchanged.
- **Zero-credit OpenRouter key warning at setup.** Setup now does a non-blocking `GET /api/v1/key`
  check and warns when a key is free-tier or has no remaining credit, so a credit-less key is flagged
  up front instead of 402-ing on the first paid model call.
- **`amicus doctor` engine-recovery guidance.** The opencode-engine check now explains the
  transient install-rollback failure mode and gives copy-paste recovery steps.
- **Postinstall verifies the Electron binary.** When the optional Electron download/extract fails (or
  AV quarantines the binary), the install now prints a clear non-fatal notice that headless runs and
  the council still work — instead of silently leaving a broken GUI to discover later.
- **CI tarball guard.** A new `check:tarball` step asserts every lifecycle-referenced script actually
  ships in the published package, so a future packaging change can't silently drop it.
- **README "Requirements & Dependencies" section** consolidating Node, git, OpenRouter credits, API-key
  env vars, the optional Electron GUI, the bundled opencode engine, and OS support.

### Fixed
- **Council / headless runs no longer report success when every model call fails.** On the shared-server
  MCP path, a run whose calls all errored (e.g. an OpenRouter 402) was finalized as `complete` with a
  0-byte summary, so `amicus_status` showed success and the error was lost. Non-2xx/402 responses are
  now detected at the OpenCode client boundary even when no assistant message is emitted, the
  shared-server finalize routes through the same terminal-state classifier as the CLI, and a failed run
  can never silently default to `complete`; `amicus_read` surfaces the failure reason.
- **`amicus_status` elapsed time** is now bounded by the run's completed/aborted/crashed timestamp
  instead of wall-clock-since-start, so a finished run reports its real duration.
- **`amicus_setup` (MCP)** no longer claims an Electron window appeared when Electron is unavailable —
  it pre-flights and returns an honest error directing you to the headless terminal wizard.
- **Clearer "session not found"** — the message now names the resolved project so you know to pass the
  original `project`.
- **Non-fatal postinstall.** An internal skill-copy / MCP-registration failure no longer exits non-zero
  and rolls back the entire global install; it warns and continues.
- **`github:` install on Windows now runs identically to the registry install.** Removed the
  consumer-facing `prepare` lifecycle that triggered npm's clone→prepare→nested-install→cached-pack
  path (the rollback source); git hooks are still configured for contributors via `postinstall`.

## [1.5.1] - 2026-06-29

A headless-reliability fix for reasoning-heavy models.

### Fixed
- **Gemini (and other reasoning-only models) no longer hang headless with "No Output."** On the
  direct-Google provider path, Gemini 3.x returns its answer as a `reasoning` part with no separate
  `text` part. The conversation mirror only accumulated `text` parts, so it captured zero output, the
  headless completion gates (which key on `output.length > 0`) never fired, and the run burned the full
  timeout — while still billing input/thinking tokens. The mirror now accumulates reasoning into a
  dedicated buffer and promotes it to the output **only when a finished assistant message produced no
  visible text**, so models that emit both a reasoning part and a text part are unaffected (their
  thinking never pollutes the answer). Fixes `--model gemini` / `gemini-pro` and any direct `google/*`
  alias in headless `start`, `fanout`, and council runs.

## [1.5.0] - 2026-06-29

A visual refresh plus a council-reliability fix and a config-dir consolidation.

### Added
- **Amicus design system**: the Electron app (setup wizard, toolbar, fold overlay), the council
  HTML report, and the marketing site now render from one shared token layer (`src/design/tokens.css`
  + a `src/design/tokens.js` loader) — the clay/gold rail-yard brand on a neutral-black ramp, with
  bundled Outfit + IBM Plex Mono fonts. Previously each surface defined its own colors independently;
  the site is pixel-identical to before, now bound to the shared tokens by a drift-guard test.

### Fixed
- **Council reliability ledger now persists.** `amicus council tally` (and the MCP
  `amicus_council_tally`) computed the tally record but never wrote it, so `council-ledger.jsonl`
  stayed empty and `amicus council stats` always reported "No council runs recorded yet." The tally
  finalize step now auto-appends the row(s) — best-effort, so a ledger write failure never fails the
  tally — and a new `--no-ledger` flag computes a record without recording it (e.g. a re-tally).

### Changed
- **Unified config directory.** On startup Amicus now migrates a legacy `~/.config/sidecar` directory
  onto the canonical `~/.config/amicus` once, non-destructively (copy; the legacy dir is kept as a
  backup). This collapses the two-directory split that could let config resolution flip between them
  and orphan your config, catalog, and ledger. A `CONFIG_DIR` override opts out.

## [1.4.0] - 2026-06-28

### Added
- **Free OpenRouter council**: a new `amicus setup` option (readline wizard + Electron Models step)
  that stands up a zero-cost council of free `:free` OpenRouter models, saved as a first-class
  `councils` config primitive. Run it with `amicus fanout --council free` or the `amicus_fanout` MCP
  `council` param; the second-opinion skill reads `councils.free`. Free-model picks are detected
  live from the catalog (the `:free` suffix is authoritative), seeded under collision-safe `free-*`
  aliases, and a delisted member degrades gracefully (dropped with a warning) instead of failing the
  wave. Needs only an `OPENROUTER_API_KEY`; the wizard discloses the free-tier caveats (rate limits,
  variable quality, the OpenRouter data-sharing prerequisite). `config.default` is left untouched.

## [1.3.0] - 2026-06-24

Making the mature council/fan-out engine legible: live per-leg progress, cost
surfaced in human output, the deterministic council spine reachable over MCP,
and a shareable verdict/disagreement report. Every change is presentation over
data the engine already records — no schema change.

### Added
- **Live per-leg fan-out progress**: a running `amicus fanout` now prints a per-leg rollup on each
  heartbeat — every model's stage, message count, and latest action — instead of a generic "still
  running". `amicus_status` reports per-leg `latestActivity` plus a `stalled` flag, so you can see
  at a glance which model is working, which is quiet, and which is wedged.
- **Cost in human output**: the `amicus fanout` / `amicus read` human view now shows a per-leg `$`
  cost cell and a `Wave cost:` total, and `amicus council tally` shows a run cost line. Each figure
  is tagged by source (reported, `~` estimated, `?` unknown) so it can never be mistaken for an
  authoritative number it isn't — surfaced straight from the existing usage telemetry.
- **Council over MCP**: three new MCP tools — `amicus_council_tally`, `amicus_council_stats`, and
  `amicus_verdict` — expose the deterministic council spine (peers-only tier cascade, street-cred,
  the reliability ledger, and verdict merge) to Claude directly, with no Bash round-trip.
- **`amicus council report`**: render a shareable disagreement + verdict report from a
  `verdict.json` — the adjudication matrix (finding × judge), peers-only street-cred, findings
  grouped by tier (Disputed first), and per-model + wave cost — as Markdown (`--md`, default) or a
  self-contained HTML page (`--html`). Pass `--wave <wave.json>` to fold in the wave-level cost
  total. The council skill's Stage-5 step now drives this renderer instead of hand-assembling the
  report.

## [1.2.1] - 2026-06-24

### Fixed
- **`amicus models --check` / `amicus doctor` stale deepseek warning is now clearable**: the
  built-in deepseek direct fallback (`deepseek/deepseek-chat`) has been updated to
  `deepseek/deepseek-v4-pro`. Additionally, stale curated-route warnings are now suppressed when
  the same alias already resolves live via any other source (default openrouter route or a
  user-set alias), so the suggested `--add-alias` fix actually clears the warning instead of
  leaving it permanently unresolvable.

## [1.2.0] - 2026-06-24

A post-launch enhancement program: reliability and cost made real, the council's
trust machinery turned from hand-math into deterministic code, plus first-run
diagnostics, a Claude Code plugin, and an observable interactive surface.

### Added
- **`amicus doctor`**: a one-screen first-run health check — configured providers, default-model
  resolution vs. the live catalog, catalog freshness, the OpenCode binary, Electron, installed
  skills, and MCP registration. Each red line carries the exact fix command; `--json` lets skills
  self-diagnose.
- **Claude Code plugin**: Amicus is now installable from the marketplace —
  `/plugin marketplace add BourbonDog/amicus` then `/plugin install amicus`. The plugin ships both
  skills and the MCP server; npm stays the engine/CLI. (The plugin channel skips the global
  postinstall via `AMICUS_SKIP_POSTINSTALL` so it can't double-register.)
- **Per-leg cost & token telemetry**: the run/wave schema (now `schemaVersion: 2`) carries a
  `usage` block — input/output/reasoning tokens and a `$` cost tagged by source (reported >
  estimated > unknown). Surfaced in `fanout --json` and council run-stats.
- **Enforced budget gate**: a per-`$/Mtok` threshold (on by default — blocks o3-pro-class models
  before a wave launches) plus an optional `--max-cost` total ceiling. `--no-cost-gate` is the
  explicit escape hatch.
- **`amicus council tally|stats`**: deterministic council scoring — a structured findings
  contract, a peers-only tier cascade with self-vote-corrected street-cred, a compounding
  reviewer-reliability ledger, and a machine-readable `verdict.json`. The council stays a skill;
  the engine owns only the arithmetic and schemas.
- **Structured `--json` error envelope**: pre-flight failures now emit a typed
  `{ ok: false, error: { code, message, hint } }` document on stdout (stable codes like
  `MISSING_KEY`, `BAD_MODEL`, `BUDGET_EXCEEDED`) instead of bare text on stderr.

### Changed
- **Interactive GUI sessions now persist live**: `conversation.jsonl` and `progress.json` are
  written as the session runs, so the CLI heartbeat, `amicus status`, and
  `amicus read --conversation` work for GUI sessions — and **closing the window without folding no
  longer loses the transcript**. Interactive runs also record token/cost usage. (Headless and
  interactive now share one persistence transform.)
- **Reliability**: a single source of truth for terminal state (exit code and `metadata.status`
  always agree; the idle backstop no longer exits 0 with `running` metadata), and an
  activity-driven interactive watchdog that won't kill an actively-working-but-quiet GUI session.
- **CI**: a real matrix (Ubuntu / Windows / macOS × Node 18 / 20 / 22) plus lint, secret-scan, and
  size-gate now gate every push and the publish.
- Repo layout: the chat skill moved to `skills/sidecar/` (both skills live under `skills/`); npm
  `homepage` now points at the live site; README and the landing page gained a "Prerequisites &
  cost" section.

### Fixed
- **MCP stderr fd leak**: `spawnSidecarProcess` opened a `debug.log` descriptor for the child's
  stderr but never closed the parent's copy — a descriptor leak that, on Windows, also held the
  file open and blocked session-dir cleanup.
- Platform-correct missing-key guidance (PowerShell `$PROFILE`/`setx` on Windows; leads with
  `amicus key`); the committed-secret scan now knows all five providers; `amicus models` marks
  your **actual** aliases (not curated defaults); OpenRouter's `-1` "variable pricing" sentinel
  renders as `—` instead of a nonsense negative price.

## [1.1.0] - 2026-06-11

### Added
- **DeepSeek as a direct API provider**: DeepSeek card and API key step in the setup wizard,
  live model fetch from DeepSeek's `/models`, and a direct `deepseek/...` route used
  automatically when no OpenRouter key is configured.
- **`amicus key`**: headless API key management — `amicus key` lists configured providers with
  masked hints, `amicus key <provider> <key>` validates and saves, `--remove` deletes. No GUI
  required.
- **Live quick picks in the setup wizard (Step 2)**: recommended models resolve per family
  against the live catalog when the window opens (no stale pinned ids), with always-visible
  labeled search and a write-preview showing exactly which alias will change.

### Changed
- **Setup wizard finish is now read-modify-write**: picking a model sets the default and
  upgrades only that one alias; untouched aliases are never rewritten and deleted aliases stay
  deleted. (Previously, finishing setup could silently rewrite every card alias.)
- Readline (no-Electron) setup parity: free-form model ids and the same no-clobber behavior.
  `amicus models --check` now also warns when a curated pinned fallback drifts from the live
  catalog.
- Council skill (Stage 6): the proposed MODEL-NOTES diff is written to a run-folder file and
  the approval prompt carries the file path — approval dialogs can hide chat text.
- Chat skill docs: single-model sidecars default to interactive (GUI) mode; headless remains
  the default for fanouts and bulk runs.
- Attribution: npm package author is Christian Wagner; "Inspired by" fork wording in
  CONTRIBUTING.

### Fixed
- **Electron preload crash on every page**: `window.sidecar` (contextBridge) is now exposed
  before DOM injection, and the injected CSS guards against a null `documentElement` — the
  silent TypeError previously killed both the bridge and the anti-white-flash styling.
- DeepSeek provider pill showed `undefined` in the wizard model step.

## [1.0.0] - 2026-06-10

Everything since the fork from upstream `claude-sidecar` v0.5.2 — the Amicus launch line.

### Added
- **LLM Council** (`skills/second-opinion/`): structured multi-model review — independent
  reviews, anonymized peer cross-review with street-cred scoring, non-Claude chair verdict,
  tiered accept/deny decisions. v3 runs natively on the fanout/JSON engine primitives.
- **`amicus fanout`**: run N models on one prompt in parallel over a single shared engine
  server; stable JSON wave output (`schemaVersion: 1`), exit codes 0/2/1.
- **`amicus models`**: live OpenRouter model catalog (TTL cache, keyless fetch) with search,
  refresh, and alias auditing (`--check` suggests replacements for stale aliases). Model
  validation on `start`/`fanout`/`continue`/`resume` (`--no-validate-model` to skip).
- **`--prompt-file`** (start/fanout): briefings from a file — no shell quoting, no Windows
  ~32 KB argument cap. **`--json`** structured output for `start` and `read`.
- **`amicus abort --all`**; searchable live model picker in the setup wizard; catalog seeding on
  first-run setup; GUI load failsafe (`AMICUS_GUI_LOAD_TIMEOUT_MS`).
- Council ships in the npm package and installs to `~/.claude/skills/second-opinion/`
  (MODEL-NOTES is seeded once and never overwritten — it's user data).

### Changed
- **Rebranded** `claude-sidecar` → `amicus` (bins `amicus`/`am`; MCP tools `amicus_*`; config
  `~/.config/amicus`; env `AMICUS_*`). Every legacy `sidecar*` form still works as a deprecated
  shim — see `docs/SHIMS.md`.
- Headless reliability: activity-aware completion (quiet tool-call gaps no longer end runs
  early), absolute `--timeout` enforcement, OpenCode idle-status as authoritative completion,
  dead-server fast-exit.
- Windows is first-class: the full unit suite is green on Windows 11; session-path encoding,
  path-separator, and native-binary PATH bugs fixed; process lifecycle (abort/teardown) works
  cross-platform.

### Fixed
- Orphaned sessions and zombie servers on abort (cross-platform PID capture + graceful
  teardown with force-exit net); broken `codex`/`grok` aliases (validation now catches stale
  aliases); update checks (ESM updater loading); session-dir gitignore leak.

### Attribution
Amicus is an independent MIT fork of [Claude Sidecar](https://github.com/jrenaldi79/sidecar)
by John Renaldi. See `LICENSE` and `NOTICE`.
