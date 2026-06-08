# Amicus compatibility shims (remove in a future revision)

These backward-compat shims let pre-rebrand `sidecar*` setups keep working after
the Amicus rebrand. Each is logged once on use where applicable. **Remove all of
these together in a future major revision once users have migrated.** See the
rebrand plan: `docs/superpowers/plans/2026-06-08-amicus-rebrand.md`.

| Shim | Location | Legacy form kept working | Remove by |
| --- | --- | --- | --- |
| Env var prefix | src/utils/env-compat.js | SIDECAR_* env vars | next major |
| CLI bins | package.json bin | sidecar, claude-sidecar commands | next major |
| Config dir | src/utils/config.js getConfigDir | ~/.config/sidecar fallback | next major |
| Session dir | src/session-manager.js + call sites | .claude/sidecar_sessions reads | next major |
| Config token | config.js + skill parser | [SIDECAR_CONFIG_UPDATE] / sidecar-config-hash parse | next major |
| MCP tool names | src/mcp-server.js registration | sidecar_* tool aliases | next major |
| Public API | src/index.js | startSidecar/listSidecars/... aliases | next major |
