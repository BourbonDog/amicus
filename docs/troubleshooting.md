# Troubleshooting (Extended)

> Quick reference is in the [README Troubleshooting table](../README.md#troubleshooting).
> This document covers the same symptoms with more diagnostic depth.

## First: run `amicus doctor`

Before working through any symptom below, run `amicus doctor` (plugin-only installs: `npx -y amicus@latest doctor`). It checks, in order: Node version, config directory, API keys, default model, catalog freshness, alias staleness and drift, the ANTHROPIC_BASE_URL form, the OpenCode binary, the OpenCode engine's MCP launch path, Electron, installed skills, MCP registration, the legacy sidecar MCP entry, session index and session metadata tmp files, OpenRouter credit, local providers, and the project root — and prints a targeted fix hint for every failing check. `amicus doctor --fix` self-heals what it can (e.g. re-installs a broken Electron in place); `--json` gives machine-readable output.

---

## MCP run fails with "budget gate refused the run"

**Symptom:** An `amicus_start` call over MCP returns an error with `message: "Error: budget gate
refused the run"` (`ERROR_CODES.BUDGET_EXCEEDED`).

**Cause:** v4.7 made the `amicus_start` shared-server budget gate unconditional
(`src/mcp-server.js:442-467`) — it used to run only when a pack forwarded `maxCost`, so a no-pack
MCP start that worked on 4.6.x can now refuse. The gate has two independent guards; when both fire,
raising only one will not clear the run.

**Fix:** the error text names which guard fired — raise that one, or choose a cheaper model. **If
both fired, you must raise both**; clearing one leaves the other refusing. See
[Cost gate](./configuration.md#cost-gate).

- **`maxCostPerMtok`** (the per-$/Mtok guard) lives only in `config.json`. No pack and no MCP param
  can override it.
- **`maxCost`** (the total-$ ceiling) is whichever value is *in effect*: **the pack's if this run
  used a pack that set one, otherwise the config's.** Editing the loser of that pair changes
  nothing.

`amicus_start` has **no per-call override** — it takes neither a `maxCost` nor a `noCostGate` param,
and nothing can turn the gate off on that path. (`amicus_council_run` is different: it does take
both, and they forward to its child exactly like the CLI flags.)

---

## Install Fails with `EEXIST: … claude-sidecar`

**Symptom:** `npm install -g amicus` fails with `npm error code EEXIST` naming a `claude-sidecar` (or `sidecar`) file under your global npm bin directory.

**Cause:** The old upstream `claude-sidecar` package is still installed globally. Through v1.x, Amicus shipped `sidecar`/`claude-sidecar` as deprecated bin aliases, which could also collide here — v2.0.0 no longer ships those aliases at all (removed in #19), so on a current install this is purely leftover from the old package.

**Fix:**

```bash
npm uninstall -g claude-sidecar
npm install -g amicus
```

Your keys and past sessions are not deleted by this swap, but v2.0.0 no longer reads them from the old locations automatically: config data was auto-migrated forward on every v1.x run, but if you're jumping straight from a pre-rebrand install, copy `~/.config/sidecar/` to `~/.config/amicus/` and rename any `.claude/sidecar_sessions/` dirs to `.claude/amicus_sessions/` by hand. See [docs/SHIMS.md](./SHIMS.md) for the full removal record.

---

## Auth / 401 Errors

**Symptom:** `401 Unauthorized`, `invalid_api_key`, or `OPENROUTER_API_KEY is not set`.

**Key resolution order** (highest priority first, implemented in `src/utils/env-loader.js`):
1. `process.env` — environment variables already set in the shell at launch. Never overwritten.
2. `~/.config/amicus/.env` — keys saved via `amicus setup`. The legacy `~/.config/sidecar/.env` fallback was removed in v2.0.0 — see [docs/SHIMS.md](./SHIMS.md). If you're migrating a pre-rebrand install directly to v2.0.0, copy the file over by hand.
3. `~/.local/share/opencode/auth.json` — OpenCode SDK credential store (lowest priority; Amicus only reads, never writes here).

**Diagnostic steps:**
- `amicus setup` — re-enters the wizard and writes the key to `~/.config/amicus/.env`.
- Check the model prefix matches the key: `openrouter/…` requires `OPENROUTER_API_KEY`; `google/…` requires `GOOGLE_GENERATIVE_AI_API_KEY`; `openai/…` requires `OPENAI_API_KEY`; `anthropic/…` requires `ANTHROPIC_API_KEY`.
- `LOG_LEVEL=debug amicus start …` will log which source each key was loaded from.

---

## Every Direct Anthropic Model Fails with `"Not Found"`

**Symptom:** Any model on the `anthropic/…` **direct** route — `haiku`, `sonnet`, `claude`, `opus`,
or an explicit `anthropic/claude-…` id — errors with exactly `Not Found` after ~2 s, with **zero
tokens** and no cost. The same model reached through OpenRouter
(`openrouter/anthropic/claude-haiku-4.5`) works normally. `amicus models --check` reports the alias
as valid, and `amicus doctor` reports the Anthropic key as valid, because both of those talk to
`api.anthropic.com` themselves rather than through the engine.

In a council this is worse than a plain failure: **a dead seat does not stop a run, it shrinks
one.** The council degrades around the missing model — the chair silently falls back, the bench
collapses from 3 seats to 2, and every finding comes back `confidence: "thin"` because it only ever
had one peer corroborator. Nothing in `verdict.json` records that the roster changed.

**Cause:** an `ANTHROPIC_BASE_URL` environment variable in **host-form** — missing the `/v1` path
segment. That's the Anthropic-SDK convention (the SDK appends `/v1` itself), not OpenCode's — its
provider layer treats the value as the already-complete prefix and appends only `/messages`, so
`https://api.anthropic.com` (no `/v1`) posts to `https://api.anthropic.com/messages` instead of
`https://api.anthropic.com/v1/messages`. That URL returns HTTP **404 with an empty body**, so the AI
SDK has no error payload to report and surfaces the bare HTTP status text — `Not Found`. Some hosts
set this variable for you: notably, a shell spawned by Claude Code inherits
`ANTHROPIC_BASE_URL=https://api.anthropic.com` (no `/v1`) from the host process. The model id, the
alias, and the API key are never the problem; only the URL is wrong.

**Since v4.6.2, this self-heals by default.** Amicus classifies `ANTHROPIC_BASE_URL` on every
engine start; when it's host-form, it carries a normalized `<value>/v1` into the engine as a
provider-config override (no env var is rewritten) and prints one
`Notice: ANTHROPIC_BASE_URL is host-form (…); passing …/v1 to the engine …` line to stderr, once per
process. `amicus doctor` also gained an `anthropic-base-url` row that always prints the exact value
it sees and how it's being treated. So on a current install, this failure should be rare — if
you're seeing it anyway, it's one of:
- **`AMICUS_BASE_URL_NORMALIZE=0` is set**, the deliberate escape hatch — it disables the fix
  entirely. Easy to hit by accident if you set it while chasing something unrelated.
- **`ANTHROPIC_BASE_URL` carries a nonstandard path** — anything other than blank/`/` (host-form)
  or an already-correct `/v1` — which amicus passes through untouched rather than guessing (an
  exotic proxy serving `/messages` at a custom root stays possible).
- You're running a **pre-v4.6.2** amicus, where none of the above exists yet.

**Confirm it in one command** (no key needed for the first three lines):

```bash
amicus doctor                        # anthropic-base-url row: the value seen + how it's treated
echo "$ANTHROPIC_BASE_URL"           # host-form (no /v1 suffix) is the underlying condition
echo "$AMICUS_BASE_URL_NORMALIZE"    # "0" here is what disables the automatic fix
amicus start --model haiku --prompt hi --no-ui   # should complete; stderr shows the Notice line
                                                  # the first time normalization actually fires
```

**Fix** — pick one:
- Unset `AMICUS_BASE_URL_NORMALIZE` (or set it to anything other than `0`) to restore the default
  self-heal.
- Still failing with normalization on? Add the missing segment yourself:
  `export ANTHROPIC_BASE_URL=https://api.anthropic.com/v1` (PowerShell:
  `$env:ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'`), or unset the variable entirely:
  `unset ANTHROPIC_BASE_URL` (PowerShell: `Remove-Item Env:\ANTHROPIC_BASE_URL`).
- Or route Anthropic models through OpenRouter for the run: `--gateway openrouter`.

Any of these gets `amicus start --model haiku …` completing normally again. **Before spending
money on a council, run one throwaway `amicus start` against each configured seat** — a
`Not Found` there costs nothing, whereas discovering it mid-council costs a degraded verdict.

---

## `Model 'X' is unverified against the direct catalog; attempting anyway`

**Symptom:** a launch-time notice on stderr naming a model that really does exist, e.g.
`Model 'deepseek/deepseek-v4-pro' is unverified against the direct catalog; attempting anyway.`
The run proceeds and may even succeed, so the notice is easy to scroll past.

**Cause:** the notice is not a claim that the model is wrong — it means amicus **could not check**.
`classifyModel()` is tri-state: `valid` / `invalid` / `unknown`, and `unknown` never blocks a
launch. It returns `unknown` when the cached catalog holds **no rows at all** for that vendor's
direct namespace, which happens when the direct fetch for that provider failed — most often because
the key amicus has stored for it is stale, truncated, or simply a different key from the one the
engine uses.

That split is the trap. Amicus resolves keys in the order listed under
[Auth / 401 Errors](#auth--401-errors), and the OpenCode engine keeps its own credential store in
`~/.local/share/opencode/auth.json`. If `~/.config/amicus/.env` holds a **bad** key for a provider
while `auth.json` holds a **good** one, amicus's catalog fetch 401s (→ empty namespace → the
notice) while the engine still runs the model successfully with the other key. You get a permanent
warning about a model that works, and no warning at all that one of your two stored keys is dead.

**Diagnose:**
```bash
amicus key                 # lists configured providers
amicus models --refresh    # re-fetches every keyed provider; watch for a provider that stays empty
amicus models --check      # audits every pinned alias route against the catalog
```
Then check the provider's own listing endpoint with the stored key (DeepSeek:
`GET https://api.deepseek.com/models`; Anthropic: `GET https://api.anthropic.com/v1/models`).
A `401` identifies the bad key.

**Fix:** re-save the working key so both stores agree — `amicus key <provider> <apikey>` (or
`amicus setup`) — then `amicus models --refresh`. The notice disappears once the vendor's direct
namespace has live rows again.

**If the model genuinely is retired,** the notice is the only warning you get before the launch
attempt: verify against the vendor's catalog and update the model id or drop the seat.

---

## OpenRouter 402 / "Payment Required" on First Call

**Symptom:** `amicus setup` and `amicus key openrouter <key>` both report the key as valid, but the first council review / `start` / `fanout` call against an OpenRouter model fails with `402 Payment Required`. (The `amicus council` subcommand itself is deterministic math and never calls a model, so it can't trigger this.)

**Cause:** Key save only checks that the key **authenticates** (`validateApiKey` — a `GET` against `openrouter.ai/api/v1/models`, which succeeds for any real key regardless of balance). It does not check credit; a zero-credit or free-tier-only key saves cleanly and only fails later, on the first paid-model call. `amicus doctor` DOES probe credit (the "OpenRouter credit" check, non-blocking) and the interactive `amicus setup` wizard prints a warning at the end if it detects zero credit or free-tier — but neither runs automatically after `amicus key`.

**Fix:**
- Run `amicus doctor` to confirm: it reports `openrouter-credit` as `warn` with the remaining-balance message if the key is zero-credit or free-tier-only.
- Add credit at [openrouter.ai/credits](https://openrouter.ai/credits), **or**
- Build a zero-cost council instead: `amicus setup` → option 2 (Free OpenRouter council) detects live `:free`-suffixed models and saves them as `councils.free`; then run `amicus fanout --council free …` (or let the `second-opinion` skill pick it up automatically).

---

## Session Not Found

**Symptom:** `Session <id> not found`, `Error: no recent session`.

**Causes and fixes:**
- **Explicit ID mismatch:** Run `amicus list` to see available sessions, then pass `--session-id <id>` explicitly.
- **Wrong project directory:** Amicus looks for sessions under `<project>/.claude/amicus_sessions/`. If you run from a different cwd, the session won't be found. Pass `--project <path>` to override.
- **Pre-rebrand sessions:** Sessions created before the Amicus rebrand live under `.claude/sidecar_sessions/`. The dual-read shim that used to resolve those automatically was removed in v2.0.0 — Amicus now only reads `.claude/amicus_sessions/`. Rename the directory to make old sessions visible again. See [docs/SHIMS.md](./SHIMS.md).

---

## No Conversation History Found

**Symptom:** `No conversation history found` or empty context injected into the Amicus run.

**Cause:** Amicus reads Claude Code's session JSONL files from `~/.claude/projects/<encoded-path>/`. The project path is encoded by replacing `/`, `\`, `:`, and `_` with `-` (implemented in `src/session.js` `encodeProjectPath()`).

**Common encoding gotchas:**
- On Windows, `C:\Users\alice\myproject` encodes to `C--Users-alice-myproject` (the drive-letter colon becomes a dash, backslashes become dashes).
- Underscores in the path also become dashes, which can make two different paths collide.

**Diagnostic steps:**
- Run `ls ~/.claude/projects/` (or `dir` on Windows) to see what encoded directories exist.
- Compare the encoded name to `encodeProjectPath(process.cwd())` output: `node -e "console.log(require('./src/session').encodeProjectPath(process.cwd()))"` from the project root.
- If the directory is missing, Claude Code may not have run in that project yet — open a Claude Code session first.

---

## Headless Run Never Finishes / Timeout

**Symptom:** `amicus start --no-ui` hangs or exits with `timedOut: true`.

**Primary knob:** `--timeout <minutes>` (default 15). Example: `--timeout 30`.

**Poller tuning** (env vars, all in `src/headless.js`):

| Variable | Default | Effect |
|----------|---------|--------|
| `AMICUS_POLL_INTERVAL_MS` | `2000` | Poll cadence in ms |
| `AMICUS_STABLE_FINISHED_POLLS` | `2` | Polls to wait after `time.completed` is set |
| `AMICUS_STABLE_IDLE_POLLS` | `30` | Polls to wait when no `time.completed` signal (~60 s) |
| `AMICUS_POLL_CALL_TIMEOUT_MS` | `30000` | Per `getMessages` call timeout |
| `AMICUS_MAX_CONSECUTIVE_POLL_FAILURES` | `15` | Bail out after N consecutive poll errors (~30 s) |

For full headless configuration, see [docs/configuration.md](./configuration.md).

---

## Headless Leg Fails with `NO_OUTPUT_BACKSTOP`

**Symptom:** A headless leg (`amicus start --no-ui`, or one leg of a `fanout`/council run) fails with an error starting `NO_OUTPUT_BACKSTOP: no output, reasoning, or tool calls in Ns — the AMICUS_NO_OUTPUT_BACKSTOP_MS window (0 disables)`. You may instead see `...in Ns — a caller-set window overriding the AMICUS_NO_OUTPUT_BACKSTOP_MS default` — this covers two different cases with the same wording: a Stage-1 retry (its window is the resolved `AMICUS_NO_OUTPUT_BACKSTOP_MS` value **doubled**, so a 300 s default reads `600s` on the retry) and the `amicus models --check --live` probe (a fixed, non-tunable `30s` — see below). Both are "caller-set" in the sense that the specific window wasn't read live from the env var at that call, but only the retry case is actually governed by it.

**Cause:** The mechanism only knows that the deadline passed with no substantive activity — no output, reasoning, or tool calls — for the backstop window (300 s by default for an ordinary leg). It does **not** know *why*. Do not read this as "the endpoint is dead" or "the model isn't being served" — the message deliberately stops short of that claim, because at one of its two firing sites the backstop can win the race before the prompt send even resolves, so acceptance itself was never observed. Treat `NO_OUTPUT_BACKSTOP` as "silence past the deadline," not a diagnosis.

Two trailing clauses are the exceptions, and neither is the mechanism's inference:

- ` — engine log: <excerpt>` (since v4.9) is the OpenCode engine's own ERROR line for this exact session, quoted verbatim from the engine's log. That clause is the engine speaking. "For this exact session" is strict: the line must name your session in one of the engine's own session fields (`session.id=`, `id=`, …), so a neighbouring session's failure is never quoted at you — and when nothing on disk meets that bar, the clause is simply absent rather than approximate.
- ` (engine skew: server <a> ≠ installed <b>)` (since v4.9) means the engine serving **this** run reported a different version than the `opencode-ai` sitting in the install that launched it — two facts, both published by the software itself, neither guessed. It names the server this leg actually talked to, as of this leg's most recent session: a skew seen on some other server in the same process, or one that was fixed part-way through, never rides along on a report it does not belong to. This is #133's own shape; see the Lesson below.

The two clauses are independent: either can appear without the other, and the skew clause is **not** conditional on the log read succeeding. With neither, the message is exactly what it was before v4.9. Everything before them is still only "silence past the deadline".

**Lesson from #133:** an earlier version of this message *did* guess a cause ("likely a listed-but-not-serving model or a dead endpoint"), and that guess sent 30 minutes of debugging at model ids and API keys on a real incident. The actual cause was an OpenCode engine version skew between the npx-cached copy and the global install — sitting in the engine's own log the whole time, at the exact timestamp of every dead session. **Both halves are now surfaced for you** (v4.9): the log line becomes the ` — engine log:` clause, and the skew itself is detected at session-create time — announced on stderr as `[amicus] engine version skew: …` (once per standing skew per server, not once per session) and repeated in the ` (engine skew: …)` clause above. The remedy is to make the two copies the same version — update whichever is behind (`npm i -g amicus`, or re-run the installer for the surface that failed). `amicus doctor` will **not** confirm this one: its engine check compares npx-cached copies against the global install and is structurally blind to the copy the running server loaded, so it can report clean while this notice is firing. One related line can also appear, once per process: `[amicus] server identity unavailable — skew attribution is process-wide; SDK shape may have changed`. It means amicus could not read which server a client is talking to, so skew records stop being kept per server and share one bucket — the skew detection still works, but a clause could in principle be attributed to the wrong server when a run talks to more than one. It is a report about amicus itself, not about your models; if you see it, the OpenCode SDK has probably changed shape and amicus needs an update. If neither clause is present, read the log yourself before chasing model/endpoint theories — see the fix below for where it lives.

**Confirm:** `amicus models --check` — audits your configured aliases against the live catalog and flags drift/staleness. A model that still resolves locally but has quietly been retired upstream is one possible explanation, but a static audit only compares against the catalog's *listing* — it can't tell you whether a still-listed model actually answers. For that, run `amicus models --check --live` on demand: it sends one tiny real request to every stored alias and reports `SERVED` / `SILENT` / `ERROR` per alias, where `SILENT` (`accepted-but-silent`) is this exact `NO_OUTPUT_BACKSTOP` failure, caught deliberately instead of by accident. It spends real money (one tiny leg per stored alias) — see [docs/usage.md § `amicus models`](./usage.md#amicus-models--the-model-catalog) for cost, scope, and exit-code details.

**Fix:** Read the ` — engine log: …` clause on the failure message first, if it has one — that is the engine's own account of this session (see #133 above). If it has none, look yourself: OpenCode writes its logs to `$XDG_DATA_HOME/opencode/log` when that variable is set, otherwise `~/.local/share/opencode/log` (that path holds on Windows too) — check **both** when `XDG_DATA_HOME` is set, since a leftover value can point at a directory the running engine never writes to (amicus searches all of them, newest file first, and answers from the most recently written line that both is an ERROR and names your session). Current engine builds write **one timestamped file per process** there, e.g. `2026-08-25T185532.log`; older ones append to a single `opencode.log` in the same directory, and both layouts turn up on real machines — so check the newest files by modification time, not one fixed filename. The session's `ses_…` id is the correlation key. Then check the alias's target (`amicus models --search <term>` to find the current id, then re-point the alias) — a stale alias is a common case, but not the only one. If the failing leg was a Stage-1 retry (the window read `600s`, or generally double your configured/default value), `AMICUS_NO_OUTPUT_BACKSTOP_MS` **is** the lever — raising it raises both the first attempt's window and the retry's doubled one, unless your `--timeout` is low enough that the doubled window is clamped to the leg timeout. On an ordinary (non-retry) leg, raise it only if a model legitimately needs more than 300 s to produce its first token. The live probe's fixed 30 s window is the one case the env var genuinely cannot touch. See [docs/configuration.md § Headless Poller Tuning](./configuration.md#headless-poller-tuning).

---

## Headless Leg Fails with `OUTPUT_LENGTH`

**Symptom:** A headless leg (`amicus start --no-ui`, or one leg of a `fanout`/council run) ends `error` with a reason starting `OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — 32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — raise outputBudget …`. The middle clause may instead read `and only reasoning was streamed, no answer text` — the provider showed its reasoning and nothing else. On a council run the seat is a dead leg and is retried once like any other death — unchanged for the no-output shape; new for the promoted-thinking shape, which 4.9.3 counted as a review — and if the retry dies too the seat is announced (`Notice: seat … did not review — the leg ended 'error': OUTPUT_LENGTH: …`).

**Cause:** The model spent its whole output reservation reasoning and never started the answer. Every clause is an observation, not a guess: `finish 'length'` is the engine's record of the provider's own stop reason; the two counts are the engine's token record for that message (on OpenAI-compatible routes reasoning and output are split; on the direct Anthropic route everything lands in `output` and reasoning reads 0 — the message still says `finish 'length'`); the budget clause is the value the engine serving the leg was started with — read once at spawn and carried on the server handle (`config.json` at that moment; a later edit does not change what the leg reserved); with no budget set it names the ambient `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` the engine was started with when there was one (a plain positive integer is honoured; anything else falls back to 32,000 — measured, D1/D2) and the engine's 32,000 default otherwise. A server handle amicus did not start carries no spawn value; then `config.json` is read when the death is named. The reservation is 32,000 by default (see [Output budget](./configuration.md#output-budget-outputbudget)). The likeliest driver is reasoning effort — OpenRouter applies a model's default effort when none is sent, and `--thinking` is not available on a council seat (on a solo or fanout leg it reaches the engine as its `variant` field since #218 PR 4) — so raising the budget gives the reasoning room, and the leg still bills for it.

**Confirm:** `finish: 'length'` is on the leg's `metadata.json` and on its row in `~/.config/amicus/spend-ledger.jsonl` (the `finish` field, present only when the engine recorded one), beside the token counts. A council run's `run.json` carries it on the leg document.

**Fix:** Raise `outputBudget` in `config.json` (the reservation is `min(outputBudget, the model's ceiling)`; see the five bullets in [Output budget](./configuration.md#output-budget-outputbudget)), or seat a model whose default effort fits the reservation. If the same seat dies the same way on its retry, the retry cost you the reservation twice — a council seat has no effort knob (filed), so raise the budget or drop the seat; on a solo or fanout leg, lower `--thinking` (it reaches the engine since #218 PR 4). A leg that took longer than `AMICUS_NO_OUTPUT_BACKSTOP_MS` to reason with nothing visible dies as `NO_OUTPUT_BACKSTOP` first, not as this — see that section above.

---

## `--thinking` Refused Before Anything Is Sent (`VARIANT_UNDECLARED`, `VARIANT_OVER_BUDGET`)

**Symptom:** A solo run (`amicus start --no-ui`) or a fanout leg ends `error` with a reason starting
`VARIANT_UNDECLARED: openrouter/moonshotai/kimi-k3 does not declare a
'medium' variant — the engine's catalogue lists low, high, max for it …` or `VARIANT_OVER_BUDGET:
the 'high' variant on anthropic/claude-haiku-4-5 carries a 16000-token thinking budget that the
engine adds ON TOP of the reservation on this route … with outputBudget 24000 this leg would
reserve 40000 …` (an interactive `amicus start` ends the same way with the reason prefixed
`Session setup failed: `). Nothing was billed: the request was never sent. On a fanout the other
legs run.

**Cause:** Since #218 PR 4, `--thinking` is sent as the engine's `variant` field and checked first
against what the engine's own catalogue declares for that model (`/config/providers`). A level the
model does not declare would be a silent no-op the engine still echoes on the artifact (probe
F3/M7), so it is refused. The declared set is read from the engine's catalogue at that moment: on a
cold `~/.cache/opencode` (first engine start after an install or a cleared cache) the bundled
catalogue can declare a different set than the live one for the same model (PR 4 record:
`openrouter/anthropic/claude-haiku-4.5` `high`/`max` cold, `low`/`medium`/`high` warm), so a level
refused on one run can be accepted on the next; the reason always lists the set in force. The dump
says whose row it is: Amicus writes exactly one cell into a model's entry (`limit`, at
`src/utils/config.js:406`), so a row that also carries the catalogue's release date, family, pricing
or capabilities is the engine's own declaration, and an empty `variants` there is a real answer
(record M23). A declared
level whose entry carries a thinking budget the engine adds on top of the reservation (direct
Anthropic Haiku 4.5 — M2; Opus 4.5 declares the same shape, M0) is refused when `outputBudget`
is below the model's ceiling, because the leg would reserve more than the budget promises. The
reason names the model, the level, what the catalogue lists, and — for the budget case — the exact
reservation, the budget and the ceiling.

**Confirm:** The reason is on the session's `metadata.json` (`reason`) and, for a fanout, on the
leg document in `wave.json`; the ledger row for it reads `status: "error"` with zero tokens and no
`variant` (nothing was spent, but the run is still attributed — its `cost.source` is `unknown`,
not a price). `amicus models` does not list variants; the declared set is in the reason itself.

**Fix:** Pick a level the reason lists, or omit `--thinking` to run at the provider's own default.
For `VARIANT_OVER_BUDGET`: raise `outputBudget` to at least the ceiling the reason names (the sum is
then clamped to the ceiling — the number the reason names is Amicus's own catalog's ceiling for the
model, which is what the fit can read once a budget is set, M3; for a model Amicus's catalog has no
row for it is instead the engine's own ceiling, straight from the dump, K5/K12), route the model
through OpenRouter (a variant leaves the reservation at the budget there — M1, M9), or use an
adaptive-thinking model such as `claude-sonnet-5`. When the reason says to refresh first, the
ceiling it named came from Amicus's catalog rather than the engine, and the two can disagree. A
model the engine's catalogue does not know yet (a custom or local model, or one newer than the
engine's bundled list before its startup refresh lands) is never refused: the level is sent after a
bounded wait, the run logs `Variant sent unverified`, and the same note is printed as a `Notice:`
line on stderr — the structured log alone is dropped at the shipped default log level, so stderr
is where you will actually see it. A budget changes none of this: the same command is refused, or
sent unverified, identically with and without one. A model the engine's catalogue does not know yet
still waits and is still sent unverified, with `variantUnverified: true` on the leg document.

---

## Multiple Active Sessions / Wrong Session Picked Up

**Symptom:** Amicus resumes or reads from the wrong session.

**Fix:** Pass `--session-id <id>` explicitly. When multiple sessions exist and no ID is specified, Amicus picks the most recent one by creation time. Run `amicus list` to inspect what's available.

---

## Fold Summary Looks Corrupted

**Symptom:** The summary output contains debug log lines, JSON blobs, or other non-summary text.

**Cause:** `LOG_LEVEL` is set to a verbose level (`debug` or `info`) and those log lines are reaching stdout instead of stderr.

**Fix:** Re-run with `LOG_LEVEL=debug amicus start …` to confirm what is leaking, then check that no `console.log` or `logger.*` call in the hot path writes to stdout. All Amicus log output should go to stderr. The summary is captured from stdout only.

---

## "Council Review This" Does Nothing

**Symptom:** Typing `council review this` (or similar) in Claude Code produces no response or an error about the skill not being found.

**Cause:** The `second-opinion` skill is not installed in `~/.claude/skills/`.

**Fix:**
1. Check whether the skill file exists: `~/.claude/skills/second-opinion/SKILL.md`.
2. If absent, re-run `npm install -g amicus` — the postinstall script installs both the `sidecar` chat skill and the `second-opinion` council skill automatically.
3. If the file exists but Claude Code still ignores it, verify that `~/.claude/skills/` is on Claude Code's skill search path (check your `~/.claude/settings.json`).

---

## Model Fails Catalog Validation

**Symptom:** `Error: model 'xyz' not found in catalog` on `amicus start` or `amicus fanout`.

**Cause:** The model name isn't in the locally cached catalog (`~/.config/amicus/model-catalog.json`), either because the catalog is stale or the model was renamed upstream.

**Fix:**
- `amicus models --refresh` — fetches the current catalog from the OpenRouter API and updates the cache.
- `amicus models --search <term>` — search the catalog for the correct model ID.
- `--no-validate-model` — bypass catalog validation for this run (the model is still validated by the OpenCode server at prompt time).

---

## Fanout Exits 2 (Partial Wave)

**Symptom:** `amicus fanout` exits with code 2.

**Meaning:** Exit code 2 means `partial` — at least one leg completed successfully and at least one did not. Exit code 1 means all legs failed (`error` or `aborted`). Exit code 0 means all legs completed.

**Diagnostic steps:**
1. Read the wave document: `amicus read <waveId> --json` or inspect `<project>/.claude/amicus_sessions/<waveId>/wave.json`.
2. Find legs with `status !== "complete"` in the `legs[]` array.
3. Read the individual leg: `amicus read <legId> --json` for the `error` field and the summary.
4. Re-run the failed leg independently: `amicus start --model <model> --prompt "…" --no-ui`.

---

## Electron Download Fails Behind a Corporate Proxy

**Symptom:** The first interactive `amicus start` (or `amicus doctor --fix`) hangs or errors while "provisioning Electron", on a network that requires an HTTP/HTTPS proxy.

**Cause:** Amicus downloads the Electron binary via `@electron/get`. As of `@electron/get` 5.x (shipped with the Electron 43 upgrade), the downloader uses Node's native `fetch`, which — unlike the older `got`-based path — does **not** honor `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` automatically. Proxied and authenticated-proxy environments are therefore not auto-detected.

**Fix:**
- **Manual install (most reliable):** on a machine/network with direct access, run any `amicus start` once to populate the Electron cache, then copy the cache directory to the target machine — `%LOCALAPPDATA%\electron\Cache` (Windows), `~/Library/Caches/electron` (macOS), `$XDG_CACHE_HOME/electron` or `~/.cache/electron` (Linux). Amicus reuses a valid cached binary without re-downloading.
- **Point at your own mirror:** set `ELECTRON_MIRROR` (and `ELECTRON_CUSTOM_DIR` if needed) to an internal Electron mirror that is reachable without a proxy.
- Headless runs and the full council never need Electron — use `--no-ui` if the GUI is not required.

---

## GUI Load Failsafe

**Symptom:** Interactive Amicus window shows a load-error page instead of the OpenCode UI, with a message about the UI not responding.

**Cause:** The OpenCode web UI did not load within the allowed window (default 15 000 ms). This can happen if the Go server is still cold-starting, or if the port is already in use.

**Fix:**
- Increase the timeout: `AMICUS_GUI_LOAD_TIMEOUT_MS=30000 amicus start …`
- Check whether another process is already using the target port: `netstat -ano | findstr <port>` (Windows) or `lsof -i :<port>` (macOS/Linux). (`amicus list --status running` shows running *sessions*, which may still hold a server — it does not list ports.)
- `AMICUS_SHARED_SERVER=0` forces a fresh per-process server if the shared server is in a bad state.

---

## Shared Server Crash Loop

**Symptom:** `amicus start` fails repeatedly; logs show `Shared server crashed` followed by restart attempts.

**Cause:** The OpenCode Go binary is crashing on startup or shortly after. The `SharedServerManager` allows up to 3 restarts in a 5-minute window, then stops retrying.

**Fix:**
- `LOG_LEVEL=debug amicus start …` to capture the crash output from the Go process.
- `AMICUS_SHARED_SERVER=0` to fall back to per-process mode (bypasses the shared server entirely).
- Reinstall: `npm install -g amicus` to ensure the bundled `opencode-ai` binary is intact.

---

## Amicus Process Not Self-Terminating

**Symptom:** `amicus start --no-ui` keeps running after the task completes.

**Cause:** The idle watchdog is disabled or has a very long timeout.

**Diagnostic steps:**
- Check per-mode overrides first: `AMICUS_IDLE_TIMEOUT_HEADLESS`, `AMICUS_IDLE_TIMEOUT_INTERACTIVE`, `AMICUS_IDLE_TIMEOUT_SERVER` (in minutes).
- The blanket `AMICUS_IDLE_TIMEOUT` overrides all modes.
- Setting any of these to `0` disables self-termination for that mode.
- `LOG_LEVEL=debug amicus start …` traces watchdog state transitions (`IdleWatchdog`).
