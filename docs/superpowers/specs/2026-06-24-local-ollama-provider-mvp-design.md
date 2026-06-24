# Local / OpenAI-compatible Provider — MVP — Design

_Status: drafted 2026-06-24 (brainstormed with user; scope + 5 decisions locked via AskUserQuestion).
Source: `SecondBrain/output/amicus-local-ollama-provider-research.md` (multi-subagent research +
binary grep of the bundled OpenCode). Base: local `main` `2dc2e5f` (v1.2.0). Git policy: author +
commit to local `main`; push deferred to owner._

## 1. Problem & intent

Amicus has no way to run a **local** model (Ollama, LM Studio) or any **OpenAI-compatible**
endpoint (Groq, Together, Fireworks, vLLM). That blocks free/$0 fan-outs and councils on owned
hardware, and offline/privacy use. The good news, all **grounded** against `main` v1.2.0:

- **OpenCode already does the execution.** A grep of the bundled binary
  (`node_modules/opencode-windows-x64/bin/opencode.exe`) shows `@ai-sdk/openai-compatible` (×54),
  `baseURL` (×278), and a literal built-in provider
  `lmstudio: { npm: "@ai-sdk/openai-compatible", api: "http://127.0.0.1:1234/v1" }` plus
  `ollama-cloud`. The SDK adapter is bundled and reads `options.baseURL`. **Amicus implements no
  HTTP client and no signing.**
- **The launch gate already passes no-key providers.** `validateApiKey(model)`
  (`src/utils/validators.js:241-274`) returns `{valid:true}` for any provider not in
  `PROVIDER_KEY_MAP` (lines 249-251), so `ollama/llama3.1` would route **today**.
  `parseModelString` (`src/opencode-client.js:39`) and `resolveModel` (`src/utils/config.js:104`)
  have no provider whitelist.

What's missing is purely **config plumbing**: there is nowhere to put a `baseURL`, and
`buildProviderModels` never emits the `npm` + `options.baseURL` block OpenCode needs.

The deeper structural issue: the provider enum is **hand-duplicated across 5 tables** — every
provider currently *requires a single secret in one HTTP header*, which a local provider violates
(it needs a configurable `baseURL` and **no** key). Adding `deepseek` required touching all five
(`PROVIDER_ENV_MAP` `api-key-store.js:11`, `VALIDATION_ENDPOINTS` `api-key-validation.js:8`,
`PROVIDER_FETCH_CONFIG`/`PROVIDER_FAMILY_NAMES` `model-fetcher.js:28/19`, `PROVIDER_KEY_MAP`
`validators.js:22`, the wizard `PROVIDERS` `electron/setup-ui-keys.js:10`).

Intent: add a **generic OpenAI-compatible provider class** behind a **provider `type` discriminator**
(`'apiKey' | 'openai-compatible'`), with Ollama and LM Studio as built-in instances and a
custom-baseURL option — building the abstraction once on the cheap local case so a future Bedrock
(`type: 'aws'`) becomes "just another type."

## 2. Locked decisions (from brainstorm)

1. **Scope = generic provider + `type` discriminator** (not a minimal hardcode). Introduce a single
   provider registry that carries `type`; ship `ollama` (`http://localhost:11434/v1`) and
   `lmstudio` (`http://localhost:1234/v1`) instances plus a generic custom-baseURL provider.
2. **`baseURL` lives in `.env`** (e.g. `OLLAMA_BASE_URL`, per-provider) — lowest friction, reuses
   `loadCredentials`' env→`process.env` flow. (A `config.json` section was the cleaner-but-heavier
   alternative; deferred.)
3. **Live model discovery** (`/api/tags` for Ollama → `/v1/models` generic), with a **fallback to a
   small manual list** when the server is unreachable.
4. **Additive, non-breaking.** The 5 existing key providers keep working unchanged; the new
   registry is the single source of truth the duplicated tables derive from (or, minimally, gain a
   local entry) — no behavior change for `apiKey` providers.
5. **Bedrock is out of scope** but the discriminator is designed to admit `type: 'aws'` later; the
   `type` field and registry shape must not foreclose it.

Out of scope: Bedrock itself, auto-`ollama pull`, per-model tool-capability gating (a follow-up).

## 3. Architecture

| Unit | New / changed code | Purpose |
|---|---|---|
| A. Provider registry + `type` | NEW `src/utils/providers.js`; derive/extend the 5 tables | single source of truth; `type:'apiKey'\|'openai-compatible'`; entries carry `{id, npm?, defaultBaseURL?, keyless?}` |
| B. `baseURL` storage + projection | `src/utils/api-key-store.js`, `src/utils/env-loader.js` | store a non-secret `*_BASE_URL` in `.env`; project it into `process.env` |
| C. `buildProviderModels` wiring | `src/utils/config.js:248-267` | for an `openai-compatible` provider, emit `providers[id].npm='@ai-sdk/openai-compatible'` + `options.baseURL` — **the one change that makes models run** |
| D. Model discovery + http fix | `src/utils/model-fetcher.js` | `/api/tags`→`/v1/models`; **add `http` branch** (line 8 hardcodes `https` → local discovery silently `[]`); force-include keyless provider in `providersToFetch` (`:141-145`); `PROVIDER_FAMILY_NAMES` += Ollama/Local |
| E. Wizard | `electron/setup-ui-keys.js`, `electron/ipc-setup.js` | a `baseURL` **text** field (not the password field) + a "test connection" that pings `/v1/models` instead of validating a key |
| F. Null-pricing verification | `src/utils/pricing.js`, `src/sidecar/budget.js` (tests) | confirm `pricing:null` / `cost=$0` is tolerated end-to-end (cost `source:'unknown'`, usage still captured) |

