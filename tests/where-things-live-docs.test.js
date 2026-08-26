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

    it('documents config.json\'s real top-level keys', () => {
      const s = section();
      expect(s).toMatch(/`default`/);
      expect(s).toMatch(/`aliases`/);
      expect(s).toMatch(/`councils`/);
      // v4.2 §4.1: user-defined local/OpenAI-compatible providers.
      expect(s).toMatch(/`providers`/);
      // #61 added routing.prefer/migration_notified; the pin never picked it up.
      expect(s).toMatch(/`routing`/);
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

/**
 * F-5 — the `routing.tier` / `routing.tier_onboarded` cost-tier surface.
 *
 * Filed 2026-08-08 (BACKLOG § "v4.7 docs PR — filed, not shipped"), excluded
 * from that PR because closing it means documenting the cost-aware default
 * picker end to end — an M-sized doc task, not a one-line correction. Shipped
 * v4.9 W12. Both keys have been live since v3.2.0 (`git log -S setCostTier` →
 * `8aa5d6f3`), so this was a four-rev-old hole.
 *
 * Anchored BY SYMBOL, re-verified 2026-08-26 (the filing's own note: the old
 * `:543–599` line range rotted once v4.8 SI-22.4 added lines above it, and
 * nothing caught it because `check:citations` does not scan the doc tree):
 *   - `src/utils/config.js :: COST_TIERS`      — ['frontier','balanced','economy']
 *   - `src/utils/config.js :: getCostTier`     — reads config.routing.tier, coerces
 *                                                anything unrecognized to 'balanced'
 *   - `src/utils/config.js :: setCostTier`     — persists it, throws on an unknown tier
 *   - `src/utils/config.js :: hasTierOnboarded` / `:: markTierOnboarded`
 *                                              — the one-time notice flag
 * MEASURED the same day, and load-bearing for what the docs may claim:
 *   - `setCostTier` has ZERO production callers (grep over src/, electron/,
 *     bin/, scripts/ — only config.js's own export and tests/config.test.js).
 *     `routing.tier` is therefore hand-edited only, like `maxCostPerMtok`.
 *   - `getCostTier` has exactly ONE production reader:
 *     `src/utils/provider-default-picker.js :: computePreselectedId`, via
 *     `buildProviderDefaultChoices` — i.e. the tier decides ONLY which row the
 *     picker preselects, nothing about routing or launch.
 *   - `markTierOnboarded` is called from
 *     `src/utils/start-helpers.js :: maybeOfferProviderDefaults`, itself called
 *     from `src/cli-handlers-run.js` on `amicus start`, and only after the tip
 *     actually printed.
 */
describe('F-5 — the cost-tier surface is documented (docs/configuration.md)', () => {
  const config = read('docs/configuration.md');
  const routingSection = mustSection(config, /## Routing[\s\S]*?(?=\n## )/, 'docs/configuration.md Routing section');
  // Scoped to the cost-tier subsection, not the whole Routing section: the
  // `routing.prefer` prose above it already says "hand-editing" and names
  // `amicus setup`, so a section-wide matcher would pass on the NEIGHBOUR's
  // words and pin nothing. The subsection must live INSIDE `## Routing` (F-5's
  // filing puts it there) — mustSection over `routingSection` enforces both.
  // Lazy (like `section()` above): a missing subsection must fail the pins that
  // name it, not blow up collection for the whole file.
  const costTier = () => mustSection(routingSection, /### Cost tier[\s\S]*/, 'configuration.md "### Cost tier" subsection');
  const wtl = config.slice(mustIndexOf(config, '## Where things live', 'configuration.md "Where things live"'));

  it('the Routing section names both keys', () => {
    expect(costTier()).toMatch(/`routing\.tier`/);
    expect(costTier()).toMatch(/`routing\.tier_onboarded`/);
  });

  it('names all three tiers, in COST_TIERS\' own vocabulary', () => {
    for (const tier of ['frontier', 'balanced', 'economy']) {
      expect(costTier()).toMatch(new RegExp('`"?' + tier + '"?`'));
    }
  });

  it('states the default tier and that an unrecognized value coerces to it (getCostTier)', () => {
    expect(costTier()).toMatch(/balanced/);
    expect(costTier()).toMatch(/default/i);
    // getCostTier does not error on junk — it silently returns 'balanced'.
    expect(costTier()).toMatch(/coerce|falls back|treated as|anything else/i);
  });

  it('says routing.tier is hand-edited only — no command writes it (setCostTier has no caller)', () => {
    expect(costTier()).toMatch(/hand-edit/i);
  });

  it('says what the tier actually DECIDES — the picker\'s preselected row, not routing', () => {
    expect(costTier()).toMatch(/preselect/i);
    expect(costTier()).toMatch(/cost-aware default picker|default picker/i);
    // The tier is not a gateway/routing knob despite living under `routing`.
    expect(costTier()).toMatch(/does not (change|affect)|never (changes|affects)|not a .*gateway/i);
  });

  it('names every surface the priced picker runs from', () => {
    expect(costTier()).toMatch(/amicus key/);
    expect(costTier()).toMatch(/amicus setup/);
    expect(costTier()).toMatch(/Electron|setup window/i);
  });

  it('describes tier_onboarded as an automatically-written one-time flag, not a knob', () => {
    expect(costTier()).toMatch(/one-time|once/i);
    expect(costTier()).toMatch(/amicus start/);
    expect(costTier()).toMatch(/don't hand-edit|do not hand-edit|written automatically/i);
  });

  it('the config.json example under "Where things live" carries both keys', () => {
    expect(wtl).toMatch(/"tier"/);
    expect(wtl).toMatch(/"tier_onboarded"/);
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
