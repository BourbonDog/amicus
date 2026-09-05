// tests/quick-picks.test.js
'use strict';

const { compareIdsDesc, pickCurrent, resolveQuickPicks, toLiveSeedAliases, toStorableRoute } =
  require('../src/utils/quick-picks');

const row = id => ({ id, name: id, contextLength: 1, pricing: { prompt: '0' } });

describe('compareIdsDesc', () => {
  test('newer numeric version wins even when older is stable and newer is preview', () => {
    const ids = ['google/gemini-2.5-pro', 'google/gemini-3.1-pro-preview'];
    expect(ids.sort(compareIdsDesc)[0]).toBe('google/gemini-3.1-pro-preview');
  });
  test('within the same version the unmarked id beats its -preview variant', () => {
    const ids = ['google/gemini-3.5-flash-preview', 'google/gemini-3.5-flash'];
    expect(ids.sort(compareIdsDesc)[0]).toBe('google/gemini-3.5-flash');
  });
  test(':free compound suffix: preview:free loses to its own base', () => {
    const ids = ['openrouter/openai/gpt-5.5-preview:free', 'openrouter/openai/gpt-5.5'];
    expect(ids.sort(compareIdsDesc)[0]).toBe('openrouter/openai/gpt-5.5');
  });
  // Owner-reported: OpenAI renamed 5.6 into tier variants (sol/terra/luna).
  // -terra isn't a MARKER_RE suffix, so this is a plain numeric-desc
  // comparison, not the same-base marker-precedence rule above — pin it
  // explicitly rather than assume compareIdsDesc treats "5.6-terra" as
  // newer than "5.5".
  test('terra-tier rename: gpt-5.6-terra outranks the older bare gpt-5.5', () => {
    const ids = ['openrouter/openai/gpt-5.5', 'openrouter/openai/gpt-5.6-terra'];
    expect(ids.sort(compareIdsDesc)[0]).toBe('openrouter/openai/gpt-5.6-terra');
  });
});

describe('pickCurrent', () => {
  const catalog = [
    row('openrouter/google/gemini-3.5-flash'),
    row('openrouter/google/gemini-3.5-flash-preview'),
    row('openrouter/google/gemini-3.1-flash-lite'),   // lite ≠ flash-class
    row('openrouter/google/gemini-3.1-flash-image'),  // image ≠ flash-class
    row('openrouter/google/gemini-2.5-flash'),
    row('google/gemini-3.5-flash'),
  ];
  const flash = /^gemini-[\d.]+-flash(-preview|-exp|-latest)?$/;

  test('resolves the newest matching id in the openrouter namespace', () => {
    expect(pickCurrent(catalog, 'openrouter/', 'google', flash))
      .toBe('openrouter/google/gemini-3.5-flash');
  });
  test('resolves the direct namespace independently', () => {
    expect(pickCurrent(catalog, '', 'google', flash)).toBe('google/gemini-3.5-flash');
  });
  test('returns null when nothing matches', () => {
    expect(pickCurrent(catalog, '', 'openai', /^gpt-[\d.]+$/)).toBeNull();
    expect(pickCurrent([], 'openrouter/', 'google', flash)).toBeNull();
    expect(pickCurrent(null, 'openrouter/', 'google', flash)).toBeNull();
  });
});

