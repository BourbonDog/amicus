# Council / Fan-out UX — MVP — Design

_Status: drafted 2026-06-24 (brainstormed with user; scope + 5 decisions locked via AskUserQuestion).
Source: `SecondBrain/output/amicus-council-fanout-ux-plan.md` (4-phase plan; this MVP = Phase 1 +
Phase 2's MCP tools + Phase 3's report renderer, the differentiator the user explicitly pulled in).
Cross-checked by a 3-model `amicus fanout` (gemini-3.1-pro / gpt-5.4 / deepseek-v4-pro). Base:
local `main` `2dc2e5f` (v1.2.0). Git policy: author + commit to local `main`; push deferred to
owner (WS-0..4 local-first cadence)._

## 1. Problem & intent

After WS-0..4 the council/fan-out **engine** is mature — concurrent legs, atomic `wave.json`,
versioned results with a `usage` block, layered cost telemetry, a budget gate, a deterministic
peers-only tally, `verdict.json`, and a reliability ledger. What is weak is **presentation**: the
data exists on disk but nothing makes it legible. Concrete gaps (re-grounded against `main`):

- **A wave is blind while it runs.** The only feedback is a generic stderr heartbeat
  `[amicus] still running… Ns elapsed` (`createHeartbeat`, `src/sidecar/session-utils.js:114`,
  called from `src/sidecar/fanout.js:226`). Per-leg `progress.json` **is** written
  (`src/sidecar/progress.js:97`) and `readProgress` (`progress.js:114`) can summarize
  message-count / latest-tool / stall — but the wave heartbeat never reads it, and MCP
  `amicus_status` (`src/mcp-server.js:264`) reports only coarse `complete/running` per leg.
- **Cost is invisible in human output.** Every leg and the wave carry a resolved `usage.cost`
  with a `source` tag (`src/utils/pricing.js:52` `resolveLegCost`, `:72` `sumWaveUsage`), but
  `formatWaveHuman` (`src/sidecar/fanout-output.js:23`) prints only status + duration, and the
  council renderers (`src/cli-handlers-council.js:35/40`) print none. The WS-2 telemetry the
  budget gate depends on is buried in JSON.
- **The deterministic council spine is unreachable over MCP.** `src/council/{tally,verdict,
  ledger}.js` are exposed only through `amicus council tally|stats` (Bash). In a Cowork/no-Bash
  environment the skill can fan out via MCP but cannot reach the scoring spine.
- **Disagreement is data, not a view.** `tally()` (`src/council/tally.js:76`) produces tiers +
  basis a/d/n + street-cred, but the only built-in render is four tier *counts* on one line. The
  adjudication grid + street-cred table exist solely as markdown the skill hand-assembles per run
  (`crossreview-matrix.md`, `report.md`). There is no reusable, shareable renderer.

Intent: **make the spine visible, reachable over MCP, and renderable into a shareable artifact** —
all as presentation/wrappers over data WS-2/3/4 already persist, with **zero schema change**.

## 2. Locked decisions (from brainstorm)

1. **Scope = four units: A live progress + B cost-in-output + C council MCP tools + D verdict/
   disagreement report renderer.** The user pulled the Phase-3 differentiator (D) into the MVP.
2. **Verdict view is report-first** — a standalone **HTML/MD** artifact (`amicus council report`),
   NOT an Electron view. The Electron council dashboard stays deferred (a later phase); D is the
   data/render layer it would eventually reuse.
3. **Schemas stay layered.** `wave.json` (`SCHEMA_VERSION 2`) and `verdict.json`
   (`VERDICT_SCHEMA_VERSION 1`) are not unified; the report **reads both** and adds no new
   persisted schema.
4. **The report is read-only over existing artifacts** — it consumes a `verdict.json` / tally
   record / `wave.json`; it does not re-run models or mutate persisted files.
5. **Judgment + anonymization stay in Claude** (per `COUNCIL-DESIGN.md`). D renders deterministic
   data only; it does not score, anonymize, or synthesize.

Out of scope (later phases): council presets / saved bench, retry-subset, the Electron dashboard,
structured Stage-4 decision capture.

## 3. Architecture

Four units. A is engine + CLI + MCP; B is CLI-only; C is MCP-only (wraps existing pure functions);
D is a new pure renderer + a CLI subcommand. No change to the council trust spine, the headless
completion logic, or any persisted schema.

| Unit | New / changed code | Interface |
|---|---|---|
| A. Wave-aware live progress | `src/sidecar/session-utils.js` (heartbeat), `src/mcp-server.js` (status branch); reads `src/sidecar/progress.js` `readProgress` | per-leg rollup line: `model · stage · msgs · last-tool · elapsed · stalled?`; `amicus_status` legs gain `latestActivity` + `stalled` |
| B. Cost-in-output | `src/sidecar/fanout-output.js` (`formatWaveHuman`), `src/cli-handlers-council.js` (`renderRecord`/`renderStats`) | cost column + wave total; reuse `pricing.js` `source` tags |
| C. Council MCP tools | NEW wrappers in `src/mcp-tools.js` + registration in `src/mcp-server.js` over `src/council/{tally,verdict,ledger}.js` | `amicus_council_tally`, `amicus_council_stats`, `amicus_verdict` (zod-validated) |
| D. Verdict/disagreement report | NEW `src/council/report.js` (pure); `amicus council report` in `src/cli-handlers-council.js` + `bin/amicus.js` switch | `buildReport({wave, tallyRecord, verdict}, {format}) → string`; `amicus council report <verdict.json\|waveId> [--md\|--html]` |

