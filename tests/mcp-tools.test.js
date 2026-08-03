/**
 * MCP Tool Definitions Tests
 *
 * Tests for tool schema structure, required tools, input schema validation,
 * and the amicus_guide text content.
 */

const { getTools, getGuideText, safeTaskId, safeModel } = require('../src/mcp-tools');
const { mustIndexOf } = require('./helpers/docs-extract');
const TOOLS = getTools();

describe('MCP Tool Definitions', () => {
  test('exports TOOLS array with correct structure', () => {
    expect(Array.isArray(TOOLS)).toBe(true);
    expect(TOOLS.length).toBeGreaterThan(0);

    for (const tool of TOOLS) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.inputSchema).toBe('object');
    }
  });

  test('has all required tools', () => {
    const names = TOOLS.map(t => t.name);

    expect(names).toContain('amicus_start');
    expect(names).toContain('amicus_status');
    expect(names).toContain('amicus_wait');
    expect(names).toContain('amicus_read');
    expect(names).toContain('amicus_list');
    expect(names).toContain('amicus_resume');
    expect(names).toContain('amicus_continue');
    expect(names).toContain('amicus_setup');
    expect(names).toContain('amicus_guide');
    expect(names).toContain('amicus_abort');
    expect(names).toContain('amicus_fanout');
  });

  // spec §8: amicus_council_run is the 15th tool (Task 16); amicus_spend is
  // the 16th (v4.3 Task 5, spec §7.3).
  test('has exactly 16 tools', () => {
    expect(TOOLS).toHaveLength(16);
  });

  test('tool names are unique', () => {
    const names = TOOLS.map(t => t.name);
    const uniqueNames = [...new Set(names)];
    expect(names).toHaveLength(uniqueNames.length);
  });

  test('all tool names use snake_case with amicus_ prefix', () => {
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^amicus_[a-z_]+$/);
    }
  });

  test('all descriptions are non-empty', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  test('model description contains dynamic alias keys', () => {
    const startTool = TOOLS.find(t => t.name === 'amicus_start');
    const modelDesc = startTool.inputSchema.model.description;
    expect(modelDesc).toContain('codex');
    expect(modelDesc).toContain('opus');
    expect(modelDesc).toContain('gemini');
    expect(modelDesc).toContain('deepseek');
  });

  test('amicus_start description does not contain brand or model names', () => {
    const startTool = TOOLS.find(t => t.name === 'amicus_start');
    const desc = startTool.description.toLowerCase();
    expect(desc).not.toContain('gemini');
    expect(desc).not.toContain('gpt');
    expect(desc).not.toContain('openrouter');
    expect(desc).not.toContain('anthropic');
  });

  test('model param description does not contain specific model IDs', () => {
    const startTool = TOOLS.find(t => t.name === 'amicus_start');
    const modelDesc = startTool.inputSchema.model.description;
    // Strip the parenthesized alias list before checking — alias names like
    // "gemini-3.1" are fine, but full IDs like "openrouter/google/gemini-3-flash-preview" are not
    const descWithoutAliases = modelDesc.replace(/\([^)]+\)/g, '');
    expect(descWithoutAliases).not.toMatch(/openrouter\//);
    expect(descWithoutAliases).not.toMatch(/gemini-\d/);
    expect(descWithoutAliases).not.toMatch(/gpt-\d/);
  });

  test('amicus_guide guide text does not contain hardcoded model IDs in prose', () => {
    const guide = getGuideText();
    // The alias table rows are fine (dynamic), but prose should not name specific models
    const linesWithoutTable = guide.split('\n')
      .filter(l => !l.startsWith('|') && !l.startsWith('${'));
    const prose = linesWithoutTable.join('\n');
    expect(prose).not.toMatch(/gemini-\d/);
    expect(prose).not.toMatch(/gpt-\d/);
    expect(prose).not.toContain('gemini-3-flash-preview');
  });

  // M-1 (whole-branch review of 4.1.1): mcp-tools.js:60,584 were reverted from a
  // bare dot-versioned Anthropic id (`anthropic/claude-opus-4.8`, which the
  // direct Anthropic API rejects) back to the correct dash-form id
  // (`anthropic/claude-opus-4-8`). Nothing pinned either surface, so all 7 MCP
  // suites stayed green whichever form was live. Pin both to the dash form and
  // reject any bare dot-versioned Anthropic id pattern.
  describe('anthropic model ids use dash form, not bare dot-versioned ids (M-1)', () => {
    const dotVersionedAnthropicId = /anthropic\/claude-[a-z]+-\d+\.\d+/;

    test('amicus_start model description names the dash-form id and no bare dot-versioned Anthropic id', () => {
      const startTool = TOOLS.find(t => t.name === 'amicus_start');
      const modelDesc = startTool.inputSchema.model.description;
      expect(modelDesc).toContain('anthropic/claude-opus-4-8');
      expect(modelDesc).not.toMatch(dotVersionedAnthropicId);
    });

    test('amicus_guide body names the dash-form id and no bare dot-versioned Anthropic id', () => {
      const guide = getGuideText();
      expect(guide).toContain('anthropic/claude-opus-4-8');
      expect(guide).not.toMatch(dotVersionedAnthropicId);
    });
  });

  describe('amicus_start', () => {
    let startTool;

    beforeAll(() => {
      startTool = TOOLS.find(t => t.name === 'amicus_start');
    });

    test('has prompt in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('prompt');
    });

    test('has model in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('model');
    });

    test('has agent in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('agent');
    });

    test('has noUi in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('noUi');
    });

    test('has thinking in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('thinking');
    });

    test('has timeout in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('timeout');
    });

    test('has contextTurns in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('contextTurns');
    });

    test('has contextSince in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('contextSince');
    });

    test('has contextMaxTokens in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('contextMaxTokens');
    });

    test('has summaryLength in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('summaryLength');
    });

    test('has includeContext in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('includeContext');
    });

    test('includeContext has no Zod default — an omitted key stays absent so a pack can fill it (v4.5 Task 15 fix wave 2, Finding 1)', () => {
      // Pre-fix, Zod's .default(true) materialized includeContext:true before
      // applyPackToMcpInput ever ran, so a pack's includeContext/noContext
      // value was silently never applied (Task 15 review Finding 1) — key
      // presence, not the Zod default, must decide caller-explicitness. The
      // effective default (true when absent) now lives at the handler's read
      // site (mcp-server.js: `input.includeContext !== false`), not in the schema.
      const schema = startTool.inputSchema.includeContext;
      expect(schema._def.typeName).toBe('ZodOptional');
      expect(schema.isOptional()).toBe(true);
    });

    test('has parentSession in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('parentSession');
    });

    test('has gateway enum in input schema, not required (#61 Task 7.2)', () => {
      const schema = startTool.inputSchema.gateway;
      expect(schema).toBeDefined();
      expect(schema.isOptional()).toBe(true);
      expect(schema.unwrap().options).toEqual(['auto', 'direct', 'openrouter']);
    });

    test('description contains mode routing guidance', () => {
      const tool = getTools().find(t => t.name === 'amicus_start');
      expect(tool.description).toContain('When in doubt, use interactive');
      expect(tool.description).toContain('does NOT need to monitor');
    });
  });

  describe('amicus_status', () => {
    test('has taskId in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_status');
      expect(tool.inputSchema).toHaveProperty('taskId');
    });

    test('is not annotated read-only/idempotent (it mutates on crash detection)', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_status');
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool.annotations.idempotentHint).toBe(false);
    });
  });

  describe('amicus_read', () => {
    test('has taskId in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_read');
      expect(tool.inputSchema).toHaveProperty('taskId');
    });

    test('has mode in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_read');
      expect(tool.inputSchema).toHaveProperty('mode');
    });
  });

  describe('amicus_list', () => {
    test('has status in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_list');
      expect(tool.inputSchema).toHaveProperty('status');
    });
  });

  describe('amicus_resume', () => {
    test('has taskId in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_resume');
      expect(tool.inputSchema).toHaveProperty('taskId');
    });

    test('has noUi in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_resume');
      expect(tool.inputSchema).toHaveProperty('noUi');
    });

    test('has timeout in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_resume');
      expect(tool.inputSchema).toHaveProperty('timeout');
    });

    test('description recommends amicus_wait, with amicus_status as fallback (B16)', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_resume');
      expect(tool.description).toContain('amicus_wait');
      expect(tool.description).toContain('amicus_status');
    });
  });

  describe('amicus_continue', () => {
    test('has taskId in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_continue');
      expect(tool.inputSchema).toHaveProperty('taskId');
    });

    test('has prompt in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_continue');
      expect(tool.inputSchema).toHaveProperty('prompt');
    });

    test('has model in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_continue');
      expect(tool.inputSchema).toHaveProperty('model');
    });

    test('has noUi in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_continue');
      expect(tool.inputSchema).toHaveProperty('noUi');
    });

    test('has timeout in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_continue');
      expect(tool.inputSchema).toHaveProperty('timeout');
    });

    test('has contextTurns in input schema with correct description', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_continue');
      expect(tool.inputSchema.contextTurns.description).toContain('Default: 80000 tokens.');
    });

    test('has contextMaxTokens in input schema with correct description', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_continue');
      expect(tool.inputSchema.contextMaxTokens.description).toContain('Default: 80000.');
    });

    test('has gateway enum in input schema, not required (#61 Task 7.2)', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_continue');
      const schema = tool.inputSchema.gateway;
      expect(schema).toBeDefined();
      expect(schema.isOptional()).toBe(true);
      expect(schema.unwrap().options).toEqual(['auto', 'direct', 'openrouter']);
    });

    test('description recommends amicus_wait, with amicus_status as fallback (B16)', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_continue');
      expect(tool.description).toContain('amicus_wait');
      expect(tool.description).toContain('amicus_status');
    });
  });

  describe('amicus_setup', () => {
    test('has empty input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_setup');
      expect(Object.keys(tool.inputSchema)).toHaveLength(0);
    });
  });

  describe('amicus_guide', () => {
    test('has empty input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_guide');
      expect(Object.keys(tool.inputSchema)).toHaveLength(0);
    });
  });

  describe('amicus_abort', () => {
    test('has taskId in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_abort');
      expect(tool.inputSchema).toHaveProperty('taskId');
    });

    test('description mentions abort', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_abort');
      expect(tool.description.toLowerCase()).toContain('abort');
    });
  });

  describe('amicus_fanout', () => {
    let fanoutTool;

    beforeAll(() => {
      fanoutTool = TOOLS.find(t => t.name === 'amicus_fanout');
    });

    test('has coworkProcess in input schema (#10)', () => {
      expect(fanoutTool.inputSchema).toHaveProperty('coworkProcess');
    });

    test('has parentSession in input schema (#10)', () => {
      expect(fanoutTool.inputSchema).toHaveProperty('parentSession');
    });

    test('has gateway enum in input schema, not required (#61 Task 7.2)', () => {
      const schema = fanoutTool.inputSchema.gateway;
      expect(schema).toBeDefined();
      expect(schema.isOptional()).toBe(true);
      expect(schema.unwrap().options).toEqual(['auto', 'direct', 'openrouter']);
    });

    test('description recommends amicus_wait, with sleep+amicus_status as fallback (B16)', () => {
      expect(fanoutTool.description).toContain('amicus_wait');
      expect(fanoutTool.description).toContain('amicus_status');
    });
  });

  describe('polling guidance in descriptions', () => {
    test('amicus_start description mentions interactive and headless modes', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_start');
      expect(tool.description).toContain('headless');
      expect(tool.description).toContain('interactive');
      expect(tool.description).toContain('do not poll');
    });

    test('amicus_status description mentions headless mode', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_status');
      expect(tool.description).toContain('headless');
    });

    test('amicus_start description recommends amicus_wait before the sleep-25 fallback (B16)', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_start');
      expect(tool.description).toContain('amicus_wait');
      expect(tool.description).toContain('sleep 25');
      expect(tool.description.indexOf('amicus_wait')).toBeLessThan(tool.description.indexOf('sleep 25'));
    });
  });

  describe('getGuideText', () => {
    test('returns non-empty string with key sections', () => {
      const guide = getGuideText();
      expect(typeof guide).toBe('string');
      expect(guide.length).toBeGreaterThan(100);
      expect(guide).toContain('Amicus');
    });

    test('contains workflow instructions', () => {
      const guide = getGuideText();
      expect(guide).toContain('amicus_start');
      expect(guide).toContain('amicus_status');
      expect(guide).toContain('amicus_read');
    });

    test('contains agent selection guidance', () => {
      const guide = getGuideText();
      expect(guide).toContain('Chat');
      expect(guide).toContain('Plan');
      expect(guide).toContain('Build');
    });

    test('contains briefing guidance', () => {
      const guide = getGuideText();
      expect(guide.toLowerCase()).toContain('briefing');
    });

    test('contains full alias table with actual model IDs', () => {
      const guide = getGuideText();
      expect(guide).toContain('| Alias | Model |');
      expect(guide).toContain('| gemini |');
      expect(guide).toContain('| opus |');
      expect(guide).toContain('| codex |');
      expect(guide).toContain('openrouter/');
    });

    test('contains context control guidance', () => {
      const guide = getGuideText();
      expect(guide).toContain('## Context Control (includeContext)');
      expect(guide).toContain('includeContext: false');
      expect(guide).toContain('Safe to Skip Context');
      expect(guide).toContain('Self-Contained Briefing Template');
    });

    test('contains parentSession guidance for Claude Code CLI', () => {
      const guide = getGuideText();
      expect(guide).toContain('parentSession');
      expect(guide).toContain('Claude Code CLI');
    });

    test('surfaces the running amicus version (#33)', () => {
      const guide = getGuideText();
      const runningVersion = require('../package.json').version;
      expect(guide).toContain(runningVersion);
    });

    test('headless workflow presents amicus_wait as the primary step, sleep+status as fallback (B16)', () => {
      const guide = getGuideText();
      const headlessStart = mustIndexOf(guide, '### Headless Mode', 'amicus_guide "### Headless Mode" heading');
      const headlessEnd = mustIndexOf(guide, '### Interactive Mode', 'amicus_guide "### Interactive Mode" heading');
      const headless = guide.slice(headlessStart, headlessEnd);
      expect(headless).toContain('amicus_wait');
      expect(headless).toContain('sleep');
      // amicus_wait must be presented as the primary step, before the sleep+status fallback steps.
      expect(headless.indexOf('amicus_wait')).toBeLessThan(headless.indexOf('sleep'));
    });

  });

  describe('Input Validation (Security)', () => {
    test('safeTaskId accepts valid IDs', () => {
      expect(safeTaskId.parse('abc-123')).toBe('abc-123');
      expect(safeTaskId.parse('task_001')).toBe('task_001');
      expect(safeTaskId.parse('a'.repeat(64))).toBe('a'.repeat(64));
    });

    test('safeTaskId rejects path traversal', () => {
      expect(() => safeTaskId.parse('../etc/passwd')).toThrow();
      expect(() => safeTaskId.parse('task/../../../etc')).toThrow();
      expect(() => safeTaskId.parse('../../..')).toThrow();
    });

    test('safeTaskId rejects empty and too-long IDs', () => {
      expect(() => safeTaskId.parse('')).toThrow();
      expect(() => safeTaskId.parse('a'.repeat(65))).toThrow();
    });

    test('safeTaskId rejects special characters', () => {
      expect(() => safeTaskId.parse('task;rm -rf /')).toThrow();
      expect(() => safeTaskId.parse('task$(evil)')).toThrow();
    });

    test('safeModel accepts valid model strings', () => {
      expect(safeModel.parse('gemini')).toBe('gemini');
      expect(safeModel.parse('openrouter/google/gemini-3-flash-preview')).toBe('openrouter/google/gemini-3-flash-preview');
      expect(safeModel.parse('anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
    });

    test('safeModel rejects flag injection', () => {
      expect(() => safeModel.parse('--malicious')).toThrow();
      expect(() => safeModel.parse('-flag')).toThrow();
    });

    test('safeModel rejects shell metacharacters', () => {
      expect(() => safeModel.parse('model;rm -rf /')).toThrow();
      expect(() => safeModel.parse('model$(evil)')).toThrow();
    });
  });

  describe('MCP tool schemas include project param', () => {
    const toolsWithProject = [
      'amicus_start', 'amicus_status', 'amicus_read',
      'amicus_list', 'amicus_resume', 'amicus_continue', 'amicus_abort',
    ];

    for (const name of toolsWithProject) {
      test(`${name} has optional project parameter`, () => {
        const tool = TOOLS.find(t => t.name === name);
        expect(tool).toBeDefined();
        expect(tool.inputSchema.project).toBeDefined();
      });
    }

    test('amicus_setup does NOT have project parameter', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_setup');
      expect(tool.inputSchema.project).toBeUndefined();
    });

    test('amicus_guide does NOT have project parameter', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_guide');
      expect(tool.inputSchema.project).toBeUndefined();
    });
  });
});

