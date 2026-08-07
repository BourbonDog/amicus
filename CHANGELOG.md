# Changelog

All notable changes to Amicus are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver.

## [Unreleased]

### Added

- **`runStats` gains a row for every paid launch, not just one per requested seat** (v4.7 CA-4,
  the row-per-launch design — closes the chair-cost accounting gap). Three new roles cover legs
  that were billed but never rowed: `chair-attempt` (a failed ch1–ch3 chair launch), `repair`
  (a Stage-1 `-p`, Stage-2 `-q`, chair-ch4, or debate-born `-d<N>r`/`-rv-…r` solo — a failed
  defense or re-vote repair), and `superseded` (a first leg a later attempt replaced — an SL-2
  retry or a debate repair); `wasChair` is always `false` on these. Every dead seat/critic/lens
  with no recovery, and a chair walk that gives up entirely, now get an honest primary error row
  too, extending the #83 judge treatment to every seat.
- **`runStats[].waveId`** (emit-only-when-set): every row backed by a real billed leg now names
  the exact wave/leg it came from; e.g. the synthetic `claude` row, a give-up chair's error row,
  and a leg-less dead-seat/critic/lens primary error row (the two SL-2 retry note-classes that
  never produced a real leg for the seat at all) carry none.
- **The run-cost bijection invariant suite** (`tests/council/run-cost-bijection.test.js`): every
  terminal run now proves Σ(`runStats` legged-row usage) equals `run.json`'s `usage` block —
  cost, and the reported/estimated/unpriced/subtreeUnknown leg counts — across clean, repair,
  chair-walk-failure, debate-repair, retry-healed, and retry-failed scenarios.
- **`runStats[].resolvedModel`** (v4.7 GOA-7, emit-only-when-set): every row built from a served
  leg now records the executable id that actually served (post-fallback-substitution), never the
  alias; carried verbatim through `tally.json`/`verdict.json` and onto `council-ledger.jsonl` rows.
- **`council stats` rows gain `aliases[]`** (every alias observed for the group, most recent
  first — `aliases[0]` is the launch-preferred name) **and a `legacy` mark** on groups whose rows
  all lack `resolvedModel`; the human table sizes the model column to the longest key (16-char
  floor) and marks `legacy` in the notes column beside `low-N`.
- **`--tag <t>` on `start`/`fanout`/`council run`** (CLI + MCP, v4.7 F8 D13): labels a session
  for `list`/`--search`/`spend --group-by tag`. Reject-style validation
  (`^[A-Za-z0-9_-]{1,64}$`) — an invalid tag fails fast rather than being silently truncated or
  charset-stripped the way `sanitizeCouncilName` cleans, since a stored tag is a search key.
  Stored absent-not-null on `metadata.json`/`wave.json`/`run.json` and every result doc; the MCP
  shared-server's in-process start path stamps it too. `--tag` is rejected alongside
  `--retry-failed` (`BAD_ARGS`).
  Council sub-waves (Stage-1, critic/lens solos, Stage-2, chair, debate) all carry the run's tag
  on their own wave metadata. Riders: `continue`/`resume` don't yet inherit the parent session's
  tag (their rows group under `(unattributed)` for `--group-by tag`), and `--retry-failed` doesn't
  yet inherit the original wave's tag either — both are future work, not oversights.
- **`amicus list --search <q>` / MCP `amicus_list {search}`** (F8 D15, errata E-PR3-5):
  case-insensitive substring filter over `id`, `tag`, and briefing material. Fan-out wave rows
  match against the full `briefing.md` text (falling back to the row's 200-char excerpt when
  unreadable); council-run rows match `briefing.md` written at MCP launch, or the
  post-`--- MATERIAL / BRIEFING ---` portion of `briefing-stage1.md` for CLI-launched runs; leg
  rows (spawned by a wave) match `id`/`tag` only, so a wave's briefing never surfaces once per
  leg it spawned. A bare `--search` with no value is a usage error.
- **`amicus spend --group-by tag`** (F8 D16): spend-ledger rows now carry `tag` (leg and solo
  rows alike); untagged history groups under `(unattributed)`, matching every other dimension's
  convention. `SPEND_LEDGER_SCHEMA_VERSION` stays at `1` — this is an additive field, not the kind
  of change that forced the council-ledger's `LEDGER_SCHEMA_VERSION` 1 → 2 bump above, which
  existed to segment history by resolved-model id, a different need.

### Changed

- **Tally/report/GUI cost totals now include legs that used to be silently dropped** — repairs,
  failed chair attempts, and superseded/replaced legs all get a row now. Totals read HIGHER than
  v4.6.x for an identical run, intentionally: this is the fix for the two-numbers-disagree
  symptom (`council tally`'s sum vs. `run.json`'s total quietly diverging by the omitted spend).
- **The council-ledger join is now an explicit allowlist, not a skip-set**: `seat`, `critic`,
  `lens:*`, `chair`, `claude`, `council`, `redteam`. Fail-closed by design — consumers keying
  `runStats` by model must now exclude every role outside that set, the v4.7 analogue of v4.6's
  "must exclude `role: 'judge'`" rule: a custom/free-form `role` label (e.g. a skill-authored tag)
  still renders in the tally/report artifact but no longer contributes role/wasChair/conformance
  to `amicus council stats` reliability numbers.
- **The Workspace seats panel no longer renders the three new non-seat launch rows**
  (`chair-attempt`, `repair`, `superseded`) — they still appear in the report/tally cost tables,
  just not as a seat.
- **`LEDGER_SCHEMA_VERSION` 1 → 2** (v4.7 GOA-7). Legacy-read, no migration: rows without
  `resolvedModel` (all pre-v4.7 history, plus leg-less rows whose resolution is unknowable)
  aggregate under their alias; a group is marked `legacy` only when every row in it lacks
  `resolvedModel`.
- **`council stats` groups reliability by resolved model id** (`resolvedModel || model`) instead
  of by alias alone — history splits honestly at the bump; a retargeted alias's new rows start
  a fresh `low-N` group.
- **Chair fallback promotion (`pickFallbackChair`) excludes candidates by their full name set**
  (group key + `aliases[]`) and launches the group's most-recent alias (`aliases[0]`) — a bench
  seat's resolved-keyed group can no longer be promoted as its own chair.
- **`amicus list` and the MCP `amicus_list` tool now share one enumeration**
  (`src/sidecar/read.js`, F8 D14): MCP rows gain `type`/`parentWave`/`legCount`, CLI rows gain
  `mode`, and both gain `tag`. The MCP `status` input relaxed from a 3-value enum
  (`'all' | 'running' | 'complete'`) to a free string, so `error`/`aborted`/`crashed`/
  `timed-out`/`idle-timeout` — always real statuses, previously rejected outright by MCP's schema
  even though the CLI already accepted them — now filter correctly there too. The CLI table
  gained a `TAG` column.
- Test/comment/docs sweep (v4.7 PR4, theme a): ~30 census nits dispositioned — no behavior
  changes.

### Fixed

- **`amicus list --all` now actually lists every project.** The flag has been documented since
  before v4.7 (`--all` / "Show all projects" in `amicus list`'s help text) but `listSidecars`
  never read it, so it silently behaved exactly like a bare `amicus list`. It now enumerates
  every project the global sessions-index knows about (an advisory navigation aid, not
  authoritative — a stale entry pointing at a missing or unreadable project is skipped, not
  surfaced as an error), deduped by canonical project identity.
- **`amicus list --search` was accepted and silently ignored.** The generic CLI arg parser took
  any `--search <value>`, but nothing downstream read it, so the flag — whose sibling convention,
  `amicus models --search`, was already a repo-wide pattern — quietly did nothing. It's now
  implemented; see Added, above.
- **`amicus fanout --quiet` was accepted and silently ignored.** `quiet` is a repo-wide known
  flag, so the command parsed and exited 0 — but `handleFanout` never forwarded it into
  `runFanout`, which printed the launch banner and per-leg lines anyway. Same
  accepted-but-ignored shape as `list --search` above.
- **`amicus pack save --version <semver>` was accepted and silently ignored — it wrote no pack at
  all.** `version` is a global boolean flag, so `parseArgs` set `args.version = true`, stranded the
  semver in positionals, and `bin/amicus.js` printed the amicus version banner *before* command
  dispatch — `handlePack` never ran, and the command exited 0 having saved nothing.
  `--version=2.0.0` failed identically. Meanwhile the handler read `args.version` for a value it
  could never receive, and both the help text and `docs/usage.md` documented `--version <semver>`
  as a real option. The pack's own version is now spelled **`--pack-version <semver>`** (honored on
  both the flags and `--from-run` paths), and `pack save --version` fails fast with `BAD_ARGS`
  naming the right spelling. Every other `--version` still prints the banner. Third instance of the
  accepted-but-ignored shape, after `list --search` and `fanout --quiet` above.
- **A fanout whose server fails to start no longer drops its pack.** `errorWave` — the third
  `buildWaveResult` call site — inherited a pre-seeded `tag` from `metadata.json` but not a
  pre-seeded `pack`, so an MCP-spawned wave that died at server start persisted a `wave.json`
  missing the pack it was launched with (and `amicus read --json` prefers `wave.json`). The two
  other call sites already inherited both; this was the lone holdout.
- **The test suite no longer writes session directories outside its sandbox.** Several suites
  passed the literal `'/tmp'` as a project cwd — on Windows that resolves to `C:\tmp`, a real
  directory — so every run leaked real session dirs onto the developer's filesystem and into the
  global sessions-index. They now sandbox under `os.tmpdir()`, pinned by
  `tests/hermetic-tmp-guard.test.js`. This residue was what made `--all` an 8-second, 21k-row
  dump on a developer machine.

### Added (follow-up)

- **`amicus list --limit <n>`**: show only the *n* newest rows (`0` = unlimited, and absent
  behaves exactly as before). When the cap elides rows it says so, naming the real total; in
  `--json` mode that notice goes to stderr so stdout stays a single parseable document. Caps
  output only — `--all` still enumerates every project, since capping the walk would rank rows it
  never saw.

## [4.6.3] - 2026-08-05

### Added

