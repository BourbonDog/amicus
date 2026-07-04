'use strict';
/**
 * Phase 17 / Task 17.2 — "Where things live" (B50) + plugin-channel command
 * treatment (B48, absorbs B41). Pins verified against the real source:
 *   - src/utils/config.js (getConfigDir, config.json shape)
 *   - src/utils/model-catalog.js (catalog cache + refresh-outcome fields)
 *   - src/utils/spend-ledger.js / src/council/ledger.js (JSONL ledgers)
 *   - src/utils/session-index-tmp-sweep.js (tmp-file sweep)
 *   - src/environment.js (getSessionRoot), src/session-manager.js (SESSIONS_DIR)
 *   - src/utils/logger.js (stderr-only, LOG_LEVEL)
 *   - scripts/postinstall.js (MCP + skill registration sites)
 * Token/regex pins, not brittle verbatim sentences, per the Phase-8 docs-test
 * pattern (see plugin-quickstart-docs.test.js).
 */
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');
const { mustSection, mustIndexOf } = require('./helpers/docs-extract');

describe('B50 — "Where things live" section (docs/configuration.md)', () => {
  const config = read('docs/configuration.md');
  const section = () => {
    const start = config.indexOf('## Where things live');
    expect(start).toBeGreaterThan(-1);
    return config.slice(start);
  };

  it('has a top-level "Where things live" section', () => {
    expect(config).toMatch(/^## Where things live/m);
  });

  it('README links to the section', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/configuration\.md#where-things-live/);
  });

  describe('the config tree', () => {
    it('names the config dir and its override; states the legacy fallback is gone (v2.0.0, #19)', () => {
      const s = section();
      expect(s).toContain('~/.config/amicus');
      expect(s).toMatch(/AMICUS_CONFIG_DIR/);
      // getConfigDir() no longer falls back to ~/.config/sidecar — removed in v2.0.0.
      // Docs must say so (not silently drop the topic), so a stray mention of the
      // legacy path is fine only inside a "removed"/"no longer" sentence.
      expect(s).toMatch(/~\/.config\/sidecar/);
      expect(s).toMatch(/no longer|removed in v2\.0\.0|not read|does(?:n't| not) (?:fall back|read)/i);
    });

    it('enumerates the real files config.js/model-catalog.js/ledgers actually write', () => {
      const s = section();
      // config.json — verified shape in src/utils/config.js loadConfig/saveConfig
      expect(s).toContain('config.json');
      // model-catalog.json — src/utils/model-catalog.js catalogPath()
      expect(s).toContain('model-catalog.json');
      // council-ledger.jsonl — src/council/ledger.js LEDGER_FILE
      expect(s).toContain('council-ledger.jsonl');
      // spend-ledger.jsonl — src/utils/spend-ledger.js SPEND_LEDGER_FILE (Phase 16)
      expect(s).toContain('spend-ledger.jsonl');
      // .env — API keys (src/utils/config.js docs + env-loader)
      expect(s).toMatch(/\.env/);
      // sessions-index.json — src/utils/session-index.js INDEX_FILENAME (global taskId index)
      expect(s).toContain('sessions-index.json');
    });

    it('documents config.json\'s three real top-level keys', () => {
      const s = section();
      expect(s).toMatch(/`default`/);
      expect(s).toMatch(/`aliases`/);
      expect(s).toMatch(/`councils`/);
    });

    it('documents the TTL cache + refresh-outcome fields on model-catalog.json', () => {
      const s = section();
      expect(s).toMatch(/24-hour|24h TTL|24 hour/i);
      // src/utils/model-catalog.js getCatalogInfo(): lastRefreshAttempt/lastRefreshError
      expect(s).toMatch(/lastRefreshAttempt/);
      expect(s).toMatch(/lastRefreshError/);
    });

    it('documents the tmp-file pattern and the doctor --fix sweep', () => {
      const s = section();
      expect(s).toMatch(/\.tmp/);
      expect(s).toMatch(/amicus doctor --fix/);
    });
  });

  describe('session storage', () => {
    it('documents getSessionRoot\'s per-client session roots (code-local / cowork / code-web)', () => {
      const s = section();
      expect(s).toMatch(/code-local/);
      expect(s).toMatch(/cowork/);
      expect(s).toMatch(/code-web/);
      // code-local: ~/.claude/projects/<encoded-cwd> (src/environment.js getSessionRoot)
      expect(s).toMatch(/\.claude[\\/]projects/);
    });

    it('documents the project-scoped per-session dir (amicus_sessions); legacy sidecar_sessions is a removed read, not a live shim', () => {
      const s = section();
      // src/session-manager.js SESSIONS_DIR = 'amicus_sessions'
      expect(s).toContain('amicus_sessions');
      // The sidecar_sessions dual-read shim was removed in v2.0.0 (#19, 887912a).
      // Docs must still name the old dir (so pre-rebrand users can find their data)
      // but state it is no longer read automatically — with a rename remedy.
      expect(s).toMatch(/sidecar_sessions/);
      expect(s).toMatch(/no longer read|not read|removed in v2\.0\.0/i);
      expect(s).toMatch(/rename/i);
    });

    it('lists the real per-session file contents', () => {
      const s = section();
      expect(s).toContain('metadata.json');
      expect(s).toContain('summary.md');
      expect(s).toContain('conversation.jsonl');
      expect(s).toContain('progress.json');
    });

    it('documents wave/leg subdirectories for fanout', () => {
      const s = section();
      expect(s).toMatch(/wave/i);
      expect(s).toMatch(/leg/i);
    });
  });

  describe('log location + LOG_LEVEL', () => {
    it('states logs go to stderr, not a file (src/utils/logger.js console.error)', () => {
      const s = section();
      expect(s).toMatch(/stderr/);
      // Must NOT claim Amicus itself writes/creates a log file — only that a
      // *user* may redirect stderr into one themselves (an example, not a claim).
      expect(s).not.toMatch(/writes? (a |the )?log file|creates? (a |the )?log file|logs? directory/i);
    });

    it('documents LOG_LEVEL values matching logger.js LOG_LEVELS', () => {
      const s = section();
      expect(s).toMatch(/error/);
      expect(s).toMatch(/warn/);
      expect(s).toMatch(/info/);
      expect(s).toMatch(/debug/);
    });
  });

  describe('config file format', () => {
    it('shows a commented config.json example', () => {
      const s = section();
      expect(s).toMatch(/```json[\s\S]*"default"[\s\S]*"aliases"[\s\S]*```/);
    });
  });

  describe('uninstall instructions', () => {
    it('gives the npm uninstall command', () => {
      const s = section();
      expect(s).toMatch(/npm uninstall -g amicus/);
    });

    it('names the real MCP registration sites left behind (postinstall.js)', () => {
      const s = section();
      // ~/.claude.json — Claude Code (registerClaudeCode)
      expect(s).toMatch(/\.claude\.json/);
      // claude_desktop_config.json — Claude Desktop/Cowork (registerClaudeDesktop)
      expect(s).toMatch(/claude_desktop_config\.json/);
    });

    it('names the skill copies left behind', () => {
      const s = section();
      expect(s).toMatch(/~\/.claude\/skills\/sidecar/);
      expect(s).toMatch(/~\/.claude\/skills\/second-opinion/);
    });

    it('names the config dir as something npm uninstall does NOT clean', () => {
      const s = section();
      expect(s).toMatch(/does not|doesn't|won't|never removes|does NOT/i);
      expect(s).toMatch(/~\/.config\/amicus/);
    });
  });
});

describe('B48 — plugin-channel command treatment (absorbs B41)', () => {
  const readme = read('README.md');

  it('has a prominent two-install-channels callout before Quick start ends', () => {
    const qs = mustSection(readme, /## Quick start[\s\S]*?(?=\n## )/, 'README.md Quick start section');
    expect(qs).toMatch(/npx -y amicus@latest/);
    expect(qs).toMatch(/plugin-channel|plugin channel/i);
    expect(qs).toMatch(/npm global|npm install -g amicus/i);
  });

  it('states slash commands are plugin-channel-only and npm users do not get them', () => {
    expect(readme).toMatch(/plugin-channel-only|plugin-channel ONLY|plugin channel only/i);
    expect(readme).toMatch(/npm users don't get them|npm.*do not get|not.*npm.*install/i);
  });

  it('/amicus:council appears in Quick start (first-screen discoverability, B41)', () => {
    const qs = mustSection(readme, /## Quick start[\s\S]*?(?=\n## )/, 'README.md Quick start section');
    expect(qs).toMatch(/\/amicus:council/);
  });

  it('/amicus:council appears in The Council section', () => {
    const start = mustIndexOf(readme, '## The Council', 'README.md "## The Council" heading');
    const end = mustIndexOf(readme, '## The parallel window', 'README.md "## The parallel window" heading');
    const councilSection = readme.slice(start, end);
    expect(councilSection).toMatch(/\/amicus:council/);
  });

  it('has a single convention-marker banner rather than rewriting every code block', () => {
    // Lightest-treatment requirement: one clear note, not per-example rewrites.
    const matches = readme.match(/plugin-channel users:.*prefix.*npx -y amicus@latest/i);
    expect(matches).toBeTruthy();
  });
});

describe('plugin quick-start claims stay verified against plugin.json + postinstall reality', () => {
  it('plugin.json sets AMICUS_SKIP_POSTINSTALL for the MCP server', () => {
    const pluginJson = JSON.parse(read('.claude-plugin/plugin.json'));
    expect(pluginJson.mcpServers.amicus.env.AMICUS_SKIP_POSTINSTALL).toBe('1');
  });

  it('commands/council.md exists (the /amicus:council slash command)', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'commands', 'council.md'))).toBe(true);
  });
});
