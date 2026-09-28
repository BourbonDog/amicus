# Distribution channels

Amicus ships through several channels. This doc is the runbook for each — what's
live today, what the submission/publish steps are, and what to check before
pulling the trigger on a release-facing action.

## 1. npm (existing)

**Status: live.** Tag `v*` on `main` → `.github/workflows/publish.yml` → npm
**Trusted Publishing** (GitHub OIDC, no long-lived npm token in CI) →
`npm publish --access public --provenance`. The workflow also cuts a GitHub
Release and asks Claude to draft categorized release notes from the commit
log + diff since the previous tag.

Postinstall (`scripts/postinstall.js`) registers the MCP server in Claude
Code / Claude Desktop / Cowork and copies both skills (`sidecar`,
`second-opinion`) into `~/.claude/skills/`. It does **not** copy
`commands/council.md` — that only ships via the plugin channel below. This
is a known, accepted gap for npm/install-script users (slash commands are
plugin-channel-only by design; see the npm-vs-plugin note in CHANGELOG.md's
`[1.9.0]` entry).

## 2. Claude Code community marketplace (claude-community)

**Status: submitted 2026-07-01 — never listed (re-checked 2026-09-28). Owner:
resubmit through the Console form.** (Update this line as the process advances:
`submitted <date> / approved <date> / listed <date>`.
Note: the submission predates the Phase-9 polish on `main` — reviewers pulling
the repo see the current surface, including `commands/` and a clean
`claude plugin validate . --strict`.)

Two Anthropic-run marketplaces exist:
- **`claude-plugins-official`** — curated by Anthropic, no application process.
- **`claude-community`** — third-party plugins, submitted for review. This is
  the one amicus targets.

Approved plugins are pinned to a commit SHA in
`anthropics/claude-plugins-community/.claude-plugin/marketplace.json`. CI in
that repo auto-bumps the pin as we push to `main`, and the public catalog
syncs from it nightly (a delay after any push is normal, not a bug). **PRs
opened directly against `anthropics/claude-plugins-community` are closed
automatically** — the only way in is the submission form below.

Because the pin auto-bumps on every push to `main`, every push after listing
reaches marketplace users on their next sync. `plugin.json` already pins an
explicit `version` synced to `package.json` (enforced by
`tests/plugin-manifest.test.js`), so this is the existing safe behavior:
users only see a version bump when we bump it, not on every commit. Treat
`main` as release-quality once listed.

### Preflight (run before every submission or major post-listing update)

```bash
claude plugin validate .claude-plugin/plugin.json    # the PLUGIN check — see the path trap below
claude plugin validate .                             # the marketplace manifest (separate check)
claude --plugin-dir .   # smoke: /amicus:council, /amicus:sidecar, /amicus:second-opinion, MCP tools
npm test
```

- **Path trap — `claude plugin validate .` does NOT validate the plugin.**
  This repo's `.claude-plugin/` holds *both* `marketplace.json` and
  `plugin.json`; given `.`, the CLI resolves the marketplace manifest, prints
  `Validating marketplace manifest:` / `✔ Validation passed`, and never looks
  at the plugin, its commands, or its skills. Always pass
  `.claude-plugin/plugin.json` explicitly for the plugin check — that is the
  surface the review pipeline evaluates. (This masked a real defect for a
  month: `commands/council.md` shipped an unparseable `argument-hint` from
  2026-07-02 until 2026-08-01 while `.` reported clean. Read the first line
  of the output — it names which manifest was actually checked.)
- `claude plugin validate` is the same structural check the review pipeline
  runs. It needs the Claude Code CLI installed locally — it is **not** wired
  into this repo's CI (runners have no `claude` auth), so
  `tests/plugin-manifest.test.js` and `tests/plugin-commands.test.js` are the
  CI-side proxies. The latter now YAML-parses the command and skill
  frontmatter (`yaml` is a devDependency for exactly this); substring
  assertions like `toContain('argument-hint:')` cannot see a parse failure,
  which is how the `council.md` defect passed CI.
- **`--strict` is expected to FAIL here, by design.** It promotes the
  root-`CLAUDE.md` warning ("not loaded as project context") to an error. The
  plugin root is the repo root, and `CLAUDE.md` is this repo's development
  context — we keep it deliberately. Use the non-strict run as the gate and
  read the warning list by eye; a *new* warning is the signal, not the
  `CLAUDE.md` one.
- `claude --plugin-dir .` loads the plugin from the working tree so you can
  manually confirm `/amicus:council`, `/amicus:sidecar`, and
  `/amicus:second-opinion` all appear in the command picker exactly once,
  and that the `amicus` MCP server connects (tools list populates).
