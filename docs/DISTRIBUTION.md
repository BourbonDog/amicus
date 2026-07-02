# Distribution channels

Amicus ships through three channels. This doc is the runbook for each — what's
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
`commands/council.md` — that only ships via the plugin channel below (see
Task 9a report, "Concerns" #2 — a known, accepted gap for npm/install-script
users).

## 2. Claude Code community marketplace (claude-community)

**Status: not yet submitted.** (Update this line when the human step below
happens: `Status: submitted <date> / approved <date> / listed <date>`.)

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
claude plugin validate . --strict
claude --plugin-dir .   # smoke: /amicus:council, /amicus:sidecar, /amicus:second-opinion, MCP tools
npm test
```

- `claude plugin validate . --strict` is the same structural check the
  review pipeline runs; `--strict` promotes unrecognized-field warnings to
  errors so nothing slips through that CI would later flag. It needs the
  Claude Code CLI installed locally — it is **not** wired into this repo's
  CI (runners have no `claude` auth), so `tests/plugin-manifest.test.js` is
  the CI-side proxy for manifest completeness.
- `claude --plugin-dir .` loads the plugin from the working tree so you can
  manually confirm `/amicus:council`, `/amicus:sidecar`, and
  `/amicus:second-opinion` all appear in the command picker exactly once,
  and that the `amicus` MCP server connects (tools list populates).
- `npm test` must be green, specifically `tests/plugin-manifest.test.js`
  and `tests/plugin-commands.test.js`.

**Known current-tree preflight result (checked 2026-07-02, commit range
based on `p9/distribution` at 249a8cc):** `claude plugin validate . --strict`
reports one warning — `plugin.json → bugs: Unknown field 'bugs'`. This is
pre-existing (present since v1.8.1, predates Phase 9), harmless (Claude Code
ignores unrecognized fields at load time — the tool says so directly), and
out of scope for this task since `.claude-plugin/plugin.json` isn't in this
task's file list. Fix it in a follow-up before submitting for real, or accept
it — either way `--strict` will report it until then, so don't mistake the
resulting non-zero preflight exit as a `commands/` or metadata regression.

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
   task — premature before approval; see Task 9b report).

*(Everything in this subsection past "search 'amicus' in
`marketplace.json`" is unverified as of 2026-07-02 in the sense that we
haven't been through it yet — it's the documented expected flow per
Anthropic's published docs, not something we've personally exercised
end-to-end against the real submission.)*

## 3. MCP Registry

**Status: not started (Phase 9c).** No `server.json` exists in this repo yet
and `.github/workflows/publish.yml` has no MCP Registry publish step as of
this writing — both are Phase 9c scope, not this task's. Per the Phase 9
plan, publish to the MCP Registry only after the tool-surface de-bloat lands
(14 tools: 13 + `amicus_wait`), so the registry entry describes the
post-de-bloat surface rather than something we immediately have to revise.
