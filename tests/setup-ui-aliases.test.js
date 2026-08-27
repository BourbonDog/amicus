/**
 * Tests for electron/setup-ui-aliases.js (Alias Editor)
 *
 * Verifies vendor-derived grouping (issue #213) and buildAliasEditorHTML output.
 */

const { getDefaultAliases } = require('../src/utils/config');
const { buildAliasEditorHTML } = require('../electron/setup-ui-aliases');
const {
  groupAliases, aliasVendorOf, vendorLabel, NEW_ROUTES_GROUP_LABEL,
} = require('../electron/setup-ui-alias-groups');
const { buildAliasScript } = require('../electron/setup-ui-alias-script');
const { ALIASES_25, DROPPED_BY_WHITELIST } = require('./setup-ui-alias-fixture');

/** Every data-alias="..." value rendered, in document order. */
function renderedAliases(html) {
  return [...html.matchAll(/<div class="alias-row" data-alias="([^"]*)"/g)].map(m => m[1]);
}

describe('setup-ui-aliases', () => {
  // Issue #213: groups came from a hardcoded name whitelist, so any alias
  // whose NAME was not listed rendered nowhere at all. Grouping is now derived
  // from the route's vendor segment, which every alias has.
  describe('groupAliases (issue #213)', () => {
    it('derives the group from the route vendor, not the alias name', () => {
      const groups = groupAliases({ 'my-weird-name': 'openrouter/z-ai/glm-5.3' });
      expect(groups).toHaveLength(1);
      expect(groups[0].vendor).toBe('z-ai');
      expect(groups[0].keys).toEqual(['my-weird-name']);
    });

    it('places every alias in the 25-alias config in exactly one group', () => {
      const groups = groupAliases(ALIASES_25);
      const placed = groups.flatMap(g => g.keys);
      expect(placed.sort()).toEqual(Object.keys(ALIASES_25).sort());
      expect(new Set(placed).size).toBe(placed.length); // no duplicates
      expect(placed).toHaveLength(25);
    });

    it('groups the 21 default aliases with none dropped or duplicated', () => {
      const defaults = getDefaultAliases();
      const placed = groupAliases(defaults).flatMap(g => g.keys);
      expect(placed.sort()).toEqual(Object.keys(defaults).sort());
      expect(new Set(placed).size).toBe(placed.length);
    });

    it('never emits an empty group', () => {
      groupAliases(ALIASES_25).forEach(g => {
        expect(g.keys.length).toBeGreaterThan(0);
        expect(g.label).toBeTruthy();
      });
    });

    it('reproduces issue #213s expected vendor counts', () => {
      const byLabel = Object.fromEntries(groupAliases(ALIASES_25).map(g => [g.label, g.keys]));
      expect(byLabel.Google).toEqual(
        expect.arrayContaining(['gemini', 'gemini-pro', 'google', 'free-google-gemma-4-31b-it']));
      expect(byLabel.Google).toHaveLength(4);
      expect(byLabel.OpenAI.sort()).toEqual(['gpt', 'gpt-pro', 'openai']);
      expect(byLabel.Anthropic.sort()).toEqual(['anthropic', 'claude', 'fable']);
      expect(byLabel.DeepSeek).toEqual(['deepseek']);
      expect(byLabel.Qwen.sort()).toEqual(['qwen', 'qwen-flash']);
    });

    it('puts direct-provider groups first, then the rest alphabetically by label', () => {
      const labels = groupAliases(ALIASES_25).map(g => g.label);
      expect(labels.slice(0, 4)).toEqual(['Google', 'OpenAI', 'Anthropic', 'DeepSeek']);
      const rest = labels.slice(4);
      const sorted = [...rest].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      expect(rest).toEqual(sorted);
    });

    it('is not case-sensitive about alias names (GLM groups with glm)', () => {
      const groups = groupAliases({ GLM: 'openrouter/z-ai/glm-5.2', glm: 'openrouter/z-ai/glm-5.3' });
      expect(groups).toHaveLength(1);
      expect(groups[0].keys.sort()).toEqual(['GLM', 'glm']);
    });

    it('normalises a floating ~vendor into the same group as the pinned vendor', () => {
      const groups = groupAliases({
        glm: 'openrouter/z-ai/glm-5.3',
        'glm-latest': 'openrouter/~z-ai/glm-latest',
      });
      expect(groups).toHaveLength(1);
      expect(groups[0].vendor).toBe('z-ai');
      expect(groups[0].keys.sort()).toEqual(['glm', 'glm-latest']);
    });

    it('groups a local-provider route that has no gateway prefix', () => {
      const groups = groupAliases({ lmstudio: 'lmstudio/qwen2.5-coder-7b-instruct' });
      expect(groups[0].vendor).toBe('lmstudio');
      expect(groups[0].label).toBe('LM Studio');
    });

    it('groups a bare route with no slash at all under its own vendor', () => {
      const groups = groupAliases({ solo: 'some-local-model' });
      expect(groups).toHaveLength(1);
      expect(groups[0].keys).toEqual(['solo']);
    });

    it('files an alias with an empty/missing route under Other rather than dropping it', () => {
      const groups = groupAliases({ broken: '', alsoBroken: undefined, ok: 'google/gemini-3.6-flash' });
      const placed = groups.flatMap(g => g.keys);
      expect(placed.sort()).toEqual(['alsoBroken', 'broken', 'ok']);
      expect(groups.find(g => g.keys.includes('broken')).label).toBe('Other');
    });

    it('returns [] for an empty alias map', () => {
      expect(groupAliases({})).toEqual([]);
    });
  });

  describe('aliasVendorOf / vendorLabel', () => {
    it.each([
      ['openrouter/z-ai/glm-5.3', 'z-ai'],
      ['openrouter/~z-ai/glm-latest', 'z-ai'],
      ['google/gemini-3.6-flash', 'google'],
      ['lmstudio/qwen2.5-coder-7b-instruct', 'lmstudio'],
      ['openrouter/cohere/north-mini-code:free', 'cohere'],
      ['bare-model', 'bare-model'],
      ['', ''],
    ])('aliasVendorOf(%s) -> %s', (route, expected) => {
      expect(aliasVendorOf(route)).toBe(expected);
    });

    it('title-cases an unknown vendor slug instead of showing the raw slug', () => {
      expect(vendorLabel('some-new-vendor')).toBe('Some New Vendor');
    });

    it('uses PROVIDER_FAMILY_NAMES for the five registered providers', () => {
      expect(vendorLabel('anthropic')).toBe('Anthropic');
      expect(vendorLabel('openrouter')).toBe('OpenRouter');
    });

    it('labels the empty vendor Other', () => {
      expect(vendorLabel('')).toBe('Other');
    });
  });

  describe('buildAliasEditorHTML - every alias renders exactly once (issue #213)', () => {
    it('renders all 25 aliases, including the 12 the whitelist dropped', () => {
      const rendered = renderedAliases(buildAliasEditorHTML(ALIASES_25));
      expect(rendered).toHaveLength(25);
      expect(new Set(rendered).size).toBe(25);
      DROPPED_BY_WHITELIST.forEach(key => expect(rendered).toContain(key));
    });

    it('renders every default alias exactly once', () => {
      const rendered = renderedAliases(buildAliasEditorHTML(getDefaultAliases()));
      expect(rendered.sort()).toEqual(Object.keys(getDefaultAliases()).sort());
    });

    it('tags each group with a data-vendor key the client can match on', () => {
      const html = buildAliasEditorHTML(ALIASES_25);
      expect(html).toContain('data-vendor="z-ai"');
      expect(html).toContain('data-vendor="lmstudio"');
    });

    it('shows a per-group count equal to the rows it holds', () => {
      const html = buildAliasEditorHTML(ALIASES_25);
      const blocks = html.split('<details class="alias-group"').slice(1);
      expect(blocks.length).toBeGreaterThan(0);
      blocks.forEach(block => {
        const count = Number(block.match(/class="alias-count">\((\d+)\)/)[1]);
        expect(block.match(/class="alias-row"/g) || []).toHaveLength(count);
      });
    });

    it('escapes HTML-special characters in alias names and routes', () => {
      const html = buildAliasEditorHTML({ 'a"b<c': 'openrouter/z-ai/x&y' });
      expect(html).toContain('data-alias="a&quot;b&lt;c"');
      expect(html).toContain('x&amp;y');
    });
  });

  describe('buildAliasEditorHTML', () => {
    let html;

    beforeAll(() => {
      html = buildAliasEditorHTML(getDefaultAliases());
    });

    it('should return a string', () => {
      expect(typeof html).toBe('string');
    });

    it('should contain a search input with id alias-search', () => {
      expect(html).toContain('id="alias-search"');
    });

    it('should render one details group per distinct route vendor', () => {
      const matches = html.match(/<details class="alias-group"/g);
      expect(matches).toHaveLength(groupAliases(getDefaultAliases()).length);
    });

    it('should render all 21 alias rows with data-alias attributes', () => {
      const defaultKeys = Object.keys(getDefaultAliases());
      defaultKeys.forEach(key => {
        expect(html).toContain(`data-alias="${key}"`);
      });
    });

    it('should contain alias names in each row', () => {
      expect(html).toContain('class="alias-name"');
      expect(html).toContain('>gemini<');
      expect(html).toContain('>gpt<');
      expect(html).toContain('>opus<');
    });

    it('should contain model strings in each row', () => {
      // Task 8.1a: gemini/gpt are direct-capable default aliases, so their
      // stored model string is now the bare canonical id, not openrouter/...
      expect(html).toContain('class="alias-model"');
      expect(html).toContain('google/gemini-3.6-flash');
      expect(html).toContain('openai/gpt-5.6-terra');
      // gpt-pro pin, retargeted to the 5.6 premium tier (owner ruling 2026-08-04)
      expect(html).toContain('openai/gpt-5.6-sol-pro');
    });

    it('should contain arrow separators', () => {
      expect(html).toContain('class="alias-arrow"');
    });

    it('should contain delete buttons', () => {
      expect(html).toContain('class="alias-delete"');
    });

    it('should contain an Add Custom Route button', () => {
      expect(html).toContain('id="alias-add-btn"');
      expect(html).toContain('Add Custom Route');
    });

    it('should contain group summary elements with counts', () => {
      // Group headings are vendor display names now, not alias-name buckets.
      expect(html).toContain('class="alias-count"');
      expect(html).toContain('>Google <');
      expect(html).toContain('>OpenAI <');
      expect(html).toContain('>Anthropic <');
      expect(html).toContain('>DeepSeek <');
      expect(html).toContain('>Qwen <');
      expect(html).toContain('>Mistral AI <');
    });

    it('should have a step-content wrapper', () => {
      expect(html).toContain('class="step-content"');
    });

    it('should have an alias-editor wrapper', () => {
      expect(html).toContain('class="alias-editor"');
    });

    it('should have a Model Routing heading', () => {
      expect(html).toContain('<h1>Model Routing</h1>');
    });

    it('should have a subtitle with explanation', () => {
      expect(html).toContain('class="subtitle"');
      expect(html).toContain('which LLM to collaborate with');
    });

    it('should have a routing example box with SVG icons', () => {
      expect(html).toContain('class="routing-example"');
      expect(html).toContain('--model');
      expect(html).toContain('example-step');
      expect(html).toContain('example-connector');
      expect(html).toContain('<svg');
    });

    it('should NOT have an alias-divider', () => {
      expect(html).not.toContain('class="alias-divider"');
    });
  });

  describe('buildAliasScript – null alias guard', () => {
    let script;

    beforeAll(() => {
      script = buildAliasScript();
    });

    it('should guard against null/empty alias in delete handler', () => {
      // The general delete click handler must skip when data-alias is null
      expect(script).toContain('if (!alias)');
    });

    it('should use delete for custom alias cleanup instead of null assignment', () => {
      // When a custom alias (not in defaultAliases) is deleted, remove the
      // key from aliasEdits rather than setting it to null
      expect(script).toContain('delete aliasEdits[');
    });

    it('should clean up aliasEdits when removing a committed custom row', () => {
      // The custom add row's delete handler should remove aliasEdits entry
      // for committed aliases (those with a data-alias attribute)
      expect(script).toMatch(/row\.getAttribute\(['"]data-alias['"]\)/);
    });
  });

  describe('buildAliasScript – model dropdown filtering', () => {
    let script;

    beforeAll(() => {
      script = buildAliasScript();
    });

    it('should pass alias name as filterKeyword to buildModelSelect on inline edit', () => {
      // When clicking a model span, buildModelSelect receives origAlias as filter
      expect(script).toContain('buildModelSelect(origValue, \'alias-model-select\', origAlias)');
    });

    it('should contain filterModels helper that filters by keyword', () => {
      expect(script).toContain('function filterModels(');
    });

    it('should match keyword against model id and name case-insensitively', () => {
      expect(script).toContain('.toLowerCase()');
      expect(script).toContain('m.id.toLowerCase()');
    });

    it('should fall back to all models when no matches found', () => {
      // If filtered list is empty, return the original unfiltered groups
      expect(script).toContain('filtered.length === 0');
    });
  });

  describe('buildAliasScript - injected current value is labelled (issue #211)', () => {
    let script;

    beforeAll(() => {
      script = buildAliasScript();
    });

    it('keeps the CSS.escape guard on the catalog-membership check', () => {
      expect(script).toContain('CSS.escape(currentValue)');
    });

    it('wraps the injected value in a labelled optgroup, not a bare option', () => {
      expect(script).toContain('Current \\u2014 not found in catalog');
      expect(script).toMatch(/createElement\('optgroup'\)/);
    });
  });

  describe('buildAliasScript - custom routes land in a labelled group (issue #213)', () => {
    let script;

    beforeAll(() => {
      script = buildAliasScript();
    });

    it('no longer appends the new row as an ungrouped sibling of the groups', () => {
      expect(script).not.toContain('editor.insertBefore(row, addBtn)');
      expect(script).toContain('placeRowInNewRoutesGroup');
    });

    it('puts the new row inside a real .alias-group details with a heading', () => {
      expect(script).toContain('data-new-routes');
      expect(script).toContain(JSON.stringify(NEW_ROUTES_GROUP_LABEL));
    });

    it('keeps group counts truthful after add and remove', () => {
      expect(script).toContain('refreshAliasCounts');
    });

    // The page must carry NO grouping rule of its own: deriving a vendor
    // client-side means shipping gateway-prefix stripping back into the
    // wizard, which issue #214 removed and tests/setup-ui.test.js guards.
    it('ships no vendor-derivation rule to the page', () => {
      expect(script).not.toContain('aliasVendorOf');
      expect(script).not.toContain("slice('openrouter/'.length)");
      expect(script).not.toContain('openrouter/');
    });
  });
});

// ---------------------------------------------------------------------------
// Council review of PR #221, finding A3 (raised by `glm`, Confirmed).
// ---------------------------------------------------------------------------
describe('buildAliasScript - group counts stay true after a delete (A3)', () => {
  const script = buildAliasScript();

  // The delete handler for SERVER-rendered rows only added the .alias-deleted
  // class; it never refreshed the headings, whose counts are baked in at render
  // time. Deleting a row left the group claiming it.
  it('the server-rendered delete handler refreshes the counts', () => {
    const i = script.indexOf("row.classList.add('alias-deleted')");
    expect(i).toBeGreaterThan(-1);
    // Bounded to this handler, so a refresh call elsewhere cannot satisfy it.
    expect(script.slice(i, i + 400)).toContain('refreshAliasCounts()');
  });

  it('counts exclude struck-out rows rather than counting every .alias-row', () => {
    expect(script).toContain(".alias-row:not(.alias-deleted)");
    // The naive selector must not survive inside refreshAliasCounts.
    const f = script.indexOf('function refreshAliasCounts');
    expect(script.slice(f, f + 400)).not.toMatch(/querySelectorAll\('\.alias-row'\)/);
  });

  it('only the client-created new-routes group is dropped at zero', () => {
    const f = script.indexOf('function refreshAliasCounts');
    const body = script.slice(f, f + 400);
    expect(body).toMatch(/rows === 0 && g\.hasAttribute\('data-new-routes'\)/);
  });
});
