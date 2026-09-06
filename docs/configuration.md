# Configuration Reference

`amicus setup` is the recommended way to configure Amicus. It opens a graphical wizard that validates your API keys live, lets you pick a default model from the live catalog — down to a specific model per provider, not just the family default — and saves everything to `~/.config/amicus/.env` (permissions `0600`). The environment variables below are for overrides and advanced tuning — most users only need the API keys section.

---

## API Keys

Amicus reads API keys from `~/.config/amicus/.env` and from `process.env`. Environment variables already set in your shell win; the `.env` file fills in anything unset; `auth.json` is the last fallback. Keys written by `amicus setup` are never silently overridden by something with higher priority.

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | OpenRouter — routes to any provider from a single key. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Direct Google Gemini access (bypasses OpenRouter). |
| `OPENAI_API_KEY` | Direct OpenAI access. |
| `ANTHROPIC_API_KEY` | Direct Anthropic access. |
| `DEEPSEEK_API_KEY` | Direct DeepSeek access. |

**Running models locally?** None of the above are required — `amicus provider` configures Ollama, LM Studio, vLLM, or any other OpenAI-compatible endpoint as an additional provider at $0 marginal cost, no entry in this table needed. See [docs/usage.md § `amicus provider`](./usage.md#amicus-provider) and the `providers` key under [Config file format](#config-file-format) below. Local models also need to be loaded with enough context to fit Amicus's ~26k-token agent prompt (~32k is a safe target) — see **Running local models** in the same `amicus provider` section for the exact commands.

**Bare `provider/model` is the canonical, policy-routed form.** Amicus routes it **direct-first**:
your direct provider key when one is configured, falling back to `OPENROUTER_API_KEY`
automatically when it isn't. `openrouter/provider/model` is an **explicit override** that always
forces OpenRouter, even when a direct key exists — reach for it deliberately, or for gateway-only
vendors with no direct integration (Qwen, Grok, Mistral, GLM, …), which require this form. See
[Routing](#routing) below for the full picture (`routing.prefer`, `--gateway`, the migration
notice).

| Model prefix | Credential consumed |
|-------------|-------------------|
| `provider/model` (bare, canonical) | Direct key for that vendor if configured, else `OPENROUTER_API_KEY` |
| `openrouter/provider/model` | `OPENROUTER_API_KEY`, always |

Per vendor, the bare form's direct key is: `google/...` → `GOOGLE_GENERATIVE_AI_API_KEY`,
`openai/...` → `OPENAI_API_KEY`, `anthropic/...` → `ANTHROPIC_API_KEY`, `deepseek/...` →
`DEEPSEEK_API_KEY`.

**Inherited provider base URLs.** Amicus does not define or read `*_BASE_URL` variables for the
hosted vendors above, and it still passes the whole environment through to the OpenCode engine,
which hands them to the underlying provider SDK. `ANTHROPIC_BASE_URL` gets one extra treatment:
the SDK appends only `/messages` to it, so it must include the `/v1` path segment, and some hosts
set the `/v1`-less host-form for you — a shell spawned by Claude Code inherits it. **Since v4.6.2,
amicus detects that host-form value and carries a normalized `<value>/v1` into the engine as a
provider-config override by default** (no env var is rewritten) — see `AMICUS_BASE_URL_NORMALIZE`
above to disable it, and `amicus doctor`'s `anthropic-base-url` row to see how your current value
is being treated. Any other path (including an already-correct `/v1`) passes through unchanged.
See [troubleshooting § Every Direct Anthropic Model Fails with `"Not Found"`](./troubleshooting.md#every-direct-anthropic-model-fails-with-not-found)
for the pre-normalization failure mode and the manual fix if you've disabled the knob.

---

## Output budget (`outputBudget`)

Each council leg reserves a `max_tokens` allowance before the model runs. Amicus previously handed
OpenCode no per-model limit at all, so OpenCode's own fixed default — **32,000** — governed every
leg regardless of the model's real ceiling.

That reservation is not free. OpenRouter validates it against your remaining credit *before* serving,
so a leg that would have emitted 800 tokens gets refused outright for asking to reserve 32,000:

```
This request requires more credits, or fewer max_tokens.
You requested up to 32000 tokens, but can only afford 354
```

`outputBudget` sets the reservation, in either direction. Every leg reserves
`min(outputBudget, that model's real ceiling)` wherever a ceiling is known — by the Amicus catalog
(a per-model `limit` descriptor) or, failing that, by the engine's own catalog (every engine Amicus
starts gets `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` set to the budget). A model neither catalog
knows receives the budget itself, exactly as it received the raw 32,000 before.

If you set `outputBudget` on 4.9.3, one thing changes on upgrade: a budget below 32,000 now also
reaches routes the catalog cannot clamp — an unrefreshed direct row, a local-provider model,
anything the catalog lacks — which 4.9.3 left at the engine's 32,000. Those legs reserve
`min(budget, the ceiling the engine's own catalog knows)` (K12: 8,000 on a bare kimi row), or the
budget as-is where the engine knows the model no better (K13).

| Setting | Values | Default | Effect |
|---------|--------|---------|--------|
| `outputBudget` (config.json, top-level) | positive integer | *unset* | Per-leg output reservation, clamped to each model's real ceiling wherever one is known. Unset means no limit is sent and no engine flag is set — OpenCode's 32,000 default applies, exactly as before. |
| `modelsDevCeilings` (config.json, top-level) | `true` / `false` | `true` | Fill direct-provider context/ceiling numbers from models.dev at refresh. Set `false` to never contact models.dev; the openai / anthropic / deepseek direct rows then carry no ceiling in the Amicus catalog and are clamped by the engine's own catalog instead (Google publishes its own ceiling and OpenRouter rows keep OpenRouter's). |

`modelsDevCeilings` is the opt-out for the one third-party lookup a refresh makes. Only a literal
`false` turns it off; the key being absent means it runs. Even with it on, the call is **skipped
automatically when no candidate row is missing a number** — a refresh with nothing to fill never
contacts models.dev at all. `amicus models --refresh` names whichever of those happened on its
`Ceilings:` line.