- **`fable` now carries an authored direct-Anthropic route** (`anthropic/claude-fable-5`,
  verified live: Anthropic's `/v1/models` lists it and a direct leg serves). With an
  Anthropic key present, `fable` routes direct-first like the other Anthropic aliases;
  the `ANTHROPIC_MODELS` floor gains a matching row so keyless installs validate it.
- **`doctor` gains a `session-metadata-tmp` check; `--fix` sweeps the orphans.** A kill
  between an atomic write's tmp-file and rename leaves `.metadata.json.*.tmp` orphans in
  per-session directories (the B09 class — ~30 write sites). Plain `doctor` reports them;
  `--fix` removes orphans older than 60 s from the current project's sessions root and
  announces the heal in the one voice (`Recovered: …`).
- **`council save` announces when it shadows a built-in bench.** Saving a council named
  `free`/`budget`/`frontier` previously printed no notice at all (the overwrite marker only
  tracked user-config names); the save now reports `shadowsBuiltin` (`--json`) and prints
  the shadow notice.

### Fixed

- **`models --check` no longer false-flags deliberate gateway-only routes.** A curated
  alias whose direct form is derived (not authored) from its OpenRouter route is no
  longer reported STALE — flat row, `GATEWAY STALE` row, candidates, and the
  `fix: --add-alias` retarget suggestion all suppressed together — when the OpenRouter
  route still serves. Deliberately gateway-only entries (`gpt-pro`) are annotated in
  the curated data and never audited for a direct sibling. Kills the v4.6.2
  release-gate false positive whose suggested "fix" was a silent tier downgrade.
- **The Workspace seats panel's dead-seat rows are now role-aware and old-run
  resilient.** A model that died as critic but succeeded as chair no longer has
  its dead row hidden by the chair's cost row (only a live reviewing leg —
  seat/critic/lens — suppresses, and a dead critic only by a live critic leg);
  the dead critic's row names its role. Pre-v4.6 runs render their losses too:
  `verdict.seatLoss.deadBenchSeats` feeds rows, and `verdict.json`'s
  `degrades[]` backstops a `run.json` that lost its checkpoint. A stale
  `get-run` reply from a run you navigated away from can no longer repaint the
  run now open.
- **A valueless `-o`/`--out` on `council verdict` now errors** (`BAD_ARGS`, flag named,
  exit 1) instead of crashing mid-write (renameSync `TypeError`) and orphaning a
  `true.tmp-<pid>` temp file. Behavior change, per the v4.6.3 R1 ruling.
