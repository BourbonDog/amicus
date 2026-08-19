# Citing one file from another

Comments, tests and planning docs in this repo cite other files. Those
citations rot silently whenever the cited file changes, and the rot is
expensive: PR #171 produced roughly thirty review findings and **not one was in
the code** — every one was a stale or false statement *about* the code, and the
majority were rotted citations. Five consecutive fix rounds on a single task
went entirely to citations, and fixing them moved lines, which falsified more.

## The forms

| Form | Use it for | Enforced by |
|---|---|---|
| `file.js :: symbolName` | **Default.** Any claim about current code. | the symbol must appear in the target, dotted paths **as written** |
| `file.js:NNN` / `file.js:NNN-MMM` | A claim no symbol can carry (a line inside a function, a specific guard). | target resolves, line in range |
| `file.js@<ref>:NNN` | Provenance — "moved verbatim from", "was true at". | line in range **in the file at that ref** |

**Prefer the symbol anchor.** A corrected line number is true until the next
edit and then silently false; a symbol anchor survives every move. Measured in
PR #171: symbol-anchoring one file removed it from the citation-rot class
entirely.

Use the `@ref` form rather than deleting or "correcting" a provenance
statement. `run-finish.js` says its body was *moved verbatim from
`run.js@6b0c3b6b:242-288`* — that range is past EOF in today's `run.js` and
looks exactly like rot, but it is true at the pre-split commit, and the gate
verifies it there. Pin the ref to a commit reachable from `main`.

**`@ref` needs full history.** `actions/checkout` defaults to a shallow clone
(`fetch-depth: 1`), where the historical commit is simply absent — which is
indistinguishable from a bogus ref. On a shallow clone the gate SKIPS those
checks and prints exactly which ones it skipped; it never fails them, and never
passes them silently. The `quality` CI job checks out full history
(`fetch-depth: 0`), so every `@ref` is really verified once per push, while the
six test legs stay shallow and cheap.

## What the gate checks

`scripts/check-citations.js` runs in `.husky/pre-commit` and in the `quality`
CI job (`npm run check:citations`).

Per commit it checks the union of two scopes:

- **IN** — citations living in the files the commit changed.
- **TO** — citations anywhere in live code that *point at* a file the commit changed.

A commit's changed set deliberately includes **deletions**, and a **rename
contributes both of its paths**. `git diff --name-only` reports a rename as its
new path alone, which would leave the renaming commit unable to see the
citations to the old path it just broke — the same hole deletions had. This is
why the gate uses `--diff-filter=ACMRD` and `--name-status` where its sibling
gates use plain `ACM`: a deleted file needs no size or secret scan, but deleting
or renaming one is among the surest ways to falsify *other* files' citations.

**What the symbol check is, honestly.** It is a text search on identifier
boundaries, not a parse. `file.js :: foo.bar` requires the literal `foo.bar` to
appear in the target; it does not prove `bar` is a property of `foo`, and it
cannot see a symbol reached through destructuring or a computed key. It catches
the case that actually rots — a renamed or removed symbol — and it will not be
fooled by an unrelated `foo` and an unrelated `bar` merely coexisting.

**TO is not optional.** Measured across PR #171's 38 commits, 119 corrected
citations split 66 IN-scope / 18 TO-scope-only. A gate scoped to changed files
alone would have shipped all 18 — including every `run-retry.js` citation in
`src/headless.js` and three test files that the extraction commit never had
open. An extraction moves *one* file's lines and falsifies citations in files it
never touches.

## What the gate does not check

Only live code (`src/`, `electron/`, `tests/`) is scanned. `BACKLOG.md` and
`docs/` hold 3639 of the repo's 4128 citations and are **out of scope by
design**.

**Doc-tree citations are dated historical record. Read them as history, not as
claims about the current tree.** In particular `docs/superpowers/plans/*` and
`docs/superpowers/specs/*` are snapshots: their filenames carry the date they
were written, and their citations were true against the tree of that date.

Do not bulk-rewrite them. In PR #171 `BACKLOG.md:1820` looked like rot and was
**true as of tag v4.7.0** — merely undated. It was annotated, not overwritten. A
codemod would have destroyed a true statement. When a doc citation is genuinely
misleading, annotate it with the ref it was true at, or convert it to `@ref`
form; do not silently renumber it.

## Fixing a stale citation

1. **Open the cited line.** Never derive a correction by offset arithmetic —
   extractions do not shift a file uniformly. PR #171 measured offsets of
   0/-1/-9/-10/-32 within one commit, and 0/+10/+15 within a single file in
   another. Applying one offset shipped fresh wrong values twice.
2. Re-anchor by symbol wherever the claim allows it.
3. **Sweep every file your commit touches**, not just the one you set out to
   fix — a comment-only edit still moves line numbers. This exact miss caused
   two fix rounds in #171.
4. Prefer line-count-neutral edits. That is what finally stopped the cascade.

## The burn-down list

`CONFIG.grandfathered` in `scripts/check-citations.js` holds citations that were
already stale when the gate landed, so the gate could block from day one instead
of shipping advisory. Every entry rotted when v4.8 PR0 split its target. Fix the
citation, then **delete the entry** — a test asserts every entry still names a
real citation, so the list cannot quietly accumulate dead weight.