describe('resolveQuickPicks', () => {
  test('live rows carry source live and catalog-resolved routes', () => {
    const catalog = [
      row('openrouter/google/gemini-9.9-flash'),
      row('google/gemini-9.8-flash'),
    ];
    const gemini = resolveQuickPicks(catalog).find(r => r.alias === 'gemini');
    expect(gemini.source).toBe('live');
    expect(gemini.routes.openrouter).toBe('openrouter/google/gemini-9.9-flash');
    expect(gemini.routes.google).toBe('google/gemini-9.8-flash');
  });
  test('empty catalog falls back to pinned routes, source fallback', () => {
    const picks = resolveQuickPicks([]);
    expect(picks).toHaveLength(5);
    const deepseek = picks.find(r => r.alias === 'deepseek');
    expect(deepseek.source).toBe('fallback');
    expect(deepseek.routes.openrouter).toBe('openrouter/deepseek/deepseek-v4-pro');
    expect(deepseek.routes.deepseek).toBe('deepseek/deepseek-v4-pro');
  });
  test('unresolvable direct namespace uses the pinned direct fallback', () => {
    const catalog = [row('openrouter/deepseek/deepseek-v9-pro')];
    const deepseek = resolveQuickPicks(catalog).find(r => r.alias === 'deepseek');
    expect(deepseek.source).toBe('live');
    expect(deepseek.routes.openrouter).toBe('openrouter/deepseek/deepseek-v9-pro');
    expect(deepseek.routes.deepseek).toBe('deepseek/deepseek-v4-pro');
  });
});

// Owner-reported: OpenAI split 5.6 into tier variants — gpt-5.6-sol (premium),
// gpt-5.6-terra (mid), gpt-5.6-luna (economy), each with a -pro sibling —
// plus the unrelated gpt-5.3-codex family. The `gpt` quick pick must track
// the TERRA tier specifically (owner ruling), not the newest id overall.
describe('gpt quick-pick resolves to the terra tier (5.6 rename)', () => {
  test('resolves gpt to the terra id when sol/luna/terra-pro siblings are all present', () => {
    const catalog = [
      row('openrouter/openai/gpt-5.5'),
      row('openrouter/openai/gpt-5.6-sol'),
      row('openrouter/openai/gpt-5.6-terra'),
      row('openrouter/openai/gpt-5.6-terra-pro'),
      row('openrouter/openai/gpt-5.6-luna'),
    ];
    const gpt = resolveQuickPicks(catalog).find(r => r.alias === 'gpt');
    expect(gpt.source).toBe('live');
    expect(gpt.routes.openrouter).toBe('openrouter/openai/gpt-5.6-terra');
  });

  test('a catalog with only the bare numeric id still resolves live (fallback-compat)', () => {
    const catalog = [row('openrouter/openai/gpt-5.5')];
    const gpt = resolveQuickPicks(catalog).find(r => r.alias === 'gpt');
    expect(gpt.source).toBe('live');
    expect(gpt.routes.openrouter).toBe('openrouter/openai/gpt-5.5');
  });
});

describe('toLiveSeedAliases', () => {
  test('direct-capable family alias overlays live catalog route as bare canonical (direct-first)', () => {
    const seeds = toLiveSeedAliases([
      row('openrouter/google/gemini-9.9-flash'),
      row('openrouter/qwen/qwen4-max'),
    ]);
    expect(seeds.gemini).toBe('google/gemini-9.9-flash');
    // gateway-only vendor (qwen): cardless, never overlaid by resolveQuickPicks,
    // and even if it were, stripGatewayPrefix leaves non-direct vendors
    // openrouter/-prefixed — stays pinned + openrouter/-prefixed regardless
    // of the live catalog containing a qwen row.
    expect(seeds.qwen).toBe('openrouter/qwen/qwen3.8-max-0902');
  });
  test('null/empty catalog returns the static defaults unchanged', () => {
    const { toDefaultAliases } = require('../src/utils/curated-models');
    expect(toLiveSeedAliases(null)).toEqual(toDefaultAliases());
  });
  test('family aliases that fell back to pinned are not overlaid', () => {
    // Catalog has gemini flash but NOT gemini-pro -> gemini-pro stays pinned
    const { toDefaultAliases } = require('../src/utils/curated-models');
    const seeds = toLiveSeedAliases([row('openrouter/google/gemini-9.9-flash')]);
    expect(seeds['gemini-pro']).toBe(toDefaultAliases()['gemini-pro']);
  });
});