- **README corrections from the v4.6.3 accuracy review**: the Node.js floor is
  22.12 (required since v3.0 — the README, install scripts, landing page, and
  `amicus doctor`'s node check still said 18), and the optional-council-elements
  list now matches the shipped skill (four opt-ins; the chair's verdict scale
  has been standard, not opt-in). The doctor's `node` row now errors below
  22.12 (it previously passed anything ≥ 18).

### CI

- **The MCP-Registry skip-check now verifies the version it trusts.** The
  release workflow's idempotency pre-check previously skipped registry publish
  on a bare HTTP 200; it now also requires the response body to both name the
  exact version and report it as `active`, so preview-API schema churn — or a
  stale/deprecated registry entry — can no longer produce a false skip. Every
  new failure mode still routes toward publishing.

## [4.6.2] - 2026-08-05

### Added

- **Headless legs now fail fast when a model produces nothing.** A leg that produces zero
  output, reasoning, or tool calls for `AMICUS_NO_OUTPUT_BACKSTOP_MS` (120 s default,
  env-tunable) is failed with `NO_OUTPUT_BACKSTOP: …` instead of burning the full `--timeout`
  to learn nothing — the "accepted but not serving" class. Disarms permanently on the first
  sign of activity, so slow cold-prefill local models are unaffected; `0` (or negative)
  disables it.
- **`doctor` gains a new `anthropic-base-url` row.** Prints the exact `ANTHROPIC_BASE_URL` the
  process sees and how it will be treated — the host-form value can live only in a parent
  process's environment, so the seen value is the only diagnostic there is.
- **Host-form `ANTHROPIC_BASE_URL` is now carried into the engine as `<value>/v1` by default**
  (a provider-config override — zero env vars written; announced once per process).
  Host-form is the Anthropic-SDK convention (the SDK appends `/v1` itself), but OpenCode's
  provider layer treats the value as the full prefix, so unnormalized host-form previously
  404'd every direct-Anthropic leg. `AMICUS_BASE_URL_NORMALIZE=0` disables normalization
  entirely.
- **`models --check` and the `doctor` aliases row now flag stored-alias drift**: a stored alias
  that's still catalog-listed but no longer matches any route its family currently resolves to
  (the v4.6.1 `gemini` release-gate class), with the exact `setup --add-alias` refresh command.
- **`models --check` gains an opt-in `--live` probe.** `--check --live` sends one real, tiny
  request to every *stored* alias (curated defaults are out of scope) on a single quiet fan-out
  wave and reports `SERVED` / `SILENT` (`accepted-but-silent`) / `ERROR` per alias — the
  on-demand version of the check that would have caught the v4.6.1 `gemini` incident (a
  catalog-listed model no longer actually served). Spends real money: one tiny leg per stored
  alias. Non-served outcomes fold into the existing exit code; a stored-alias count above the
  fan-out leg cap (`AMICUS_FANOUT_MAX_LEGS`) fails fast before anything is probed. When the
  probe can't run (catalog unavailable, or `--refresh` also passed), Amicus announces the skip
  instead of silently dropping the flag.
- **The Council Workspace seats panel now shows seats a run announced dead.** The **Seats**
  table appends a row for every seat with zero usable legs — derived from `run.json`'s
  `degrades[]` (dead-leg/dead-wave records) and the critic's `verdict.seatLoss` — with a
  blind-maskable model name (a dead seat has no anonymity label, so blind mode renders
  `(masked)` rather than leak the raw id), `did not review — retried once` (the degrade
  recorded a `retryWaveId`) or plain `did not review`, no cost cell, and muted seat-dead
  styling. Dead rows appear live, mid-poll: as soon as the run checkpoints the loss — always
  post-retry, so a row never lands before the seat's one shot at recovery is spent — it paints
  and stays through every tick after (immediately for a dead-wave seat; at that stage's
  boundary for a dead-leg seat, since the panel keeps suppressing the row while the seat's own
  errored-leg entry is still listed live); the run's terminal refresh then additionally unions
  the critic's `seatLoss` on top, for any loss the live payload alone didn't carry.
- **The chair fallback walk now records every attempt on `run.json`.** Each leg it tries — `ch1`
  (the requested chair), `ch2` (a same-chair retry), `ch3` (the ledger-promoted fallback) —
  appends an entry to an additive `chairAttempts[]` array (`{waveId, model, outcome, reason}`,
  `outcome ∈ completed|error|timeout|no-output`), checkpointed after every attempt so a mid-walk
  kill never loses what already ran. When no chair leg completes at all, the `chair-failed`
  degrade's "What was lost" `why` now names each attempt's cause instead of one flat sentence —
  `ch1 <model>: <reason> · ch2 <model>: <reason> · ...` — while a chair that ran but produced no
  parseable VERDICT line keeps its original flat why (the walk didn't fail). The `ch4`
  VERDICT-line repair re-prompt is deliberately not counted as an attempt — its chair leg already
  completed; only the verdict line gets re-prompted.

### Fixed

- **The `gpt` quick-pick family stopped resolving once OpenAI split 5.6 into
  tiers.** `idPattern` only matched bare numeric ids (`gpt-5.5`), so it missed
  5.6 entirely — `gpt-5.6-sol` (premium), `gpt-5.6-terra` (mid), `gpt-5.6-luna`
  (economy), and their `-pro` siblings all fell outside it, leaving the family
  pinned to the older `gpt-5.5` and the owner's stored `gpt` alias reported as
  DRIFTED. Per owner ruling, `gpt` now tracks the TERRA (mid) tier: the
  pattern additionally matches `-terra` while still excluding `-terra-pro`,
  `-sol*`, `-luna*`, and the unrelated `-codex` family; the pinned fallback
  moves to `openrouter/openai/gpt-5.6-terra`. Bare numeric ids stay matched as
  a within-family fallback.
- **The curated `opus` pin fell behind the live catalog.** Both routes move from Claude
  Opus 4.8 to Claude Opus 5: `openrouter/anthropic/claude-opus-5` plus the authored
  direct `anthropic/claude-opus-5` (verified against the live catalog and Anthropic docs
  2026-08-04 — authored, never derived; anthropic stays in `DIVERGENT_VENDORS`). Same
  live price, so the `frontier` bench's pricing evidence is unchanged. The offline
  `ANTHROPIC_MODELS` floor gains a matching `anthropic/claude-opus-5` row so keyless and
  offline installs never report the shipped default stale. Opus 5's two gateway forms
  coincide (no dotted version segment), so the dot-vs-dash regression guards now ride
  `haiku`, the surviving divergent-form alias.

### Removed

- **The `devstral` alias** (owner ruling 2026-08-04). OpenRouter delisted the entire
  devstral family — zero matches across the live catalog, any vendor — and the alias had
  no other route. No served model is a devstral successor, so the alias was dropped
  rather than retargeted ("no pinned guess is better than a wrong one"); `mistral`
  remains the vendor's alias, and a stored `devstral` alias in user config is flagged
  with replacement suggestions by `models --check` / `doctor`. This was the pin that made
  `models --check` exit 1 — the v4.6.2 release-gate risk.

### CI

- **The macOS/node-24 unit leg now runs jest with `--workerIdleMemoryLimit=1GB`.** That leg —
  and only that leg — intermittently lost a worker to a native SIGSEGV ("A jest worker process
  was terminated by another process"), which fails whichever suite occupied the worker with
  zero assertion failures and a green rerun. Three confirmed hits (2026-07-31
  run-cost-unknown, 2026-08-04 PR #100 update-notice, 2026-08-05 PR #105 — 6466 passed, the
  dead worker alone failed 1 suite) tripped the standing third-occurrence rule. The limit
  makes jest recycle an idle worker before the leak reaches segfault territory; the flag is
  injected via a matrix `include`, so the other five legs still run a bare `npm test`.

## [4.6.1] - 2026-08-03

### Added

- **The MCP channel finally hears about new versions** (spec 2026-08-03). The MCP server now
  runs the update check at startup and appends one flavor-aware notice block to the first
  successful tool result of each server process (once per session, latched); `amicus_guide`
  carries an always-on update line, and one `[amicus] update available` line lands in the
  client's MCP log on stderr. The instruction is chosen config-first (`npx -y amicus@latest`
  registrations are told a restart suffices; cached/pinned npx copies get the re-point-or-
  clear-cache hint in the unverified voice; global installs get `npm install -g amicus`, from
  where #33's stale-version warning takes over). Words only — no auto-update over MCP, no
  periodic re-check; `NO_UPDATE_NOTIFIER=1` still disables the check entirely.
- **A lost Stage-1 seat gets one more chance (SL-2).** A council sub-wave that dies before
  its legs exist, or a leg that ends with no usable output, is relaunched exactly once —
  serially, after the surviving launches settle. Recovery announces in the one voice
  (`Recovered: seat X reviewed on retry — …`, a `stage1-retry` heal on
  `run.json`/`verdict.json` `degrades[]`) and the run stays exit 0; a seat still dead after
  its retry degrades exactly as before, with both attempts named in the why. Unconditional;
  gated on the run's `--max-cost` position (an over-budget run skips the retry and records
  the loss byte-identically to v4.6.0). Retry legs and their spend-ledger rows carry
  `retryOfWaveId`. A healed critic counts as seated in `verdict.seatLoss`.

### Changed

- **The shipped second-opinion MODEL-NOTES seed was corrected and enriched** (owner-ruled
  fold-back, PR #93): the haiku "hard-404" warning re-caused to the `ANTHROPIC_BASE_URL` `/v1`
  convention split, GLM's stale reliability caution withdrawn on the v4.4.1 fence-extractor
  replay evidence, pre-degrade-era claims re-grounded in the current announce/retry contract,
  and three model sections plus the "peer consensus ≠ evidence on published numbers" rule added
  from the field.

### Removed

- **The unused `rebuildElectron` remediation hint** (owner ruling 2026-08-03, closing Plan 3's
  queued hint-voice question). It had no live call site — `doctor --fix`, the in-place Electron
  self-heal, is its stated convergence target — and its prose asserted unverified causes ("after
  an ABI mismatch or partial unpack"). Absence-pinned in `tests/remediation-hints.test.js`; a
  reintroduction must adopt the unverified-cause voice. The same ruling keeps
  `sweepSessionIndexTmp`'s confident voice: its cause is definitional (an atomic-write tmp orphan
  has no other producer), not a guess.

## [4.6.0] - 2026-08-02

### Added (v4.6 milestone — the degrade announcement invariant, plans 1-4)

- **The ten-channel degrade announcement contract.** A council run can no longer degrade its
  exit code without announcing what was lost: every loss routes through one sink
  (`src/council/run-degrade.js`, the only code allowed to flip `degraded.value` — enforced by a
  source-scan invariant test) and lands with mandatory *what/why/effect* on stderr,
  `run.json.degrades[]`, `verdict.json.degrades[]`, and the report's new **"What was lost"**
  section, all rendered in one voice.
- **`verdict.seatLoss` is now derived from the degrade records** (closes #84) — a dead critic
  *leg* finally flips `criticSeated`, and `seatLoss` can no longer disagree with `degrades[]`.
  The v4.5.2 seatLoss shape is unchanged (its tests passed byte-unedited).
- **Stage-2 judge legs get `runStats` rows** (closes #83) — per-leg cost attribution for ~38%
  of a run's spend that had none, judge-tagged in the report's cost table.
- **`doctor` speaks the same language**: `doctor --json` gains additive `degrades[]`;
  `doctor --fix` prints `Recovered:` lines for every repair; the engine hints state causes as
  **unverified** instead of asserting an antivirus guess.
- **The Workspace is discoverable from the CLI**: `watch` usage names `--ui` (closes #80), and
  a CLI council run with Electron present prints how to open the live Workspace (closes #81 —
  the silence half; auto-open parity remains a product decision).

### Changed (v4.6 — deliberate behavior changes)

- **A dropped preset member now degrades the run to exit 2 on every transport** (was: exit 0
  with a `--json`-blind stderr notice). The loss is announced per-member with its reason.
- **A shared-server acquisition failure now exits degraded (2)** (was: stderr + run.json only,
  exit 0) — the per-wave fallback is the racy configuration and the run says so.
- **Reported cost totals rise** for identical runs versus v4.5.x: judge legs now appear in
  `runStats`. Consumers keying `runStats` by model must exclude `role: 'judge'` (as the
  ledger's reliability join now does).
- In-run degrade notices hedge the exit-code claim truthfully ("will exit degraded (2)");
  `engineMissing`/`reinstallEngineAv` hint prose changed to the unverified voice (commands
  byte-identical).

### Fixed (v4.6)

- **A dead Stage-1 leg was announced on no surface at all** (closes #85) — the only trace was
  its absence from the stage entry's `taskIds`. Now named everywhere, with a regression pin.
- **The Stage-5 verdict rebuild silently destroyed `seatLoss`/`degrades[]`** (closes #87) —
  `tally.json` carries neither, so the decisions flow dropped both; now preserved from the run
  folder's verdict the same way the chair's synthesis already was, on both CLI and MCP.
- **`watch --ui` against an `--out-dir` run failed with a symptom, not a cause** (closes #82) —
  the error now names the launch-directory pointer and the working invocation.

### Fixed

- **`/amicus:council` lost all of its frontmatter at load time.** `commands/council.md`'s
  `argument-hint` value began with `[material, path, or URL] [...]`, which YAML reads as a flow
  sequence followed by a second, unexpected `[` — the whole block failed to parse, so the command
  loaded with empty metadata: no description, no argument hint, and `disable-model-invocation:
  true` silently dropped (the command was model-invocable, the opposite of the intent). The value
  is now single-quoted. Present since `3900429` (Phase 9a, 2026-07-02); `claude plugin validate
  .claude-plugin/plugin.json` failed on it, non-strict, that entire time.
- **The preflight that should have caught it was validating the wrong file.** With `.claude-plugin/`
  holding both manifests, `claude plugin validate .` resolves the *marketplace* manifest and
  reports `✔ Validation passed` without ever inspecting the plugin. `docs/DISTRIBUTION.md` §2 now
  documents the path trap, prescribes `claude plugin validate .claude-plugin/plugin.json`, and
  records why `--strict` is expected to fail here (the deliberately retained root-`CLAUDE.md`
  warning).

### Changed

- **`tests/plugin-commands.test.js` now YAML-parses frontmatter** for `commands/council.md` and
  both skills, asserting `description`, `argument-hint` (as a *string*), and
  `disable-model-invocation: true` survive parsing. The previous
  `expect(md).toContain('argument-hint:')` substring checks passed happily against a file that
  could not parse. `yaml` added as a devDependency for this.

## [4.5.4] - 2026-08-01

### Fixed

- **README: corrected a false claim about Electron and install channels.** The install section
  said "the standalone Electron window is npm-only." That is not true — the Council Workspace
  auto-open gate (`src/sidecar/workspace-auto-open.js`) keys on `client === 'code-local'` plus
  Electron presence, **not** on install channel, so a plugin-channel user in Claude Code local
  does get the window. Removed.

### Changed

- **README now leads with npm as the recommended install**, with a per-channel comparison table.
  The accurate reason npm is preferable for the interactive experience: the plugin's MCP config
  sets `AMICUS_SKIP_POSTINSTALL=1`, and `scripts/postinstall.js` returns early on that — *before*
  `provisionElectron()`. So the plugin channel gets no `amicus` on `PATH` (every window-opening
  command becomes an `npx` call), no Electron provisioning or cache-heal, no reachable
  `amicus doctor --fix` when the GUI breaks, and a fresh npx cache directory on every release.
  The plugin block keeps its genuine strengths — native registration and the slash commands the
  npm paths don't have — alongside an accurate statement of the tradeoff.
- **README documents the single-MCP-registration behavior** when both channels are installed.
  Config, API keys, and session history are shared, but the MCP server is one registration named
  `amicus` that resolves to whichever install registered most recently — so the copy the CLI runs
  and the copy Claude's MCP tools run can differ. This is the #76 confusion; `amicus doctor`
  reports the MCP launch path and `--fix` repairs that copy in place.

## [4.5.3] - 2026-08-01

### Fixed

- **Unknown CLI flags are rejected instead of silently absorbed.** `parseArgs` treated any
  `--token` as a flag: an unrecognized one landed on the parsed args object, no handler read it,
  and the command ran as though it were never typed. Found while smoke-testing v4.5.2 —
  `amicus start -m deepseek --prompt "…" --headless` printed no error and exited 0, but `start`
  has no `--headless`; the run silently took the **interactive** path, ignored `-m`, and left a
  session running against the default model. A typo (`--modl`), a flag borrowed from another
  command, or an invented one all behaved the same way, and an unknown flag followed by a
  positional would swallow it as its value. Unknown flags now get the same treatment amicus
  already gave an unknown *command*: name it, suggest the nearest real flag, point at `--help`,
  exit 1. The known-flag set is **derived from the usage text** (the same source `getCommandNames()`
  uses, for the same anti-rot reason) plus the boolean-flag list, plus a small explicitly-documented
  allowlist of internal MCP→CLI passthroughs (`--task-id`, `--run-id`, `--council-name`,
  `--cowork-process`) and undocumented-but-working flags (`--briefing`, `--mode`, `--quiet`).
  A regression test asserts every `args.<flag>` any CLI handler reads is in the known set, so the
  check can never silently start rejecting a flag that works.

### Changed

- **README Quick start is now four numbered steps**, with **Configure** promoted from a bold line
  buried between two callouts to its own step and TOC entry. Installing without configuring is the
  step people skip, and every council fails at the first model call when they do — so it now says
  so plainly, notes that one OpenRouter key is enough to start, and ends with `amicus doctor` as
  the confirmation that setup actually took.

## [4.5.2] - 2026-07-31

### Fixed

- **OpenCode server-start timeout is no longer pinned to the SDK's 5000 ms, and a start timeout
  is now retried.** `@opencode-ai/sdk` defaults `createOpencodeServer`'s start timeout to 5 s and
  lets the caller override it; amicus never passed one, so every start on every platform ran on
  that default — undocumented, untunable, and invisible to `amicus doctor`. Worse, the existing
  start retry (`retryOnLockRace`) classified only `database is locked` / `SQLITE_BUSY`, so a start
  timeout fell straight through with **zero** retries, past machinery already wired in at every
  call site. On a Windows box with the project on a OneDrive-synced volume and Defender active, a
  cold OpenCode/SQLite start blew the window: the council's shared server failed to acquire, the
  run degraded to exactly the per-wave configuration `src/council/run-server.js` exists to
  eliminate, and the whole Stage-1 bench died with `COUNCIL_QUORUM: Only 0 Stage-1 review(s)
  survived`. Three of the reporter's runs were lost this way. A start timeout is now classified as
  transient (`isTimeoutClassStartFailure`) and retried on the same bounded 250/500/1000/2000 ms
  schedule, the timeout is threaded through `buildServerOptions` and both upstream start sites,
  and the default is raised to **30 s on Windows / 15 s elsewhere** — a slow start costs latency,
  a failed start costs a review seat.
- **The Electron self-heal was dead code in every published install.** `src/sidecar/unzip.js`
  did a bare, unguarded `require('extract-zip')` for a package that was never declared in
  `dependencies` or `optionalDependencies`. It resolved in the dev tree only because `puppeteer`
  (a devDependency) pulls it transitively — `npm ls extract-zip --omit=dev` returned empty — so on
  a real `npm i -g amicus` `robustExtract` threw `MODULE_NOT_FOUND` before Strategy 1. That made
  the native-unzip fallback below it unreachable, the bounded idle/max timers from the
  extract-zip-node24 work inert, and `amicus doctor --fix` dead-end at `self-heal incomplete` —
  while routing users toward antivirus allow-listing for what was actually a missing module.
  `extract-zip` is now a declared production dependency, the `require` degrades into the native
  strategies instead of throwing out of the function, and a new `no-phantom-dependencies` test
  fails on any undeclared runtime require anywhere in `src/`, `bin/` or `electron/`.
- **A lost critic is now recorded on `verdict.json`.** The critic is a solo wave with one leg, and
  unlike a dead bench wave (which trips the quorum gate and fails the run loudly) a dead critic is
  survivable — so a run could reach a full verdict, tally and chair synthesis that had never seen
  the adversarial seat, with the only record being `deadWaves` in `run.json`. Field run `dfb6a692`
  did exactly that. `verdict.json` now carries an optional `seatLoss` block
  (`criticRequested`/`criticSeated`/`reason`/`deadBenchSeats`) whenever `--critic` was requested,
  so a reader of the verdict can see the critic never ran. Additive; `schemaVersion` stays `2`.

### Added

- **`AMICUS_SERVER_START_TIMEOUT_MS`** — override the server-start window (see
  [docs/configuration.md](docs/configuration.md#server-startup)). Values ≤ 0 are ignored rather
  than honored, since a zero start timeout fails every start instantly.
- **Successful server starts are logged at debug level** with both `startMs` and the `timeoutMs`
  ceiling in force, so headroom on a slow box is measurable rather than inferred — the question
  the field report could not answer.

## [4.5.1] - 2026-07-30

### Added

- **`electron-mcp` doctor check — doctor now validates Electron in the install the MCP actually
  runs from (#76).** `amicus doctor` used to probe Electron only in the copy doctor itself runs
  from (usually the global install), while `npx -y amicus@latest mcp` serves councils from an
  npx-cache copy — so doctor could print `Electron: ok` while every `ui: true` run failed with
  `electron-absent` (the electron-flavored recurrence of the engine's green-while-broken defect).
  The new check enumerates running/global/npx-cache installs (reusing the engine scanner) and
  probes Electron in each through a dual-root resolver — npm nests `electron` under
  `amicus/node_modules` in a global install but hoists it to a sibling in the npx cache (the #69
  layout lesson, now applied to Electron). With `--fix`, binary-missing npx copies are healed in
  place via `repairElectron` under the #56 timeout guard; never-installed copies are reported,
  not repaired.

### Changed

- **`workspaceOpenReason` distinguishes a broken Electron from a missing one (#76).**
  `electron-absent` now means the electron package was never installed; the new
  `electron-broken: binary missing under <dir> — run `amicus doctor --fix`` covers the
  package-present-but-binary-missing state (interrupted postinstall, AV quarantine) that the old
  single reason conflated with it — naming the exact dir and the one-command fix.

## [4.5.0] - 2026-07-28

"Save and share your councils" — complex run configurations become one command, repeatable and
shareable, and the flagship Council Workspace stops being opt-in on its best client.

### Added

- **Policy packs — save a full run configuration and invoke it by name.** `amicus pack save <name>
  --kind council|fanout|solo [flags]` (or `--from-run <id>`, which captures an existing council
  run / fanout wave / solo session instead of typing flags) writes one JSON file per pack to
  `~/.config/amicus/packs/<name>.json`; `pack list` / `pack show` / `pack rm` manage them. `--pack
  <name|path>` on `amicus start` / `fanout` / `council run` — and the new `pack` param on the
  `amicus_start` / `amicus_fanout` / `amicus_council_run` MCP tools — loads a pack's bench,
  chair/critic/lenses, options, and briefing template as this run's defaults. **Explicit flags
  always override the pack's values, and the pack is recorded either way** — `pack: {name,
  version, hash, source}` lands on the resulting session `metadata.json`, wave `metadata.json` /
  `wave.json`, or council `run.json`. Precedence throughout: **flag > pack > config default >
  built-in default**. A pack is validated on save (hard-fail — `PACK_INVALID` — with any
  non-fatal warnings printed to stderr) and again whenever it's used to launch a run; `pack show`
  never fails on an invalid pack, only reports what's wrong with it; `pack show` and `pack rm` both
  return `PACK_NOT_FOUND` for a missing pack. New `schemas/pack.schema.json`.
- **MCP pack semantics.** Over MCP, `pack` resolves entirely **in-process**, on the same call that
  reads it — a resolved pack is never forwarded as `--pack` to a spawned child. Two knobs get
  special-cased handling for CLI parity: a pack's `options.maxCost` and `briefing.template` have no
  MCP schema param of their own on `amicus_start`/`amicus_fanout`, but they still apply — forwarded
  to the spawned CLI child's argv as `--max-cost`/`--template` (`amicus_fanout` always spawns;
  `amicus_start`'s spawn-fallback path does the same), or, on `amicus_start`'s in-process
  shared-server path, applied via the same budget-gate/template-render code the CLI itself uses,
  before any session is created — so a shared pack's spend cap and briefing template never silently
  vanish over MCP. (`amicus_council_run` already has real MCP params for both.) Any *other* pack
  knob with no destination in a tool's own MCP input schema is never silently dropped either: it
  surfaces as an explicit `Notice: pack '<name>' sets <key>, which <tool> does not support over
  MCP — ignored.` content block, naming the pack's own camelCase option key (e.g. `contextTurns`,
  never the CLI's `context-turns`). Concretely, `amicus_fanout` has no MCP destination for
  `options.contextTurns` / `options.contextMaxTokens` (both notice); `amicus_start` has real params
  for both, so neither does.
- **Council packs do not accept `agent`/`thinking`/`summaryLength`.** They were inert on every
  surface — no council code path, CLI or MCP, ever reads a pack-filled one; the engine hardcodes
  agent `Plan`/summaryLength `verbose` regardless of what a pack says — so `KIND_OPTIONS.council`
  never accepted them; a council pack that sets one fails `pack save` (`PACK_INVALID`), naming the
  offending key. They remain valid, and functional, on `fanout`/`solo` packs.
- **Briefing templates.** `amicus template list|show`, plus `--template <name|path>` / `--artifact
  <file>` / `--var <k=v>` (repeatable) on `start` / `fanout` / `council run`, render a
  `{{variable}}` briefing before it's sent. Templates are Markdown files in
  `~/.config/amicus/templates/` — a same-named user file shadows a built-in, the same precedent
  saved councils already use — and v4.5 ships one built-in, `review`. Known variables: `{{prompt}}`,
  `{{artifact}}`, `{{artifact_path}}`, `{{date}}`, `{{project}}`, `{{var.<key>}}`. Rendering is
  strict by design: an unknown variable, a slot with no data behind it, or data passed with no slot
  to receive it are all hard errors (`TEMPLATE_RENDER`) rather than a silently dropped value. MCP
  has no `template` param of its own on any of the three run tools — a pack's `briefing.template` is
  the only way a template reaches an MCP-invoked run.
- **The Council Workspace auto-opens on `amicus_council_run` from Claude Code (local).** When the
  MCP tool `amicus_council_run` is invoked from Claude Code (local), the same Electron window that
  `amicus watch <runId> --ui` has always opened by hand now launches automatically, detached, right
  after the run starts — no more separate `--ui` call to see the flagship v4.4 surface. The CLI
  `amicus council run` is unaffected (there is no MCP client to detect on that path). Decision
  order: an explicit `ui: false` param beats everything; the hard guards (Electron not installed —
  this path never installs it; Linux with no `DISPLAY`) beat even an explicit `ui: true`; `ui: true`
  then overrides both the new `workspace.autoOpen` config key and the client check; short of an
  explicit param, `workspace.autoOpen === false` disables it, and any client other than Claude Code
  (local) simply doesn't auto-open. New `workspace.autoOpen` config key (`config.json`, default on
  — only an explicit `false` turns it off). The tool response carries `workspaceOpened: boolean`
  and, only when it did not open, `workspaceOpenReason` (`param-suppressed`, `electron-absent`,
  `no-display`, `config-disabled`, `client-not-code-local`, or a `spawn-failed:` /
  `auto-open-failed:` detail).

### Fixed

- **A failed council seat no longer renders as perpetually live.** `createSession`'s early return
  under a shared server bypassed the terminal `progress.json` write, leaving a stage marked
  in-progress in `progress.json` after `metadata.json` had already recorded the error. The
  terminal-write logic is now one shared helper (`writeTerminalProgressSafe`), called at all three
  early-return sites plus the original one, so the paths can no longer drift apart.
- **Collided artifact names no longer misattribute one model's prose to another's.** Two bench
  models whose sanitized filenames collide (e.g. `vendor/a` and `vendor?a` both → `vendor-a`) share
  one physical file on disk; the Council Workspace compounded that with a rendering bug that showed
  the first model's review/judge prose under the *second* model's panel — including, in a `--debate`
  run, the rebuttal/re-vote drill-in. Collided names now get a deterministic suffix (`~2`, `~3`,
  …), and every Workspace file lookup consults the resulting name map instead of recomputing a bare
  sanitized name — the second colliding model's row is now correctly dropped by the existing
  presence filter (its suffixed name was never physically written) instead of showing the wrong
  model's text, and a run-integrity banner names the collision so the gap reads as a known
  limitation rather than missing data.
- **A blind-mode toggle no longer collapses every open prose panel or repaints twice.** Flipping
  Blind mid-run used to unconditionally recompute the blind default, forcing one paint with the
  wrong value, a restore, and a second compensating repaint — and reset every lazy-loaded panel's
  open/loaded state along the way, closing whatever the user had expanded. Blind state and
  lazy-panel state now key off whether the run — and, separately, its status — actually changed
  since the last render, so a same-run toggle updates in place and paints once without closing any
  open panel; a run reaching its terminal status still recomputes the blind default and auto-reveals
  exactly as before.
- **`renderSeats` now reorders rows to match the composed run document.** The keyed seat-table
  update already added and removed rows on change but never moved one, so the table's row order
  froze at first render — visibly wrong once a repair solo or a new wave changed the underlying leg
  order mid-run. Existing rows are now moved into place at the end of every render pass.
- **`amicus council show` no longer reports a catalog-delisted bench member as healthy, and a
  dropped member is no longer invisible to scripted/MCP callers.** `show`'s resolved/dropped split
  checked only whether a member's alias mapped to *some* id, never whether that id was still in
  the cached catalog — so a preset member whose alias now resolves to a catalog-absent id (e.g. a
  direct-vendor route with no matching cached row) read as fully healthy in `show` while the real
  run path (`resolveCouncilMembers`) silently dropped it on every actual run. `show` now reuses
  that exact check — alias resolution, then catalog membership, with the same local-provider/
  offline-catalog rule that a catalog it cannot consult never blocks a member, only a non-empty
  catalog that omits it does. Separately, `council run --json` already suppressed the human-mode
  `Notice: dropped unavailable council member(s): ...` line, and `run.json` carried no field for
  it at all — a JSON-mode or MCP caller had zero signal a bench member vanished short of diffing
  `bench` against the preset's nominal member list. `run.json` now carries an additive
  `droppedMembers: [{member, reason}]` array (present only when at least one member was actually
  dropped), reaching the `--json` envelope and the `amicus_council_run` MCP response body for
  free. Resolution behavior itself — which members run, exit codes, spend — is unchanged; this is
  observability only.

### Changed

- **`amicus_start` / `amicus_fanout`'s MCP schemas no longer declare a JSON-Schema `default` for
  `agent`, `noUi`, or `includeContext`.** Client-visible metadata only — nothing behavioral: the
  defaults are still applied at the same read sites they always were, and are still stated in each
  param's own description. (`amicus_resume` / `amicus_continue`'s `noUi` keep their schema-level
  default; they were not part of this pass.)

### Removed

- **The inert `repairCanHonorContract` guard.** 4.4.1's empty-findings acceptance flipped this
  predicate permanently true by its own design, so `run-stages.js`'s `repairable &&` check could no
  longer short-circuit on it and no test failed if the function were deleted outright — a
  silent-deletion hazard that would otherwise re-arm the deadlock it used to guard against the day
  empty-set validation tightens again. Removed deliberately instead: the underlying reasoning moved
  to its call site, and the zero-findings regression test's comment now explains why the case it
  covers still holds without the guard.

## [4.4.1] - 2026-07-27

A fast-follow patch on 4.4.0. Every item is a correction to something already shipped, and almost all of it was measured against real paid council runs rather than reasoned about — the five gate councils that certified the Council Workspace are also what found these. Five behaviour changes ride along and are called out under **Changed**, because a user upgrading a patch should not discover them by surprise.

### Fixed

- **The repair path is whole for the first time.** 4.4.0 gave the Stage-1 findings repair the review it was repairing; the judge, chair, defense and re-vote repair prompts carried the identical omission, and `buildChairRepairPrompt` took no arguments at all. A repair leg is a *fresh* session with no memory of the turn it is repairing, so shipping only the validation errors asked a model to correct something it had never seen. **Three of the five paid gate councils burned a seat on it:** `wsgate02`'s `qwen` and `wsgate04`'s `glm` each refused twice ("I don't have a previous review to correct"), so a 4-model bench silently adjudicated on 3 while still paying for the fourth; `costgate01`'s `grok` complied instead — by **inventing a self-referential finding about its own empty output**, which entered `tally.json`, the street-cred rankings, the chair synthesis, and a human's decision. Every repair call site now embeds the text that actually failed, verbatim and uncapped, tracked across attempts so the errors and the artifact always describe the same generation. Separately, a repair that **silently changes the finding count is now refused** rather than adjudicated: the repair contract is "the same findings, fixed", and a count change is exactly the fabrication shape above. Where the original block was absent or unparseable there is no count to compare, so the repair is accepted but marked `findingsUnverified` rather than implying a check happened. A repair's output never replaces the review's prose — that would hand the judges a narrative-free review and put a JSON dump in the Stage-2 bundle.
- **Three of four seats on a paid council were silently truncated by the fence extractor.** The closing-fence pattern was unanchored, so the **first triple-backtick anywhere inside a JSON body ended the match** — and a review *of markdown* inevitably quotes a fence. On the $1.95 renderer-review council, `glm`, `opus` and `minimax` all came back `NOT_PARSEABLE` and collapsed to `conformance: unstructured`; replayed against the same artifacts after the fix they yield 6, 5 and 4 findings respectively. **15 of 17 findings were lost or left to a paid repair wave to rescue, and the chair synthesised from the two that survived without knowing the rest existed.** The extractor now enumerates every fenced opener independently, reads each one both ways (close-at-line-start primary, same-line close as fallback), and lets **`JSON.parse` arbitrate** — the last opener whose body actually parses wins. This is the repo's only fence extractor and all five consumers funnel through it, so judge, debate-defense and re-vote parsing carried the identical defect and are fixed by the same change; each now has its own test so a future re-implementation cannot regress one silently. The malformed-versus-absent distinction is preserved deliberately: a cut-off emit that never closed at all is still *absent*, because the repair path answers "no findings block" and "a broken findings block" differently.
- **A council run no longer races itself for OpenCode's database.** A run started a fresh OpenCode server for the Stage-1 seat wave, the critic solo, each findings repair, the Stage-2 judge wave, each judge repair, each debate wave and the chair chain — 10+ spawns, each one a fresh chance to lose OpenCode's SQLite startup race. Stage 1 launches its seat wave and its critic solo under one `Promise.all`, so two of those starts are ~140 ms apart *by construction*: one run **lost four of five seats in 736 ms** to `database is locked` and failed quorum, which is what made `--critic` a coin flip. A run now acquires **one** server and forwards it into every launch, closed once on the single path every terminal outcome already funnels through. It never fails closed — a shared server that will not start is a notice, and the run falls back to one server per wave exactly as before. The Stage-2 anonymization boundary was verified rather than assumed: judges run in the run's `_scratch` directory and scoping is per-call, so nothing about it ever lived in the server process. Separately, a **lock-class** start failure (`database is locked`, `database table is locked`, `SQLITE_BUSY` — and nothing else) is now retried 3 times over ≤750 ms, which covers the races a single process cannot remove: two amicus processes, or a CLI run beside a live MCP server. A missing binary, an auth failure, a port conflict and a failed health check are deterministic and fall straight through rather than tripling the latency before the same error.
- **`amicus spend` stopped reporting a total that `council run` calls inexact.** A leg whose spawned subagent could not be accounted for wrote a **priced** ledger row, so `unpricedRows` never caught it and the product's two truthfulness surfaces disagreed about the same dollars. Such a row now carries the flag and is counted as `unattributedSubtreeRows` **beside — never instead of —** `unpricedRows`, since a row can be both; the human table gains a second, distinctly worded line, because "we could not see this leg at all" and "we saw this leg but not what it spawned" are different facts. The MCP `amicus_spend` tool inherits it unchanged. And the unknown-spend notice is no longer **sticky**: it guarded on a boolean, so the first unknown leg was announced and every one created afterwards — Stage 2, repairs, debate, chair — was silently swallowed. It now re-announces on a growing count, and says "so far this run" rather than repeating a cumulative number as if it were new.
- **A leg observed only through cache tokens reports `unknown`, not a falsely free `$0`.** The observation gate accepted `cacheRead`/`cacheWrite`/`reasoning`, but the estimate prices `input`/`output` only — so a leg observed in neither passed the gate and resolved to `estimated $0.0000`, the same authoritative false zero 4.4.0 exists to eliminate, in the one corner its predicate did not cover. The v4.2 free-local `$0` tier is untouched: a real local seat reports genuine token counts and still resolves to `estimated ~$0.0000`.
- **A leg that both fell back to another model and left an unattributable subtree no longer reports `costExact: true`.** Folding a leg's attempts together returned a bare `{tokens, cost}` and dropped the subtree flag, so `run.json` claimed a complete total for a number that was a floor. The fold now preserves every key: the flag ORs across attempts (a gap admitted once cannot be erased by a later clean attempt) and a measured subtree sums rather than last-wins. Separately, the spend reader promised to skip corrupt ledger lines but let a valid-JSON *scalar* through as a row, inflating both `runs` and `unpricedRows`.
- **A failed leg no longer renders as complete in the Council Workspace.** A seat that errored or timed out could show a green check, because `timed-out` was missing from the terminal-state lists the mirror consults. Alongside it: the leg-role guard is now symmetric, a leg that throws writes a terminal progress record instead of leaving its last live one as the final word, and swallowed read failures are logged rather than discarded.
- **A permission failure is no longer reported as "not written yet".** An unreadable run artifact was indistinguishable from one the run had not produced yet, which had been producing a **silent chairless fold reporting `{ok: true}`** — the fold said it succeeded and carried no verdict. Three dead fallbacks and an unwired `legsTotal`/`legsComplete` pair were deleted in the same pass: a documented field that is never populated is worse than no field.
- **A Stage-1 wave that dies before its legs start no longer leaves the run looking healthy.** Such a wave wrote no `wave.json` at all, so nothing downstream could tell "the wave failed" from "the wave has not reported yet"; it now degrades the run loudly. A shared-server acquisition that fails likewise degrades loudly instead of silently, and its **success** is recorded too — previously only the failure was.
- **The `haiku` alias was never broken.** It hard-404'd 3 of 3 times across two paid councils — as chair (twice, including the fallback retry) and as a bench seat, ~2 s and zero tokens each — and the standing diagnosis was a rotten model id. It is not: the cause is an `ANTHROPIC_BASE_URL` without its `/v1` suffix, an **environment** misconfiguration. Documented as such, because the prescribed "fix or remove the alias" would have deleted a working route. The more useful half of the lesson stands unchanged from 4.4.0: a dead alias does not stop a council, it shrinks one.
- **Renderer and markdown robustness.** The workspace's markdown renderer no longer re-slices its input on every inline token (identical output on 219,543 verified inputs — exhaustive to length 6 plus 200,000 fuzz cases — removing a dependence on a V8 string-representation detail nothing stated or tested); heading text is trimmed rather than baking trailing blanks into a text node; and an unreachable heading-level clamp is gone, pinned so a future widening fails loudly instead of silently emitting an `<h7>`.

### Changed

- **A review that honestly finds nothing is now a valid review.** An empty finding set was a hard error, which structurally pressured a model to invent a finding — directly contradicting the anti-sycophancy clause shipped in every Stage-1 briefing, and `costgate01`'s `grok` did exactly that, reaching a human's decision. A **present-but-empty** `findings` array with a non-empty `overall` now validates. The lines that already existed are preserved: a broken emit keeps its own codes, an empty set with a blank or missing `overall` is still an error, and a *missing* `findings` key is still an error — only an array that is present and empty means "I read it and found nothing". The briefing now says what the validator enforces, which also makes the repair prompt's "emit an empty findings array and say so" branch describe an answer that can actually pass rather than a trap costing two paid legs. Downstream, an all-clean bench degrades gracefully: Stage 2 still runs (peer ranking, and therefore street-cred, is unaffected by an empty findings pool), and the judge bundle and chair packet **state** the empty index instead of rendering a heading over nothing under an order to adjudicate ids that do not exist — an instruction a judge obeying it answers by inventing an id, which buys up to two paid repair solos per judge. The debate stage is genuinely skipped and already records its reason. **This changes what a council means when every seat comes back clean.**
- **A leg that exceeds the tool-settle grace ceiling now has its OpenCode session aborted.** 4.4.0 bounded the wait and completed the leg anyway; it left the underlying session running and **billing** for output nobody would read. The leg's completion and partial output are unchanged — only the session is stopped, after the child-session walk so subtree attribution survives, and before the server closes, since on a shared server (i.e. every council run) the server is not closed here at all — which is precisely the pathological case. Whether the abort landed rides the result, the terminal `progress.json` and the leg's `metadata.json` as `toolSettleAborted`, and it is recorded as `false` when the abort was attempted and failed rather than omitted: "we tried to stop it and could not; it may still be billing" is the useful half of that signal. A failed or hung abort can never alter a leg that already succeeded.
- **A run under a `--max-cost` ceiling now exits `2` when its own total is inexact.** A fully-unpriced council could never trip the ceiling, so a ceiling silently bounded nothing while the run exited `0` — an unqualified success for a number the run itself was reporting as a floor. When a ceiling is set *and* the total is inexact, the run now exits `2`, through the same degraded path a budget-refused wave already uses; a signal and a real error are never re-labelled. **The ceiling still never blocks a run** and still trips on **known** spend only — a fully-unpriced bench under a $0.01 ceiling runs every stage to completion. The docs now say "`--max-cost` bounds **known** spend", which is what it has always done. Anything gating on `council run`'s exit status should expect `2` where it previously saw `0` on an inexact run.
- **`amicus watch <id> --ui` now validates the run id.** A malformed id skipped validation entirely and surfaced whatever the run lookup produced — a vaguer error than the identical typo gets on the terminal path. It now **exits `1` with the validator's message instead of launching the workspace**. Bare `amicus watch --ui` still opens the project run-list landing; the check applies only when an id is actually supplied.
- **`npm i -g amicus` now installs the documentation.** The package's `files[]` excluded `docs/` entirely, so every word of documentation was unreachable from an install — and the moment a user most needs troubleshooting text already on disk is an opaque `Not Found` with zero tokens, which is exactly when they have no reason to trust a browser tab instead. The 15 top-level `docs/*.md` pages now ship (**+15 files, 285 → 300; +93 KB packed, +8.8%**). Images and the plan/spec archive deliberately do not — ~425 KB with no offline value. A handful of roadmap references point at repo working files that still do not ship; they are now labelled as such rather than reading as broken paths.
- **The fold's `Cost:` line stops saying the same thing twice.** It appended the source name on top of a glyph that already encoded the same fact, printing `~$0.0100 (estimated)` and `? (unknown)`. Those two words are gone — `~` already means inexact and a bare `?` already means unknown. Two sources keep their word because the glyph vocabulary cannot express them: **`reported`**, since a plain `$0.4321` is also what an unrecognised source renders as, so the absence of a glyph cannot mean "exact"; and **`mixed`**, since `~` says *inexact* without saying *which kind* — collapsing `mixed` to a bare `~$…` makes it indistinguishable from `estimated`, and the two are not the same claim. `mixed` asserts that part of the number is genuinely measured.

### Security

- **The Council Workspace's markdown renderer has finally been reviewed by a bench.** The component that turns **another model's prose into DOM** was in none of the five gate councils' review sets and shipped in 4.4.0 uncertified; one chair called that out explicitly and rated it blocking, while another cleared the same file by reading its *consumers* rather than the file. A paid council was run against the file itself. **It found nothing exploitable** — no DOM injection (`textContent`/`createTextNode` only, fixed tag names, no HTML parsing of model-controlled content) and no prototype pollution — and the findings it did raise are architectural, fixed above under **Fixed**. The certification is recorded here rather than in a working note because the disagreement it settles was a public one. Its adversarial coverage is now pinned: prototype-pollution inertness, `javascript:`/`data:` URL inertness, malformed and unmatched inline backticks, the resource budget at exactly the artifact-size cap under both pathological shapes, and a widened attribute-sink guard — the previous banned-token scan covered four HTML-string APIs and would **not** have caught `setAttribute('href', userText)`, with a negative control proving the guard is not vacuous. Two rendering-fidelity findings were surfaced and deliberately not fixed; neither is a security property.
- **The Council Workspace's read-only posture is now enforced rather than asserted.** That the workspace never writes into a run directory was checked nowhere. It now is, by a guard that **parses** rather than greps: these files are dense with prose *about* writes, and a text scan that goes red for a comment gets weakened rather than fixed, so the guard builds an AST (comments are structurally absent from it) and matches string literals by exact equality. It pins that no write API appears in the workspace source, that the registered IPC channel set is **exactly** the seven known channels — so a new channel cannot be added without being classified — and that the one verb which legitimately writes, Abort, **delegates** to the engine's own abort path rather than writing itself. A positive control scans the engine's own writer and requires it to come back dirty, so a broken scan cannot pass by finding nothing. The Workspace's CSP likewise gains a real regression guard: "no violations" is also what a *loosened* policy produces, so the check now appends an inline `<script>` and requires the refusal to appear.

## [4.4.0] - 2026-07-26

### Added

- **Council Workspace (GUI)** — third Electron mode `council-workspace`, opened via `amicus watch <councilRunId> --ui` (bare `--ui` opens the project run list). Renders live and historical council runs: stage rail, live per-seat status/tokens/cost (v4.3 data layer, 1.5s/5s poll depending on window focus/visibility), verbatim anonymized Stage-2 packet, tier-colored adjudication matrix with basis counts/thin/override badges, dissent drill-in with prose highlight, chair verdict + street-cred + Stage-4 decisions, cost-by-seat with `--max-cost` gauge. Blind-mode toggle (labels vs models; ON while live, OFF once terminal — a reading aid against anchoring bias, not a security control: the label map is plaintext in `run.json`). Two verbs: confirm-gated Abort (delegates to the engine's own council-aware abort path) and nonced Fold (chair verdict to the launching terminal; no model call). Fully sandboxed first-party page (CSP with no network directive at all, `contextIsolation`, textContent-only rendering of model prose, enforced by a static source scan); read-only against run directories **apart from the Abort verb, which checkpoints the run through the engine's own in-process abort path** — not a direct write from the workspace code itself. `--ui` is interactive-only (`--json` is rejected, not silently ignored).
- `CdpClient.workspace(port)` e2e factory (`file://` target, port 9225) + a fixture-driven workspace CDP suite.

### Fixed

- **Zero-cost reporting no longer lies about spend.** A leg whose captured token totals were *all zero* used to be priced as `0 × catalog price` and labelled `estimated $0.0000` — an authoritative "this seat was free" for work that had genuinely been billed. Diagnosed against four real paid council runs plus OpenCode's own session database: `council-wsgate02` spent **$0.9859 against a `--max-cost` ceiling of $0.75 (131%)** while Amicus believed $0.3720 and never emitted `COST_EXCEEDED`. Four separate defects, all fixed here:
  - `resolveLegCost` now gates the estimate on **observed tokens**, not on the mere existence of a price, so a zero-token leg resolves to `{amount: null, source: 'unknown'}`. The v4.2 free-local-provider `$0` tier is unaffected — a local seat still reports real token counts, so it keeps resolving to `estimated ~$0.0000`.
  - The headless poll loop's fast-path exits (trailing fold marker, SDK `idle`) could break *before* OpenCode stamps `info.tokens`/`info.cost` — measured losing by 155 ms and 29 ms on real paid legs. A bounded, best-effort **post-loop usage re-poll** (≤3 reads, ~1.2 s worst case, usage capture only — never re-mirrors text) now closes that window.
  - `progress.json`'s usage snapshot was only ever written on `receiving` flushes, i.e. always before finalization — 31 of 35 real legs ended with an all-zero snapshot while `metadata.json` held thousands of tokens, and that snapshot is what the live GUI reads. A **terminal `complete` progress record** now carries the settled usage, and the reader prefers `metadata.json` for any terminal leg.
  - `amicus spend` and the spend ledger no longer coerce a null cost into a measured-looking `$0.0000`: a model whose rows are all unpriced renders `?`, and `unpricedRows` is reported on `total`, `byModel`, every `group`, and `wasted`.
- **A leg is no longer declared `complete` while its OpenCode session is still working and billing.** Measured on a real paid run: `council-wsgate02`'s `wsgate02-s1-3` was declared complete on **166 characters** of reasoning preamble, 129 s before its `task` tool call finished, and its session then billed $0.14279 of further parent spend plus a $0.47105 child session — 166 characters were adjudicated as a finished peer review. Root cause was a shape drift, not a logic slip: the mirror modelled a tool call as an Anthropic-style `tool_use` part cleared by a matching `tool_result`, and **OpenCode emits neither** (36 `tool_use` records and 0 `tool_result` records across 35 recorded legs; 5,129 persisted parts resolve to six type names, none of them `tool_result`). So `pendingToolCalls` never cleared for any real leg, tool names never reached `conversation.jsonl`, and the `Task`-subagent log was permanently empty. Tool-call liveness is now keyed on the SDK's real `state.status` vocabulary (`pending`/`running`/`completed`/`error`; terminal = `completed`|`error`), and the completion gates that lack an explicit done-signal defer while a call is still executing. The wait is **bounded** by `AMICUS_TOOL_SETTLE_GRACE_MS` (default 300 s, `0` disables): on exceeding it the leg **completes anyway** — never fails — carrying `toolSettleTimedOut` on its result, its `metadata.json` and its terminal `progress.json` record, plus an error-level log line. A tool part whose status cannot be observed at all is deliberately *not* treated as live, so an unknown shape can never hang a finished leg.
- **`costExact: true` no longer claims a total is complete when it is not.** `council-wsgate01` reported `costExact: true` while **$0.0215 short** of OpenCode's ledger. Reconciled leg-by-leg: all 7 legs were `source: 'reported'` with real tokens, and **100% of the gap was one unattributed `explore` child session** ($0.021460, parent `wsgate01-s1-2`) — not rounding, not partial usage, not float drift. The predicate was wrong: `costExact` was computed as `unknownLegs === 0`, which asks "did every leg report tokens" — a statement about each leg's *own* session, not about whether the total is the whole bill. A leg that spawns a subagent now carries `subtreeUnknown` on its usage block, `sumWaveUsage` reports `subtreeUnknownLegs`, and `costExact` requires **both** every leg observed *and* no unattributed subtree. Surfaced on `run.json`, the `Notice:` line, the human summary, the workspace total and the `--max-cost` gauge (which goes indeterminate). Subtree-unknown spend still does not trip the ceiling — fail loud, not closed.
- **`--max-cost` is now threaded into the council pre-flight estimate.** `src/council/run-launch.js` never passed `maxCost` to the transport, so `src/sidecar/fanout.js` fell back to a `cfg.maxCost` key that does not exist and the `budget.js` soft ceiling was inert for every council run — the post-hoc check in `run.js` was the only ceiling, and it can only refuse *after* the money is spent. Each wave is now measured against the **remaining** allowance (ceiling − known spend − outstanding reservations).
- **The council pre-flight ceiling is now concurrency-safe.** Stage 1 launches its seat wave and its critic wave together under one `Promise.all`, and each launcher read the remaining allowance *before either wave's legs had been recorded* — so both saw the full, unreduced ceiling and both could pass a gate that only one of them fit under. A read is not a claim. The transport now takes an optional `reserveBudget(estimate)` seam (`src/sidecar/fanout-budget.js`, extracted from `runFanout` §1b) which the council answers with a **synchronous** read-and-claim against the allowance no sibling wave has taken — synchronicity is the guarantee, since the event loop cannot interleave two callers inside it. A fixed quota split was rejected as strictly more refusing than the ceiling requires. **When a wave is refused the run continues with a partial bench** — it never rolls back launched waves and never aborts (fail loud, not closed) — but the refusal is announced on stderr, recorded on `run.json` as `budgetRefusals[]`, and degrades the run's exit code to `2`. Stage 1's existing quorum gate still refuses to call a bench of fewer than two reviews a council.
- **The best-effort usage-settle re-poll can no longer discard a finished leg.** Its `try/catch` covered only the network read; the snapshot inspection that followed it (`mirrorUsageOnly`, `allAssistantUsagePresent`) ran outside the boundary, so a throw there escaped `runHeadless` and destroyed a leg whose answer had already been captured and paid for — the most expensive possible outcome for a path whose whole job is an optional usage top-up. The boundary now covers the entire loop body; a failure stops settling, keeps every dollar already mirrored, and leaves the completion verdict untouched.
- **`AMICUS_USAGE_SETTLE_POLLS=0` (and friends) now actually disable the feature.** All four v4.4 settle knobs parsed their environment override as `Number(process.env.X) || DEFAULT`, which silently rewrites an explicit `0` — the documented "off" value — back into the default. `AMICUS_USAGE_SETTLE_POLLS`, `AMICUS_USAGE_SETTLE_INTERVAL_MS`, `AMICUS_USAGE_SETTLE_CALL_TIMEOUT_MS` and `AMICUS_TOOL_SETTLE_GRACE_MS` now go through `src/utils/env-num.js`, which honors an explicit numeric value including `0` and falls back only for unset / blank / non-finite. Older knobs (`AMICUS_POLL_INTERVAL_MS`, `AMICUS_STABLE_*_POLLS`, `AMICUS_TOOL_CALL_STALL_MS`, …) deliberately keep the old form: `0` is not a documented escape hatch for any of them and honoring it would busy-loop a poller or disable a stall guard.
- **Subagent (child-session) spend is now attributed to the leg that spawned it.** A leg that calls the `task` tool spawns a *child* OpenCode session; OpenCode bills it separately, does **not** roll it into the parent session's cost, and amicus never enumerated it — so it was invisible to every total the product prints. Measured across the four recorded paid runs: **$0.492506** ($0.021460 in `wsgate01`, $0.471046 in `wsgate02`). `wsgate01` was the honest limit case — all 7 legs `source: 'reported'`, `unpricedLegs: 0`, `costExact: true`, and the run still 7.1% short, with 100% of the gap in one `explore` child session. `runHeadless` now walks each leg's child sessions at finalization (bounded, cycle-proof, directory-scoped) and the measured spend rolls into the run total, reported separately as `cost.subtreeCost` / `cost.subtreeSessions`. Replayed against the OpenCode oracle, `wsgate01` reconciles **exactly**. A child's price comes from OpenCode's own billing and is never estimated from a catalog — the SDK's session record carries no model id, so an estimate would be a guess. What the walk cannot account for still reports as `subtreeUnknown`, never as zero; conversely, a subtree that WAS fully walked now clears that flag, which the previous `task`-name proxy could never do. A failed walk with no evidence of a subagent at all flags nothing, so an OpenCode build without the `children` endpoint does not mark every leg of every run inexact.
- **A Stage-1 repair re-prompt now carries the review it is repairing.** When a review's trailing findings JSON failed validation the engine launched a repair solo — a *fresh* session with no memory of the review turn — and handed it the validation **errors without the review those errors were about**. Three of the five paid councils burned a seat on it: `wsgate02`'s `qwen` and `wsgate04`'s `glm` both refused, twice each ("I don't have a previous review to correct"; "the previous review's content was excluded by the caller… I will not fabricate findings"), so a 4-model bench silently adjudicated on 3 while still paying for the fourth's tokens; `costgate01`'s `grok` complied instead, by **inventing a self-referential finding about its own empty output**, which entered `tally.json`, the street-cred rankings and the chair synthesis as `C1` and reached a human's decision. The prompt now embeds, verbatim and uncapped, the text that actually failed — the original review on the first attempt, the previous repair's output on the second, so the errors and the artifact they describe are always the same thing. When there genuinely is no prior text the prompt **says so** and instructs the model to emit an empty `findings` array rather than leaving it to guess.

### Changed

- **Unknown cost fails LOUD, not CLOSED.** A leg whose cost cannot be determined does **not** halt a run and does **not** by itself trip `--max-cost` — the ceiling still trips on known spend only. Instead the uncertainty is made impossible to miss: `run.json`'s `usage` block gains `unknownLegs` + `costExact`, the council run emits a `Notice:` naming the count and stating that real spend is higher, the human summary appends `+ N leg(s) unknown — real spend is at least this much`, `amicus spend` adds an explicit unpriced-rows line, and the workspace's budget gauge switches to an indeterminate (hatched) band with a `≥` readout rather than claiming a percentage it cannot know. Nothing converts uncertainty into a fabricated number in either direction.
- **`amicus watch <councilRunId>` now prints per-seat rows in the terminal**, not just the stage checklist — each seat's model, status, message count, tokens, cost and stall state, refreshed on the same poll as the stage rail. This is a **behavior change to an existing command**: a plain terminal `amicus watch` on a council run shows materially more than it did on 4.3.0, with no new flag. The Council Workspace GUI and the terminal renderer now read the same per-leg data.

### Security

- **A council pointer file can no longer redirect reads — or writes — outside the project.** A `council-<runId>.json` pointer's `{runId, runDir}` JSON is validated only for truthiness (`src/council/run-state.js`), so a tampered or stale pointer could name any `runDir` on disk. The v4.4 Council Workspace already fenced all four of its pointer-consuming reads against the run dir's realpath; the older CLI/MCP surface behind `amicus_status` / `amicus_abort` / `amicus_list` / `amicus watch` did not, and two of its call sites are worse than a read leak — both crash detection and abort `checkpoint()` **into** `ptr.runDir`, making an unfenced pointer a write primitive at an attacker-chosen path. All of them now resolve and check containment **before touching the filesystem at all**, sharing the one fence implementation (`src/utils/path-fence.js`). A fenced-out pointer resolves to the existing "not a council run" outcome — the same `Session <id> not found in project <cwd>` error `amicus_status`/`amicus_abort` already return for an absent pointer, a skipped row in `amicus_list`, and `kind: 'unknown'` (→ `BAD_SESSION`) for `watch` — so no new error shape, and nothing is read or written from the escaping directory. Nothing legitimate is refused: a real `runDir` is always nested inside the project, enforced at creation time.

## [4.3.0] - 2026-07-24

### Added

- **Observability data layer.** Three file surfaces every consumer polls, no push/IPC/`fs.watch` anywhere: the existing durable snapshots (`metadata.json`/`progress.json`/`wave.json`/council `run.json`, all additively extended), a new append-only `events.jsonl` milestone stream per wave dir / council-run dir, and the composed live doc (the `amicus_status` rollup, stamped `view:'live'` with per-leg read-time `usage`).
- **`amicus watch <id>`** — live-render any fan-out wave, council run, or session from any terminal, reading only the data layer above (no attach): an in-place refresh table on a TTY, milestone lines (`--plain` / non-TTY), or NDJSON (`--json`). `--interval` controls the poll rate (default 2s, floor 0.5s); exit code maps the run's terminal state (`complete`→0, `partial`→2, else 1). `--ui` registers the flag for the v4.4 Council Workspace GUI (rejects `--json`) — the GUI itself is not shipped in this release.
- **`--follow` on `fanout` and `council run`** — stream a run's own milestone events to stderr as they happen; stdout's `--json`/human contracts stay byte-identical. On `council run`, `--follow` covers the run's own lifecycle and each stage's boundaries, not the per-leg events inside a stage's internal fan-out sub-wave.
- **`--on-complete` hook.** CLI: runs a user-authored shell command once a wave/council run reaches a terminal state, with the payload carried via 8 environment variables (`AMICUS_TASK_ID`, `AMICUS_TYPE`, `AMICUS_STATUS`, `AMICUS_EXIT_CODE`, `AMICUS_RESULT_FILE`, `AMICUS_EVENTS_FILE`, `AMICUS_COST`, `AMICUS_PROJECT`) — ids/paths only, never model-generated text; exit-isolated from the run (a non-zero exit or a 60s timeout is a warning only). MCP: only `onComplete: "mcp-notify"` is accepted, a best-effort advisory notification — `exec` is never exposed over MCP.
- **Failed-leg resilience.** `fanout --retry-failed <waveId>` relaunches only a wave's terminal, non-complete legs as a new linked wave (byte-identical retry from each leg's saved context; `--models` filters which legs retry; the original `wave.json` is never touched). `--fallback` / `--no-fallback` opt into per-leg cheaper-model substitution, off by default, triggered only by a classified rate-limit/overload failure (never timeout or auth) and always recorded loudly (a `leg-fallback` event, an `attempts[]` array, a `fallback` block on the final doc).
- **Spend visibility & attribution.** `continue`/`resume`/council rows are now recorded in the spend ledger, not just `start`/`fanout` legs, and every row carries attribution (`op`/`status`/`waveId`/`councilRunId`/`councilName`/`project`/`gateway`, plus fallback/retry linkage). `amicus spend` grows a full query surface — `--wave`/`--council`/`--project`/`--model`/`--op`/`--failed`/`--group-by <model|wave|council|project|op|day>`/`--rows` — plus a `wasted` rollup (both `--failed` and `wasted` deliberately exclude rows with no recorded status at all, so a pre-v4.3 ledger row is never counted as a failure that was never actually recorded). A new read-only `amicus_spend` MCP tool (16th tool) mirrors the same flags for MCP-only hosts.

### Notes

- All additive: no schema-breaking changes to v4.0 artifacts. `SPEND_LEDGER_SCHEMA_VERSION` stays `1`; both JSONL ledgers (`spend-ledger.jsonl`, `council-ledger.jsonl`) remain internal, non-envelope files, not published docs. A wave dir / council-run dir now also contains `events.jsonl`.

## [4.2.1] - 2026-07-23

### Security

- **`.env` key writes strip CR/LF and re-assert `0600`.** A provider key or local-provider
  bearer that carries a stray newline — a trailing `\r\n` from a paste, or an embedded one — is
  now sanitized before it is persisted, so it can no longer split `~/.config/amicus/.env` into a
  broken line or silently truncate the stored token; the sanitized value is also what lands in
  the process environment. Every rewrite of the secrets file additionally re-asserts `0600`
  permissions, re-tightening an existing `.env` whose mode had drifted (created under a loose
  umask, or hand-edited). POSIX; a no-op on Windows/NTFS, where key-file ACL hardening remains a
  separate tracked item.

### Fixed

- Test-suite hardening: a global hermetic baseline pins the config and keys directories to a
  per-worker scratch dir so no unit test can read or write the real `~/.config/amicus`. Scoped to
  the unit run; the integration rails continue to manage their own credentials. This closes the
  config/keys-dir door only — the OpenCode `auth.json` door is handled separately by the keyless
  integration rail.
- Removed a redundant `.env` re-read in the credential loader, and cleaned up test scratch
  directories that were leaking across runs.

## [4.2.0] - 2026-07-23

### Added

- **Local / OpenAI-compatible providers, at $0.** `amicus provider add <id> --preset
  ollama|lmstudio|vllm` (or `--url <baseURL>` for any other OpenAI-compatible endpoint)
  configures Ollama, LM Studio, vLLM, or a self-hosted server as a first-class model source —
  `provider list|test|remove` manage them (all support `--json`). Local models price at a real,
  explicit `$0` tier (not "unpriced"), so the budget gate, `amicus spend`, and the default-model
  picker all treat them as free. `amicus key <localId> <token>` manages a local provider's bearer
  (stored in the `0600` `.env`, never in `config.json`); `amicus doctor` gains a
  `local-providers` reachability check (warn, never error); the setup wizard (readline and
  Electron) offers to add one.
- **Local inference completes instead of hanging forever.** Local (`@ai-sdk/openai-compatible`)
  provider blocks now carry a 5-minute engine request `timeout` and a non-empty `apiKey`
  (`{env:VAR}` for a configured bearer, the literal `not-needed` otherwise), so `amicus
  start`/`fanout`/`council` against Ollama/LM Studio/vLLM now complete. Local models need enough
  context loaded to fit the ~26k-token agent prompt (**~32k** is a safe target — LM Studio's
  ~16k default is not) and are slower than cloud to first token (30–90s prefill on a cold model
  is normal) — see [`amicus provider`](docs/usage.md#amicus-provider).
- **`amicus init [--claude] [--desktop] [--json]`** re-runs the same skill-install + MCP
  registration that `npm install`'s postinstall runs, on demand — for plugin-channel /
  `--ignore-scripts` installs (which skip the postinstall), a failed postinstall, or repairing
  deleted `~/.claude` state.

## [4.1.2] - 2026-07-22

### Fixed

- **Claude model aliases no longer drift between the direct API and OpenRouter.** The two
  gateways spell the same model differently — OpenRouter serves `anthropic/claude-opus-4.8`,
  the direct Anthropic API serves `anthropic/claude-opus-4-8` — and three places converted
  between the two by adding or removing the `openrouter/` prefix. That is only sound when the
  rest of the id is identical, which for Claude it is not. Two user-visible consequences: a fresh
  `amicus setup` wrote an `opus` alias that `amicus doctor` then reported as stale (the exact
  warning 4.1.1 shipped to remove — and it fired even with an Anthropic-only catalog, not just
  for OpenRouter users), and the pre-registered fallback catalog handed to a long-lived shared
  server carried two ids OpenRouter does not serve while omitting the two it does. All three
  sites now read each gateway's authored route instead of deriving one from the other, and an
  alias you have overridden yourself is left alone rather than inheriting a curated route.
  Affects `opus` and `haiku`; every other alias is spelled identically on both gateways or is
  OpenRouter-only. Default routing is direct-first and was never affected — no run selected a
  wrong model.

## [4.1.1] - 2026-07-21

### Fixed

- **The integration tier is tested again, and now something actually watches it.** All 14
  `tests/**/*.integration.test.js` files were unreachable from every gate — `jest.config.js` excludes
  them from `npm test`, no workflow ran `npm run test:integration`, and the pre-push hook ran only the
  unit suite. Six tests had been failing unnoticed behind a single dead model alias: three E2E suites
  passed `--model gemini-flash`, which is not a live alias (`tryResolveModel('gemini-flash')` returns
  `Unknown model alias`). They now pass `gemini`.
- **`--claude-review` reports no longer grow a blank `claude` judge column, or a false self-vote `*`.**
  `report.js`'s `toModel()` reused `verdict.council` (the street-cred universe, which legitimately
  includes `claude` on a `--claude-review` run) as the adjudication-matrix judge roster too. Claude is
  judged but never judges, so the matrix grew an extra column that always rendered blank, or a bare
  `*` on a row Claude itself raised — asserting Claude voted for its own finding, the opposite of the
  documented guarantee. `judges` is now filtered out of `council` independently (gated on the
  `claudeInCouncil` flag plus the `claude` name, never on whether a model cast any adjudications, so a
  genuinely dead/unstructured bench judge with zero votes still keeps its blank column).
- **`debate-revote` now checkpoints `skipped`, not a false `complete`, when the re-vote wave never
  launches** (nothing was defended/amended, or the cost ceiling skipped it). **This is a
  consumer-visible `run.json` value change**: anything parsing `stages[].status` for this stage — the
  Council Review Action's stage-ladder footer, `amicus status`, or a user script — now sees `skipped`
  instead of `complete` on a run that hits this path. Neither the Action's footer nor `amicus
  status`'s human/JSON renderers special-case `complete`, so both already print whatever value is
  there correctly; a script that hard-coded an expectation of `complete` for this stage should treat
  `skipped` as the equivalent no-op, the same way `run-chair.js`'s existing chair-skipped-over-budget
  convention already works.
- **`amicus council verdict --render` now writes `report.html` at `0o600`**, matching every sibling
  writer (`run-assemble.js`, `mcp-server.js`'s `amicus_verdict` `render:true` path, `run-launch.js`).
  It previously wrote with no explicit mode, which falls back to the process umask (typically `0o644`
  on POSIX — group/world-readable) whenever the target directory had no pre-existing `report.html`,
  i.e. exactly the fresh-`--out-dir` case, for a file that holds model output.
- **Dropped the false `amicus wait` CLI claim.** `docs/usage.md` and `docs/council.md` both documented
  `amicus status|wait|abort <councilRunId>` as working CLI commands. There is no CLI `wait` (verified
  against `bin/amicus.js`'s command dispatch) — only `status` and `abort` genuinely resolve council
  runs via the sessions-dir pointer file. Both docs now point readers at the MCP `amicus_wait` tool
  instead.

### Added

- **Keyless integration job in CI.** `.github/workflows/ci.yml` gained an `integration` job that runs
  `npm run test:integration` with no secrets on every push and PR, so the tier is permanently watched
  for free (~51 assertions, ~10s). `npm run test:integration` now goes through
  `scripts/run-integration-keyless.js`, which strips every provider credential and sandboxes
  `HOME`/`USERPROFILE` before spawning jest — the money-spending suites self-skip and the script cannot
  bill even on a machine with keys on disk. The scrub derives its key names from the engine's own
  `PROVIDER_ENV_MAP`, so it covers providers and paid suites added later without maintenance.
- **`npm run test:integration:live`** — the paid rail, split out so the CI job cannot silently start
  billing if secrets are ever added to it. Run by the new `.github/workflows/integration-live.yml`
  (`workflow_dispatch` only, carries `secrets.OPENROUTER_API_KEY`) and by the release checklist in
  `docs/publishing.md`.

### Fixed (docs)

- `docs/testing.md` and `CLAUDE.md` both claimed a pre-push integration gate that has never existed;
  the pre-push hook runs the unit suite only, deliberately, so a local push never spends money. Both
  now describe the real rails, and `.husky/pre-push`'s stale "until the 'Fix integration tests' task
  lands" comment is replaced with the reason the hook stays unit-only.
- **`amicus doctor` no longer warns about Amicus's own shipped defaults — on a fresh install, and in
  the keyless `model-drift.yml` CI check.** Both previously reported `⚠ Model aliases: 2 stale: opus,
  haiku` (and the scheduled Model Drift Check ran red) with no user config involved.
  `toDefaultAliases()` built each alias's pinned id by string-stripping the `openrouter/` prefix
  instead of routing through the module's own `directFormFor()`, so it emitted OpenRouter's dot ids
  for Anthropic — `anthropic/claude-opus-4.8`, `anthropic/claude-haiku-4.5` — which the direct API
  rejects, and invented a bare `anthropic/claude-fable-5` for a model OpenRouter serves exclusively.
  Defaults now come from `toGatewayRoutes()`, so an alias resolves to its authored direct form when
  one exists (`anthropic/claude-opus-4-8`, `anthropic/claude-haiku-4-5-20251001`) and to its
  OpenRouter route when none does (`openrouter/anthropic/claude-fable-5`). `fable`'s *recorded* form
  changes, but this is **not a routing change** — OpenRouter was already the only gateway that serves
  it, so a `fable` run resolves and routes identically before and after; only the id `doctor`/`amicus
  models` display and compare against is different. Council artifacts are unaffected either way — they
  record alias strings, not resolved ids.
  - **This fix does not reach everyone who already ran `amicus setup`.** `createDefaultConfig()`
    (`src/sidecar/setup.js`) persists the *entire* default alias map into `config.json` at setup time,
    and `getEffectiveAliases()` lets that persisted user config win over the shipped defaults — so
    anyone who ran `amicus setup` on Amicus ≤4.1.0 has the old, broken ids frozen on disk
    (`source: user-config`), which `findStaleAliases()` never suppresses. Measured: such a user sees
    **4 stale** aliases after upgrading to 4.1.1 — `opus`, `haiku`, `fable` (the pre-fix ids) plus
    `gemini` (this release's own pin move, see Changed below) — not zero, and `amicus doctor` /
    the Model Drift Check will keep warning for them. **There is no code fix for this in 4.1.1**; a
    self-healing config migration is a 4.2 candidate. If `amicus doctor` still warns after upgrading,
    re-run `amicus setup`, or fix individual aliases by hand, e.g.
    `amicus setup --add-alias opus=anthropic/claude-opus-4-8`.
- The offline Anthropic model floor now also lists `anthropic/claude-haiku-4-5-20251001`, the dated id
  Anthropic's own listing returns. Without it, keyless and OpenRouter-only users saw the shipped
  `haiku` default reported stale against the shipped floor.

### Changed

- **Curated `gemini` pin moves from Gemini 3.5 Flash to Gemini 3.6 Flash on both gateways.** This is a
  **silent model change, not merely a drift-notice cleanup**: a user with no `gemini` alias override of
  their own starts talking to a different underlying model the next time they use the `gemini` alias
  after upgrading. It also clears the pinned-fallback drift notice from `amicus models --check`.

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
  entire review. The default is now four seats (`glm,qwen,minimax,qwen-coder`), leaving real slack.
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
