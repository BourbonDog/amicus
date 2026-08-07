# `pack save --version` — a documented flag that can never arrive

**Date:** 2026-08-07
**Status:** design approved, pre-implementation
**Class:** accepted-and-silently-ignored (third instance; see Precedent)

---

## The bug

```bash
amicus pack save mybench --kind council --bench a,b --version 2.0.0
```

Exits 0. Writes no pack. Prints the amicus version banner instead.

Confirmed live during v4.7 PR5 review. Pre-existing — not introduced by the v4.7 sweep.

## Root cause chain

1. `version` is in `BOOLEAN_FLAGS` ([src/cli.js:139](../../../src/cli.js)), so `parseArgs` sets
   `args.version = true` and drops the semver `2.0.0` into positionals.
2. [bin/amicus.js:90](../../../bin/amicus.js) intercepts `args.version` and prints the banner
   **before** command dispatch, so `handlePack` never runs.
3. `--version=2.0.0` fails identically: `isBooleanFlag` is tested at
   [src/cli.js:65](../../../src/cli.js), ahead of the inline-value branch at `:71`, so the
   inline value is parsed off the token and then discarded.
4. Meanwhile [src/cli-handlers-pack.js:26](../../../src/cli-handlers-pack.js) reads
   `args.version || '1.0.0'` — the handler is written expecting a value it can never receive.
   Same at `:117` for the `--from-run` path.
5. Both the pre- and post-v4.7-PR5 help text documents `--version <semver>` as a real option
   (the `pack:` block in `USAGE_COMMAND_BLOCKS`), and `docs/usage.md`'s pack section describes
   the version semantics (unchanged re-save is a no-op; a changed one auto-bumps the patch).

Blast radius is small: `args.version` has exactly three read sites —
`bin/amicus.js:72`, `bin/amicus.js:90`, and `src/cli-handlers-pack.js:26`/`:117`.

## Precedent

This is the "accepted and silently ignored" class the repo has fixed twice before:

| Instance | Release | Treatment |
|---|---|---|
| `start … --headless` (and unknown flags generally) | v4.5.2 | **Reject** — name it, suggest the nearest real flag, exit 1 |
| `list --search` | v4.7 | **Implement** — the flag now does what it says |
| `fanout --quiet` | v4.7 | **Implement** — forward it into `runFanout` |

The amicus product principle explicitly rejects this class: a correct-but-silent degrade fails
the bar as hard as a crash.

## Options considered

**(b) Make the global `--version` interception subcommand-aware.** Rejected. `parseArgs` has no
command context, and `BOOLEAN_FLAGS` is a module-level list that `known-flags.js` also consumes
via `getBooleanFlags()`. Making booleanness command-dependent changes the parser contract for
every caller and every `__explicit` consumer — a large, risky change for a small bug. It also
overloads the one flag spelling that universally means "print the version".

**(c) Reject the combination only.** Honest, but it deletes a documented capability. `writePack`
would become the sole version authority (auto-bump patch), and the docs would have to say a
pack's version cannot be set from flags. That is a capability regression, not a fix.

**(a) Rename only.** Fixes the handler but leaves the reported command line broken: `pack save …
--version 2.0.0` would keep printing the banner and exiting 0 with no pack written. Less silent,
equally wrong.

## Decision: (a) + the guard from (c)

Give `pack save` a non-conflicting spelling **and** make the trap combination fail loudly. This
is the only combination where both the help text and the actual command line stop lying.

### 1. Working spelling — `--pack-version <semver>`

The `pack:` block in `USAGE_COMMAND_BLOCKS` ([src/cli.js](../../../src/cli.js)) advertises
`--pack-version <semver>` in place of `--version <semver>`.

`src/utils/known-flags.js` derives the known-flag set from the usage text, so `--pack-version`
becomes a known flag automatically — no second list to keep in sync. `--version` stays known via
`BOOLEAN_FLAGS` and keeps its global meaning everywhere else.

### 2. Handler reads the new key

`args.version` → `args['pack-version']` at [src/cli-handlers-pack.js:26](../../../src/cli-handlers-pack.js)
(`buildPackFromFlags`) and `:117` (`buildPackFromRun`), so both the `--kind` and `--from-run`
paths honor it. The `|| '1.0.0'` default is unchanged, as are `writePack`'s no-op and
auto-bump-patch semantics.

### 3. Guard — `pack save --version` fails BAD_ARGS

A pure predicate — `packSaveVersionConflict(args)`, returning an error message string or `null` —
added to `src/utils/cli-preflight.js` (the existing home for "tiny shared preflight guards") and
called from `bin/amicus.js` immediately **before** the `if (args.version)` banner block.

Fires only when `command === 'pack'` && `args._[1] === 'save'` && `args.version` is set — so it
covers both the `--kind` and `--from-run` ways of building a pack. The
message names `--pack-version` as the real spelling. It goes through `failJson` so
`pack save --json --version 2.0.0` emits the standard error envelope
(`{type:'error', ok:false, error:{code:'BAD_ARGS'}}`) rather than bare text.

Everything else is untouched: `amicus --version`, `amicus pack list --version`,
`amicus start --version` all keep printing the banner and exiting 0.

The predicate lives in a helper rather than inline in `bin/amicus.js` specifically so it is
unit-testable — `bin/amicus.js` is a script with a top-level `main()` and `process.exit`, which
is why `tests/bin/preflight-json-envelope.test.js` tests extracted handlers rather than the bin.

Both spellings are caught: `--version 2.0.0` sets `args.version = true` (semver falls to
positionals) and `--version=2.0.0` also sets `args.version = true` (inline value discarded at
`src/cli.js:65`). The guard tests `args.version`, so it catches both.

### 4. Docs

`docs/usage.md`'s pack section names `--pack-version` explicitly. The existing line — "Every kind
may also carry `description`, `version` (semver, default `1.0.0`), and `briefing.template`" —
stays as written: it describes the pack **field**, which is unchanged and still accurate.

`tests/docs-quick-sync.test.js` anchors its version regex on the `amicus status demo123 --json`
example, not on the pack help block, so it is unaffected.

### 5. Tests — RED first

| Test | Home | RED today because |
|---|---|---|
| `pack save x --kind council --bench a,b --pack-version 2.0.0` writes a pack at v2.0.0 | `tests/pack/cli-pack-cmd.test.js` | `--pack-version` is unread; the pack lands at `1.0.0` |
| `--pack-version` on the `--from-run` path likewise | `tests/pack/cli-pack-cmd.test.js` | same |
| Guard predicate fires for `pack save` + `args.version` and names `--pack-version` | `tests/bin/pack-save-version-guard.test.js` (new) | the predicate does not exist |
| Guard is silent for `pack list --version`, `start --version`, bare `--version` | `tests/bin/pack-save-version-guard.test.js` (new) | the predicate does not exist |
| Anti-rot: the usage `pack:` block advertises `--pack-version` and does **not** advertise a bare `--version` | `tests/pack/cli-pack-cmd.test.js` | help text still advertises `--version <semver>` |

## Non-goals

- No change to `writePack`'s no-op / auto-bump semantics.
- No change to the `version` field on the pack JSON, its schema, or the recorded run pack record.
- No MCP surface change — packs are *invoked* over MCP (`pack` param) but only *saved* via CLI,
  so there is no MCP `pack save` to update.
- No change to `--version` behavior for any command other than `pack save`.
- No general short-flag or command-aware-parser work.

## Verification

- `npx jest tests/pack/ tests/bin/ tests/utils/known-flags.test.js` — targeted.
- `npm test` — full unit suite (the pre-push gate).
- Manual: the four command lines in the table above against the real CLI.
