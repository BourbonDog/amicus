/**
 * MCP Tool Definitions Tests
 *
 * Tests for tool schema structure, required tools, input schema validation,
 * and the amicus_guide text content.
 */

const { z } = require('zod');
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

  // M-1 (whole-branch review of 4.1.1): mcp-tools.js :: amicus_start and
  // mcp-tools.js :: getGuideText were reverted from a bare dot-versioned
  // Anthropic id (`anthropic/claude-opus-4.8`, which the direct Anthropic API
  // rejects) back to the correct dash-form id (`anthropic/claude-opus-4-8`).
  // Nothing pinned either surface, so all 7 MCP suites stayed green whichever
  // form was live. Pin both to the dash form and reject any bare
  // dot-versioned Anthropic id pattern.
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

    // v4.7 F8 (D14): status relaxes from a fixed enum to any string, so
    // 'aborted'/'error'/'crashed'/'idle-timeout' (schema-legal statuses this
    // enum never listed) pass through the MCP schema layer, not just the
    // in-process handler.
    test('status accepts any string value, not just the former enum (schema relax, D14)', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_list');
      const parsed = z.object(tool.inputSchema).parse({ status: 'aborted' });
      expect(parsed.status).toBe('aborted');
    });

    test('status remains optional', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_list');
      const parsed = z.object(tool.inputSchema).parse({});
      expect('status' in parsed).toBe(false);
    });

    // F8 D15 (errata E-PR3-5): case-insensitive substring filter over
    // id/tag/briefing material, shared with the CLI's --search.
    test('has an optional search string in the input schema', () => {
      const tool = TOOLS.find(t => t.name === 'amicus_list');
      expect(tool.inputSchema).toHaveProperty('search');
      const parsed = z.object(tool.inputSchema).parse({ search: 'needle' });
      expect(parsed.search).toBe('needle');
      expect('search' in z.object(tool.inputSchema).parse({})).toBe(false);
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

    // v4.7 PR7 Task 9 review: the task's own "TYPED door" test
    // (tests/pack/mcp-pack-params.test.js, 'typed timeout: -1 with a
    // valid prompt') calls handlers.amicus_fanout(input, project) directly —
    // but zod validation only runs inside the MCP SDK's registerTool
    // dispatch wrapper (node_modules/@modelcontextprotocol/sdk/dist/cjs/
    // server/mcp.js: validateToolInput, upstream of executeToolHandler), so
    // that test never actually reaches the schema. Proof by mutation:
    // reverting prompt to z.string() and timeout to z.number().optional() in
    // src/mcp-tools.js left all 4 of that describe block's tests green.
    //
    // mcp-pack-params.test.js already names this exact failure mode
    // for a sibling schema change: "a unit test that hand-builds its own
    // input object (bypassing Zod) would not notice if .default(...) were
    // ever reintroduced." The same reasoning applies to .min(1)/.positive()
    // here, so these parse through the REAL fanoutTool.inputSchema via
    // z.object(...).parse — the same shape the MCP SDK builds from
    // getTools() — rather than hand-building an input object.
    //
    // Not covered here: z.string().min(1) accepts whitespace-only strings
    // like '   ' — that case is rejected by the handler's own .trim() check
    // (src/mcp-server.js), not by the schema, so it is deliberately not
    // asserted in this schema-boundary block.
    describe('prompt/timeout schema guards (Task 9 review)', () => {
      test('rejects an empty prompt', () => {
        expect(() => z.object(fanoutTool.inputSchema).parse({ prompt: '' })).toThrow();
      });

      test('rejects a non-positive timeout', () => {
        expect(() => z.object(fanoutTool.inputSchema).parse({ prompt: 'hi', timeout: -1 })).toThrow();
      });

      test('accepts a valid prompt with a positive timeout (baseline — proves the rejections above are not rejecting everything)', () => {
        const parsed = z.object(fanoutTool.inputSchema).parse({ prompt: 'hi', timeout: 5 });
        expect(parsed.prompt).toBe('hi');
        expect(parsed.timeout).toBe(5);
      });
    });
  });

  describe('tag input (F8 D13, errata E-PR3-2)', () => {
    // amicus_start/amicus_fanout share `prompt` as their sole required field;
    // amicus_council_run requires `briefingFile` instead — each `extra` supplies
    // just enough to satisfy the schema's OTHER required keys so z.object(...).parse
    // exercises `tag` in isolation.
    const TAG_TOOLS = [
      { name: 'amicus_start', extra: { prompt: 'hi' } },
      { name: 'amicus_fanout', extra: { prompt: 'hi' } },
      { name: 'amicus_council_run', extra: { briefingFile: '/tmp/briefing.md' } },
    ];

    test.each(TAG_TOOLS)('$name declares tag as optional with no Zod default', ({ name }) => {
      const tool = TOOLS.find(t => t.name === name);
      expect(tool.inputSchema).toHaveProperty('tag');
      const schema = tool.inputSchema.tag;
      expect(schema._def.typeName).toBe('ZodOptional');
      expect(schema.isOptional()).toBe(true);
    });

    test.each(TAG_TOOLS)('$name accepts a valid tag', ({ name, extra }) => {
      const tool = TOOLS.find(t => t.name === name);
      const parsed = z.object(tool.inputSchema).parse({ ...extra, tag: 'sprint-42_v2' });
      expect(parsed.tag).toBe('sprint-42_v2');
    });

    test.each(TAG_TOOLS)('$name rejects a tag with disallowed characters', ({ name, extra }) => {
      const tool = TOOLS.find(t => t.name === name);
      expect(() => z.object(tool.inputSchema).parse({ ...extra, tag: 'bad tag!' })).toThrow();
    });

    test.each(TAG_TOOLS)('$name rejects a tag over 64 chars', ({ name, extra }) => {
      const tool = TOOLS.find(t => t.name === name);
      expect(() => z.object(tool.inputSchema).parse({ ...extra, tag: 'a'.repeat(65) })).toThrow();
    });

    test.each(TAG_TOOLS)('$name leaves tag genuinely absent from the parsed result when omitted', ({ name, extra }) => {
      const tool = TOOLS.find(t => t.name === name);
      const parsed = z.object(tool.inputSchema).parse({ ...extra });
      expect('tag' in parsed).toBe(false);
    });

    // v4.7 F8 (D13, T4 review): regex-parity pin — the MCP schema's tag regex
    // is a duplicated literal (mcp-tools.js), not an import of
    // utils/validators.js's TAG_PATTERN (the CLI's own --tag validator). This
    // locks the two in sync: if either ever drifts, a value the CLI accepts
    // could be rejected over MCP (or vice versa) with no other test to catch it.
    test.each(TAG_TOOLS)('$name: tag regex source matches utils/validators.js TAG_PATTERN exactly', ({ name }) => {
      const { TAG_PATTERN } = require('../src/utils/validators');
      const tool = TOOLS.find(t => t.name === name);
      const inner = tool.inputSchema.tag.unwrap(); // ZodOptional -> ZodString
      const regexCheck = inner._def.checks.find(c => c.kind === 'regex');
      expect(regexCheck).toBeDefined();
      expect(regexCheck.regex.source).toBe(TAG_PATTERN.source);
      expect(regexCheck.regex.flags).toBe(TAG_PATTERN.flags);
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

// v4.8 PR4c Task 3 (plan §1.5, R4c-5) — the MCP tally schema must not strip the
// seat keys, or `amicus_council_tally` stays permanently on the #137 behaviour
// while `amicus council tally` (cli-handlers-council.js, a raw JSON.parse with
// no schema at all) gets the fix. zod STRIPS unknown keys rather than rejecting
// them, so the fork would be silent: mcp-server hands the SDK-PARSED input to
// `tally()`.
//
// The widening is deliberately PERMISSIVE — validate the envelope, let `tally()`
// be the single arbiter of shape on both paths. Two tighter spellings were
// measured to leave a fork of their own and each has a test below:
// `z.array(z.record(z.any()))` rejects a string seat table the CLI accepts, and
// a bare `.optional()` rejects `raiserSeat: null` / `seat: null`, which the CLI
// accepts and which serialize byte-identically to omitting the key.
describe('amicus_council_tally retains the seat keys (v4.8 PR4c R4c-5, T16)', () => {
  const { getTools } = require('../src/mcp-tools');
  const schema = () => getTools().find(t => t.name === 'amicus_council_tally').inputSchema;

  test('meta.seats survives the parse', () => {
    const seats = [{ id: 'deepseek#1', alias: 'deepseek', role: 'seat', lens: null, position: 1 }];
    const out = schema().meta.parse({ runId: 'r', models: ['deepseek', 'deepseek'], seats });
    expect(out.seats).toEqual(seats);
  });

  test('meta.seats accepts a NON-object table, exactly as the CLI does', () => {
    expect(schema().meta.parse({ runId: 'r', models: ['a'], seats: ['deepseek#1'] }).seats)
      .toEqual(['deepseek#1']);
    expect(schema().meta.parse({ runId: 'r', models: ['a'], seats: [] }).seats).toEqual([]);
  });

  test('findings[].raiserSeat survives, including the `|| null` idiom', () => {
    const out = schema().findings.parse([
      { id: 'F1', raiser: 'deepseek', severity: 'major', raiserSeat: 'deepseek#1' },
      { id: 'F2', raiser: 'gpt', severity: 'minor', raiserSeat: null },
    ]);
    expect(out[0].raiserSeat).toBe('deepseek#1');
    expect(out[1].raiserSeat).toBeNull();
  });

  test('adjudications[].seat survives, including the `|| null` idiom', () => {
    const out = schema().adjudications.parse([
      { judge: 'deepseek', findingId: 'F1', verdict: 'agree', seat: 'deepseek#2' },
      { judge: 'gpt', findingId: 'F1', verdict: 'agree', seat: null },
    ]);
    expect(out[0].seat).toBe('deepseek#2');
    expect(out[1].seat).toBeNull();
  });

  // v4.8 T3.2: rankings[].seat is a FOURTH seat key, added when run-assemble.js's
  // buildTallyInput started emitting the judge's own seat on rankings[]. Same
  // reasoning as the three above: undeclared here, zod strips it silently and a
  // hand-assembled MCP call can seat its adjudications but not its rankings.
  test('rankings[].seat survives, including the `|| null` idiom', () => {
    const out = schema().rankings.parse([
      { judge: 'deepseek', order: ['deepseek'], seat: 'deepseek#2' },
      { judge: 'gpt', order: ['deepseek'], seat: null },
    ]);
    expect(out[0].seat).toBe('deepseek#2');
    expect(out[1].seat).toBeNull();
  });

  // ⚠️ Council C1: the `|| null` idiom was spelled `.nullable().optional()` for
  // `raiserSeat` and `seat` and left bare `.optional()` for `seats` — two of
  // three. Measured at that spelling: the MCP path fails the WHOLE call with
  // `seats: Expected array, received null`, while `amicus council tally`
  // (cli-handlers-council.js:24, raw JSON.parse, no schema) accepts it, and
  // every seat-space reader treats it as absent because `Array.isArray(null)`
  // is false. That is exactly the silent CLI/MCP fork R4c-5 exists to close,
  // and `mcp-tools.js`'s own `amicus_verdict` already spells array/record
  // envelope keys `.nullable().optional()` (`seatLoss`, `degrades`).
  test('meta.seats accepts the `|| null` idiom too, exactly as the CLI does', () => {
    expect(schema().meta.parse({ runId: 'r', models: ['a'], seats: null }).seats).toBeNull();
  });

  test('a null seats table reaches tally() and is treated as ABSENT, so both paths agree', () => {
    const { tally } = require('../src/council/tally');
    const base = {
      meta: { runId: 'r', runType: 'headless', date: '2026-07-20',
        models: ['gemini', 'gpt'], chair: 'deepseek', claudeInCouncil: false },
      findings: [{ id: 'A1', raiser: 'gemini', severity: 'major' }],
      adjudications: [{ findingId: 'A1', judge: 'gpt', verdict: 'agree' }],
      rankings: [{ judge: 'gpt', order: ['gemini'] }],
      runStats: [],
    };
    // mcp-server.js:1544-1547 hands the SDK-PARSED input to the handler and
    // :1424 does `const record = tally(input)` — so the parse output, not the
    // raw object, is what tally() sees on this path.
    const s = schema();
    const record = tally({
      meta: s.meta.parse({ ...base.meta, seats: null }),
      findings: s.findings.parse(base.findings),
      adjudications: s.adjudications.parse(base.adjudications),
      rankings: s.rankings.parse(base.rankings),
      runStats: s.runStats.parse(base.runStats),
    });
    expect(record.meta.seats).toBeNull();
    // Equivalent to the document that never carried the key: identical modulo
    // that one key, which `JSON.stringify` drops when it is set to undefined.
    const strip = r => JSON.parse(JSON.stringify({ ...r, meta: { ...r.meta, seats: undefined } }));
    expect(strip(record)).toEqual(strip(tally(JSON.parse(JSON.stringify(base)))));
  });
});

// SI-23 (R10): `findings[].location` was silently stripped by the same closed
// z.object, one key later than the seat keys above. MEASURED (see the
// comment above `findings:` in mcp-tools.js): `location` is the one real
// field of the four R10 named — `evidence`/`file`/`line` do not exist
// anywhere in this codebase's finding shape (no producer, no consumer).
// The property that matters, per the brief, is that the field reaches
// tally()'s OUTPUT document, not merely that it survives zod — so the pin
// below exercises the schema's own `.parse()` (not a hand-built object that
// bypasses it) and feeds the parsed result into `tally()`, the same recipe
// as 'a null seats table reaches tally()' above. SCHEMASTRIP (remove the
// `location` declaration in mcp-tools.js) turns this red: zod strips the key
// before `tally()` ever runs, so `record.findings[0].location` goes missing.
// The round-trip test's fixture already carried `claim: 'c'` unasserted;
// SI-23 fix round 1 (PR #183 council A1/B1) now asserts it too, since
// `claim` was declared on this same schema before R10 and reaches this exact
// MCP path — it was tally.js's outFindings map, not this schema, that
// dropped it, so this pin exercises the fix at the schema+tally() seam
// findings A1/B1 named.
describe('amicus_council_tally retains findings[].location (SI-23, R10)', () => {
  const { getTools } = require('../src/mcp-tools');
  const { tally } = require('../src/council/tally');
  const schema = () => getTools().find(t => t.name === 'amicus_council_tally').inputSchema;

  test('findings[].location survives the schema parse', () => {
    const out = schema().findings.parse([
      { id: 'A1', raiser: 'deepseek', severity: 'major', location: 'src/foo.js line 12' },
      { id: 'A2', raiser: 'gpt', severity: 'minor' },
    ]);
    expect(out[0].location).toBe('src/foo.js line 12');
    expect('location' in out[1]).toBe(false);
  });

  test('round-trip: a hand-assembled MCP-shaped input carrying location still carries it after tally()', () => {
    const s = schema();
    const record = tally({
      meta: s.meta.parse({ runId: 'r', models: ['deepseek', 'gpt'], chair: 'gpt' }),
      findings: s.findings.parse([
        { id: 'A1', raiser: 'deepseek', severity: 'major', claim: 'c', location: 'src/foo.js line 12' },
      ]),
      adjudications: s.adjudications.parse([
        { judge: 'gpt', findingId: 'A1', verdict: 'agree' },
      ]),
      rankings: s.rankings.parse([]),
      runStats: s.runStats.parse([]),
    });
    expect(record.findings[0].location).toBe('src/foo.js line 12');
    expect(record.findings[0].claim).toBe('c');
  });
});

// v4.9 W5.2: `intent` on the two council MCP shapes.
//
// amicus_council_run gains a real enum param (`.optional()` never `.default()`
// — the absent-key idiom is the engine-wide representation of 'review').
//
// amicus_council_tally's closed meta z.object is the same silent-strip trap as
// the seat keys above (#137 shape): W5.3 puts `intent` on the engine-built
// tally-input's meta, so WITHOUT a declaration here zod strips it from every
// hand-assembled MCP call and the three W5.4 ledger gates see a review run —
// a task run's rankings would land in the reliability ledger via exactly one
// transport. Permissive z.string(), matching runType: tally() stays the
// single arbiter of shape on both paths.
describe('intent on the council MCP schemas (v4.9 W5.2)', () => {
  const byName = () => Object.fromEntries(getTools().map(t => [t.name, t]));

  test('amicus_council_run declares intent as an optional review|task enum with no Zod default', () => {
    const schema = byName().amicus_council_run.inputSchema.intent;
    expect(schema).toBeDefined();
    expect(schema._def.typeName).toBe('ZodOptional');
    expect(schema.isOptional()).toBe(true);
  });

  test("amicus_council_run accepts intent 'task' and 'review', rejects anything else", () => {
    const tool = byName().amicus_council_run;
    const extra = { briefingFile: '/tmp/briefing.md' };
    expect(z.object(tool.inputSchema).parse({ ...extra, intent: 'task' }).intent).toBe('task');
    expect(z.object(tool.inputSchema).parse({ ...extra, intent: 'review' }).intent).toBe('review');
    expect(() => z.object(tool.inputSchema).parse({ ...extra, intent: 'bogus' })).toThrow();
  });

  test('amicus_council_run leaves intent genuinely absent from the parsed result when omitted', () => {
    const tool = byName().amicus_council_run;
    const parsed = z.object(tool.inputSchema).parse({ briefingFile: '/tmp/briefing.md' });
    expect('intent' in parsed).toBe(false);
  });

  // The strip pin (RED first against the raw shape): undeclared, zod ^3
  // silently DROPS meta.intent rather than rejecting it.
  test('amicus_council_tally meta.intent survives the MCP parse', () => {
    const schema = byName().amicus_council_tally.inputSchema;
    const out = schema.meta.parse({ runId: 'r', models: ['a', 'b'], intent: 'task' });
    expect(out.intent).toBe('task');
  });

  test('amicus_council_tally meta.intent stays absent when omitted', () => {
    const schema = byName().amicus_council_tally.inputSchema;
    const out = schema.meta.parse({ runId: 'r', models: ['a', 'b'] });
    expect('intent' in out).toBe(false);
  });
});
