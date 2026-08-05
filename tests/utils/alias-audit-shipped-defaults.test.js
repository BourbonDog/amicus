/**
 * v4.1.1 regression — the product must never warn about its OWN shipped
 * defaults.
 *
 * `amicus doctor` reported "Model aliases: 2 stale: opus, haiku" on every
 * install, and the scheduled Model Drift Check workflow ran red, because
 * `toDefaultAliases()` derived each alias's pinned id by stripping the
 * `openrouter/` prefix instead of routing through `directFormFor()`. That
 * emitted OpenRouter's DOT ids for Anthropic (`anthropic/claude-opus-4.8`) —
 * ids the direct API never serves — and fabricated a bare direct id for
 * OpenRouter-only `fable`. No user config was involved: the warning came
 * from shipped data alone.
 *
 * The hardcoded Anthropic floor (`model-fetcher.ANTHROPIC_MODELS`) is the one
 * namespace every user's catalog always contains — keyless/offline users get
 * nothing else, and OpenRouter-only users still get floor rows under
 * `anthropic/`. That makes it the sharpest hermetic check that the shipped
 * defaults, the shipped curated routes, and the shipped offline truth all
 * agree. Without this guard the audit silently re-drifts on the next model
 * refresh, which is exactly how the defect reached a release.
 *
 * Deliberately in its own file: tests/utils/alias-audit.test.js installs
 * `jest.doMock` stubs for config/curated-models that survive
 * `jest.resetModules()`, so a sibling block there would assert against mock
 * data and pass vacuously.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('shipped defaults never go stale against the shipped Anthropic floor', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-alias-floor-'));
    originalEnv = { ...process.env };
    // Empty config dir → collectAliasSources() sees shipped data only.
    process.env.AMICUS_CONFIG_DIR = tempDir;
    process.env.AMICUS_ENV_DIR = tempDir;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.resetModules();
  });

  it('reports zero stale aliases against a floor-only Anthropic catalog', () => {
    const { ANTHROPIC_MODELS } = require('../../src/utils/model-fetcher');
    const { collectAliasSources, findStaleAliases } = require('../../src/utils/alias-audit');
    // Shape the floor exactly as model-fetcher hands it back with no key.
    const floorOnly = ANTHROPIC_MODELS.map(r => ({ ...r, authoritative: false }));
    expect(findStaleAliases(collectAliasSources(), floorOnly)).toEqual([]);
  });

  it('pins every Anthropic-vendor default to its authored direct form', () => {
    const { toDefaultAliases } = require('../../src/utils/curated-models');
    const defaults = toDefaultAliases();
    // Authored direct ids. For haiku the dot form is OpenRouter's, not
    // Anthropic's; opus-5's two forms coincide but stay authored, never derived.
    expect(defaults.opus).toBe('anthropic/claude-opus-5');
    expect(defaults.haiku).toBe('anthropic/claude-haiku-4-5-20251001');
    // fable's direct route is now AUTHORED (owner ruling R2, v4.6.3 spec §3,
    // 2026-08-05): the direct API serves claude-fable-5, so the pinned
    // default routes to the authored direct id, same as opus/haiku above.
    expect(defaults.fable).toBe('anthropic/claude-fable-5');
  });

  it('the shipped gpt-pro default NEVER reports stale (and thus never yields a retarget fix:) while its authored openrouter route is live — the 2026-08-05 release-gate false positive', () => {
    // Direct openai namespace serves the 5.6 base tiers but NOT sol-pro
    // (today's real catalog shape); the authored openrouter route is live.
    const catalog = [
      { id: 'openai/gpt-5.6-sol' }, { id: 'openai/gpt-5.6-terra' }, { id: 'openai/gpt-5.6-luna' },
      { id: 'openrouter/openai/gpt-5.6-sol-pro' },
    ];
    const { collectAliasSources, findStaleAliases } = require('../../src/utils/alias-audit');
    const stale = findStaleAliases(collectAliasSources(), catalog);
    expect(stale.filter(r => r.alias === 'gpt-pro')).toEqual([]);
  });
});
