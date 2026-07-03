'use strict';
/**
 * Phase 18 / Task 18.3 — post-removal docs sweep. #19 removed the sidecar*
 * compatibility shims (SIDECAR_* env fallback, sidecar/claude-sidecar bin
 * aliases, ~/.config/sidecar dir fallback, .claude/sidecar_sessions dual-read,
 * the sidecar_* MCP tool aliases + AMICUS_LEGACY_ALIASES, and the public API
 * *Sidecar export aliases). These pins lock that every doc claiming any of
 * those things are still "honored"/"still read"/"deprecated but working" has
 * been rewritten to v2.0.0 reality: removed, with a migration remedy.
 *
 * KEEPs (never touched by this sweep, asserted negatively is out of scope):
 *   - the [SIDECAR_FOLD] / [SIDECAR_FOLD:<nonce>] wire-format token (unrelated
 *     to the compat shims; still emitted by the current binary)
 *   - the skills/sidecar/ and .claude/skills/sidecar/ *directory name* (the
 *     skill is still named "sidecar", it was never renamed)
 *   - src/sidecar/fanout.js and other internal source paths under src/sidecar/
 *   - the mcp-self-identity recursive-spawn guard recognizing old bin/server
 *     names 'sidecar'/'claude-sidecar' (a defense against a stale PATH/MCP
 *     config launching a zombie amicus-in-amicus loop, not a compat shim)
 *   - CHANGELOG.md historical version entries (immutable)
 */
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8').replace(/\r\n/g, '\n');

