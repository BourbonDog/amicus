// tests/pack/pack-validate.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let tmp;
beforeEach(() => {
  jest.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-validate-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
  // getEffectiveAliases() merges defaults + user config; seed the names this
  // file's fixtures use as bench/chair/model values.
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
    aliases: { deepseek: 'deepseek/deepseek-chat', 'qwen-coder': 'qwen/qwen3-coder', gpt: 'openai/gpt-5.3' },
  }));
});
afterEach(() => {
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const load = () => require('../../src/pack/pack-validate');

// Base fixture idiom shared with Task 7 (tests/pack/pack-store.test.js).
const PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'sec-review', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['deepseek', 'qwen-coder'], chair: 'gpt', critic: null, lenses: null,
  options: { timeout: 10 }, briefing: { template: 'review' },
});
const FANOUT_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'fanout-review', version: '1.0.0', kind: 'fanout',
  description: 'x', bench: ['deepseek', 'qwen-coder'], options: { noContext: true },
  briefing: { template: 'review' },
});
const SOLO_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'solo-review', version: '1.0.0', kind: 'solo',
  description: 'x', model: 'deepseek', options: { noUi: true },
  briefing: { template: 'review' },
});

describe('validatePack: structural shape', () => {
  const cases = [
    ['missing schemaVersion', (p) => { delete p.schemaVersion; }, /schemaVersion must be 1/],
    ['wrong schemaVersion', (p) => { p.schemaVersion = 2; }, /schemaVersion must be 1/],
    ['missing type', (p) => { delete p.type; }, /type must be 'pack'/],
    ['wrong type', (p) => { p.type = 'not-a-pack'; }, /type must be 'pack'/],
    ['missing name', (p) => { delete p.name; }, /invalid pack name/],
    ['wrong-type name', (p) => { p.name = 123; }, /invalid pack name/],
    ['bad name grammar', (p) => { p.name = 'Bad Name!'; }, /invalid pack name/],
    ['missing kind', (p) => { delete p.kind; }, /kind must be one of/],
    ['unknown kind', (p) => { p.kind = 'bogus'; }, /kind must be one of/],
    ['non-semver version', (p) => { p.version = '1.0'; }, /version must be semver-shaped/],
  ];
  test.each(cases)('%s -> ok:false', (_label, mutate, expected) => {
    const { validatePack } = load();
    const pack = PACK();
    mutate(pack);
    const res = validatePack(pack, { mode: 'save' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toMatch(expected);
  });
});

describe('validatePack: kind-inappropriate fields', () => {
  test('council pack with a model field is rejected', () => {
    const { validatePack } = load();
    const res = validatePack({ ...PACK(), model: 'deepseek' }, { mode: 'save' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toContain("field 'model' is not valid for kind 'council'");
  });
  test('fanout pack with a chair field is rejected', () => {
    const { validatePack } = load();
    const res = validatePack({ ...FANOUT_PACK(), chair: 'gpt' }, { mode: 'save' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toContain("field 'chair' is not valid for kind 'fanout'");
  });
  test('solo pack with a bench field is rejected', () => {
    const { validatePack } = load();
    const res = validatePack({ ...SOLO_PACK(), bench: ['deepseek', 'qwen-coder'] }, { mode: 'save' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toContain("field 'bench' is not valid for kind 'solo'");
  });
});

describe('validatePack: inline-bench council rules', () => {
  test('chair inside the bench is rejected', () => {
    const { validatePack } = load();
    const res = validatePack({ ...PACK(), chair: 'deepseek' }, { mode: 'save' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toContain('is a bench seat');
  });
  test('critic outside the bench is rejected', () => {
    const { validatePack } = load();
    const res = validatePack({ ...PACK(), critic: 'gpt' }, { mode: 'save' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toContain('must be one of the bench seats');
  });
  test('critic and lenses together are rejected', () => {
    const { validatePack } = load();
    const res = validatePack({ ...PACK(), critic: 'deepseek', lenses: ['sec', 'perf'] }, { mode: 'save' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toContain('mutually exclusive');
  });
  test('lenses count mismatched with bench size is rejected', () => {
    const { validatePack } = load();
    const res = validatePack({ ...PACK(), critic: null, lenses: ['sec'] }, { mode: 'save' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toContain('lenses needs exactly one lens per seat');
  });
});

describe('validatePack: options allowlist', () => {
  test('unknown options key names the offending key and kind', () => {
    const { validatePack } = load();
    const res = validatePack({ ...PACK(), options: { frobnicate: 1 } }, { mode: 'save' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toContain("unknown option 'frobnicate' for kind 'council'");
  });

  // v4.5 HOLD-gate decision 2 (final-review F1): agent/thinking/summaryLength
  // were inert on every council surface (the CLI dead-fills them, never reads
  // them; the engine hardcodes agent 'Plan'/summaryLength 'verbose') — dropped
  // from KIND_OPTIONS.council pre-release rather than shipped as dead weight.
  // A council pack that still carries one now fails save-validation, same as
  // any other unknown option for the kind.
  test.each(['agent', 'thinking', 'summaryLength'])(
    "dropped council option '%s' is rejected as unknown (v4.5 HOLD-gate decision 2)",
    (key) => {
      const { validatePack } = load();
      const res = validatePack({ ...PACK(), options: { ...PACK().options, [key]: 'x' } }, { mode: 'save' });
      expect(res.ok).toBe(false);
      expect(res.errors.join(' | ')).toContain(`unknown option '${key}' for kind '${'council'}'`);
    }
  );

  // Regression lock: the drop is council-only — fanout/solo genuinely apply
  // these knobs and must keep accepting them.
  test('fanout pack may still carry agent/thinking/summaryLength (council-only drop)', () => {
    const { validatePack } = load();
    const res = validatePack({
      ...FANOUT_PACK(), options: { ...FANOUT_PACK().options, agent: 'Plan', thinking: 'high', summaryLength: 'brief' },
    }, { mode: 'save' });
    expect(res).toEqual({ ok: true, warnings: [] });
  });

  test('solo pack may still carry agent/thinking/summaryLength (council-only drop)', () => {
    const { validatePack } = load();
    const res = validatePack({
      ...SOLO_PACK(), options: { ...SOLO_PACK().options, agent: 'Plan', thinking: 'high', summaryLength: 'brief' },
    }, { mode: 'save' });
    expect(res).toEqual({ ok: true, warnings: [] });
  });
});

describe('validatePack: bench member resolution', () => {
  test('unresolvable bench member is named; no user aliases (shipped defaults still merge in)', () => {
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ aliases: {} }));
    const { validatePack } = load();
    const pack = { ...PACK(), bench: ['notanalias', 'openai/gpt-5.3'] };
    const res = validatePack(pack, { mode: 'save' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toMatch(/unresolvable/);
    expect(res.errors.join(' | ')).toContain('notanalias');
  });
  test('a USER-configured alias (not a shipped default) resolves through the config merge', () => {
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
      aliases: { 'zz-custom': 'vendor/model-x', deepseek: 'deepseek/deepseek-chat', 'qwen-coder': 'qwen/qwen3-coder', gpt: 'openai/gpt-5.3' },
    }));
    const { validatePack } = load();
    const pack = { ...PACK(), bench: ['zz-custom', 'deepseek'], chair: 'gpt' };
    const res = validatePack(pack, { mode: 'save' });
    expect(res).toEqual({ ok: true, warnings: [] });
  });
  test('a vendor/model bench member resolves without an alias lookup', () => {
    const { validatePack } = load();
    const pack = { ...FANOUT_PACK(), bench: ['openai/gpt-5.3', 'anthropic/claude-x'] };
    const res = validatePack(pack, { mode: 'save' });
    expect(res).toEqual({ ok: true, warnings: [] });
  });
});

describe('validatePack: by-name bench', () => {
  test('built-in "budget" bench resolves; lenses defer member-level checks to run time', () => {
    const { validatePack } = load();
    const pack = { ...PACK(), bench: 'budget', chair: null, critic: null, lenses: ['sec', 'perf'] };
    const res = validatePack(pack, { mode: 'save' });
    expect(res.ok).toBe(true);
    // Brief's quoted phrase "member-level checks deferred to run time" isn't
    // literally contiguous in the implementation (a parenthetical sits between
    // "checks" and "deferred") -- assert both halves instead of the full phrase.
    expect(res.warnings.join(' | ')).toContain('member-level checks');
    expect(res.warnings.join(' | ')).toContain('deferred to run time');
  });
});

describe('validatePack: briefing.template resolution', () => {
  test('unresolvable template is a warning in save mode', () => {
    const { validatePack } = load();
    const res = validatePack({ ...PACK(), briefing: { template: 'ghost' } }, { mode: 'save' });
    expect(res.ok).toBe(true);
    expect(res.warnings.join(' | ')).toContain('does not resolve');
  });
  test('unresolvable template is an error in run mode', () => {
    const { validatePack } = load();
    const res = validatePack({ ...PACK(), briefing: { template: 'ghost' } }, { mode: 'run' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toContain('does not resolve');
  });
});

describe('validatePack: fully valid packs', () => {
  test('a valid council pack is ok with no warnings', () => {
    const { validatePack } = load();
    expect(validatePack(PACK(), { mode: 'save' })).toEqual({ ok: true, warnings: [] });
  });
  test('a valid fanout pack (bench + options.noContext) is ok with no warnings', () => {
    const { validatePack } = load();
    expect(validatePack(FANOUT_PACK(), { mode: 'save' })).toEqual({ ok: true, warnings: [] });
  });
  test('a valid solo pack (model + options.noUi) is ok with no warnings', () => {
    const { validatePack } = load();
    expect(validatePack(SOLO_PACK(), { mode: 'save' })).toEqual({ ok: true, warnings: [] });
  });
});
