# JSON output schemas

Every JSON document Amicus emits carries a versioned envelope: `{ "schemaVersion": <n>, "type": "<doc-type>", … }`.
Published JSON Schemas (draft 2020-12) live in [`schemas/`](../schemas/) at the repo root and ship in the npm tarball —
validate any `--json` output with them (e.g. `ajv validate -s node_modules/amicus/schemas/run.schema.json -d out.json`).

**Stability contract:** within a `schemaVersion`, fields are only ever ADDED. Any rename/removal bumps the family's version.
Schemas leave `additionalProperties` open for exactly this reason — a doc with extra fields still validates.

## Families

| Family | schemaVersion | Types |
|---|---|---|
| result | 2 | `run`, `wave`, `abort`, `error`, `spend`, `model-catalog`, `alias-audit`, `doctor` |
| council | 2 (v4.0 bumped 1→2) | `council-tally`, `council-verdict`, `council-stats`, `council-validate`, `council-run` |
| observability | 1 | `event`, `progress` (v4.3, spec §4.2 — the events stream and the progress snapshot) |

`wave-live` and `run-live` are not a new family: they're the existing **result family (v2)** `wave`/`run` docs, composed at read time with an additive `view:'live'` marker — `amicus_status` stamps `schemaVersion: 2` (`stampEnvelope`) exactly as the durable `wave.json`/per-leg `run` docs do. `council-run-live` is the composed council live status payload (`buildCouncilStatusPayload`) — a point-in-time `amicus_status` snapshot like the other live/ack payloads in [Documented exclusions](#documented-exclusions), not a versioned result doc — and carries **no `schemaVersion` key at all**.

## Files

| Schema | Emitted by |
|---|---|
| [`run.schema.json`](../schemas/run.schema.json) | `start`/`read`/`resume`/`continue --json`; every wave leg |
| [`wave.schema.json`](../schemas/wave.schema.json) | `fanout --json`; `wave.json` |
| [`abort.schema.json`](../schemas/abort.schema.json) | `abort <id|--all> --json` |
| [`error.schema.json`](../schemas/error.schema.json) | every `--json` pre-flight/validation/route failure (stdout, exit 1) and every MCP error tool-text |
| [`spend.schema.json`](../schemas/spend.schema.json) | `spend --json` |
| [`model-catalog.schema.json`](../schemas/model-catalog.schema.json) | `models --json` |
| [`alias-audit.schema.json`](../schemas/alias-audit.schema.json) | `models --check --json` |
| [`doctor.schema.json`](../schemas/doctor.schema.json) | `doctor --json` |
| [`council-tally.schema.json`](../schemas/council-tally.schema.json) | `council tally --json`; `amicus_council_tally` |
| [`council-verdict.schema.json`](../schemas/council-verdict.schema.json) | `council verdict --json`; `amicus_verdict`; `verdict.json` |
| [`council-stats.schema.json`](../schemas/council-stats.schema.json) | `council stats --json`; `amicus_council_stats` |
| [`council-validate.schema.json`](../schemas/council-validate.schema.json) | `council validate --json` |
| [`council-run.schema.json`](../schemas/council-run.schema.json) | the headless engine's `run.json` manifest (`amicus council run` — lands after the trust-foundation phase; the schema is published ahead as the contract) |
| [`event.schema.json`](../schemas/event.schema.json) | `events.jsonl` lines — one append-only file per wave dir / council-run dir, milestone events appended by fan-out waves and council runs (wave/leg/run/stage lifecycle) |
| [`progress.schema.json`](../schemas/progress.schema.json) | `progress.json` — a leg/solo session's lifecycle stage + raw per-leg usage snapshot |
| [`wave-live.schema.json`](../schemas/wave-live.schema.json) | `amicus_status` on a running wave — the composed doc, `view:'live'` + per-leg read-time usage |
| [`run-live.schema.json`](../schemas/run-live.schema.json) | `amicus_status` on a running single session — the composed doc, `view:'live'` + read-time usage |
| [`council-run-live.schema.json`](../schemas/council-run-live.schema.json) | `amicus_status` on a running council run (`buildCouncilStatusPayload`) — the composed doc, `view:'live'` + read-time usage |

## Breaking change at v4.0 — `council stats --json`

Pre-4.0, `council stats --json` (and the `amicus_council_stats` MCP tool) emitted a **bare array** of per-model rows.
v4.0 wraps it: `{ "schemaVersion": 2, "type": "council-stats", "models": [ … ] }`. The row shape is unchanged.
This is the one non-additive shape change in the envelope unification; migrate `doc[0]` → `doc.models[0]`.

## Documented exclusions

- **The two JSONL ledgers** (`council-ledger.jsonl`, `spend-ledger.jsonl`): internal append-only storage, each stays at its own v1 row format (`SPEND_LEDGER_SCHEMA_VERSION` is 1, unrelated to and unbumped by the result/council envelope versions above) — not an emitted/published doc. `spend.schema.json` (the `amicus spend --json` output) is the published, versioned doc built *from* `spend-ledger.jsonl` rows — the ledger row shape itself is not published.
- **`amicus_list`** (MCP): returns a bare JSON array of session rows; a wrap would be a second breaking change and is deliberately not taken.
- **`setup` / `update` / `key`**: interactive-only commands with no `--json` mode.
- **MCP acks and live-status snapshots** (start/resume/continue/abort acks, `amicus_status`/`amicus_wait` bodies): carry the envelope keys with subject-family types (`run`/`wave`/`abort`) but are point-in-time snapshots, not the durable result docs the published schemas describe.
- **Fencing:** MCP council tool text arrives wrapped in the `<untrusted_sidecar_output>` fence with the JSON intact inside; CLI `--json` stdout is never fenced.
