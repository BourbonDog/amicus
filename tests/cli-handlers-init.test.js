// tests/cli-handlers-init.test.js
//
// `amicus init` (src/cli-handlers-init.js). Every dependency
// (claude-register, cli-handlers-doctor, doctor-summary) is replaced via
// jest.doMock before the module under test is required, so this file NEVER
// loads the real src/utils/claude-register.js and NEVER touches
// ~/.claude.json, the real Claude Desktop config, or ~/.claude/skills.
'use strict';

describe('handleInit', () => {
  afterEach(() => jest.resetModules());

  test('no flags -> runs both targets and reports per-step status', async () => {
    jest.resetModules();
    const calls = [];
    jest.doMock('../src/utils/claude-register', () => ({
      installSkill: () => calls.push('skill'),
      installCouncilSkill: () => calls.push('council'),
      registerClaudeCode: () => { calls.push('code'); return 'added'; },
      registerClaudeDesktop: () => { calls.push('desktop'); return 'updated'; },
      migrateLegacyMcp: () => calls.push('migrate'),
      MCP_CONFIG: {},
    }));
    jest.doMock('../src/cli-handlers-doctor', () => ({ runDoctorChecks: async () => [{ status: 'ok' }] }));
    jest.doMock('../src/utils/doctor-summary', () => ({ summarizeDoctor: () => 'doctor: all 1 checks pass' }));
    const out = [];
    const { handleInit } = require('../src/cli-handlers-init');
    const code = await handleInit({ _: ['init'], json: true }, { emitJson: (o) => out.push(o), print: () => {} });
    expect(calls).toEqual(expect.arrayContaining(['skill', 'council', 'code', 'desktop', 'migrate']));
    expect(code).toBe(0);
    expect(out[0].steps.claudeCode).toBe('added');
    expect(out[0].steps.claudeDesktop).toBe('updated');
    expect(out[0].ok).toBe(true);
  });

  test('--claude narrows to Claude Code only (desktop not called)', async () => {
    jest.resetModules();
    const calls = [];
    jest.doMock('../src/utils/claude-register', () => ({
      installSkill: () => calls.push('skill'), installCouncilSkill: () => calls.push('council'),
      registerClaudeCode: () => { calls.push('code'); return 'unchanged'; },
      registerClaudeDesktop: () => { calls.push('desktop'); return 'added'; },
      migrateLegacyMcp: () => calls.push('migrate'), MCP_CONFIG: {},
    }));
    jest.doMock('../src/cli-handlers-doctor', () => ({ runDoctorChecks: async () => [] }));
    jest.doMock('../src/utils/doctor-summary', () => ({ summarizeDoctor: () => '' }));
    const { handleInit } = require('../src/cli-handlers-init');
    await handleInit({ _: ['init'], claude: true, json: true }, { emitJson: () => {}, print: () => {} });
    expect(calls).toContain('code');
    expect(calls).not.toContain('desktop');
  });

  test('--desktop narrows to Claude Desktop only (code not called)', async () => {
    jest.resetModules();
    const calls = [];
    jest.doMock('../src/utils/claude-register', () => ({
      installSkill: () => calls.push('skill'), installCouncilSkill: () => calls.push('council'),
      registerClaudeCode: () => { calls.push('code'); return 'added'; },
      registerClaudeDesktop: () => { calls.push('desktop'); return 'added'; },
      migrateLegacyMcp: () => calls.push('migrate'), MCP_CONFIG: {},
    }));
    jest.doMock('../src/cli-handlers-doctor', () => ({ runDoctorChecks: async () => [] }));
    jest.doMock('../src/utils/doctor-summary', () => ({ summarizeDoctor: () => '' }));
    const { handleInit } = require('../src/cli-handlers-init');
    await handleInit({ _: ['init'], desktop: true, json: true }, { emitJson: () => {}, print: () => {} });
    expect(calls).toContain('desktop');
    expect(calls).not.toContain('code');
  });

  // M18: handleInit's own '|| done' fallback must stay honest when a dep
  // returns undefined (e.g. a stale/incompatible claude-register) — it must
  // NOT fabricate a specific added/updated/unchanged value it cannot back up.
  test('a registerClaudeCode/Desktop that returns undefined is reported as the honest "done" fallback, not a fabricated status', async () => {
    jest.resetModules();
    jest.doMock('../src/utils/claude-register', () => ({
      installSkill: () => {}, installCouncilSkill: () => {},
      registerClaudeCode: () => undefined,
      registerClaudeDesktop: () => undefined,
      migrateLegacyMcp: () => {}, MCP_CONFIG: {},
    }));
    jest.doMock('../src/cli-handlers-doctor', () => ({ runDoctorChecks: async () => [] }));
    jest.doMock('../src/utils/doctor-summary', () => ({ summarizeDoctor: () => '' }));
    const out = [];
    const { handleInit } = require('../src/cli-handlers-init');
    await handleInit({ _: ['init'], json: true }, { emitJson: (o) => out.push(o), print: () => {} });
    expect(out[0].steps.claudeCode).toBe('done');
    expect(out[0].steps.claudeDesktop).toBe('done');
    expect(['added', 'updated', 'unchanged']).not.toContain(out[0].steps.claudeCode);
  });

  test('a throwing step is reported gracefully, other steps still run, exit code is 1', async () => {
    jest.resetModules();
    const calls = [];
    jest.doMock('../src/utils/claude-register', () => ({
      installSkill: () => calls.push('skill'), installCouncilSkill: () => calls.push('council'),
      registerClaudeCode: () => { throw new Error('disk full'); },
      registerClaudeDesktop: () => { calls.push('desktop'); return 'added'; },
      migrateLegacyMcp: () => calls.push('migrate'), MCP_CONFIG: {},
    }));
    jest.doMock('../src/cli-handlers-doctor', () => ({ runDoctorChecks: async () => [] }));
    jest.doMock('../src/utils/doctor-summary', () => ({ summarizeDoctor: () => '' }));
    const out = [];
    const { handleInit } = require('../src/cli-handlers-init');
    const code = await handleInit({ _: ['init'], json: true }, { emitJson: (o) => out.push(o), print: () => {} });
    expect(code).toBe(1);
    expect(out[0].ok).toBe(false);
    expect(out[0].steps.claudeCode).toMatch(/failed.*disk full/);
    // Claude Desktop registration + legacy migration still ran despite Claude
    // Code's failure -- graceful, per-step degradation, not an all-or-nothing abort.
    expect(calls).toContain('desktop');
    expect(calls).toContain('migrate');
  });

  // Guarded polish: a bug in the doctor check / summary formatting must never
  // crash `init` itself -- registration already happened; the summary is a
  // best-effort bonus tacked on at the end.
  test('a throwing summarizeDoctor does not crash handleInit', async () => {
    jest.resetModules();
    jest.doMock('../src/utils/claude-register', () => ({
      installSkill: () => {}, installCouncilSkill: () => {},
      registerClaudeCode: () => 'added', registerClaudeDesktop: () => 'added',
      migrateLegacyMcp: () => {}, MCP_CONFIG: {},
    }));
    jest.doMock('../src/cli-handlers-doctor', () => ({ runDoctorChecks: async () => [{ status: 'ok' }] }));
    jest.doMock('../src/utils/doctor-summary', () => ({ summarizeDoctor: () => { throw new Error('boom'); } }));
    const out = [];
    const { handleInit } = require('../src/cli-handlers-init');
    const code = await handleInit({ _: ['init'], json: true }, { emitJson: (o) => out.push(o), print: () => {} });
    expect(code).toBe(0);
    expect(out[0].ok).toBe(true);
  });

  test('a throwing runDoctorChecks does not crash handleInit', async () => {
    jest.resetModules();
    jest.doMock('../src/utils/claude-register', () => ({
      installSkill: () => {}, installCouncilSkill: () => {},
      registerClaudeCode: () => 'added', registerClaudeDesktop: () => 'added',
      migrateLegacyMcp: () => {}, MCP_CONFIG: {},
    }));
    jest.doMock('../src/cli-handlers-doctor', () => ({ runDoctorChecks: async () => { throw new Error('probe failed'); } }));
    jest.doMock('../src/utils/doctor-summary', () => ({ summarizeDoctor: () => 'unreachable' }));
    const out = [];
    const { handleInit } = require('../src/cli-handlers-init');
    const code = await handleInit({ _: ['init'], json: true }, { emitJson: (o) => out.push(o), print: () => {} });
    expect(code).toBe(0);
    expect(out[0].ok).toBe(true);
  });

  test('non-json mode prints per-step lines and the doctor summary via the injected print fn', async () => {
    jest.resetModules();
    jest.doMock('../src/utils/claude-register', () => ({
      installSkill: () => {}, installCouncilSkill: () => {},
      registerClaudeCode: () => 'added', registerClaudeDesktop: () => 'unchanged',
      migrateLegacyMcp: () => {}, MCP_CONFIG: {},
    }));
    jest.doMock('../src/cli-handlers-doctor', () => ({ runDoctorChecks: async () => [{ status: 'ok' }] }));
    jest.doMock('../src/utils/doctor-summary', () => ({ summarizeDoctor: () => 'doctor: all 1 checks pass' }));
    const lines = [];
    const { handleInit } = require('../src/cli-handlers-init');
    const code = await handleInit({ _: ['init'] }, { print: (l) => lines.push(l), emitJson: () => {} });
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes('claudeCode') && l.includes('added'))).toBe(true);
    expect(lines.some((l) => l.includes('doctor: all 1 checks pass'))).toBe(true);
  });

  test('default deps shape: handleInit is callable with no injected deps at all (uses realDeps internally)', () => {
    jest.resetModules();
    const { handleInit } = require('../src/cli-handlers-init');
    expect(typeof handleInit).toBe('function');
  });
});