### Unit A — Wave-aware live progress

**Root cause:** the heartbeat is wave-level, not leg-level. `createHeartbeat`
(`session-utils.js:114`) emits a single elapsed line; it never opens the per-leg `progress.json`
files the legs already write (`progress.js:97`).

**Approach:** give the fan-out heartbeat a per-leg rollup callback. During a wave, on each tick,
read each leg's `progress.json` via `readProgress` (`progress.js:114`) and print one compact line
per leg (`model · stage · msgs · last-tool · Ns · ⏳stalled`). Mirror the same per-leg
`latestActivity` + `stalled` fields into the MCP `amicus_status` wave branch (`mcp-server.js:264`)
so the agent polling loop sees them too. Pure data already on disk → low risk; the only new code is
the rollup formatter + status enrichment. Degrade gracefully when a leg's `progress.json` is absent
(show `starting…`).

### Unit B — Cost/usage in human output

`formatWaveHuman` (`fanout-output.js:23`) gains a per-leg cost cell
(`leg.usage.cost.amount` + a `source` marker: `~` estimated, `?` unknown) and a **wave total**
from `wave.usage` (`sumWaveUsage`, `pricing.js:72`). `renderRecord`/`renderStats`
(`cli-handlers-council.js:35/40`) gain a cost line. No new computation — purely surfacing WS-2
data. Never imply precision the `source` tag doesn't support.

### Unit C — Council MCP tools

Thin MCP wrappers, one per existing pure function, mirroring `cli-handlers-council.js`:
`amicus_council_tally` (over `tally()`), `amicus_council_stats` (over `deriveReliability`),
`amicus_verdict` (over `buildVerdict`). Each takes the same inputs the CLI handler assembles,
returns the structured result, and is zod-validated in `src/mcp-tools.js` + registered in
`src/mcp-server.js`. No new logic; this removes the council flow's only hard Bash dependency.

### Unit D — Verdict / disagreement report renderer (the differentiator)

**NEW pure module `src/council/report.js`:** `buildReport({wave, tallyRecord, verdict}, {format})`
→ a single self-contained string. Sections:
- **Adjudication matrix** — finding × judge, each cell `agree / dispute / neutral` (from the tally
  basis), tier-colored (Confirmed / Contested / Disputed / Singleton).
- **Street-cred table** — peers-only per model (the ledger-facing number).
- **Tier groupings** — findings bucketed by tier, Disputed-first.
- **Per-model cost** — from `wave.usage` (ties D back to B).

`format: 'md' | 'html'`. **MD** is the default (cheap, diff-able, PR/Slack-pastable); **HTML** is a
self-contained file (inline CSS, no server) for sharing/archiving. Surfaced as
`amicus council report <verdict.json|waveId> [--md|--html]`, dispatched from the `bin/amicus.js`
`council` switch into `cli-handlers-council.js` (`--json` failures via `failJson`). Read-only;
adds no persisted schema. The second-opinion skill replaces its hand-built `crossreview-matrix.md`
/ `report.md` assembly with a call to this renderer.

## 4. Testing

TDD per unit (house pattern). Unit tests: A — rollup formatter over fixture `progress.json` files
(+ stall/missing-file cases) and the `amicus_status` enrichment; B — cost cells incl.
`estimated`/`unknown`/null source; C — each wrapper returns the same shape as its CLI analog
(zod-valid); D — **golden-fixture** render (reuse the WS-3 av-receiver tally fixture) for both `md`
and `html`, asserting the matrix, street-cred, tiers, and cost. Integration: a real-LLM **2-model
smoke** (the owner's setup works — the planning fan-out cost $0.10) verifying live per-leg progress
during the wave and the cost line in `formatWaveHuman`, then `amicus council report` on the
resulting verdict. Gates: `npm test`, `lint`, `check:secrets`, `check:sizes`, `generate-docs:check`.

## 5. Acceptance criteria

1. During a live wave, the CLI shows a per-leg progress line (model · stage · msgs · stall) and MCP
   `amicus_status` legs carry `latestActivity` + `stalled`.
2. `amicus fanout` human output shows per-leg cost + a wave total with correct `source` tags;
   `amicus council tally|stats` show cost.
3. `amicus_council_tally`, `amicus_council_stats`, `amicus_verdict` work over MCP with no Bash.
4. `amicus council report <…> --md|--html` renders the adjudication matrix + street-cred + tiers +
   cost from existing artifacts, with zero schema change.
5. Full suite green; lint + secrets + sizes + docs gates clean; real-LLM smoke passes.

## 6. Risks & follow-ups

- **Heartbeat noise:** per-leg rollup must stay terse (one line/leg) and milestone-based — NOT a
  token firehose (all three council models flagged this). Keep the tick interval as-is.
- **Report scope creep:** D renders only; resist adding scoring/anonymization (decision 5).
- **Follow-ups (not this MVP):** council presets, retry-subset (needs durable run/wave lineage),
  the Electron dashboard, structured Stage-4 decision capture. The report module is intentionally
  the data layer those later surfaces reuse.