describe('README.md — legacy-alias claims rewritten to removal reality', () => {
  const readme = read('README.md');

  it('the SHIMS.md doc-table pointer no longer promises a live alias mapping', () => {
    // Old: "including the legacy SIDECAR_*→AMICUS_* shim mapping" (implies live).
    expect(readme).not.toMatch(/legacy `?SIDECAR_\*`? *(→|->) *`?AMICUS_\*`? shim mapping/i);
  });

  it('the SHIMS.md documentation-table row recharacterizes it as a removal record', () => {
    const docTableRow = readme.match(/\|\s*\[docs\/SHIMS\.md\]\(\.\/docs\/SHIMS\.md\)\s*\|.*\|/);
    expect(docTableRow).toBeTruthy();
    expect(docTableRow[0]).toMatch(/removal record|migration reference|removed in v2\.0\.0|historical/i);
  });

  it('the EEXIST troubleshooting row no longer claims legacy paths are still read', () => {
    const row = readme.match(/\|\s*`npm install -g amicus` fails with `EEXIST[\s\S]*?\|\s*\n/);
    expect(row).toBeTruthy();
    expect(row[0]).not.toMatch(/legacy paths are still read/i);
  });

  it('[SIDECAR_FOLD] wire-token literal is kept (unrelated to compat shims)', () => {
    expect(readme).toMatch(/\[SIDECAR_FOLD\]/);
  });
});

describe('docs/usage.md — legacy-alias / legacy-env claims rewritten', () => {
  const usage = read('docs/usage.md');

  it('MCP tools section states sidecar_* aliases do not exist and AMICUS_LEGACY_ALIASES is a no-op', () => {
    const mcpSection = usage.slice(usage.indexOf('## MCP Server'), usage.indexOf('## OpenCode Agent Types'));
    expect(mcpSection).not.toMatch(/will be removed entirely in the next major/i);
    expect(mcpSection).toMatch(/no longer (exist|register|registered)|removed (entirely )?in v2\.0\.0/i);
    expect(mcpSection).toMatch(/AMICUS_LEGACY_ALIASES/);
    expect(mcpSection).toMatch(/no-op|no effect|inert/i);
  });

  it('Process Self-Termination section no longer claims legacy SIDECAR_IDLE_TIMEOUT* is honored', () => {
    const section = usage.slice(usage.indexOf('## Process Self-Termination'), usage.indexOf('## JSON Output'));
    expect(section).not.toMatch(/still honored/i);
    expect(section).not.toMatch(/Legacy `SIDECAR_IDLE_TIMEOUT\*` names still honored/i);
  });

  it('fold handoff [SIDECAR_FOLD] wire-token literal is kept', () => {
    expect(usage).toMatch(/\[SIDECAR_FOLD\]/);
  });
});

describe('docs/configuration.md — legacy env/config/session claims rewritten to v2.0.0 reality', () => {
  const config = read('docs/configuration.md');

  it('AMICUS_ENV_DIR row no longer claims precedence over a working legacy SIDECAR_ENV_DIR', () => {
    const behaviorTable = config.slice(config.indexOf('## Behavior'), config.indexOf('## Headless Poller Tuning'));
    expect(behaviorTable).not.toMatch(/Takes precedence over the legacy `SIDECAR_ENV_DIR` name \(which still works/i);
  });

  it('Process Lifecycle section no longer claims legacy SIDECAR_IDLE_TIMEOUT* is honored', () => {
    const section = config.slice(config.indexOf('## Process Lifecycle'), config.indexOf('### Shared server'));
    expect(section).not.toMatch(/still honored/i);
  });

  it('the config-dir "Legacy fallback" bullet states the fallback is gone, not live', () => {
    const wtl = config.slice(config.indexOf('## Where things live'));
    const configTree = wtl.slice(0, wtl.indexOf('### Session storage'));
    expect(configTree).not.toMatch(/Amicus reads from the legacy dir until the one-time, non-destructive/i);
    // Still names the old path (for reader orientation) but as removed/migrated, not live.
    expect(configTree).toMatch(/~\/.config\/sidecar/);
    expect(configTree).toMatch(/removed in v2\.0\.0|no longer read|not read/i);
  });

  it('the session-storage paragraph states sidecar_sessions is no longer read, with a rename remedy', () => {
    const wtl = config.slice(config.indexOf('## Where things live'));
    const sessionStorage = wtl.slice(wtl.indexOf('### Session storage'), wtl.indexOf('### Log location'));
    expect(sessionStorage).not.toMatch(/is still read \(a pre-rebrand shim\)/i);
    expect(sessionStorage).toMatch(/sidecar_sessions/);
    expect(sessionStorage).toMatch(/no longer read|not read|removed in v2\.0\.0/i);
    expect(sessionStorage).toMatch(/rename/i);
  });

  it('the trailing "Legacy names" callout no longer claims SIDECAR_* env vars are honored', () => {
    expect(config).not.toMatch(/Pre-rebrand `SIDECAR_\*` environment variables are still honored/i);
  });

  it('src/sidecar/fanout.js internal source citation is kept (unrelated to the env/config shims)', () => {
    expect(config).toMatch(/src\/sidecar\/fanout\.js/);
  });
});

describe('docs/SHIMS.md — re-scoped as a v2.0.0 removal record', () => {
  const shims = read('docs/SHIMS.md');

  it('header no longer frames this as scheduled-for-future-removal', () => {
    expect(shims).not.toMatch(/remove in a future revision/i);
    expect(shims).not.toMatch(/Removal is scheduled for a post-launch revision/i);
  });

  it('every non-KEPT row is marked REMOVED in v2.0.0', () => {
    expect(shims).toMatch(/REMOVED in v2\.0\.0/);
  });

  it('the env-var-prefix row records the AMICUS_MAX_SESSIONS rename in its migration note', () => {
    const row = shims.split('\n').find((l) => /Env var prefix/i.test(l));
    expect(row).toBeTruthy();
    expect(row).toMatch(/AMICUS_MAX_SESSIONS/);
  });

  it('the MCP-tool-names row states AMICUS_LEGACY_ALIASES=1 is now a no-op', () => {
    const row = shims.split('\n').find((l) => /MCP tool names/i.test(l));
    expect(row).toBeTruthy();
    expect(row).toMatch(/no-op|no effect|inert/i);
  });

  it('row 8 (MCP registration cleanup) is re-scoped as KEPT, not a removed compat shim', () => {
    const row = shims.split('\n').find((l) => /MCP registration/i.test(l));
    expect(row).toBeTruthy();
    expect(row).toMatch(/KEPT|KEEP/);
    expect(row).toMatch(/#19/);
  });

  it('the fold-marker KEEP row is unchanged', () => {
    const row = shims.split('\n').find((l) => /Fold-marker constant/i.test(l));
    expect(row).toBeTruthy();
    expect(row).toMatch(/KEEP/);
  });

  it('row 5 (config token) no longer claims the dual-parse lived in config.js — states the real removal site', () => {
    const row = shims.split('\n').find((l) => /Config token/i.test(l));
    expect(row).toBeTruthy();
    // Must not claim the shim lived only in config.js — the acceptance path
    // was skills/sidecar/SKILL.md's dual-token instruction (+ test pins).
    expect(row).toMatch(/skills\/sidecar\/SKILL\.md/);
  });

  it('records the mcp-self-identity recursive-spawn guard as a deliberate defense, not a removed shim', () => {
    expect(shims).toMatch(/mcp-self-identity/i);
    expect(shims).toMatch(/recursive[- ]spawn/i);
  });

  it('documents the AMICUS_MAX_SESSIONS rename as a migration note', () => {
    expect(shims).toMatch(/SIDECAR_MAX_SESSIONS/);
    expect(shims).toMatch(/AMICUS_MAX_SESSIONS/);
  });
});

describe('docs/testing.md — legacy env var mentions removed (18.1 fixed HEADLESS_TEST; sweep verifies the rest)', () => {
  const testing = read('docs/testing.md');

  it('no SIDECAR_MOCK_UPDATE / SIDECAR_DEBUG_PORT "still honored/also accepted" claims remain', () => {
    // Naming the old var as historical context (e.g. "legacy X name was removed
    // in v2.0.0") is fine and expected; only a live-acceptance claim is stale.
    expect(testing).not.toMatch(/legacy `SIDECAR_MOCK_UPDATE`\s*(also accepted|still honored)/i);
    expect(testing).not.toMatch(/legacy `SIDECAR_DEBUG_PORT`\s*(still honored|also accepted)/i);
    expect(testing).not.toMatch(/\(or legacy `SIDECAR_MOCK_UPDATE=available`\)/i);
  });

  it('sidecar/*.test.js directory-naming mentions are kept (test-suite naming convention, not a shim)', () => {
    expect(testing).toMatch(/sidecar\/start\.test\.js/);
  });
});

describe('docs/opencode-integration.md — Backward Compatibility section corrected', () => {
  const doc = read('docs/opencode-integration.md');

  it('no longer claims startSidecar/listSidecars/etc. are internal-only, never-exported identifiers', () => {
    // Through v1.9.1 these WERE exported as deprecated aliases from src/index.js's
    // module.exports (present on npm in every v1.x release); v2.0.0 removed them.
    // The doc must not claim they were "never separately-exported deprecated aliases".
    expect(doc).not.toMatch(/are real source identifiers that exist in `src\/index\.js` as deprecated shims/i);
  });
});

describe('docs/troubleshooting.md — legacy-path claims rewritten', () => {
  const trouble = read('docs/troubleshooting.md');

  it('EEXIST section no longer claims config/sessions are read through legacy-path shims', () => {
    const section = trouble.slice(trouble.indexOf('## Install Fails'), trouble.indexOf('## Auth / 401'));
    expect(section).not.toMatch(/are all still read by Amicus through the legacy-path shims/i);
  });

  it('Auth/401 key-resolution order no longer claims a live ~/.config/sidecar/.env fallback', () => {
    const section = trouble.slice(trouble.indexOf('## Auth / 401'), trouble.indexOf('## OpenRouter 402'));
    expect(section).not.toMatch(/if this file does not exist, `~\/\.config\/sidecar\/\.env` is used instead/i);
  });

  it('Session Not Found section no longer claims sidecar_sessions is read via a compatibility shim', () => {
    const section = trouble.slice(trouble.indexOf('## Session Not Found'), trouble.indexOf('## No Conversation History'));
    expect(section).not.toMatch(/Amicus reads both directories via the compatibility shim/i);
  });
});

describe('skills/second-opinion/MODEL-NOTES.md — credentials bullet corrected', () => {
  const notes = read('skills/second-opinion/MODEL-NOTES.md');

  it('no longer claims a live ~/.config/sidecar/.env read', () => {
    expect(notes).not.toMatch(/legacy `~\/\.config\/sidecar\/\.env` still\s*\n?\s*read/i);
  });
});

describe('docs/architecture.md — idle-timeout legacy-env mentions rewritten', () => {
  const arch = read('docs/architecture.md');

  it('per-mode timeout priority no longer claims legacy SIDECAR_IDLE_TIMEOUT_* is honored via an env-compat shim', () => {
    expect(arch).not.toMatch(/legacy `SIDECAR_IDLE_TIMEOUT_\*` honored via env-compat shim/i);
  });

  it('blanket timeout line no longer parenthetically claims legacy SIDECAR_IDLE_TIMEOUT works', () => {
    expect(arch).not.toMatch(/Blanket env var `AMICUS_IDLE_TIMEOUT` \(legacy `SIDECAR_IDLE_TIMEOUT`\)/i);
  });

  it('[SIDECAR_FOLD:<nonce>] wire-token mentions are kept (unrelated to the env-var shims)', () => {
    expect(arch).toMatch(/\[SIDECAR_FOLD:<nonce>\]/);
  });
});

describe('skills/sidecar/SKILL.md — dual-token acceptance instruction removed (:750, :756)', () => {
  const skill = read('skills/sidecar/SKILL.md');

  it('no longer instructs accepting the legacy [SIDECAR_CONFIG_UPDATE] stderr marker', () => {
    expect(skill).not.toMatch(/or the legacy `\[SIDECAR_CONFIG_UPDATE\]` from older installs — accept either/i);
  });

  it('no longer instructs tolerating a legacy sidecar-config-hash comment form', () => {
    expect(skill).not.toMatch(/legacy files may use `<!-- sidecar-config-hash: \.\.\. -->`/i);
  });

  it('still instructs handling the canonical [AMICUS_CONFIG_UPDATE] marker and amicus-config-hash comment', () => {
    expect(skill).toMatch(/\[AMICUS_CONFIG_UPDATE\]/);
    expect(skill).toMatch(/amicus-config-hash/);
  });
});

describe('GLOBAL SWEEP — no dangling "still honored / still read / still works / deprecated shim" legacy claims remain', () => {
  const targets = [
    'README.md',
    'docs/usage.md',
    'docs/configuration.md',
    'docs/testing.md',
    'docs/troubleshooting.md',
    'docs/opencode-integration.md',
    'docs/architecture.md',
    'skills/sidecar/SKILL.md',
    'skills/second-opinion/MODEL-NOTES.md',
  ];

  // Patterns that would indicate a doc still claims a *removed* shim is live.
  // Intentionally narrow (not a bare "SIDECAR_" grep) so the [SIDECAR_FOLD]
  // wire token and historical/SHIMS-removal-record prose don't false-positive.
  const staleClaimPatterns = [
    /SIDECAR_\w+.{0,40}(still (honored|works|read|accepted)|deprecation warning)/i,
    /legacy .{0,15}(shim|fallback).{0,40}(still (works|read|honored))/i,
  ];

  it.each(targets)('%s has no stale "shim still active" claims', (file) => {
    const content = read(file);
    for (const pattern of staleClaimPatterns) {
      expect(content).not.toMatch(pattern);
    }
  });
});