// v4.1.2. For a DIVERGENT vendor (anthropic) the direct id and the OpenRouter
// id are different strings, not differently prefixed, so stripping
// `openrouter/` fabricates an id the direct API rejects. A seeded config
// carrying it makes `amicus doctor` report a stale alias — the very warning
// the v4.1.1 alias work removed. Mirrors the guard at
// model-canonicalization.js :: directFormIfSafe.
describe('divergent-vendor routes are never derived by prefix-stripping', () => {
  const { toDefaultAliases, DIVERGENT_VENDORS } = require('../src/utils/curated-models');

  test('anthropic is the divergent vendor this guard exists for', () => {
    expect(DIVERGENT_VENDORS.has('anthropic')).toBe(true);
    expect(DIVERGENT_VENDORS.has('google')).toBe(false);
  });

  test.each([
    ['openrouter + direct', ['openrouter/anthropic/claude-opus-5', 'anthropic/claude-opus-5'], 'anthropic/claude-opus-5'],
    ['direct only', ['anthropic/claude-opus-5'], 'anthropic/claude-opus-5'],
    ['openrouter only', ['openrouter/anthropic/claude-opus-5'], 'anthropic/claude-opus-5'],
    // A catalog still on the dotted 4.8 era (older than the 2026-08-04 pins)
    // keeps this guard's dot/dash bite alive: the seed must be the catalog's
    // own direct dash row — or the authored direct fallback when the catalog
    // offers no direct row — NEVER the prefix-stripped dot id.
    ['stale dotted openrouter-only', ['openrouter/anthropic/claude-opus-4.8'], 'anthropic/claude-opus-5'],
    ['stale dotted openrouter + dash direct', ['openrouter/anthropic/claude-opus-4.8', 'anthropic/claude-opus-4-8'], 'anthropic/claude-opus-4-8'],
  ])('seeds opus from a %s catalog as a direct-API id, never a stripped dot id', (_label, ids, expected) => {
    const seeds = toLiveSeedAliases(ids.map(row));
    expect(seeds.opus).toBe(expected);
    expect(seeds.opus).not.toBe('anthropic/claude-opus-4.8'); // the fabricated strip
  });

  test('a live anthropic catalog never makes the seed diverge from the shipped defaults', () => {
    const seeds = toLiveSeedAliases([
      row('openrouter/anthropic/claude-opus-5'),
      row('anthropic/claude-opus-5'),
    ]);
    const defaults = toDefaultAliases();
    const diverged = Object.keys(defaults).filter(k => seeds[k] !== defaults[k]);
    expect(diverged).toEqual([]);
  });

  test('resolveQuickPicks exposes vendorPath so callers can apply the guard', () => {
    const opus = resolveQuickPicks([]).find(p => p.alias === 'opus');
    expect(opus.vendorPath).toBe('anthropic');
  });

  test('toStorableRoute keeps the direct form for a divergent vendor', () => {
    expect(toStorableRoute({
      vendorPath: 'anthropic',
      routes: { openrouter: 'openrouter/anthropic/claude-opus-4.8',
                anthropic: 'anthropic/claude-opus-4-8' },
    })).toBe('anthropic/claude-opus-4-8');
  });

  test('toStorableRoute keeps an intact openrouter route when no direct pick exists', () => {
    expect(toStorableRoute({
      vendorPath: 'anthropic',
      routes: { openrouter: 'openrouter/anthropic/claude-opus-4.8' },
    })).toBe('openrouter/anthropic/claude-opus-4.8');
  });

  test('toStorableRoute still canonicalises non-divergent vendors (unchanged behaviour)', () => {
    expect(toStorableRoute({
      vendorPath: 'google',
      routes: { openrouter: 'openrouter/google/gemini-9.9-flash' },
    })).toBe('google/gemini-9.9-flash');
  });

  test('toStorableRoute leaves gateway-only vendors openrouter/-prefixed', () => {
    expect(toStorableRoute({
      vendorPath: 'qwen',
      routes: { openrouter: 'openrouter/qwen/qwen4-max' },
    })).toBe('openrouter/qwen/qwen4-max');
  });
});
