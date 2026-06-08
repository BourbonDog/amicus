# Amicus compatibility shims (remove in a future revision)

These backward-compat shims let pre-rebrand `sidecar*` setups keep working after
the Amicus rebrand. Each is logged once on use where applicable. **Remove all of
these together in a future major revision once users have migrated.** See the
rebrand plan: `docs/superpowers/plans/2026-06-08-amicus-rebrand.md`.

| Shim | Location | Legacy form kept working | Remove by |
| --- | --- | --- | --- |
| Env var prefix | src/utils/env-compat.js | SIDECAR_* env vars | next major |
