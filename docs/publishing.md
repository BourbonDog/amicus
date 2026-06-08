# npm Publishing

**Package**: `amicus` on npm (public)
**Publishing method**: GitHub Actions with OIDC trusted publishing + provenance

## How to Publish a New Version

```bash
npm version patch   # or minor/major (bumps version + creates git tag)
git push origin main --tags
```

The `.github/workflows/publish.yml` workflow triggers on `v*` tags and publishes automatically.

## Publishing Setup

- **Trusted Publisher**: Configured on npm for `jrenaldi79/sidecar` + `publish.yml` (OIDC-based, no manual token management)
- **NPM_TOKEN**: Granular access token stored as GitHub secret (bypass 2FA enabled, scoped to `amicus`)
- **OIDC provenance**: `--provenance` flag adds Sigstore attestation (requires `id-token: write` permission)
- **Trusted publisher config**: https://www.npmjs.com/package/amicus/access (Settings tab)
