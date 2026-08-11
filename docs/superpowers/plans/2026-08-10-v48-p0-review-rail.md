# v4.8 P0 — Unblind the review rail (diff budget + plan-doc policy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the council review the *code* in a PR instead of the paperwork, and stop plan documents from living permanently on `main`.

**Architecture:** `.github/workflows/council-review.yml` currently builds its briefing with `head -c "$DIFF_CAP" full.diff`, a blind byte-prefix of `gh pr diff` output. Replace that with a small JS filter, heredoc'd into the workflow step, that splits the unified diff on file boundaries, drops non-reviewable paths, orders `src/`/`tests/` first, packs whole files into the byte budget, and *reports* what it dropped. The workflow performs **no checkout**, so the filter cannot be a repo script — but `actions/setup-node@v6` already runs, so an inline JS program is available and, unlike inline `awk`, can be harvested from the YAML and executed verbatim by a cross-platform jest test.

**Tech Stack:** GitHub Actions YAML, POSIX sh, Node 22 (CI) / Node ≥22.12 (local), jest.

## Global Constraints

- Hard **300 lines/file** gate, `scripts/check-file-sizes.js:18`, enforced pre-commit AND in CI. Comparison is `adjustedCount > limit` after stripping a trailing newline: **300 passes, 301 fails.**
- `npm test` must be run before `git push` — the pre-push hook re-runs the FULL suite unless `.test-passed` matches HEAD.
- Never use `npm test -- <path>` for a single suite: it stamps `.test-passed` and makes pre-push SKIP the suite. Single suites use bare `npx jest <path>`.
- Never pipe gates through `| tail` — it masks exit codes.
- The council-review workflow must keep **no checkout** (`expect(y).not.toContain('actions/checkout')`, pinned at `tests/scripts/council-review-workflow.test.js:44`). PR code is never executed.
- Plans live at `docs/superpowers/plans/`; per **R13** they are committed on-branch and pruned at the release cut. Specs are permanent.
- Line endings: `.gitattributes` sets `eol=lf`. Edit normally.

---

## Scope note — what is NOT in this plan

The spec's §11.4 change 3 (**split `BACKLOG.md`'s work queue from its historical record**) is deliberately excluded. Measured at `c11bdd1`: 1947 lines, **26 `##` + 25 `###` sections, 54 open `- [ ]` and 135 done `- [x]` items**, with at least two known pairs in contradictory states (`:1676-1753` vs `:1825-1832`; `:1547` vs `:1773-1774`). That is a different kind of work with a different risk profile — a large content migration whose review gate is "did any open item get lost," not "does the code behave." **It gets its own plan.** Folding it in here would produce a PR no reviewer could hold in their head, which is the failure this rev exists to stop repeating.

This plan delivers spec §9 **P0** (R12) and **P0b** (R13) only.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `.github/workflows/council-review.yml` | CI council review | Modify the "Build council briefing from the PR diff" step (`:121-151`) |
| `tests/scripts/council-review-workflow.test.js` | Pins the workflow's contract (225 lines) | Add a harvest-and-execute suite for the filter |
| `docs/publishing.md` | Release recipe | Add the plan-prune step under `## Release checklist` (`:47`) |
| `src/utils/session-metadata-tmp-sweep.js` | doctor's tmp sweep | Repoint one JSDoc reference (`:16`) |
| `docs/ROADMAP.md` | Public roadmap | Repoint one plan reference (`:139`) |
| `docs/SHIMS.md` | Shim rationale | Repoint one plan reference (`:62`) |
| `docs/doc-system.md` | Doc-system description | Reword the `docs/superpowers/plans/` mention (`:65`) |

**Why the filter is inline JS and not a script file or awk:**
- A repo script is unreachable — the workflow never checks out (pinned).
- Inline `awk` is testable only by translation, and the existing sed-harvest test (`:165-202`) explicitly flags translation fidelity as a caveat it had to reason about. A stateful awk program makes that caveat much worse.
- Inline JS is harvested and executed **verbatim** — zero translation risk — and `node` is already provisioned by `actions/setup-node@v6` at `:110-113`.

---

## Task 1: Filter the review diff by path, priority, and whole files

