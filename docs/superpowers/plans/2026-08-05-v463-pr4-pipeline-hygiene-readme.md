# v4.6.3 PR4 — "pipeline + hygiene + the README tells the truth" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The MCP-Registry skip-check verifies the version it trusts (spec D6), the README's two stale claims are corrected with their test pins moved in lockstep (the owner's accuracy-review mandate), the duplicated doctor `baseDeps` fixture collapses into one factory (~360 lines → 1 helper), and `run-chair.js` loses its waveId literal duplication — spec §7 of `docs/superpowers/specs/2026-08-05-v463-post-train-sweep-design.md`, closing the v4.6.3 sweep.

**Architecture:** Four independent mechanical tasks. Everything is CI-config, docs, or test plumbing except two trivial src edits (`run-chair.js` consts; `install.sh`/`install.ps1` Node gates — an adjacent truth fix the README review surfaced). No behavior changes outside the publish pipeline's skip condition.

**Tech Stack:** GitHub Actions bash (implicit `bash -e {0}`, NO pipefail — pipe-free constructs only in publish.yml), jest, CommonJS test helper.

## Global Constraints

- **Fail-toward-publish is the invariant** (spec D6): every new failure mode in the registry pre-check (curl transport, missing/empty/reshaped body, grep miss) must route to *proceeding with publish*, never to job failure and never to a false skip. The `exit 0` skip fires ONLY on `200 AND body-names-this-version`.
- publish.yml runs under implicit `bash -e` without pipefail — no pipelines in the new check (grep reads the body FILE, never a curl pipe).
- **README pin lockstep:** `tests/readme-requirements-deps.test.js` (~:30-32) and `tests/ws4-quickwins.test.js` (~:13-18) PIN the stale "Node ≥ 18" text — the correction and the pin updates land in the SAME commit. The literal `[SIDECAR_FOLD]` token, the four-tier list, `report.html`, the `5–8 paid model calls` literal, and the `"version": "4.6.2"` status example are all pinned — do NOT touch them (**no version bump in PR4** — the release cut owns it and must bump README:444 + docs/usage.md with package.json).
- **makeBaseDeps preserves EXACT current shapes:** fresh `jest.fn()` per call (cli-handlers-doctor.test.js:79's never-called assertion); an `omit` mechanism for genuine key ABSENCE (spreading `key: undefined` is NOT equivalent — realDeps fall-through keys on presence); `doctor-electron-stat-exe` omits `getElectronPath`; `doctor-local-providers` omits `getLocalProviders`+`probeLocalProvider` AND `env` (its env omission is undocumented but real — preserve it byte-conservatively, note as a rider, do not silently change semantics). Institutional comments (M14/B14/D8/#95 forward-pin writeups) MOVE into the helper, never deleted. The `engine-install-scan`/`engine-repair` local factories are different-shaped units — untouched. Suites' assertions stay byte-unchanged — fixture plumbing only.
- CHANGELOG `[Unreleased]` ONLY, placement proven via `git diff main -- CHANGELOG.md` (the PR2/PR3 lesson).
- Sizes: publish.yml 236 (no gate), publish-workflow.test.js 154, run-chair.js 219/300, README 612. Worktree `C:\Users\sendt\code\amicus-wt-v463-pr4`, branch `feat/v4.6.3-pr4-pipeline-hygiene-readme`. NEVER npm install; push ≥5min; `git add` specific paths. Baseline: 493 suites / 6533+ / 0.

**Measured reality (recon 2026-08-05, wf_22805652-21d — verbatim excerpts in the pr4r-* reports):**
- Pre-check today (publish.yml:120-125): `STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 <url> || true)`; skip on bare `STATUS = "200"`. The body is DISCARDED — D6 adds capture, not parse-tightening. The response body's schema is NOT recorded in-repo (registry is PREVIEW, drift expected) → defensive grep beats jq-pathing a guessed schema (jq IS available but unnecessary).
- The existing pre-check pin (publish-workflow.test.js:93-125) regex `STATUS=\$\(curl[\s\S]*?\)` tolerates changing `-o /dev/null` → `-o "$BODY_FILE"`; `|| true` + `--max-time` pins must keep matching.
- Step-scoped slice idioms already in the file: step-header→next-step-header (:65-84) and step-header→login-literal (:93-125). Whole-file `::notice::`/`::error::` toContain pins at :19,:30,:82,:90,:130 — the Phase-11 bundle (BACKLOG:199-208) wants them step-scoped "next time these test files are open"; PR4 opens the file, so that portion is in-scope. The bundle's `package-manifest.test.js` `yml.indexOf('npm publish')` ordering-pin tighten (matches a B04 comment today) rides too (one line). The bundle's skill-docs items (different files) do NOT ride — rider.
- README findings (top half): Node ≥18 at :15 (badge), :195, :205 → engines is `>=22.12.0` since v3.0 (CHANGELOG:1081); a FOURTH instance at :336-337 sits INSIDE the pinned Requirements section. "Five opt-in behaviors" at :102-108 → the chair verdict scale is STANDARD (SKILL.md:150), only FOUR opt-ins remain (critic seat, expert lenses, debate mode, Claude in the council). Bottom half (300-612): CLEAN — zero wrong claims. Adjacent code find: `install.sh:17-25` + `install.ps1:16-25` still gate Node ≥ 18 (green-lighting a version the engines field rejects).
- Corrections touch NO pinned strings except the Node ≥ 18 text (the two pin suites above). Run after README edits: `npx jest tests/docs-quick-sync.test.js tests/docs-command-coverage.test.js tests/readme-requirements-deps.test.js tests/ws4-quickwins.test.js tests/where-things-live-docs.test.js tests/shim-removal-docs.test.js`.
- baseDeps: 11 byte-identical-valued fixtures (canonical 26-key `allGood`, cli-handlers-doctor.test.js:6-58; exact table + line ranges in pr4r-basedeps). `unlinkSessionIndexTmp`/`unlinkSessionMetadataTmp` never in the base. Helpers convention: `tests/helpers/<name>.js`, plain CommonJS. A second smaller 3-file duplicate (`base` in legacy-mcp/tmp-sweep/metadata-tmp-sweep) is OPTIONAL — skip, rider.
- run-chair.js:146-161 — three attempt sites each pass the same `` `${o.runId}-chN` `` literal twice (attemptChair + recordAttempt); #105's lockstep suite pins record shapes.
- README "sixteen tools" word is NOT pinned (docs-command-coverage scrapes names live) — rider for a count-neutral wording, owner call, do not build.

---

### Task 1: registry pre-check body assert (D6) + the publish-workflow pin scoping bundle

**Files:**
- Modify: `.github/workflows/publish.yml` (the pre-check block only, :112-125 region)
- Test: `tests/scripts/publish-workflow.test.js` (new pin + step-scope the whole-file ::notice::/::error:: pins), `tests/scripts/package-manifest.test.js` (the one-line ordering-pin tighten)

- [ ] **Step 1: Write the failing pins** in publish-workflow.test.js (use the file's existing step-header→login-literal slice idiom from :93-125):
```js
  test('registry skip fires only on 200 AND a body that names this exact version (D6, v4.6.3)', () => {
    const y = yml();
    const stepStart = y.indexOf('- name: Publish to MCP Registry');
    const loginStepIdx = y.indexOf('mcp-publisher login github-oidc');
    const preCheckBlock = y.slice(stepStart, loginStepIdx);
    // the body must be captured to a file (never piped — no pipefail here)
    expect(preCheckBlock).toMatch(/-o\s+"\$BODY_FILE"/);
    // the skip condition requires BOTH the status test and the body grep
    const skipCond = preCheckBlock.match(/if \[ "\$STATUS" = "200" \][\s\S]*?then/);
    expect(skipCond).not.toBeNull();
    expect(skipCond[0]).toMatch(/grep -q/);
    expect(skipCond[0]).toMatch(/\$VERSION/);
    // fail-toward-publish: the pre-check region must contain no exit 1
    expect(preCheckBlock).not.toMatch(/exit 1/);
  });
```
Then the scoping conversions: each whole-file `expect(y).toContain('::notice::')` / `('::error::')` (at :19,:30,:82,:90,:130 today) becomes the same assertion against the step slice the test's own name claims to pin (npm-publish step, registry step, gh-release step — reuse the header→header idiom). In package-manifest.test.js, retarget the stale `yml.indexOf('npm publish')` ordering pin to `indexOf('npm publish --access public --provenance')` (the actual command, not the B04 comment).

- [ ] **Step 2: RED** — the new D6 pin fails (no BODY_FILE/grep today); the converted pins must still PASS (they assert existing content, now scoped — if one fails, the scoping slice is wrong, not the yml).

- [ ] **Step 3: Implement** — publish.yml pre-check block becomes:
```bash
          BODY_FILE="${RUNNER_TEMP:-/tmp}/registry-precheck-body.json"
          STATUS=$(curl -s -o "$BODY_FILE" -w "%{http_code}" --max-time 15 \
            "https://registry.modelcontextprotocol.io/v0/servers/io.github.BourbonDog%2Famicus/versions/$VERSION" || true)
          # D6 (v4.6.3): a bare 200 is not proof of publication — the registry
          # is a PREVIEW API (schema churn expected), so the skip additionally
          # requires the body to name this exact version. grep on a missing,
          # empty, or reshaped body exits non-zero and the `&&` routes us into
          # login/publish — the same fail-toward-publish direction as `|| true`
          # above (a duplicate publish attempt is registry-idempotent; a false
          # skip would silently drop the release).
          if [ "$STATUS" = "200" ] && grep -q "\"version\"[[:space:]]*:[[:space:]]*\"$VERSION\"" "$BODY_FILE"; then
```
(The existing `::notice::` skip line and everything after stay byte-identical; keep the existing transport-guard comment block above the curl, trimming only its now-stale "so no error-string matching on the publish result is needed" sentence if it reads contradictory — judgment call, note in the report.)

- [ ] **Step 4: Green** — `npx jest tests/scripts/publish-workflow.test.js tests/scripts/package-manifest.test.js tests/ci-workflow.test.js` + `npx jest tests/scripts/` (the whole scripts family).

- [ ] **Step 5: Commit** — `git commit -m "ci(publish): registry skip requires the body to name the version (D6) + step-scoped pins"` (add the two test files + publish.yml explicitly).

### Task 2: README accuracy corrections + install-script Node gates (the owner's review, findings applied)

**Files:**
- Modify: `README.md` (:15 badge, :102-108, :195, :205, :336-337), `install.sh` (:17-25), `install.ps1` (:16-25)
- Test (pin lockstep): `tests/readme-requirements-deps.test.js` (~:30-32), `tests/ws4-quickwins.test.js` (~:13-18); plus any install-script test (grep `tests/` for install.sh/install.ps1 — update or report none)

- [ ] **Step 1 (pins first):** update the two pin suites to require the CORRECTED text (`Node.js ≥ 22.12` / `node->=22.12` — read each pin's exact regex and update minimally). RED: the updated pins fail against today's README.
- [ ] **Step 2: Correct README.**
  - :15 badge → `node->=22.12`; :195, :205, :336-337 prose → "Node.js ≥ 22.12" (keep each sentence's surrounding wording; :336 sits inside the pinned Requirements section — the Step-1 pin update covers it).
  - :102-108 → "four opt-in behaviors" with the four bullets (critic seat, expert lenses, debate mode, Claude in the council), and the **Chair verdict scale** restated as now-standard, e.g.: "**Chair verdict scale** *(standard since v2.2.0's follow-ups — no longer opt-in)*: the chair always closes with 3–5 hard questions and one parseable `VERDICT: Ship it | Fix these first | Fundamental rethink` line." (Match SKILL.md:150's framing; the VERDICT line text is already accurate.)
- [ ] **Step 3: install scripts** — `install.sh` and `install.ps1` version gates 18 → 22.12 (match each script's existing comparison mechanics exactly; these scripts green-lighting Node 18 into an engines-gate failure is the same truth-bar violation as the README claim).
- [ ] **Step 4: Green** — the six docs suites from Measured reality + any install-script suite found + `npx jest tests/docs-` glob equivalents.
- [ ] **Step 5: Commit** — `git commit -m "docs(readme): Node >=22.12 everywhere + the four real opt-in council elements (owner accuracy review)"`.

### Task 3: `makeBaseDeps()` helper + run-chair waveId consts

**Files:**
- Create: `tests/helpers/doctor-base-deps.js`
- Modify: the 11 fixture files (table in pr4r-basedeps §1), `src/council/run-chair.js` (:146-161)
- Test: existing suites unchanged in assertions (plumbing only); run-chair's existing suites re-run.

- [ ] **Step 1: The helper** — `makeBaseDeps({ omit = [], ...overrides } = {})`: builds the canonical 26-key object FRESH per call (new `jest.fn()` for probeLocalProvider), deletes `omit` keys (true absence), spreads `overrides` last. The canonical shape and values transcribe from cli-handlers-doctor.test.js's `allGood` (:6-58) VERBATIM including the institutional comments (moved into the helper's body/docblock). Docblock records: the #96 hermeticity contract, the env forward-pin history, the fresh-fn requirement, and the omit-vs-undefined semantics.
- [ ] **Step 2: Consume** — file by file, replace each local fixture with `const baseDeps = makeBaseDeps()` (or `makeBaseDeps({ omit: ['getElectronPath'] })` for doctor-electron-stat-exe; `makeBaseDeps({ omit: ['getLocalProviders', 'probeLocalProvider', 'env'] })` for doctor-local-providers — its env omission preserved byte-conservatively, one-line comment noting it's a preserved divergence). cli-handlers-doctor.test.js keeps the name `allGood = makeBaseDeps()` (its `allGood.probeLocalProvider` read still works — same object per file). Per-file second-layer overrides (`base = {...baseDeps, ...}`) stay as-is. Run each converted file's suite IMMEDIATELY after converting it (11 quick runs — a conversion error must be caught at its own file, not in a 11-file pile).
- [ ] **Step 3: waveId consts** — run-chair.js: at each of the three attempt sites, `const waveId = `${o.runId}-chN`;` then pass `waveId` to both calls. Zero behavior; run `npx jest tests/council/run-chair.test.js` (or the file's actual covering suites — grep) + the #105 lockstep suite.
- [ ] **Step 4: Green** — the full doctor family (12 suites) + run-chair's suites + `npm run check:sizes` + `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "test(doctor): makeBaseDeps() consolidates 11 duplicated fixtures; chore(council): run-chair waveId consts"`.

### Task 4: CHANGELOG + full gates

**Files:** `CHANGELOG.md` (`[Unreleased]` ONLY).

- [ ] **Step 1: CHANGELOG** — under `[Unreleased]`:
```markdown
### Fixed

- **README corrections from the v4.6.3 accuracy review**: the Node.js floor is
  22.12 (required since v3.0 — the README and install scripts still said 18),
  and the optional-council-elements list now matches the shipped skill (four
  opt-ins; the chair's verdict scale has been standard, not opt-in).

### CI

- **The MCP-Registry skip-check now verifies the version it trusts.** The
  release workflow's idempotency pre-check previously skipped registry publish
  on a bare HTTP 200; it now also requires the response body to name the exact
  version, so preview-API schema churn can no longer produce a false skip.
  Every new failure mode still routes toward publishing.
```
- [ ] **Step 2: Full gates** — `npm test` (exact counts), `npm run lint`, `npm run check:sizes`, `npm run validate-docs`, `npm run generate-docs:check` (no new src module — should be a no-op; confirm). Placement proof: `git diff main -- CHANGELOG.md` → `[Unreleased]`-only.
- [ ] **Step 3: Commit** — `git commit -m "docs(changelog): v4.6.3 PR4 — registry hardening + README truth"`. NO push, NO PR.

## Execution notes

- Tasks are independent; order as written (T1 riskiest-first, T2 pin-lockstep discipline, T3 the grind, T4 closer).
- The release cut (NOT this PR) owns: version bump incl. README:444 + docs/usage.md status examples (docs-quick-sync pins them to package.json), the CHANGELOG roll-up, BACKLOG ticks (incl. the two Phase-11 items this PR discharges — publish-workflow scoping + package-manifest tighten — and the D6 item itself), ROADMAP correction, rider transcription.
- Riders for the PR body: the "sixteen tools" unpinned count (owner call on neutral wording); the 3-file second-layer `base` duplicate (optional consolidation); the Phase-11 bundle's skill-docs items (files not opened here); doctor-local-providers' preserved env omission.
- Expected new-test delta: ~1-2 (the D6 pin); everything else is pin conversion/plumbing.
