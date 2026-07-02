# npm Publishing

**Package**: `amicus` on npm (public)
**Repo**: `github.com/BourbonDog/amicus`

## How to Publish a New Version

```bash
npm version patch   # or minor/major (bumps version + creates git tag)
git push origin main --tags
```

The `.github/workflows/publish.yml` workflow triggers on `v*` tags and publishes automatically.

## What the Workflow Does

1. `npm ci` — install dependencies
2. `npm publish --access public --provenance` — publish with Sigstore attestation (requires `id-token: write` permission)
3. Create a GitHub Release with auto-generated notes
4. Call the Anthropic API to write richer release notes and update the release

**Publish auth: npm Trusted Publishing (OIDC).** Configured on npm for
`BourbonDog/amicus` + `publish.yml` (2026-06-11). The workflow authenticates via
GitHub's OIDC token (`id-token: write`) — no npm token is used. The runner
upgrades npm first (OIDC publishing needs npm ≥ 11.5; Node 22 bundles 10.x).
Provenance is implied under trusted publishing.

**Secrets:**
| Secret | Purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | Used in the "Generate release notes with Claude" step (direct `/v1/messages` call). Without it the step exits 0 with a warning and keeps the default GitHub release notes. **As of v1.0.0 this secret exists but is empty — set a real key to get Claude-written notes.** |
| `NPM_TOKEN` | **Legacy — no longer read by the workflow.** Kept only until the first successful OIDC publish confirms trusted publishing end-to-end; then delete the secret and revoke the token on npmjs.com. |

## Publishing history / notes

- v1.0.0 (2026-06-11) was published with `NPM_TOKEN` (granular, bypass-2FA). First
  attempt failed `EOTP` because the original token lacked 2FA bypass.
- Trusted Publishing was configured immediately after launch; the next tagged
  release is the first OIDC publish. If it fails, re-add a bypass-2FA granular
  token as `NPM_TOKEN` and restore the `NODE_AUTH_TOKEN` env on the publish step
  (see git history of `publish.yml`).
- After the first successful OIDC publish, optionally tighten the package's
  publishing access on npmjs.com to require trusted publishing.
- The upstream `jrenaldi79/sidecar` repo had its own npm trusted-publisher
  config; it never applied to this repository.

## Release checklist

Run top-to-bottom before `npm version`:

1. **MODEL-NOTES fold-back:** diff the machine-local ledger (`~/.claude/skills/second-opinion/MODEL-NOTES.md`) against the shipped seed (`skills/second-opinion/MODEL-NOTES.md`); port durable, machine-independent lessons into the shipped file (merge/prune, keep it tight — no run-ledger numbers, those live in `amicus council stats`).
2. `npm test` green; `npm run lint` clean.
3. `npm run generate-docs:check` passes (CLAUDE.md markers + cross-links).
4. Bump `.claude-plugin/plugin.json` `version` to match `package.json` (no script syncs it). Also bump `server.json` — both `.version` and `.packages[0].version` — to the same value (no script syncs this either).
5. Update `CHANGELOG.md` (move Unreleased → the new version).
6. `npm version <x.y.z> --no-git-tag-version` + plugin.json lockstep + server.json lockstep (`.version` and `.packages[0].version`), single `chore(release): vX.Y.Z` commit, then push main + tag (publish.yml does the rest — see the canonical ritual in Phase 2 of the 2026-07-01 review-execution plan). If you forget the server.json bump, `tests/scripts/package-manifest.test.js` fails the suite (`server.json versions stay in lockstep with package.json`) — that's your safety net, but don't rely on it; do the bump.
