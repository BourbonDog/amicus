# v4.8 Wave 2.5 — R16: the `sessions-index.json` growth gap

**Branch:** `v48-wave25-r16` · **BASE:** `11f0c8cb` · Ruling **R16**. Ships alone.
**Written:** 2026-08-22, just-in-time, measured at BASE.

---

## §0. Measured substrate

### §0.1 The defect, and the honest size of it

`session-index.js :: recordSession` (`:64`) appends `index[taskId] = canonicalProjectPath` on every
session start and **nothing ever removes one**. Entries outlive their subject: a project that is
deleted, renamed or moved leaves rows behind forever. No TTL, no cap, no prune.

Measured on the dev machine 2026-08-07: **18,874 entries, 0.69 MB, of which 5,933 (31.4%) pointed
at project paths that no longer existed.** Two measured costs:

- **Every session start pays for the whole file.** `recordSession` does a full
  read → `JSON.parse` → mutate → `JSON.stringify` → atomic write of the ENTIRE index. At 18,874
  entries that is ~5.7 ms plus a **0.69 MB write, on every single start** — `O(total sessions ever)`
  per launch, not `O(1)`.
- **`--all` walks all of it.** `enumerateAllProjects` (`sidecar/read.js:94`) reads every distinct
  project. `amicus list --all` measured **21,145 rows in 8,275 ms**; after a manual prune to 187
  entries, **132 rows in 53 ms**.

⚠️ **Do NOT quote the 18,874 as the expected steady state.** The backlog entry says so explicitly:
the *bulk* of that particular index was **test residue** from a `/tmp` hermeticity leak that
**PR #123 sealed** — a fresh index will not balloon the same way. What remains, and what this task
closes, is the **structural** gap: even with zero test residue a real user's index accrues dead
entries as projects come and go, and pays a growing per-start write cost forever. The leak made it
visible; it is not the whole of it. **Any claim this PR ships must be scoped that way.**

### §0.2 The shape

`INDEX_FILENAME = 'sessions-index.json'` (`:29`), in `getConfigDir()`. The document is a **flat map**
`{ [taskId]: canonicalProjectPath }`. `recordSession` is wrapped in `try/catch` that swallows
everything — *"Index is a navigation aid; never let its failure break a session start."*

### §0.3 The precedent to reuse — this is why R16 recommends option 1

`src/utils/session-index-tmp-sweep.js` is **already a doctor check with `--fix` operating on this
very file** (orphaned `.tmp` files rather than stale entries). Its wiring:

- deps injected at `cli-handlers-doctor.js:81-82`
  (`listSessionIndexTmpFiles`, `unlinkSessionIndexTmp`)
- composed at `cli-handlers-doctor.js:206`:
  `checks.push(guard('sessions-index-tmp', 'Session index tmp files', () => tmpSweep.evaluateSessionIndexTmpSweep(d)))`
- it carries an `AGE_THRESHOLD_MS` so a live writer's ms-lived tmp is never swept

A sibling module reuses that whole warn/fix/hint shape. **Read it before writing anything.**

---

## §0.4 Rulings

**R16-1 — option 1 (doctor check + `--fix`), as the backlog entry itself recommends.** Its two
alternatives are documented with named defects: *prune on write* adds a `statSync` per entry to the
hot start path (worse than the problem at scale) and deletes user-visible state with no
announcement; *cap + LRU* silently degrades `amicus read <id>` from another project into a
not-found, because the index is an advisory lookup aid (`safeSessionDir`'s cross-project fallback,
#40). Option 1 is announced, user-triggered, reuses an existing surface, and cannot silently lose a
lookup. *Cost if wrong:* a user who never runs `doctor --fix` keeps the growth — which is the
status quo, so the downside is bounded by doing nothing.

**R16-2 — liveness-based, NEVER age-based.** The backlog entry is explicit and it is the single
easiest thing to get wrong here: *a five-year-old session in a project that still exists is still a
valid lookup target, while a one-day-old entry for a deleted project is not.* An entry is stale
**iff its project path no longer exists on disk**. Do not add a TTL. Do not sort by mtime.

**R16-3 — probe DISTINCT PROJECTS, not entries.** The index is `taskId → project` and many task ids
share one project. Dedupe to the distinct project set first, `statSync` each once, then mark
entries. That makes the check `O(distinct projects)` rather than `O(entries)` — the difference
between the measured 21,145-row walk and something that finishes. **Measure and report both counts.**

**R16-4 — the "13 unpinned rails" phrase is UNSOURCED and is not scope.** R16's ruling row reads
*"pin all 13 unpinned rails"*, and that phrase appears **nowhere else in the repo** — no list, no
definition. Scope comes from the growth entry above, not from that wording. If a rail-shaped set
turns out to exist, report it; do not invent one to match a number.

---

## Global constraints

1. **No file over 300 lines** (`content.split('\n').length`, minus 1 if it ends in a newline).
   **EXTRACT — never shave a comment.** ⚠️ `src/council/run-retry.js` is at **300/300** — do not
   touch it.
2. **Every behaviour claim measured, never argued** — admissible only with the command that
   produced it.
3. **The fix gets a named mutant with a red set measured at FULL `npx jest --no-coverage` scope.**
   An empty red set is a finding, not a result.
4. **Commit before running any mutant.** ⚠️ **Never** `git checkout -- <path>`, `git restore`,
   `git stash`, or `git checkout-index` — the rule is by **effect**, not spelling. Hand-revert and
   byte-verify with `git diff` (⚠️ **not** `diff <(git show HEAD:file) file` — this worktree is
   CRLF and that comparison reports every line as differing).
5. **Never silently delete user state.** The prune must report what it will remove before `--fix`
   removes it, matching the tmp-sweep's announce-then-fix shape.

---

## Tasks

### T-R16.1 — the check

New module `src/utils/session-index-prune.js`, mirroring `session-index-tmp-sweep.js`:

- **list** stale entries — entries whose canonical project path no longer exists (R16-2), probing
  the **distinct project set** (R16-3)
- **prune** them, rewriting the index atomically through the same `writeFileAtomic` path
  `recordSession` uses
- **evaluate** into a doctor check line, and wire it in `cli-handlers-doctor.js` beside its sibling
  (deps at `:81-82`, `checks.push` at `:206` — re-derive both, they will have moved)

⚠️ **Handle the corrupt/missing index exactly as `readIndex` already does** (`corrupt -> {}`), and
never throw into `doctor`. ⚠️ **A relative or unreadable path is not the same as a deleted one** —
decide what an `EACCES` on `statSync` means and say so; treating "cannot read" as "does not exist"
would delete a live entry on a permissions blip.

**Tests + named mutant `STALEKEEP`** (make the prune keep everything / the liveness test always
return live). Record the red set at full scope.

### T-R16.2 — the record

`BACKLOG.md`, the phasing doc, `CHANGELOG.md`. Tick R16. ⚠️ **Scope the claim honestly per §0.1** —
the headline 18,874/31.4% was inflated by sealed test residue; what shipped closes the structural
gap. Record R16-4 (the unsourced "13 rails" phrase) so nobody hunts for it later. Update the resume
point to **Wave 3: SI-27 first, SI-22.4 last**, and carry the `run-retry.js` 300/300 warning, since
SI-27 extracts from that file.

Re-derive every citation against the FINAL tree; grep the distinctive phrase of anything corrected.
⚠️ `output/` and dated plan snapshots are out of scope — dated records, never "gitignored".