- `npm test` must be green, specifically `tests/plugin-manifest.test.js`
  and `tests/plugin-commands.test.js`.

**Known current-tree preflight result (checked 2026-08-01, on
`fix/plugin-frontmatter-validation`):**
`claude plugin validate .claude-plugin/plugin.json` → exit 0,
`✔ Validation passed with warnings` (the one retained root-`CLAUDE.md`
warning). With `--strict` → exit 1 on that same warning, as documented above.
`claude plugin validate .` → exit 0 on the marketplace manifest.

History of this line: it previously read "`claude plugin validate . --strict`
passes clean, exit 0" as of 2026-07-02 — measured against the *marketplace*
manifest via the path trap above, while the plugin itself had a hard
frontmatter error in `commands/council.md`. Older still: `--strict` flagged an
unknown `plugin.json → bugs` field, removed in commit `4207485`.

### Submit

- **Individual-author route:** https://platform.claude.com/plugins/submit
  (Console form). This is the route for us — Christian has no Team/Enterprise
  org, so the directory-management admin route below doesn't apply.
- **Team/Enterprise route:** https://claude.ai/admin-settings/directory/submissions/plugins/new
  (requires Team/Enterprise org + directory management permissions — not
  applicable here, listed for completeness).
- **Metadata to enter in the form:**
  - Repository: `https://github.com/BourbonDog/amicus` (public, MIT)
  - Plugin name: `amicus`
  - Description: pulled from `.claude-plugin/plugin.json` → `description`
  - Contact: `sendtowags@outlook.com`
- **Timing:** submit only after Task 9a (`commands/council.md` + the sidecar
  argument surface) has merged to `main`, so the SHA the reviewer evaluates
  and the SHA that eventually gets pinned both include the slash commands.
  Submitting before 9a merges means the reviewed surface is incomplete.
- Never open a PR against `anthropics/claude-plugins-community` — it's a
  read-only mirror for the public catalog; PRs there are auto-closed.

### What review checks (and what it might ask about)

The pipeline runs `claude plugin validate` plus automated safety screening.
There's no published SLA for turnaround — **budget this as unscheduled** and
don't put any downstream work on the critical path of approval.

Anticipated reviewer question: the npm package runs a postinstall
(`scripts/postinstall.js`) and the repo ships `install.sh` / `install.ps1`.
The **plugin channel itself never triggers postinstall** —
`.claude-plugin/plugin.json`'s `mcpServers.amicus.env` sets
`AMICUS_SKIP_POSTINSTALL=1`, so a plugin install only ever runs
`npx -y amicus@latest mcp` with that guard set, not the interactive
setup/registration flow. This paragraph is the answer if a reviewer asks.

### After approval

1. Search `"amicus"` in
   https://github.com/anthropics/claude-plugins-community/blob/main/.claude-plugin/marketplace.json
   to confirm the listing synced (nightly delay after approval is normal).
2. End-to-end verify:
   ```bash
   claude plugin marketplace add anthropics/claude-plugins-community
   claude plugin install amicus@claude-community
   ```
3. Update the Status line at the top of this section with the
   submitted/approved/listed dates.
