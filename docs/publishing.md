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

**Secrets required at publish time:**
| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | Granular access token scoped to `amicus`. Required for `npm publish`. |
| `ANTHROPIC_API_KEY` | Used in the "Generate release notes with Claude" step (direct `/v1/messages` call). Without it the step exits 0 with a warning and keeps the default GitHub release notes. |

## Launch Prerequisites for Amicus

The publish workflow is set up but a first publish to npm requires manual one-time steps:

1. **Create the npm package** — `npm publish --access public` from an authorized account (the package name `amicus` must be available or already owned by the `BourbonDog` account).
2. **Store `NPM_TOKEN`** — Generate a granular access token at [npmjs.com → Access Tokens](https://www.npmjs.com/settings/tokens) (bypass 2FA enabled, scoped to the `amicus` package), and add it as a GitHub Actions secret named `NPM_TOKEN` in the `BourbonDog/amicus` repository settings.
3. **OIDC Trusted Publishing (optional)** — The workflow currently uses `NPM_TOKEN`. If you prefer token-free OIDC publishing, configure a Trusted Publisher on npm for `BourbonDog/amicus` + `publish.yml`. This replaces the `NPM_TOKEN` secret. See [npmjs.com/settings/~/access](https://www.npmjs.com/settings/~/access).
4. **`ANTHROPIC_API_KEY`** — Add as a GitHub Actions secret to enable rich release notes. The step is non-fatal if missing.
5. **Trusted publisher note** — The upstream `jrenaldi79/sidecar` repo had its own npm trusted-publisher config. That config does NOT apply to `BourbonDog/amicus`. You must configure publishing fresh for this repository.
