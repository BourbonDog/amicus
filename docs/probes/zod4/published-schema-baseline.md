# zod 3 → 4: the published MCP schema, before and after

**Measured 2026-11-10, for the v4.15.0 release (PR #296).** The release moves `zod` from
`^3.0.0` (3.25.76) to `^4.6.7`. This file is the committed **before-image**: once the release
merges, zod 3 is gone from the tree and the claim "the bump changed exactly these four
properties" would otherwise be unverifiable prose. The council on PR #296 (round 3, deepseek
D1) asked for exactly this, and it was right to.

## Why a dependency bump can move a public interface at all

`@modelcontextprotocol/sdk` converts zod schemas to JSON Schema with **a different library per
zod major**, chosen in its own `server/zod-json-schema-compat.js`:

| zod major | converter |
| --- | --- |
| v3 | `zod-to-json-schema` (an SDK dependency, `^3.25.1`) |
| v4 | `zod/v4-mini`'s `toJSONSchema` |

So the bytes a client receives from `tools/list` can change with **no amicus source change at
all**. `src/mcp-tools.js` is untouched by this release.

## Method

The v3 side cannot be measured from the post-bump tree, so it was measured in a throwaway
project against the same converter the SDK uses:

```sh
mkdir zod3-compare && cd zod3-compare
npm init -y
npm install --ignore-scripts zod@3.25.76 zod-to-json-schema@3.25.1
```

```js
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');
zodToJsonSchema(z.record(z.any()), { target: 'jsonSchema7' });
```

The v4 side was read off the **real wire**, not a converter call: a `tools/list` request to
`node bin/amicus.js mcp` over stdio. That is the same path
`tests/mcp-protocol.integration.test.js` exercises.

## Measured

`$schema` differs only because `zodToJsonSchema` stamps it on a standalone conversion; it is
not a per-property difference and does not appear inside a tool's `inputSchema`.

| shape | zod 3.25.76 | zod 4.6.7 |
| --- | --- | --- |
| `z.record(z.any())` | `{"type":"object","additionalProperties":{}}` | `{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}` |
| `z.array(z.record(z.any()))` | `{"type":"array","items":{"type":"object","additionalProperties":{}}}` | same, `items` gains `propertyNames` |
| `z.record(z.any()).nullable()` | `{"anyOf":[{"type":"object","additionalProperties":{}},{"type":"null"}]}` | same, `anyOf[0]` gains `propertyNames` |
| `z.string().regex(...)` | `{"type":"string","pattern":"..."}` | identical |
| `z.boolean()` | `{"type":"boolean"}` | identical |
| `z.enum([...])` | `{"type":"string","enum":[...]}` | identical |

**Cause.** zod 3's single-argument `z.record(valueType)` carried no key schema, so there was
nothing for the converter to emit. zod 4 models the key type explicitly, so it emits
`propertyNames: {"type":"string"}`.

## The four affected published properties

All four are the `z.record(z.any())` call sites in `src/mcp-tools.js`:

| published property | source |
| --- | --- |
| `amicus_verdict.record` | `src/mcp-tools.js` — `z.record(z.any())` |
| `amicus_verdict.seatLoss` | `z.record(z.any()).nullable().optional()` |
| `amicus_verdict.degrades` | `z.array(z.record(z.any())).nullable().optional()` |
| `amicus_council_tally.runStats` | `z.array(z.record(z.any())).optional()` |

Nothing else on the surface moved. Every other published shape is byte-identical.

> An earlier revision of the release notes said **three** of these and omitted `degrades`. The
> count came from a truncated `grep` and was simply wrong; the whole-surface fixture is what
> surfaced the fourth. That is the argument for pinning the whole surface rather than the
> properties someone thought to list.

## Is it a breaking change?

No. A JSON object's keys are **always** strings, so `propertyNames: {"type":"string"}` rejects
nothing that was previously accepted — it restates a guarantee the format already makes. No
request that validated under 4.14.3 fails under 4.15.0.

It is still a real change to amicus's only machine-facing interface, which is why the release
is a **minor** rather than a patch, and why it is documented rather than asserted away.

## How the next one gets caught

`tests/fixtures/mcp-tools-list.published.json` pins the whole `tools/list` surface as a client
receives it, asserted by `tests/mcp-protocol.integration.test.js` on the keyless rail and
regenerated deliberately with `node scripts/capture-mcp-schema.js`. Descriptions are stripped
(several interpolate the caller's alias list and so differ per machine); every other field,
`execution` included, is kept, so a newly emitted field cannot pass unnoticed.