4. Optionally add an "Install as a Claude Code plugin" section to
   `README.md` referencing `@claude-community` (not done as part of this
   task — premature before approval, since the listing doesn't exist yet).

*(Everything in this subsection past "search 'amicus' in
`marketplace.json`" is unverified as of 2026-07-02 in the sense that we
haven't been through it yet — it's the documented expected flow per
Anthropic's published docs, not something we've personally exercised
end-to-end against the real submission.)*

## 3. MCP Registry

**Status: published.** `server.json` (repo root) and the `mcpName` field in
`package.json` exist, and `.github/workflows/publish.yml` publishes to the
MCP Registry (`registry.modelcontextprotocol.io`) as the last three steps
before the GitHub Release, on every `v*` tag push. Published since v1.9.1
(2026-07-03; v1.9.0's attempt was rejected — see the 422 caveat below); the
v4.14.1 entry was confirmed active on 2026-09-28 at its per-version registry
endpoint.

**Namespace:** `io.github.BourbonDog/amicus` (case-sensitive — the registry
grants `io.github.<Login>/*` using the exact-case GitHub login/repository
owner). Confirmed unclaimed via
`https://registry.modelcontextprotocol.io/v0/servers?search=amicus`
(0 results, checked 2026-07-02).

**Flow:** tag↔`package.json` version lockstep is verified first (fails fast
with `::error::` on a mis-tag) → npm publish (existing, OIDC), itself guarded
by a version-exists check so a re-run does not re-attempt a version already
live on npm → `mcp-publisher` binary installed → `server.json` version
synced from the tag via `jq` (belt-and-braces; the in-repo
`server.json`/`package.json`/`packages[0]` versions are also kept in
lockstep by hand at release time and enforced by
`tests/scripts/package-manifest.test.js`) → MCP Registry publish, itself
pre-checked against the registry API so a re-run does not double-publish →
`mcp-publisher login github-oidc` (no secret needed, uses the same
`id-token: write` OIDC permission as the npm Trusted Publishing step),
retried up to 5 times on transient OIDC token-exchange failures → `mcp-publisher
publish`, retried up to 5 times (npm propagation lag) before hard-failing the
job → GitHub Release creation, guarded by an existence check so a re-run
does not fail on a release that already exists. The registry steps run
strictly after `npm publish` because npm-side ownership validation reads
`mcpName` from the *published* `package.json`.

**Release-order dependency (historical — satisfied before the first registry
publish):** the first post-merge `v*` tag had to wait for the Phase 4
tool-surface de-bloat, because the server still registered 13 deprecated
`sidecar_*` aliases alongside the real tools and the first registry publish
snapshots whatever surface exists at that time. Both have long since landed.
The rule that outlives the episode: **a registry publish snapshots the tool
surface, so land any tool-surface change before you cut the tag.** For the
current tool count, see the MCP table in [README.md](../README.md) — it is the
single source of truth and moves with each release (v4.0 added
`amicus_council_run`).

**Registry preview caveat:** the MCP Registry is still in preview per its
own docs (breaking changes/data resets possible before general
availability). The publish steps are additive to the existing npm/GitHub
Release flow and do not touch it; a registry publish failure after 5 retries
does fail the workflow job (hard `exit 1`), which means the 'Create GitHub
Release' step does not run on that path. If that trade-off proves unwanted
in practice, add `continue-on-error: true` to the 'Publish to MCP Registry'
step.

**First-publish de-risk (historical — the first publish, v1.9.1, happened on
2026-07-03; the manual recovery path below reuses these steps):** before
relying on CI for the first real publish,
run once locally: download `mcp-publisher` (Windows: the tarball flow from
the quickstart docs), `mcp-publisher login github` (device-flow auth as
BourbonDog), then `mcp-publisher publish` — to fail fast on any
namespace/validation error outside of CI. If publish returns "You do not
have permission…", the error message states the granted pattern; align
`server.json`'s `name` casing to it exactly.

**If the registry publish fails in CI (Phase 11 hardening):** re-running the
workflow is now the primary recovery path. Every publish-ish step in
`publish.yml` is idempotency-guarded, so a re-run skips whatever already
succeeded and only retries the step that actually failed:
- **npm publish** checks `npm view amicus@<version>` first and skips with a
  `::notice::` if that version is already on the registry (instead of
  hitting `EPUBLISHCONFLICT`).
- **MCP Registry publish** pre-checks
  `registry.modelcontextprotocol.io/v0/servers/io.github.BourbonDog%2Famicus/versions/<version>`
  (HTTP 200 = already published, 404 = not yet) and skips with a
  `::notice::` if present, before attempting login or publish.
- **`mcp-publisher login github-oidc`** now retries up to 5 times (20s
  apart) on transient OIDC token-exchange failures, same pattern as the
  publish retry.
- **GitHub Release creation** checks `gh release view <tag>` first and skips
  with a `::notice::` if the release already exists.

So: fix whatever caused the failure (registry outage, OIDC hiccup, etc.),
then re-run the failed job from the Actions tab (or `gh run rerun
--failed`). Do not delete and re-push the tag — the existing job re-run is
sufficient, and steps that already succeeded (npm publish, an earlier
registry publish, an existing release) are detected and skipped rather than
re-attempted or double-published.

**Caveat — content-level 422s are NOT re-run-recoverable.** A workflow
re-run checks out the tag, so a `server.json` validation error (the registry
returns HTTP 422 naming the failing field) reproduces identically on re-run.
Fix `server.json` on main and recover via the manual path below, or let the
fix ride the next tag. Known registry constraint (learned live): the
top-level `description` is capped at **100 characters** — v1.9.0's first
publish attempt 422'd on a 199-char description (2026-07-03); now pinned by
`tests/scripts/package-manifest.test.js`.

**Manual recovery (fallback, if re-run is not viable):**
1. **Registry publish:** run the same local de-risk flow above for real —
   `mcp-publisher login github` (device-flow login as BourbonDog), sync
   `server.json`'s `.version` and `.packages[0].version` to the tag that
   already published to npm, then `mcp-publisher publish`.
2. **GitHub Release:** cut it by hand:
   `gh release create <tag> --generate-notes --latest`. The "Generate release
   notes with Claude" step is optional polish — skip it or run it manually
   against the API.

## 4. Chocolatey (Windows)

**Status: drafted, not published.** Package id `amicus` confirmed unclaimed on
`community.chocolatey.org` (checked 2026-09-28). The package wraps a global npm
install (`npm install -g amicus@<version>`) behind a `nodejs-lts` dependency,
rather than bundling a Node binary — Chocolatey installs the dependency first.

**Repo home:** `packaging/chocolatey/amicus.nuspec` and
`packaging/chocolatey/tools/chocolateyInstall.ps1` /
`chocolateyUninstall.ps1`. Not part of the npm tarball — `package.json`'s
`files` field is unrelated to this channel.

**The postinstall-under-elevation risk.** `choco install` commonly runs
elevated, sometimes under a different admin account or as SYSTEM.
`scripts/postinstall.js`'s skill/MCP registration resolves
`os.homedir()`/`%APPDATA%`, which in that case belongs to the elevated
account, not the interactive user — a silent misplacement, not a visible
failure (`runCli()`'s wrapper always exits 0). `chocolateyInstall.ps1` sets
`AMICUS_SKIP_POSTINSTALL=1` before the npm install (the same guard the
Claude Code plugin channel already relies on) and prints instructions to run
`amicus init` / `amicus setup` / `amicus doctor` afterward from an ordinary,
non-elevated prompt.

**Same-account elevation only, for now.** The guard fixes only the
registration half. The package currently supports same-account elevation
only: npm's global prefix is per-account (Node's bundled npmrc sets
`prefix=${APPDATA}\npm`), so under a different admin account or SYSTEM,
amicus and its `amicus`/`am` shims land in that account's `%APPDATA%\npm`,
off the interactive user's PATH — and the install still exits 0. A
machine-wide prefix is the alternative; choosing it is an owner decision
(B-REL-5), not part of this draft.

**Before the first submission:** a real elevated local install has not been
run — this package is untested against a real Chocolatey install. Test it
first on a real Windows account, ideally a second one, elevating as that same
account (same-account elevation only, above):

1. Run `choco pack` in `packaging/chocolatey/`.
2. From an elevated prompt in that same directory (`choco install` needs an
   admin shell by default), run
   `choco install amicus --source "'.;https://community.chocolatey.org/api/v2/'"`.
   The community feed after the semicolon is what lets the `nodejs-lts`
   dependency resolve.
3. From the interactive account, in an ordinary (non-elevated) prompt,
   `where.exe amicus` must resolve before `amicus init` is run (`where.exe`,
   because in PowerShell `where` is an alias for Where-Object). Then confirm
   `amicus init` finds Node on PATH and completes.
4. After the install, open an ordinary (non-elevated) prompt, run
   `amicus doctor`, and confirm it finds the OpenCode engine binary, because
   the package installs through `npm install -g`, npm 11 warns about install
   scripts that are not on its allow-scripts list (a later phase of that
   policy is to block them), and opencode-ai's install script is what places
   the engine binary.

Then create a community.chocolatey.org account + API key and `choco push`.

**Version:** `amicus.nuspec`'s `<version>` is a manual pin site, kept in
lockstep with `package.json`/`server.json`/`.claude-plugin/plugin.json` by
hand at release time (`docs/publishing.md`'s checklist) — no automated test
enforces this one yet, unlike `server.json`
(`tests/scripts/package-manifest.test.js`). A Chocolatey package-fix re-push
for the same amicus release adds a fourth, numeric segment (for example
`4.14.1.20261001`); `chocolateyInstall.ps1` passes only the first three to
npm, so it still installs `amicus@4.14.1`.

## 5. Third-party MCP directories

Status as of 2026-09-28:

| Directory | Status | Action needed |
|---|---|---|
| Glama | Listed (auto-indexed from the MCP Registry), **unclaimed** | Owner: claim via GitHub OAuth, HTTP, or DNS at glama.ai/mcp/servers/BourbonDog/amicus |
| PulseMCP | Listed (auto-ingested from the MCP Registry) | None — submissions/changes are globally paused |
| mcp.so | Not listed | Owner: submit at mcp.so/submit (free reviewed queue, or a paid immediate track) |
| Smithery | Not listed — **deferred** | None planned. Its current publish flow needs either a hosted Streamable-HTTP endpoint or a pre-built MCPB bundle; amicus's MCP server is stdio-only (`server.json`'s `packages[0].transport.type`) and has neither. Owner-deferred 2026-09-28. |
| `punkpeye/awesome-mcp-servers` | Not listed | Owner: fork + one-line README PR under "Coding Agents" |

Pattern: the two directories that already carry amicus (Glama, PulseMCP) are the
two that auto-ingest the official MCP Registry (§3) — amicus has been
registry-published since 2026-07-03. The other three each need a distinct,
separate submission regardless of registry status.
