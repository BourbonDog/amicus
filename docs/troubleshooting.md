# Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Amicus process not self-terminating | Idle timeout misconfigured or disabled | Check per-mode overrides first: `AMICUS_IDLE_TIMEOUT_HEADLESS`, `AMICUS_IDLE_TIMEOUT_INTERACTIVE`, `AMICUS_IDLE_TIMEOUT_SERVER`. The blanket `AMICUS_IDLE_TIMEOUT` overrides all modes. Set `LOG_LEVEL=debug` to trace watchdog transitions |
| Shared server crash loop | Server crashing repeatedly | Check logs for the root cause; after 3 restarts in 5 min the server halts. Use `AMICUS_SHARED_SERVER=0` to fall back to per-process mode |
| Resume fails with "session already active" | Stale `session.lock` file from a previous crash | Usually auto-recovers: if the old process is dead, the lock is reclaimed automatically on next resume. Manual deletion only needed if the PID was reused by another process: `rm <project>/.claude/sidecar_sessions/<task_id>/session.lock` |
| Cold start latency after server idle timeout | Shared server was shut down and must restart | Increase `AMICUS_IDLE_TIMEOUT_SERVER` to keep the server alive longer between requests |
| `command not found: opencode` | OpenCode binary not found | Reinstall: `npm install -g amicus` (opencode-ai is bundled) |
| `spawn opencode ENOENT` | CLI not in PATH | Verify `path-setup.js` runs before server start; check `node_modules/.bin/opencode` exists |
| API 400 Bad Request | Model format wrong | Use `{providerID, modelID}` object, not string. See `formatModelForAPI()` |
| Jest ESM mock fails | Dynamic import | Skip test with `it.skip()` or use `--experimental-vm-modules` |
| Session resolution fails | No recent session | Pass explicit `--session` flag |
| Electron window blank | Assets not built | Run from project root |
| Headless stalls silently | `chat` agent in `--no-ui` mode | Use `--agent build` or remove `--no-ui` |
| Headless timeout | Task too complex | Increase `AMICUS_TIMEOUT` |
| Context too large | Too many turns | Use `--turns` or `--tokens` filter |
| API key errors | Missing env var | Set `OPENROUTER_API_KEY` in .env |
| Summary not captured | Fold not clicked | Click FOLD button or wait for [SIDECAR_FOLD] |
| Question tool fails after answer | Using sync API | Ensure `sendToAPIStreaming()` is used, not `sendToAPI()` |