Set it by hand-editing `~/.config/amicus/config.json`:

```json
{ "outputBudget": 8000 }
```

`amicus doctor`'s `output-budget` row then says what the value reaches: how many of your alias
routes the catalog can clamp it to, whether an `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` you exported
yourself is being honoured or overridden, and a malformed value in either place — the engine falls
back to 32,000 *silently* on those (measured), so the doctor row is where it surfaces.

Five things worth knowing before you set it. Every number below was measured on the wire by
`scripts/probe-max-tokens.js` against the pinned engine, or read in the pinned binary where it says
so; the row ids refer to the three probe tables filed in `BACKLOG.md` under "v4.9.4 records" (#218
P1, PR 2 and PR 3).

- **Above 32,000 it is the engine flag doing the work.** OpenCode computes
  `Math.min(limit.output, OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX)` with the flag defaulting to
  32,000 (read in the pinned binary; the rows below are its wire effects), so Amicus sets that
  flag to your budget for every engine it starts — around the spawn only. It never lands in
  your shell, and a value you exported yourself is honoured untouched when `outputBudget` is
  unset and overridden (for Amicus-started engines only) when it is set. A budget of 100,000 on a
  model with a 943,718 ceiling reserves 100,000 (K6); on a model whose ceiling is 64,000 it
  reserves 64,000 (K5). The flag is experimental on the engine's side, and a malformed value is
  ignored without a word (D1/D2): CI runs the probe's flag rows on every push, and the full matrix
  is re-run and re-filed after every engine bump. An SDK bump is covered by a test that drives the
  real SDK against a fake engine and checks the flag reached the spawn.
- **It clamps best with a catalog that knows each model's ceiling.** Run `amicus models --refresh`
  after setting it. OpenRouter rows carry OpenRouter's own ceiling and Google rows carry Google's;
  the direct `openai` / `anthropic` / `deepseek` rows — and any other row whose number the provider
  left empty or unusable — are filled from [models.dev](https://models.dev) at refresh. models.dev
  fills a field only where the provider gave no usable positive integer (a null, a zero, a negative
  or a malformed number), and never overwrites a usable provider value; the `openrouter/openrouter/*`
  meta-routers and local-provider rows are never filled at all. The refresh output says how many
  rows were filled or why none could be. A route the Amicus catalog cannot clamp still gets the
  budget through the engine flag, clamped by the engine's own catalog where it knows the model
  (K5: 100,000 → 64,000 on a bare haiku row; K12: 8,000 on a bare kimi row, passed through
  under its ceiling); a model neither knows receives the budget as-is (K13). That is the one way a
  raised budget can fail where the 32,000 default did not: a custom or local model neither catalog
  knows is asked for the full budget, and a provider that enforces its ceiling refuses the
  request — loudly, with the provider's own error on the leg, never silently. `amicus doctor`
  names such routes; lower the budget if you have one, or give the model a catalog entry.
- **Direct-Anthropic thinking legs add their thinking budget on top.** On the direct `anthropic/*`
  route the engine adds a thinking variant's budget to the reservation — 8,000 becomes 24,000 with
  the 16,000-token `high` variant (K2) — and clamps the sum to the model's real ceiling (K3/K4/K10:
  64,000 for haiku, whatever the descriptor or the flag said). Amicus sends no thinking variant
  today (`--thinking` never reached the engine — F1), so this is the number PR 4 inherits, not one
  you can hit yet — and PR 4, which sends the variant, must fit it under the budget rather than on
  top. `openrouter/anthropic/*` rows route through OpenRouter's effort mapping and clamp normally.
- **The reservation comes out of the context window.** Input plus `max_tokens` has to fit the
  window, and the engine subtracts this same reservation from the window before it decides to
  compact (read in the pinned binary's `SessionCompaction.isOverflow`, not wire-measured: that is
  the branch for a model without `limit.input`; a model with one loses at most 20,000, and a
  `compaction.reserved` config overrides both). A budget of 100,000 leaves a 131,072-context
  model 31,072 tokens for the prompt. `amicus doctor` warns when a budget takes at least half of
  any alias route's window.
- **When a leg hits it, the run says so.** The engine records `finish: 'length'` on the leg's
  assistant message whenever the provider stopped at the reservation (A, H1, L1–L4 — both provider
  families). A leg whose finalized message carries **no answer text** — the whole reservation went
  to reasoning, the #218 "Mode 2" rows (32,000 reasoning, 0–2 output, $0.63 billed) — now ends
  `error` with a reason starting `OUTPUT_LENGTH:` that carries the engine's reasoning/output counts
  for the leg and the budget in force; it used to end `complete` with an empty summary or, when the
  provider streamed the reasoning, with its *thinking* promoted to the review (L2/L4). A leg whose
  finalized message carries answer text keeps its review — that text alone: reasoning an earlier
  message promoted as a stand-in is dropped the moment answer text arrives — and a council prints a
  `Note:` on the `output-truncated` channel — informational, the exit code does not move. The counts
  are reported, never decided on: on OpenAI-compatible routes the engine subtracts reasoning from
  completion (L3: 8 = 40 − 32); on the direct Anthropic route it reports no split (L4: 24,000 output
  / 0 reasoning). Two limits: a leg whose hidden reasoning outlasts the no-output backstop window
  dies under `NO_OUTPUT_BACKSTOP` first (the message has not finalized yet), and the Note is Stage-1
  only — a judge, chair or debate leg cut at its reservation gets the death name but no Note.
  Separately, L5 settles the catalog question PR 2 parked: a descriptor above the engine's own
  ceiling is clamped to that ceiling with a thinking variant (K10: 70,000 + 31,999 → 64,000) and
  without one (L5: 70,000 + flag 100,000 → 64,000 on haiku), so a catalog row whose ceiling exceeds
  the engine's is harmless.

