// tests/helpers/doctor-base-deps.js
'use strict';

/**
 * makeBaseDeps({ omit = [], ...overrides } = {})
 *
 * Factory for the canonical 26-key `runDoctorChecks` deps fixture, formerly
 * duplicated byte-identically across 11 doctor-family suites (~360 lines).
 * Builds a FRESH object on every call and returns it — no shared/module-level
 * state — so each consumer file owns its own instance.
 *
 * Contract (do not weaken without re-reading the 11 consumer files):
 *
 * - Fresh `jest.fn()` per call. `probeLocalProvider` must be a new mock
 *   instance every time this factory runs — cli-handlers-doctor.test.js:79
 *   asserts `allGood.probeLocalProvider` was NEVER called across the whole
 *   file's test run. A shared/module-level jest.fn() would let calls from
 *   one test bleed into that assertion for another; a factory sidesteps the
 *   whole class of bug by construction.
 *
 * - `omit` means true key ABSENCE, not `key: undefined`. Two consumers rely
 *   on this:
 *     - doctor-electron-stat-exe.test.js needs `getElectronPath` genuinely
 *       missing so realDeps()'s electron wrapper seam falls through (a
 *       present-but-undefined key does not trigger the same fall-through in
 *       a plain object spread/merge).
 *     - doctor-local-providers.test.js needs `getLocalProviders` and
 *       `probeLocalProvider` genuinely missing — not because a pinned base
 *       value would otherwise fight the per-test override (spreading
 *       `{...baseDeps, ...deps}` already lets `deps` win either way, and
 *       every call site in that file supplies both keys). The omission is
 *       preserved byte-conservatively: it matches the pre-consolidation
 *       fixture's exact shape, which this factory does not silently change.
 *   `omit` deletes the keys from the freshly-built object before returning
 *   it, so `Object.keys(makeBaseDeps({ omit: ['x'] }))` truly excludes `x`.
 *
 * - `overrides` spread LAST, after the omit deletions, so a caller can both
 *   omit and override in one call if ever needed (`{...base, ...overrides}`
 *   ordering, applied post-omit).
 *
 * Institutional comments below (M14, B14, B15, D8, engine-mcp, electron-mcp
 * #76, v4.6.2 PR1 env forward-pin) are transcribed verbatim from
 * cli-handlers-doctor.test.js's original `allGood` (the canonical source,
 * :6-58) — they document WHY each fixture value is pinned, not just what it
 * is, and must not be deleted on future edits to this helper.
 */
function makeBaseDeps({ omit = [], ...overrides } = {}) {
  const base = {
    nodeVersion: 'v20.0.0',
    readApiKeys: () => ({ openrouter: true, google: false, openai: false, anthropic: false, deepseek: false }),
    readApiKeyValues: () => ({ openrouter: 'sk-or-good' }),
    checkOpenRouterCredit: () => Promise.resolve({ warning: null, isFreeTier: false, limitRemaining: 5, limit: 10, usage: 5 }),
    getCwd: () => 'C:\\Users\\me\\code\\amicus',
    readProjectMarkers: () => ({ hasGit: true, hasPackageJson: true, hasClaude: false }),
    getConfigDir: () => '/cfg',
    resolveModel: () => 'openrouter/google/gemini-3.5-flash',
    readCache: () => ({ fetchedAt: Date.now(), models: [{ id: 'openrouter/google/gemini-3.5-flash' }] }),
    collectAliasSources: () => [{ alias: 'gemini', model: 'openrouter/google/gemini-3.5-flash', source: 'defaults' }],
    findStaleAliases: () => [],
    hasOpencodeBinary: () => true,
    getElectronPath: () => '/path/to/electron',
    // B14: hasAmicusRegistration (raw, unstripped read) is the PRIMARY 'mcp'
    // check signal — discoverClaudeCodeMcps can never produce { amicus: {} }
    // because it always strips the amicus entry (recursive-spawn guard).
    hasAmicusRegistration: () => true,
    discoverCoworkMcps: () => ({ amicus: {} }),
    inspectLegacyMcpEntries: () => [
      { target: 'Claude Code', status: 'absent' },
      { target: 'Claude Desktop', status: 'absent' },
    ],
    migrateLegacyMcpEntries: () => [],
    skillInstalled: () => true,
    // B15: deterministic fixture — without this the check would fall through to
    // the real config dir on whatever machine runs the suite (non-deterministic).
    listSessionIndexTmpFiles: () => [],
    // D8: same rationale, one level down — without this the metadata sweep
    // would fall through to the real cwd's .claude/amicus_sessions.
    listSessionMetadataTmpFiles: () => [],
    // engine-mcp: deterministic scan — without it the check probes the real
    // machine's installs (non-deterministic). 'none' → the check reports ok.
    scanEngineInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
    // engine self-heal (--fix): deterministic no-op unless a test overrides it.
    repairEngine: async () => ({ repaired: false }),
    // electron-mcp (#76): deterministic scan, same rationale as scanEngineInstalls.
    scanElectronInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
    // M14: deterministic fixture — without this the local-providers check would
    // fall through to the real config dir (and, worse, fire a REAL probe against
    // it) on whatever machine runs this "pure" doctor suite. probeLocalProvider
    // must never be called with the empty map above.
    getLocalProviders: () => ({}),
    probeLocalProvider: jest.fn(),
    // v4.6.2 PR1: the anthropic-base-url check reads d.env (falling through to the
    // real process.env only when a caller omits it — see
    // src/utils/doctor-base-url-check.js). Pinning it empty here keeps this fixture
    // "healthy" deterministic regardless of the host/parent-process env, same
    // rationale as the M14 getLocalProviders() pin above (a dev or CI process that
    // happens to carry ANTHROPIC_BASE_URL, e.g. set by the Claude Code app itself,
    // must not turn this into a warn).
    env: {},
  };

  for (const key of omit) {
    delete base[key];
  }

  return { ...base, ...overrides };
}

module.exports = { makeBaseDeps };