### Unit A — Provider registry + `type` discriminator

**NEW `src/utils/providers.js`:** the authoritative `PROVIDERS` list. Each entry:
`{ id, type:'apiKey'|'openai-compatible', envVar?, npm?, defaultBaseURL?, keyless?, family }`.
The five existing tables either **derive** from this (preferred) or, as a smaller first step, each
gains the local entries — but every consumer that does `PROVIDER_ENV_MAP[provider] → single string`
must branch on `type`. The deepseek addition is the cautionary precedent: a partial migration
yields a provider that "exists" but can't authenticate or shows no models.

### Unit C — The one change that makes models run

`buildProviderModels` (`config.js:248-267`) today emits only
`{ providerID: { models: { modelID: {} } } }` and is consumed at `opencode-client.js:374-375`
(`config.provider = buildProviderModels()`). For an `openai-compatible` provider it must
**additionally** set `providers[id].npm = '@ai-sdk/openai-compatible'` and
`providers[id].options = { baseURL }`. Nothing else on the OpenCode side is needed — the adapter is
bundled.

### Unit D — Discovery + the silent-failure fix

`fetchModelsFromProvider` (`model-fetcher.js:96`) uses `require('https')` (line 8). Local servers
are `http://localhost` → discovery would **silently return `[]`** (the catch swallows it). Add a
scheme branch (`http` vs `https`). Discovery strategy: Ollama-native `GET {baseURL}/api/tags`
(`{models:[{name}]}` → `ollama/<name>`) preferred; else `GET {baseURL}/v1/models`
(`{data:[{id}]}`, identical to the existing `openai` normalizer). Force-include the keyless
provider in `providersToFetch` (mirror the `openrouter`/`anthropic` force-include at `:141-145`).
On unreachable server, fall back to a small manual model list and a clear actionable error
("Ollama not running on :11434 — run `ollama serve`" / "model not pulled — run `ollama pull <id>`").

## 4. Testing

TDD per unit. Unit tests: A — registry shape + `type` branching, and that the 5 derived/extended
tables still describe the existing 5 key providers unchanged; B — `.env` round-trip of a
`*_BASE_URL` + env projection; C — `buildProviderModels` emits `npm` + `options.baseURL` for an
`openai-compatible` provider and the unchanged shape for `apiKey` providers; D — `http` branch,
`/api/tags` + `/v1/models` normalizers, force-include, unreachable→fallback; F — a fan-out/budget
path with `pricing:null`/`cost=$0` does not throw and tags `source:'unknown'`.

**Real-LLM smoke caveat:** end-to-end verification needs a **running Ollama or LM Studio** server,
which is likely **not installed on this machine**. The spec therefore relies on unit tests + a
**documented manual smoke** the owner runs locally (`ollama serve` + `ollama pull llama3.1`, then
`amicus start --no-ui --model ollama/llama3.1 --prompt "hi"` and a 2-leg `amicus fanout`). The
bundled OpenCode `lmstudio`/`ollama-cloud` providers are the upstream reference that this wiring
targets. Gates: `npm test`, `lint`, `check:secrets`, `check:sizes`, `generate-docs:check`.

## 5. Acceptance criteria

1. `ollama/<model>` and `lmstudio/<model>` (or a custom-baseURL provider/model) launch via the
   bundled OpenCode using a stored `baseURL`, with **no API key**.
2. `src/utils/providers.js` is the single source of truth; the 5 existing key providers behave
   identically (no regression); a local provider carries `type:'openai-compatible'` + `baseURL`.
3. Model discovery returns models from a running local server over **http** (no silent `[]`); an
   unreachable server yields the manual-list fallback + an actionable message.
4. The wizard offers a `baseURL` text field + test-connection for local providers (password field
   only for `apiKey` providers).
5. Cost/budget/usage tolerate `pricing:null` / `cost=$0` end-to-end.
6. Full suite green; lint + secrets + sizes + docs gates clean; documented manual smoke recipe
   included.

## 6. Risks & follow-ups

- **5-table duplication:** prefer the derive-from-registry refactor; a partial migration is the
  main risk (the deepseek lesson). Treat the registry + its consumers as one atomic change.
- **Tool-use on small local models is unreliable** (research: model-dependent). MVP advertises
  local models for chat/council prose; per-model capability detection via Ollama `/api/show`
  `capabilities[]` (and graceful degrade) is a **follow-up** before sending tools to local legs.
- **`.env` for a non-secret URL** is semantically loose (it's chmod-0600) but lowest-friction;
  revisit `config.json` if a second config dimension appears.
- **Bedrock** reuses this exact `type` machinery later (`type:'aws'` carrying `{region, creds}`) —
  do not foreclose it in the registry shape.