This addresses reservation *rejections* and *clips*. It does **not** stop a reasoning-heavy model
from spending its whole allowance on reasoning and emitting nothing — that is governed by reasoning
effort, which today's `--thinking` never delivers to the engine (PR 4 sends `variant` instead).
Lowering the budget makes such a leg fail faster and cheaper; raising it gives the reasoning more
room; neither makes it produce output — but since #218 PR 3 the failure is at least *named*: the leg
ends `error` with an `OUTPUT_LENGTH:` reason instead of `complete` with nothing, or with its thinking
as the review (see [Troubleshooting](./troubleshooting.md#headless-leg-fails-with-output_length)).

---

## Routing

`routing.prefer` in `config.json` sets the global default gateway policy; `--gateway` (CLI) or the
MCP `gateway` param overrides it per call.

| Setting | Values | Default | Effect |
|---------|--------|---------|--------|
| `routing.prefer` (config.json) | `"direct"` \| `"openrouter"` | `"direct"` | Global default: prefer the direct provider key when one exists, or always prefer OpenRouter. |
| `--gateway <mode>` (CLI, all commands that resolve a model) | `auto` \| `direct` \| `openrouter` | `auto` | Per-call override. `auto` means direct-first (honors `routing.prefer`); `direct`/`openrouter` force a specific gateway for this call and error if the required key is missing. |
| `gateway` (MCP: `amicus_start`, `amicus_continue`, `amicus_fanout`) | `"auto"` \| `"direct"` \| `"openrouter"` | `"auto"` | Same semantics as `--gateway`, for MCP callers. |

There is no `amicus setup` wizard step for `routing.prefer` yet — set it by hand-editing
`~/.config/amicus/config.json`'s top-level `routing.prefer` field (see the config.json example
below).

**One-time migration notice.** If you hold both an OpenRouter key and a direct key for a vendor,
the first launch that resolves a bare canonical id to that vendor via direct-first auto-routing
prints a one-time notice, e.g.:

```
Routing openai via direct API (previously OpenRouter).
Set routing.prefer: "openrouter" (or use --gateway openrouter) to restore.
```

The notice fires once per vendor (tracked in `config.json`'s `routing.migration_notified` map) —
not on every launch, and not when you explicitly chose the gateway with `--gateway`. Set
`routing.prefer: "openrouter"` (or pass `--gateway openrouter` per call) to keep routing everything
through OpenRouter as before.

### Cost tier

`routing.tier` is your standing answer to "when a vendor offers several models, which end of its
range do you want by default?" It lives under `routing` for filing reasons only — **it does not
change how a call is routed**, and it is not a gateway knob. Its one and only effect is which row
the **cost-aware default picker** preselects (`src/utils/provider-default-picker.js`).

| Tier | Means | Example (Anthropic) |
|---|---|---|
| `"frontier"` | the most capable / most expensive of the vendor's line | `claude-opus-*` |
| `"balanced"` | the middle of the range — **the default** | `claude-sonnet-*` |
| `"economy"` | the cheapest of the line | `claude-haiku-*` |

Absent, misspelled or set to anything outside those three, the tier **coerces silently to
`"balanced"`** — a junk value never errors and never blocks a launch. Per-vendor tier resolution
lives in `src/utils/model-tiers.js`; when a vendor's catalog has no model matching the tier, the
picker falls back to the cheapest priced row, then the first row.

**`routing.tier` is hand-edited only.** No wizard step, CLI command or GUI control writes it — set
it yourself in `~/.config/amicus/config.json` (the same rule as [`maxCostPerMtok`](#cost-gate)
below):

```jsonc
{ "routing": { "prefer": "direct", "tier": "economy" } }
```

**Where the picker actually runs.** It offers you that vendor's models, priced, with the tier's pick
flagged as recommended, and writes your choice to `aliases.<vendor>` (seeding `config.default` when
that is still unset). Three surfaces reach it:

- `amicus key <provider> <key>` — after a successful **cloud**-vendor key save (local-provider
  bearer saves skip it).
- `amicus setup` — the readline wizard runs it once per keyed provider, in detection order.
- The **Electron setup window** — the same picker, with a family → model drill-down.

Non-interactively (`--json`, `--quiet`, or no TTY) the picker takes the recommended pick silently and
prints a one-line summary instead of prompting. It is also a graceful no-op for `openrouter`, which
is a gateway rather than a model vendor.

**`routing.tier_onboarded`** is bookkeeping, not a setting: a boolean written automatically the
first time `amicus start` prints the one-time tip pointing existing users at the picker
(`src/utils/start-helpers.js`). The tip only fires on an interactive run that already has a direct
provider key and has not used the picker yet, and the flag is set only when the line actually
printed — so a `--json` run never burns it. Don't hand-edit it; delete it if you want the tip once
more.

---

## Behavior

| Variable | Purpose | Default |
|----------|---------|---------|
| `LOG_LEVEL` | Log verbosity: `error` \| `warn` \| `info` \| `debug`. Keep `error` (the default) for clean LLM consumption; use `debug` to diagnose poll issues. | `error` |
| `AMICUS_CONFIG_DIR` | Override the entire config directory — keys, model catalog, session index. Useful for isolated test environments. | `~/.config/amicus` |
| `AMICUS_ENV_DIR` | Override just the `.env` file directory (keys only). The legacy `SIDECAR_ENV_DIR` name was removed in v2.0.0 — only `AMICUS_ENV_DIR` is read now. | `~/.config/amicus` (the config dir) |
| `AMICUS_FANOUT_MAX_LEGS` | Cap the number of concurrent legs in a single fanout wave. Protects against accidental runaway costs when `--models` is a long list. Non-positive or non-integer values fall back to the default. | `10` |
| `AMICUS_MCP_CLIENT` | Force the MCP server's `--client` value (`code-local`, `code-web`, or `cowork`) instead of auto-detecting it from the caller's MCP `initialize` handshake (`clientInfo.name`). Invalid values are ignored (with a warning) and detection proceeds normally. Note: `code-web` requires an explicit `--session-dir` and is not usable for MCP-spawned sessions. | auto-detected |
| `AMICUS_MAX_SESSIONS` | Maximum number of concurrent sessions the shared OpenCode server (`src/utils/shared-server.js`) will track before rejecting new ones. Renamed from `SIDECAR_MAX_SESSIONS` in v2.0.0. | `20` |
| `AMICUS_BASE_URL_NORMALIZE` | Set `0` to stop amicus from carrying a host-form `ANTHROPIC_BASE_URL` into the engine as `<value>/v1`. Host-form is the Anthropic-SDK convention (the SDK appends `/v1`); OpenCode treats the value as a full prefix, so unnormalized host-form 404s every direct-Anthropic leg. | `1` |

---

## Headless Poller Tuning

These variables control the polling loop that drives headless sessions. The defaults are conservative and work for almost all workloads. You only need them if you are running against unusually slow or fast model endpoints, or if you are building tooling on top of Amicus and need tighter completion detection.

**Which of these accept `0`, and which ignore it.** Five knobs in this table — the four `SETTLE` knobs (`AMICUS_USAGE_SETTLE_POLLS`, `AMICUS_USAGE_SETTLE_INTERVAL_MS`, `AMICUS_USAGE_SETTLE_CALL_TIMEOUT_MS`, `AMICUS_TOOL_SETTLE_GRACE_MS`) plus `AMICUS_NO_OUTPUT_BACKSTOP_MS` — read through `envNumber()` (`src/utils/env-num.js`), which honours an explicit, finite `0` — for those, `0` is a documented escape hatch and each row below says what it switches off (`AMICUS_NO_OUTPUT_BACKSTOP_MS` treats any negative value the same as `0`). **Every other variable in this table reads through `Number(env) || default`, so `0` is falsy and silently falls back to the default** — there is no way to set them to zero, and that is deliberate: a `0` poll interval would busy-loop and a `0` stall threshold would kill every leg on its first poll. In both families a blank, missing or non-finite value falls back to the default.

| Variable | Purpose | Default |
|----------|---------|---------|
| `AMICUS_POLL_INTERVAL_MS` | Delay between poll cycles in milliseconds. Lower values detect completion faster but add more API calls; raise it if you see rate-limit warnings from the OpenCode server. | `2000` |
| `AMICUS_POLL_CALL_TIMEOUT_MS` | Per-poll `getMessages` call timeout in milliseconds. If a poll call hangs longer than this, it is abandoned and counted as a consecutive failure. | `30000` |
| `AMICUS_STABLE_FINISHED_POLLS` | Number of consecutive idle polls required after the SDK reports the session as `completed` before the headless runner exits. A small number (2) guards against a race where the assistant message is flagged complete but trailing content is still streaming. | `2` |
| `AMICUS_STABLE_IDLE_POLLS` | Number of consecutive idle polls required when no explicit completion signal is received (approximately 60 s at the 2 s default). This is the fallback heuristic for models or SDK versions that don't emit a clean completion event. | `30` |
| `AMICUS_MAX_CONSECUTIVE_POLL_FAILURES` | Consecutive poll failures before the headless runner bails. At the 2 s interval this is approximately 30 s. Prevents a dead server from burning the full session timeout on futile polls. | `15` |
| `AMICUS_TOOL_CALL_STALL_MS` | How long a tool call may sit pending with **no** result and no output growth before the leg is failed with `Tool call stalled: <tool>` and its OpenCode session aborted. This is the wedge guard: it targets a leg producing nothing at all, and it is skipped while a tool-settle deferral is active (`AMICUS_TOOL_SETTLE_GRACE_MS` owns that decision instead, and ends in a completion rather than a failure). **`0` is ignored** — it falls back to the default rather than disabling the guard, because a `0` threshold would kill every leg on its first poll. There is no way to switch this off; raise it if you legitimately run very long single tool calls. | `180000` |
| `AMICUS_NO_OUTPUT_BACKSTOP_MS` | Fail a headless leg fast when the model has produced no output, reasoning, or tool calls for this long — the "accepted but not serving" class. Disarms permanently on the first sign of activity, so slow cold-prefill local models are unaffected. **Set `0` (or negative) to disable the backstop entirely** — silent legs then run to the ordinary timeout. | `300000` |
| `AMICUS_USAGE_SETTLE_POLLS` | How many extra `getMessages` reads run **after** a leg has already finished, to catch provider usage/cost that lands milliseconds after the completion signal (measured: real paid legs losing their cost by 29 ms and 155 ms). The loop breaks early as soon as every assistant message carries usage, so the common case is one extra read. **Set to `0` to disable the reconciliation entirely** — legs then report whatever usage was present at completion, which can be `$0` on a leg that really did cost money. | `3` |
| `AMICUS_USAGE_SETTLE_INTERVAL_MS` | Delay between those settle reads. **`0` is honoured and means no delay** — the reads run back to back. It does **not** disable the reconciliation (that is `AMICUS_USAGE_SETTLE_POLLS=0`); it only removes the gap between attempts. | `400` |
| `AMICUS_USAGE_SETTLE_CALL_TIMEOUT_MS` | Per-call deadline for a settle read and for the child-session (subagent) spend walk. Deliberately much tighter than `AMICUS_POLL_CALL_TIMEOUT_MS`: the leg is already finished, so a hung read must not add 30 s × 3 to a run's wall time. The effective value is the **smaller** of this and `AMICUS_POLL_CALL_TIMEOUT_MS`, so raising it above that has no effect. **`0` is honoured and means no timer is armed at all** — a hung settle read or subtree walk would then wait indefinitely. | `5000` |
| `AMICUS_TOOL_SETTLE_GRACE_MS` | How long a completion signal may be deferred while a tool call has not reached a terminal status, so a leg is not declared complete while its session is still working and billing. On exceeding the grace the leg **completes anyway** — its partial output is kept and it is never failed — carrying `toolSettleTimedOut` on its result, its `metadata.json` and its terminal `progress.json`; its OpenCode session is then **aborted** so it stops billing for output nobody will read, and whether that abort landed is recorded as `toolSettleAborted`. Set to `0` to disable the deferral entirely (and with it the abort) — pre-v4.4 behaviour. | `300000` |

---

## GUI and Debug

| Variable | Purpose | Default |
|----------|---------|---------|
| `AMICUS_GUI_LOAD_TIMEOUT_MS` | Maximum wait in milliseconds for the Electron UI to load before the load-failsafe fires. If the OpenCode web UI fails to respond within this window, Amicus shows a load-error page instead of hanging invisibly. | `15000` |
| `AMICUS_DEBUG_PORT` | Chrome DevTools Protocol port for the Electron window. Increment (e.g. `9223`) to avoid conflicts with a running Chrome or another Amicus window. | `9222` |
| `AMICUS_MOCK_UPDATE` | Mock the update-notification state for UI development. Values: `available` \| `updating` \| `success` \| `error`. Has no effect outside development. | *(unset)* |

---

## Process Lifecycle

Amicus processes self-terminate after a configurable idle period. The idle watchdog is active in all modes — headless, interactive, and shared-server.

| Variable | Purpose | Default |
|----------|---------|---------|
| `AMICUS_IDLE_TIMEOUT` | Blanket override for all modes (minutes; `0` = disabled). | *(mode default)* |
| `AMICUS_IDLE_TIMEOUT_HEADLESS` | Per-mode override for headless sessions (minutes). | `15` |
| `AMICUS_IDLE_TIMEOUT_INTERACTIVE` | Per-mode override for interactive sessions (minutes). | `60` |
| `AMICUS_IDLE_TIMEOUT_SERVER` | Per-mode override for shared-server sessions (minutes). | `30` |

Legacy `SIDECAR_IDLE_TIMEOUT*` names were removed in v2.0.0 — rename to the `AMICUS_IDLE_TIMEOUT*` forms above. See [docs/SHIMS.md](./SHIMS.md).

Set `AMICUS_IDLE_TIMEOUT=0` to disable self-termination entirely.

### Server startup

| Variable | Purpose | Default |
|----------|---------|---------|
| `AMICUS_SERVER_START_TIMEOUT_MS` | How long to wait for OpenCode to report it is listening before treating the start as failed. | `30000` on Windows, `15000` elsewhere |

A start that exceeds this window is treated as **transient** and retried on the same bounded schedule as an OpenCode database lock race (5 attempts, 250/500/1000/2000 ms), because retrying costs nothing but the backoff while a failed start costs a whole review seat.

Raise it if you see `Timeout waiting for server to start` on a slow box — a project directory on a sync-backed volume (OneDrive, Dropbox) with an antivirus scanner attached can push a cold OpenCode/SQLite start well past the default. Values of `0` or below are ignored rather than honored, since a zero start timeout fails every start instantly.

To see how much headroom you actually have, run with `LOG_LEVEL=debug` and look for the `OpenCode server started` line — it reports both `startMs` (what the start took) and `timeoutMs` (the ceiling it ran against):

```json
{"level":"debug","msg":"OpenCode server started","startMs":561,"timeoutMs":30000}
```

### Shared server

The shared-server mode (`AMICUS_SHARED_SERVER=1`, which is the default) lets multiple Amicus sessions reuse a single OpenCode Go binary process rather than spawning one per invocation, eliminating cold-start latency on the second and subsequent calls. Disable it with `AMICUS_SHARED_SERVER=0` if you need per-process isolation or are diagnosing a crash loop.

---

## Model Names Reference

Amicus does **not** ship a frozen model list. Aliases and validation resolve against a live catalog fetched from provider APIs and cached at `~/.config/amicus/model-catalog.json`.

```bash
amicus models                   # list the full catalog
amicus models --search gemini   # filter by substring (id + display name)
amicus models --refresh         # force-fetch from provider APIs (bypasses the 24h TTL)
amicus models --check           # audit your configured aliases against the catalog
```

**Catalog mechanics:**

- **24-hour TTL.** The catalog is fetched at most once per 24 hours. `amicus models --refresh` bypasses the TTL immediately.
- **Keyless fetch.** The initial catalog fetch works without an API key — provider model lists are public. Keys are only needed when you actually launch a session.
- **Floor-only refresh guard.** A background or offline `--refresh` can never clobber a good cache with an empty or truncated response. If the fresh fetch returns fewer models than the cached catalog, Amicus keeps the existing cache and logs a warning. This protects against transient network errors.
- **Catalog location.** `~/.config/amicus/model-catalog.json` — human-readable JSON; safe to inspect or delete (it rebuilds on next use).

**Spend ledger.** Every completed run/leg appends one row to `~/.config/amicus/spend-ledger.jsonl` (tokens + resolved cost). `amicus spend` reads it for a cross-run rollup; safe to delete (starts fresh, loses history only).

**Validation on launch.** `amicus start` and `amicus fanout` validate the model against the catalog before launching. For an explicit `--model` this is **blocking** (a typo'd model name fails fast with same-vendor suggestions); for a model inherited from a previous session via `continue`/`resume` it is **advisory** (a warning is printed but the session still starts). Skip catalog validation with `--no-validate-model`, or refresh the catalog with `amicus models --refresh`.

**`amicus models --check` in CI.** The command exits with the **number of stale aliases** (capped at 100) and prints replacement suggestions for each, so it integrates cleanly into a CI gate:

```bash
amicus models --check && echo "aliases ok"
```

---

## Model Aliases

Aliases are short names that resolve to full provider-prefixed model IDs. `amicus setup` seeds a curated default set (e.g. `gemini`, `gpt`, `opus`, `deepseek`) to the bare canonical form for direct-capable vendors. You add or override aliases with:

```bash
amicus setup --add-alias fast=google/gemini-3.1-flash-lite-preview
```

Aliases are stored in `~/.config/amicus/config.json`. The source of truth for what resolves on your machine is `amicus models`, not this document.

**Full-id passthrough.** You can always bypass aliases and specify a model by its full ID — bare `provider/model` (canonical, direct-first) or `openrouter/provider/model` (explicit force-OpenRouter override):

```bash
amicus start --model google/gemini-3-pro-preview --prompt "..."       # bare canonical, direct-first
amicus start --model anthropic/claude-opus-4 --prompt "..."           # bare canonical, direct-first
amicus start --model openrouter/google/gemini-3.1-flash-lite-preview --prompt "..."  # explicit override
```

---

## Where things live

New to Amicus's disk footprint? This section maps everything it reads and writes, verified against
the source that actually writes it — not aspirational. If a claim here and the code ever disagree,
the code wins; file an issue.

### The config tree

Everything lives under `~/.config/amicus/` (`getConfigDir()` in `src/utils/config.js`):

- **Override:** set `AMICUS_CONFIG_DIR` to relocate the entire tree — keys, catalog, session index,
  both ledgers. Useful for isolated test environments.
- **Legacy fallback — removed in v2.0.0:** `getConfigDir()` no longer falls back to
  `~/.config/sidecar/` at all. Through v1.x, config data was auto-migrated forward on every run
  (a one-time, non-destructive copy into `~/.config/amicus/` the first time it didn't exist yet),
  so most installs already have everything in the new location. If you jumped straight from a
  pre-rebrand install to v2.0.0 without ever running a v1.x build, copy `~/.config/sidecar/` to
  `~/.config/amicus/` by hand. See [docs/SHIMS.md](./SHIMS.md).

| File | Written by | Contains |
|---|---|---|
| `config.json` | `amicus setup` / `saveConfig()` (`src/utils/config.js`) | Top-level keys: `default` (your default model alias), `aliases` (your alias → `provider/model` map), `councils` (saved council presets, e.g. `councils.free`), `providers` (user-defined local / OpenAI-compatible providers added via `amicus provider add`, or by hand — id → `{type, baseURL, flavor, name?, apiKeyEnv?, pricing}`; see [`amicus provider`](./usage.md#amicus-provider)), `routing` (`prefer`: `"direct"` \| `"openrouter"`; `migration_notified`: per-vendor flags for the one-time direct-migration notice — see [Routing](#routing)). `0600` permissions. |
| `.env` | `amicus setup` / `amicus key` | API keys (`OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`). `0600` permissions. |
| `model-catalog.json` | `refreshCatalog()` (`src/utils/model-catalog.js`) | The cached provider model list, schema-versioned, with a **24-hour TTL**. Also carries refresh-outcome fields — `lastRefreshAttempt` and `lastRefreshError` — stamped on a *failed* refresh without touching the last-good `models`/`fetchedAt` (a bad fetch never clobbers a good cache). Human-readable JSON; safe to delete, it rebuilds on next use. |
| `sessions-index.json` | `session-index.js` (`recordSession`, written at session start) | A **global** map of `taskId → project path`, consulted only when a per-project session lookup misses (e.g. an MCP server whose cwd differs from where the session was created). Navigation aid only, never authoritative — a corrupt index degrades to "no entry," never a crash. |
| `council-ledger.jsonl` | `src/council/ledger.js` (`appendRun`), on every `council tally` | One row per distinct (council model, resolved executable) pair per run — findings raised, severity breakdown, street-cred, conformance. On an ordinary bench that is one row per council model; where **one alias** was served by one executable across more than one seat (a repeated alias, or a chair that is also a bench seat *when its chair and seat legs resolved to the same executable*) those seats collapse into a single row (v4.8), and an alias whose seats resolved differently gets one row per executable. Two *distinct* aliases sharing one resolution still write **two** rows — one per alias — which `amicus council stats` then aggregates into a single executable-keyed group. `runs` in `amicus council stats` counts distinct `meta.runId` values, not rows. At `LEDGER_SCHEMA_VERSION` **2** (v4.7 GOA-7), rows may also carry `resolvedModel` (the executable id that served); legacy-read, no migration — a row without one (all pre-v2 history, plus leg-less rows) aggregates under its alias, and a group is marked `legacy` only when every row in it lacks `resolvedModel`. Read back by `amicus council stats`. |
| `spend-ledger.jsonl` | `src/utils/spend-ledger.js` (`appendSpend`), new in Phase 16 | One row per completed run/leg — tokens + resolved cost. Read back by `amicus spend` for the cross-run rollup. Append is best-effort and can never fail the run it's recording; safe to delete (starts fresh, loses history only). |
| `packs/<name>.json` (v4.5) | `amicus pack save` (`src/pack/pack-store.js`) | One JSON file per saved policy pack — bench/model, chair/critic/lenses, options, and a briefing-template *reference*. Peer directory of `templates/` below. Safe to inspect, hand-edit, or delete individually; see [Policy packs](./usage.md#policy-packs). |
| `templates/<name>.md` (v4.5) | You, by hand (your editor is the manager) | User-authored briefing templates; a file here shadows a built-in of the same name. Amicus itself never writes into this directory — there is no `template save`/`rm`. See [Briefing templates](./usage.md#briefing-templates). |

**Tmp-file pattern.** Several writers (`model-catalog.json`, `sessions-index.json`, session
metadata) use an atomic write: a temp file named `.<target>.<pid>.<random>.tmp` is written
alongside the target, then renamed into place. A process killed between the write and the rename
leaves an orphaned `.tmp` file behind forever — harmless, but it accumulates. `amicus doctor --fix`
sweeps orphaned `sessions-index.json.*.tmp` files and, per-session, orphaned `.metadata.json.*.tmp`
files (the B09 class, ~30 write sites — both `<taskId>/` and `<taskId>/subagents/<id>/` levels
under the current project's `.claude/amicus_sessions/`); both sweeps only remove files older than
60 seconds, so a live writer's in-flight tmp file is never touched. `amicus doctor` (without
`--fix`) just reports the counts.

### Session storage

Session data is split across two different roots — don't confuse them:

**1. The session root** (`getSessionRoot()` in `src/environment.js`) — resolved per client, mostly
relevant for how Claude Code/Cowork discovers *your current conversation's* context to share:

| Client | Root |
|---|---|
| `code-local` (default on macOS, or when a `DISPLAY`/`WAYLAND_DISPLAY` is present) | `~/.claude/projects/<encoded-cwd>` — the cwd is encoded by replacing `/`, `\`, the drive-letter colon, and `_` with `-` (matches Claude Code's own scheme). |
| `cowork` | Platform-specific: macOS `~/Library/Application Support/Claude/local-agent-mode-sessions`, Windows `%APPDATA%\Claude\local-agent-mode-sessions`, Linux `~/.config/Claude/local-agent-mode-sessions`. |
| `code-web` | No default — `--session-dir` is **required**; there's nothing to resolve. |

**2. Amicus's own per-session directories** — where the actual session data (metadata, conversation,
summaries) is written. These live **project-scoped**, under `.claude/amicus_sessions/<taskId>/` in
the project directory (`SESSIONS_DIR` in `src/session-manager.js`; not under the session root
above). The legacy `.claude/sidecar_sessions/` dual-read was removed in v2.0.0 — that directory is
no longer read at all. If you have session history there, rename `.claude/sidecar_sessions/` to
`.claude/amicus_sessions/` to make it visible to `amicus list`/`amicus read` again. See
[docs/SHIMS.md](./SHIMS.md).

Per-session directory contents:

| File | Written by | Notes |
|---|---|---|
| `metadata.json` | `createSession()` | Model, project, briefing, mode, thinking level, status. Atomic write. |
| `conversation.jsonl` | Appended as the session runs | One JSON line per message. |
| `progress.json` | Headless polling | Live progress snapshot (message count, latest activity, stage) — read by `amicus status` and the fanout wave heartbeat. |
| `summary.md` | `saveSummary()`, on fold/completion | The fold output — what `amicus read <id>` returns by default. |
| `subagents/<subagentId>/` | Sub-agent sessions | Same shape as a top-level session (its own `metadata.json` + `conversation.jsonl`). |

**Fanout waves.** A wave (`amicus fanout`) gets its own session dir at `<waveId>` (same
`amicus_sessions/` root); each leg is a full sibling session dir named `<waveId>-1` through
`<waveId>-N` (`deriveLegIds()` in `src/sidecar/fanout.js`). The wave-heartbeat display reads each
leg's `progress.json`/`conversation.jsonl` directly. The wave dir itself holds:

```
<waveId>/
  metadata.json   # type "wave", legs: [...], plus a 200-char rendered briefing excerpt
  wave.json       # written on completion
  briefing.md     # the RENDERED prompt — the corpus `amicus list --search` matches against.
                  # Written by mcp-server.js BEFORE the child spawns (so an aborted wave
                  # stays searchable), and again by fanout.js:145 once the child runs
```

One more file appears only for an `amicus_fanout` wave whose prompt came from a **template**: a
sibling `briefing-input.md` holding the raw pre-render prompt handed to the spawned child, so the
child's own re-render stays byte-identical and `promptMeta.template` provenance survives.

### Log location + LOG_LEVEL

**Logs go to stderr only — there is no log file, anywhere, ever.** `src/utils/logger.js` writes every
entry as one JSON line via `console.error(...)`; stdout is reserved for command output (summaries,
`--json` documents). Setting `LOG_LEVEL=debug` does **not** create a file or a new destination — it
only lowers the filter threshold so `debug`-level entries (which are dropped by default) start
printing to the same stderr stream. If you want debug output captured, redirect it yourself:

```bash
LOG_LEVEL=debug amicus start --model gemini --prompt "test" --no-ui 2> debug.log
```

Levels, in order of decreasing verbosity: `debug` > `info` > `warn` > `error` (the default). Each
level includes everything above it.

### Config file format

`config.json`, commented (comments added for illustration — real JSON has none):

```jsonc
{
  // Default alias, resolved via `aliases` below when --model is omitted.
  "default": "gemini",

  // Short name -> full model id. Bare `provider/model` (canonical) routes direct-first;
  // `amicus setup` seeds direct-capable vendors this way automatically.
  // `amicus setup --add-alias name=provider/model` adds more.
  "aliases": {
    "gemini": "google/gemini-3-pro-preview",
    "gpt": "openai/gpt-5",
    "opus": "anthropic/claude-opus-4",
    "deepseek": "deepseek/deepseek-v3"
  },

  // Named council member lists, e.g. seeded by the Free OpenRouter council
  // wizard step. Run with `amicus fanout --council <name>`.
  "councils": {
    "free": ["free-gemini", "free-deepseek", "free-llama"]
  },

  // Gateway routing policy (see Routing above). `prefer` defaults to "direct"
  // when this key is absent entirely. `tier` is the cost-tier preference the
  // model picker preselects on ("frontier" | "balanced" | "economy"; anything
  // else coerces to "balanced") — hand-edited only, see Cost tier above.
  // `migration_notified` and `tier_onboarded` are both written automatically
  // when their one-time notices fire — don't hand-edit either.
  "routing": {
    "prefer": "direct",
    "tier": "balanced",
    "migration_notified": { "openai": true },
    "tier_onboarded": true
  },

  // User-defined local / OpenAI-compatible providers (v4.2) — written by
  // `amicus provider add`, or hand-edited. id -> normalized entry; `pricing`
  // defaults to {prompt: 0, completion: 0} (the $0 tier) when omitted.
  "providers": {
    "lmstudio": { "type": "openai-compatible", "baseURL": "http://127.0.0.1:1234/v1", "flavor": "lmstudio" },
    "ollama": { "type": "openai-compatible", "baseURL": "http://127.0.0.1:11434/v1", "flavor": "ollama" },
    "vllm-lab": {
      "type": "openai-compatible",
      "baseURL": "http://127.0.0.1:8000/v1",
      "flavor": "vllm",
      "apiKeyEnv": "VLLM_LAB_API_KEY",
      "pricing": { "prompt": 0.0000005, "completion": 0.0000015 }
    }
  },

  // v4.5: opt out of auto-opening the Council Workspace window on an
  // MCP-invoked `amicus_council_run` from Claude Code (local). Absent, null,
  // or anything other than a literal `false` leaves auto-open ON — only an
  // explicit `false` here disables it. See docs/council.md's Council
  // Workspace section for the full decision order (the `ui` MCP param and
  // the hard guards both take precedence over this key either way).
  "workspace": {
    "autoOpen": false
  }
}
```

A provider id may not shadow one of the five built-in vendors — `openrouter`, `google`, `openai`, `anthropic`, `deepseek` are rejected. `apiKeyEnv` names an env var — the token itself is never written to `config.json`, only to `.env` (`0600`), by `amicus provider add --bearer` or `amicus key <id> <token>`.

An alias whose value is missing, `null`, or not a string is stripped on the next `saveConfig()`
call, with a notice printed to stderr — `config.json` never accumulates dead aliases silently.

**Policy pack precedence.** A saved [policy pack](./usage.md#policy-packs) sits between your flags
and whatever this repo's existing default logic already was for a given knob — the resolution
order everywhere a pack applies is **flag > pack > config default > built-in default.** A pack only
fills in a value you did not type explicitly on the command line; everything below that layer is
unchanged from before packs existed. `--gateway` is the clearest example with all four tiers live
today: an explicit `--gateway` wins, then a pack's `options.gateway`, then `routing.prefer` in
`config.json` (this section, above), then the hard-coded `"auto"` fallback. Most other pack-fillable
options (`timeout`, `maxCost`, `agent`, `thinking`, …) have no `config.json`-level default yet — just
a hard-coded built-in (`DEFAULTS` in `src/cli.js`) — so for those the chain is effectively **flag >
pack > built-in** today. See [Policy packs](./usage.md#policy-packs) for the full per-kind field
reference.

### Cost gate

Two independent pre-flight guards run before a paid model call, both set via top-level
`config.json` keys that are **hand-edited only** — no wizard or CLI command writes them
(`src/sidecar/budget.js`):

- **`maxCostPerMtok`** — hard per-$/Mtok refusal threshold. Refuses any leg whose catalog
  price-per-Mtok exceeds the cap. Defaults to **60**; a non-positive value falls back to that
  default.
- **`maxCost`** — soft ceiling on the estimated total $ for the call. Absent, zero or negative all
  mean no ceiling.

> ⚠️ **`0` means the opposite thing on each key.** `maxCostPerMtok: 0` falls back to the default 60,
> so that guard stays **on**; `maxCost: 0` disables the ceiling entirely. Neither key is turned off
> by setting it to zero in the way you might expect — use `--no-cost-gate` (CLI) or
> `noCostGate` (`amicus_council_run`) to actually disable them.

```jsonc
{
  "maxCostPerMtok": 60,
  "maxCost": 5
}
```

On the CLI, `--max-cost <$>` overrides `maxCost` for that call, and `--no-cost-gate` disables both
guards (e.g. for an intentional o3 run).

Over MCP the per-call override depends on the tool. `amicus_council_run` takes its own `maxCost`
and `noCostGate` params, which forward to the spawned child exactly as the CLI flags do.
**`amicus_start` takes neither.** On that path `maxCostPerMtok` is config-only and nothing can turn
the gate off at all; the soft ceiling is the **effective** `maxCost` — the pack's if the run used a
pack that set one, otherwise the config's (`mcp-server.js:454`). Only one of those two values is in
effect, so raising the other one changes nothing. See
[Troubleshooting: MCP run fails with "budget gate refused the
run"](./troubleshooting.md#mcp-run-fails-with-budget-gate-refused-the-run).

### Uninstall instructions

`npm uninstall -g amicus` removes the package and its bin shims. It does **not** clean up everything
`amicus` and its postinstall left behind — remove these by hand if you want a full uninstall:

| What | Where | Left behind because |
|---|---|---|
| MCP registration in Claude Code | `~/.claude.json` → `mcpServers.amicus` | Written by `scripts/postinstall.js`'s `registerClaudeCode()`; npm has no hook into another app's config file. Remove the `amicus` key under `mcpServers`, or run `claude mcp remove amicus`. |
| MCP registration in Claude Desktop / Cowork | `claude_desktop_config.json` → `mcpServers.amicus` (macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`; Linux: `~/.config/claude/`) | Written by `registerClaudeDesktop()`, same reasoning. Remove the `amicus` key under `mcpServers` by hand. |
| The chat skill | `~/.claude/skills/sidecar/` | Copied by `installSkill()`. Delete the directory. |
| The council skill | `~/.claude/skills/second-opinion/` | Copied by `installCouncilSkill()`. Delete the directory — note `MODEL-NOTES.md` inside it is **your** reviewer-reliability data (seeded once, never overwritten by updates), so back it up first if you want to keep it. |
| The entire config tree | `~/.config/amicus/` (keys, config, catalog cache, both ledgers, session index) | Never touched by npm at all — it's outside the package's install footprint by design (so an uninstall doesn't silently delete your API keys or history). Delete the directory yourself: `rm -rf ~/.config/amicus` (macOS/Linux) or `Remove-Item -Recurse -Force $HOME\.config\amicus` (PowerShell). |
| Per-project session data | `<project>/.claude/amicus_sessions/` in every project you ran Amicus from | Also outside npm's footprint — it lives inside *your* project directories, not the package. Delete per-project if you want it gone. |

If you plan to reinstall later, leaving `~/.config/amicus/` in place is the point — your keys,
aliases, and council presets carry over untouched.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `electron` ^43.1.1 | Interactive Amicus window |
| `tiktoken` ^1.0.0 | Declared for future exact tokenization; **currently unused** — token sizing uses a length/4 heuristic (see `src/context.js`, `src/context-compression.js`). |
| `jest` ^29.0.0 | Testing framework |
| `eslint` ^8.0.0 | Code linting |
| `lint-staged` ^16.3.2 | Run linters on staged files |

The bundled **`opencode-ai`** engine (pinned to `1.18.15`, matched by `@opencode-ai/sdk`) installs automatically as a normal dependency — you don't install it separately. Its own postinstall lays down the per-platform binaries.

> **Legacy names.** Pre-rebrand `SIDECAR_*` environment variables were removed entirely in v2.0.0 — they are no longer read, with no warning. Rename to the `AMICUS_*` equivalents documented above. See [docs/SHIMS.md](./SHIMS.md) for the full removal record and rename table.