**Files:**
- Modify: `.github/workflows/council-review.yml:121-151` (the "Build council briefing from the PR diff" step)
- Test: `tests/scripts/council-review-workflow.test.js` (append a new `describe`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a heredoc'd program delimited by `<<'FILTER_EOF'` … `FILTER_EOF` inside the workflow, invoked as `node filter-diff.js full.diff "$DIFF_CAP" > capped.diff 2> diff-notes.txt`. Task 2 consumes `diff-notes.txt`.

**Context the implementer needs:** `gh pr diff` emits a unified diff in which every file's section begins at column 0 with `diff --git a/<old> b/<new>`. The current code takes a raw byte prefix, so on a large PR the *first* files alphabetically consume the budget and everything after is invisible. On [PR #143](https://github.com/BourbonDog/amicus/pull/143) that meant 8 markdown files ate the 120 KB cap (one plan doc alone was 91,870 bytes = 36% of the diff) and **zero bytes of `src/` or `tests/` reached the council** — its own finding C1 reported that as a blocker.

- [ ] **Step 1: Write the failing test**

Append to `tests/scripts/council-review-workflow.test.js`, before the final `});`:

```js
  describe('review-diff filter (harvested from the workflow and executed verbatim)', () => {
    const os = require('os');
    const { execFileSync } = require('child_process');

    /** Pull the filter program out of the YAML heredoc and write it to a temp file. */
    function harvestFilter() {
      const y = yml();
      const m = y.match(/<<'FILTER_EOF'\n([\s\S]*?)\nFILTER_EOF/);
      if (!m) { throw new Error('filter program not found in council-review.yml'); }
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-filter-'));
      const file = path.join(dir, 'filter-diff.js');
      fs.writeFileSync(file, m[1], 'utf-8');
      return { file, dir };
    }

    /** Run the harvested filter exactly as the workflow does. */
    function runFilter(diffText, cap) {
      const { file, dir } = harvestFilter();
      const input = path.join(dir, 'full.diff');
      fs.writeFileSync(input, diffText, 'utf-8');
      const stdout = execFileSync(process.execPath, [file, input, String(cap)], { encoding: 'utf-8' });
      return stdout;
    }

    const block = (p, body) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n+${body}\n`;

    test('drops docs/superpowers and package-lock.json, keeps src/', () => {
      const diff = block('docs/superpowers/plans/big.md', 'PLANTEXT')
        + block('package-lock.json', 'LOCKTEXT')
        + block('src/council/tally.js', 'SRCTEXT');
      const out = runFilter(diff, 100000);
      expect(out).toContain('SRCTEXT');
      expect(out).not.toContain('PLANTEXT');
      expect(out).not.toContain('LOCKTEXT');
    });

    test('orders src/ and tests/ ahead of everything else', () => {
      const diff = block('README.md', 'READMETEXT')
        + block('tests/foo.test.js', 'TESTTEXT')
        + block('src/cli.js', 'SRCTEXT');
      const out = runFilter(diff, 100000);
      expect(out.indexOf('SRCTEXT')).toBeLessThan(out.indexOf('TESTTEXT'));
      expect(out.indexOf('TESTTEXT')).toBeLessThan(out.indexOf('READMETEXT'));
    });

    test('packs WHOLE files — a budget overflow never emits a half hunk', () => {
      const big = block('docs/other/big.md', 'X'.repeat(500));
      const small = block('src/cli.js', 'SRCTEXT');
      const out = runFilter(small + big, small.length + 50);
      expect(out).toContain('SRCTEXT');
      expect(out).not.toContain('XXXXX');
      expect(out.endsWith('\n')).toBe(true);
    });

    test('a single file larger than the whole budget is truncated, never silently dropped to nothing', () => {
      const out = runFilter(block('src/huge.js', 'Y'.repeat(5000)), 400);
      expect(out.length).toBeGreaterThan(0);
      expect(out).toContain('diff --git a/src/huge.js');
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/scripts/council-review-workflow.test.js -t "review-diff filter"`
Expected: FAIL — `Error: filter program not found in council-review.yml`

- [ ] **Step 3: Replace the briefing-build step's diff handling**

In `.github/workflows/council-review.yml`, inside the `Build council briefing from the PR diff` step, replace this line:

```sh
          head -c "$DIFF_CAP" full.diff > capped.diff
```

with the heredoc'd filter and its invocation:

```sh
          # Feed the council the CODE, not the paperwork. A raw byte prefix of
          # `gh pr diff` lets whatever sorts first eat the whole budget — on #143
          # that was 8 markdown files, and ZERO bytes of src/ reached the bench
          # (its own finding C1 called that a blocker). Spec §9 P0 / ruling R12:
          # exclude non-reviewable paths, order src/ first, pack WHOLE files.
          # Inline JS rather than a repo script because this workflow never
          # checks out, and rather than awk because the test harvests this
          # program and executes it verbatim.
          cat > filter-diff.js <<'FILTER_EOF'
'use strict';
const fs = require('fs');
const [, , diffPath, capRaw] = process.argv;
const cap = Number(capRaw);
const raw = fs.readFileSync(diffPath, 'utf8');

const EXCLUDE = [/^docs\/superpowers\//, /^package-lock\.json$/];
const PRIORITY = [/^src\//, /^tests\//, /^schemas\//, /^\.github\//];

function pathOf(block) {
  const m = block.match(/^diff --git a\/.+? b\/(.+?)$/m);
  return m ? m[1] : null;
}
function priorityOf(p) {
  const i = PRIORITY.findIndex((re) => re.test(p));
  return i === -1 ? PRIORITY.length : i;
}

const parts = raw.split(/(?=^diff --git )/m).filter((s) => s.trim().length > 0);
const kept = [];
const dropped = [];
for (const block of parts) {
  const p = pathOf(block);
  if (p === null) { continue; }
  if (EXCLUDE.some((re) => re.test(p))) { dropped.push(p); continue; }
  kept.push({ p, block, prio: priorityOf(p) });
}
kept.sort((a, b) => a.prio - b.prio);

let out = '';
const elided = [];
for (const k of kept) {
  if (Buffer.byteLength(out) + Buffer.byteLength(k.block) > cap) { elided.push(k.p); continue; }
  out += k.block;
}
// A single file bigger than the entire budget must not reduce the briefing to
// nothing — that would read to the bench as "this PR changed no code".
let headTruncated = null;
if (out === '' && kept.length > 0) {
  out = Buffer.from(kept[0].block, 'utf8').subarray(0, cap).toString('utf8');
  headTruncated = kept[0].p;
  elided.shift();
}

process.stdout.write(out);
const notes = [];
if (dropped.length) { notes.push('excluded as non-reviewable: ' + dropped.join(', ')); }
if (elided.length) { notes.push('elided to fit the byte budget: ' + elided.join(', ')); }
if (headTruncated) { notes.push('truncated mid-file (larger than the whole budget): ' + headTruncated); }
process.stderr.write(notes.join('\n'));
FILTER_EOF
          node filter-diff.js full.diff "$DIFF_CAP" > capped.diff 2> diff-notes.txt
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/scripts/council-review-workflow.test.js -t "review-diff filter"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole workflow suite for regressions**

Run: `npx jest tests/scripts/council-review-workflow.test.js`
Expected: PASS — all prior tests still green, including `never executes PR code (no checkout)`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/council-review.yml tests/scripts/council-review-workflow.test.js
git commit -m "fix(ci): review the code, not the paperwork — filter the council diff by path and priority"
```

---

## Task 2: Tell the bench what it is not being shown

**Files:**
- Modify: `.github/workflows/council-review.yml` (the same step, the `TRUNC` block at `:129-132` and the briefing heredoc at `:137-151`)
- Test: `tests/scripts/council-review-workflow.test.js`

**Interfaces:**
- Consumes: `diff-notes.txt` from Task 1.
- Produces: nothing downstream.

**Context:** The existing `TRUNC` string says only *"diff truncated to N bytes."* Post-Task-1 that is both wrong (whole files are dropped, not a byte prefix) and incomplete (it never names what was dropped). A bench that cannot see `src/` and is not told so will confidently review the wrong thing — which is exactly what happened on #143. A correct-but-silent degrade fails the bar as hard as a crash.

- [ ] **Step 1: Write the failing test**

Append inside the same `describe` block added in Task 1:

```js
    test('the briefing declares exclusions and elisions instead of claiming a byte truncation', () => {
      const y = yml();
      const step = y.slice(y.indexOf('Build council briefing from the PR diff'),
                           y.indexOf('Run the adjudicated council'));
      expect(step).toContain('diff-notes.txt');
      // the stale byte-prefix wording must be gone
      expect(step).not.toContain('diff truncated to ${DIFF_CAP} bytes');
      expect(step).toContain('Not shown');
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/scripts/council-review-workflow.test.js -t "declares exclusions"`
Expected: FAIL — `expect(received).toContain("diff-notes.txt")`.

- [ ] **Step 3: Replace the TRUNC block and thread the notes into the briefing**

Delete these lines:

```sh
          TRUNC=""
          if [ "$(wc -c < full.diff)" -gt "$DIFF_CAP" ]; then
            TRUNC="(diff truncated to ${DIFF_CAP} bytes — review what is shown; do not guess about elided hunks)"
          fi
```

In the briefing heredoc, replace this line:

```sh
            echo "## Diff ${TRUNC}"
```

with:

```sh
            echo "## Diff"
            if [ -s diff-notes.txt ]; then
              echo
              echo "> **Not shown.** The diff below is filtered, not the whole PR. Review only what is"
              echo "> shown and do not guess about anything omitted:"
              while IFS= read -r line; do echo "> - ${line}"; done < diff-notes.txt
              echo
            fi
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/scripts/council-review-workflow.test.js -t "declares exclusions"`
Expected: PASS.

- [ ] **Step 5: Run the whole workflow suite**

Run: `npx jest tests/scripts/council-review-workflow.test.js`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/council-review.yml tests/scripts/council-review-workflow.test.js
git commit -m "fix(ci): the briefing names what the bench is not being shown"
```

---

## Task 3: Plan-doc policy — prune at release, repoint the references

**Files:**
- Modify: `docs/publishing.md:47` (`## Release checklist`)
- Modify: `src/utils/session-metadata-tmp-sweep.js:16`
- Modify: `docs/ROADMAP.md:139`
- Modify: `docs/SHIMS.md:62`
- Modify: `docs/doc-system.md:65`

**Interfaces:** none — documentation and one JSDoc comment.

**Context (R13):** `docs/superpowers/` holds **46 specs / 11,932 lines** and **68 plans / 87,442 lines**, and **none of it ships** (`package.json:37-49` lists `docs/*.md`, single-star). Specs stay permanently — they are decision records and shipped code cites them (`run-retry.js:5`, `fanout.js:10`, `update-notice.js:6`). Plans are execution scripts that are false the moment they are executed; they stay committed on-branch during a build (which is what stops them being silently rewritten mid-flight) and are pruned in the release-cut commit.

Exactly **three** references point at plans, plus one generic mention. (An earlier draft of the spec said four `src/` JSDoc headers — that was wrong; three of those four point at *specs*.)

- [ ] **Step 1: Write the failing test**

Create `tests/docs-plan-refs.test.js`:

```js
// tests/docs-plan-refs.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/** Files that must not hard-link a specific plan doc: plans are pruned at the
 *  release cut (R13), so any citation of one rots into a dead path. Specs are
 *  permanent and may be cited freely. */
const SCANNED = ['src', 'docs', 'skills'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'superpowers') { continue; } // the plans themselves may cross-reference
      walk(p, out);
    } else if (/\.(js|md)$/.test(e.name)) { out.push(p); }
  }
  return out;
}

test('no shipped source or doc cites a specific plan file (plans are pruned at release)', () => {
  const offenders = [];
  for (const root of SCANNED) {
    for (const file of walk(path.join(ROOT, root))) {
      const text = fs.readFileSync(file, 'utf-8');
      const hits = text.match(/docs\/superpowers\/plans\/[\w.-]+\.md/g);
      if (hits) { offenders.push(`${path.relative(ROOT, file)} -> ${hits.join(', ')}`); }
    }
  }
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/docs-plan-refs.test.js`
Expected: FAIL, listing 3 offenders — `src/utils/session-metadata-tmp-sweep.js`, `docs/ROADMAP.md`, `docs/SHIMS.md`.

- [ ] **Step 3: Repoint the three references**

`src/utils/session-metadata-tmp-sweep.js:16` — replace the plan citation with the behaviour it was explaining. Change:

```js
 * docs/superpowers/plans/2026-08-05-v463-pr3-cli-doctor-odds.md): this walks
```

to:

```js
 * v4.6.3 D8): this walks
```

`docs/ROADMAP.md:139` — change:

```markdown
`docs/superpowers/plans/` (`2026-08-0*-v4.6-degrade-invariant-plan-*.md`).
```

to:

```markdown
the v4.6 degrade-invariant plans (pruned at the release cut; see git history for the branch).
```

`docs/SHIMS.md:62` — change:

```markdown
See the rebrand plan for the original shim rationale: `docs/superpowers/plans/2026-06-08-amicus-rebrand.md`.
```

to:

```markdown
The original shim rationale is in the 2026-06-08 rebrand plan, pruned at its release cut; see git history.
```

- [ ] **Step 4: Reword the generic mention**

`docs/doc-system.md:65` currently describes `docs/superpowers/plans/` as "uncataloged". Change that clause to:

```markdown
`docs/superpowers/plans/`, which are working documents pruned at each release cut — specs in `docs/superpowers/specs/` are the permanent record.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest tests/docs-plan-refs.test.js`
Expected: PASS.

- [ ] **Step 6: Add the prune step to the release checklist**

In `docs/publishing.md`, under `## Release checklist` (`:47`), add:

```markdown
- [ ] **Prune the rev's plan docs.** Delete `docs/superpowers/plans/*` belonging to this release in the release-cut commit. Specs in `docs/superpowers/specs/` are permanent and stay. Plans are working documents — they are committed on-branch so they cannot be silently rewritten mid-build, and removed at the cut so `main` never accumulates prescriptions that are false the moment they ship. Git history remains the audit trail. `npx jest tests/docs-plan-refs.test.js` fails if anything still cites a specific plan.
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, zero failures. (Judge health on **0 failures**, not on the suite count — a docs commit can move the count via docs-driven parameterized tests.)

- [ ] **Step 8: Commit**

```bash
git add docs/publishing.md docs/doc-system.md docs/ROADMAP.md docs/SHIMS.md src/utils/session-metadata-tmp-sweep.js tests/docs-plan-refs.test.js
git commit -m "docs: plans are pruned at the release cut; specs are permanent"
```

---

## Verification before opening the PR

- [ ] `npm run lint` — clean.
- [ ] `npm run check:sizes` — clean. (No file in this plan approaches 300, but the gate runs on everything.)
- [ ] `npm test` — 0 failures. Required before `git push`, or the pre-push hook re-runs the whole suite.
- [ ] Confirm no checkout was introduced: `grep -c 'actions/checkout' .github/workflows/council-review.yml` → `0`.
- [ ] Open the PR **with the `council-review` label** — that label is what gates the council job (`require_label` defaults true, and the workflow re-triggers on `labeled`). This PR is the first live test of its own fix: the council's briefing should now name what it was not shown.

---

## Self-review

**Spec coverage.** §9 P0 (R12, exclusion + ordering) → Tasks 1–2. §9 P0b (R13, prune-at-release + reference fixes) → Task 3. §11.4 change 1 (delete rot-prone numbers) and change 3 (BACKLOG split) are **not** in this plan — change 1 rides `ROADMAP.md:248` in PR-Z per the spec's own train, and change 3 is scoped out above with its measurements. §11.4 change 2 (executable doc-fact gate) rides PR-Z with the `skills/` extension. **Gap deliberately accepted and named, not silent.**

**Placeholder scan.** No TBD/TODO. Every code step carries the literal content. The one judgement call left to the implementer — whether `.github/` belongs in `PRIORITY` — is resolved in the code, not deferred.

**Type consistency.** `harvestFilter()` / `runFilter()` / `block()` are defined once in Task 1 and reused by Task 2's test inside the same `describe`. The heredoc delimiter `FILTER_EOF` matches between the workflow and the test's harvest regex. `diff-notes.txt` is written in Task 1 and read in Task 2 under the same name.

**One risk the implementer must not paper over.** The filter changes what the council *sees*, so the first council run on this PR is not a control — it is the new behaviour reviewing its own introduction. If that run reports something odd about the diff, read `diff-notes.txt` in the evidence artifact before assuming the council is wrong.