describe('council MCP tool schemas', () => {
  const { getTools } = require('../src/mcp-tools');
  const byName = () => Object.fromEntries(getTools().map(t => [t.name, t]));
  test('exposes the three council tools', () => {
    const t = byName();
    for (const name of ['amicus_council_tally', 'amicus_council_stats', 'amicus_verdict']) {
      expect(t).toHaveProperty(name);
      expect(typeof t[name].description).toBe('string');
    }
    expect(t.amicus_council_tally.annotations).toHaveProperty('readOnlyHint', true);
    expect(t.amicus_council_stats.annotations).toHaveProperty('readOnlyHint', true);
    // v4.1 §4.5c: amicus_verdict can now write report.html (render:true + outDir).
    expect(t.amicus_verdict.annotations).toHaveProperty('readOnlyHint', false);
  });
  test('tally schema requires findings, adjudications, rankings, meta', () => {
    const tally = byName().amicus_council_tally;
    for (const k of ['meta', 'findings', 'adjudications', 'rankings']) {
      expect(tally.inputSchema).toHaveProperty(k);
    }
  });
  test('stats schema has no required inputs', () => {
    const stats = byName().amicus_council_stats;
    expect(Object.keys(stats.inputSchema)).toEqual(expect.arrayContaining(['project']));
  });
});

describe('getGuideText update line (spec 2026-08-03)', () => {
  const originalMock = process.env.AMICUS_MOCK_UPDATE;

  afterEach(() => {
    if (originalMock === undefined) { delete process.env.AMICUS_MOCK_UPDATE; }
    else { process.env.AMICUS_MOCK_UPDATE = originalMock; }
  });

  test('shows the update-available line under mock mode', () => {
    process.env.AMICUS_MOCK_UPDATE = 'available';
    const text = getGuideText();
    expect(text).toContain('**Update available: v99.0.0**'); // updater mock FAKE_LATEST
  });

  test('no update known: no update line', () => {
    delete process.env.AMICUS_MOCK_UPDATE;
    const text = getGuideText();
    expect(text).not.toContain('Update available:');
  });
});
