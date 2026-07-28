// tests/pack/cli-pack-cmd.test.js
'use strict';

/**
 * v4.5 Task 14 (B7/F5) — `amicus pack save|list|show|rm` + `--from-run`: the
 * user-facing management CLI on top of the pack subsystem (pack-store Task 7,
 * pack-validate Task 8), unmocked end-to-end (mirrors tests/pack/cli-council-pack.test.js
 * and cli-fanout-start-pack.test.js's real-writer style — no execution ever
 * happens here, so nothing needs mocking).
 *
 * `--from-run` fixtures are seeded with the REAL writers where practical
 * (run-state.js's initCouncilRun/writePointer for the council branch) and
 * hand-written metadata.json for the wave/solo branches (session-manager.js's
 * getSessionDir, matching the real directory layout).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseArgs } = require('../../src/cli');
const { handlePack } = require('../../src/cli-handlers-pack');
const { ERROR_CODES } = require('../../src/utils/error-doc');
const runState = require('../../src/council/run-state');
const { getSessionDir } = require('../../src/session-manager');

const store = () => require('../../src/pack/pack-store');

let tmp; let out; let err;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-pack-cmd-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
  // Shared alias/council fixture idiom (matches cli-council-pack.test.js): lets
  // bench/chair/critic/model resolution stay fully under this file's control.
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
    aliases: {
      alpha: 'vendorx/alpha-model', beta: 'vendorx/beta-model',
      gamma: 'vendorx/gamma-model', chairmodel: 'vendorx/chair-model',
    },
    councils: { trio: ['alpha', 'beta', 'gamma'] },
  }));
  out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  out.mockRestore();
  err.mockRestore();
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const stdout = () => out.mock.calls.map((c) => c[0]).join('');
const stderr = () => err.mock.calls.map((c) => c[0]).join('');
const pa = (argv) => parseArgs(['pack', ...argv]);

// ---- unknown/missing-arg guards ----
describe('handlePack: unknown subcommand / missing required args', () => {
  test('unknown subcommand -> BAD_ARGS exit 1', async () => {
    const code = await handlePack(pa(['bogus']));
    expect(code).toBe(1);
    expect(stderr()).toContain("unknown pack subcommand 'bogus'");
  });

  test('save with no name -> BAD_ARGS exit 1', async () => {
    const code = await handlePack(pa(['save']));
    expect(code).toBe(1);
    expect(stderr()).toContain('pack save needs a <name>');
  });

  test('show with no name -> BAD_ARGS exit 1', async () => {
    const code = await handlePack(pa(['show']));
    expect(code).toBe(1);
    expect(stderr()).toContain('pack show needs a');
  });

  test('rm with no name -> BAD_ARGS exit 1', async () => {
    const code = await handlePack(pa(['rm']));
    expect(code).toBe(1);
    expect(stderr()).toContain('pack rm needs a <name>');
  });
});

// ---- save -> list -> show -> rm roundtrip ----
describe('handlePack: save -> list -> show -> rm roundtrip', () => {
  test('full lifecycle via flags (human-readable)', async () => {
    let code = await handlePack(pa([
      'save', 'my-council', '--kind', 'council', '--bench', 'alpha,beta',
      '--chair', 'chairmodel', '--description', 'nightly review',
    ]));
    expect(code).toBe(0);
    expect(stdout()).toContain("Saved pack 'my-council' v1.0.0");
    out.mockClear();

    code = await handlePack(pa(['list']));
    expect(code).toBe(0);
    expect(stdout()).toContain('my-council');
    expect(stdout()).toContain('[council]');
    out.mockClear();

    code = await handlePack(pa(['show', 'my-council']));
    expect(code).toBe(0);
    expect(stdout()).toContain("Pack 'my-council'");
    expect(stdout()).toContain('validation: ok');
    out.mockClear();

    code = await handlePack(pa(['rm', 'my-council']));
    expect(code).toBe(0);
    expect(stdout()).toContain("Removed pack 'my-council'");
    out.mockClear();

    code = await handlePack(pa(['show', 'my-council']));
    expect(code).toBe(1);
    expect(stderr()).toContain('not found');
  });

  test('show by file path works too (not just by name)', async () => {
    const w = store().writePack({
      schemaVersion: 1, type: 'pack', name: 'path-pack', version: '1.0.0', kind: 'solo',
      model: 'vendorx/solo-model',
    });
    const code = await handlePack(pa(['show', w.path]));
    expect(code).toBe(0);
    expect(stdout()).toContain("Pack 'path-pack'");
  });
});

describe('handlePack: list with no packs', () => {
  test('human mode prints "No packs."', async () => {
    const code = await handlePack(pa(['list']));
    expect(code).toBe(0);
    expect(stdout()).toBe('No packs.\n');
  });
});

// ---- --json doc shapes ----
describe('handlePack: --json doc shapes', () => {
  test('save/list/show/rm each emit their documented schemaVersion + type', async () => {
    let code = await handlePack(pa(['save', 'json-pack', '--kind', 'solo', '--model', 'alpha', '--json']));
    expect(code).toBe(0);
    let doc = JSON.parse(stdout());
    expect(doc).toMatchObject({ type: 'pack-save', name: 'json-pack' });
    expect(doc.schemaVersion).toBeDefined();
    out.mockClear();

    code = await handlePack(pa(['list', '--json']));
    expect(code).toBe(0);
    doc = JSON.parse(stdout());
    expect(doc.type).toBe('pack-list');
    expect(doc.dir).toBe(store().packsDir());
    expect(doc.packs.some((p) => p.name === 'json-pack')).toBe(true);
    out.mockClear();

    code = await handlePack(pa(['show', 'json-pack', '--json']));
    expect(code).toBe(0);
    doc = JSON.parse(stdout());
    expect(doc.type).toBe('pack-show');
    expect(doc.pack.name).toBe('json-pack');
    expect(doc.validation.ok).toBe(true);
    out.mockClear();

    code = await handlePack(pa(['rm', 'json-pack', '--json']));
    expect(code).toBe(0);
    doc = JSON.parse(stdout());
    expect(doc).toMatchObject({ type: 'pack-rm', name: 'json-pack', removed: true });
  });
});

// ---- save validation failures ----
describe('handlePack: save validation failures', () => {
  test('unresolvable bench member -> PACK_INVALID exit 1', async () => {
    const code = await handlePack(pa([
      'save', 'bad-pack', '--kind', 'council', '--bench', 'nope1,nope2', '--chair', 'chairmodel',
    ]));
    expect(code).toBe(1);
    expect(stderr()).toContain('invalid pack');
    expect(stderr()).toContain('nope1');
  });

  test('PACK_INVALID carries the code under --json', async () => {
    const code = await handlePack(pa([
      'save', 'bad-pack-json', '--kind', 'council', '--bench', 'nope1,nope2',
      '--chair', 'chairmodel', '--json',
    ]));
    expect(code).toBe(1);
    const doc = JSON.parse(stdout());
    expect(doc.error.code).toBe(ERROR_CODES.PACK_INVALID);
  });

  test('a valid-but-warning pack (by-name bench + chair) saves and prints the warning', async () => {
    const code = await handlePack(pa([
      'save', 'preset-pack', '--kind', 'council', '--bench', 'trio', '--chair', 'chairmodel',
    ]));
    expect(code).toBe(0);
    expect(stderr()).toContain('member-level checks');
  });
});

// ---- auto-bump on changed re-save ----
describe('handlePack: save auto-bump on changed re-save', () => {
  test('identical content is a no-op; changed content auto-bumps the patch version', async () => {
    let code = await handlePack(pa(['save', 'bump-pack', '--kind', 'solo', '--model', 'alpha']));
    expect(code).toBe(0);
    expect(stdout()).toContain("Saved pack 'bump-pack' v1.0.0");
    out.mockClear();

    code = await handlePack(pa(['save', 'bump-pack', '--kind', 'solo', '--model', 'alpha']));
    expect(code).toBe(0);
    expect(stdout()).toContain('unchanged (no-op)');
    out.mockClear();

    code = await handlePack(pa([
      'save', 'bump-pack', '--kind', 'solo', '--model', 'alpha', '--description', 'now different',
    ]));
    expect(code).toBe(0);
    expect(stdout()).toContain('version auto-bumped');
    expect(stdout()).toContain('v1.0.1');
  });
});

// ---- buildPackFromFlags: bench forms + debate negation ----
describe('handlePack: bench forms (comma -> array, else -> council-name string)', () => {
  test('comma-separated --bench builds an array', async () => {
    const code = await handlePack(pa(['save', 'array-bench', '--kind', 'fanout', '--bench', 'alpha,beta']));
    expect(code).toBe(0);
    expect(store().readPack('array-bench').pack.bench).toEqual(['alpha', 'beta']);
  });

  test('comma-less --bench is a council-name string', async () => {
    const code = await handlePack(pa([
      'save', 'string-bench', '--kind', 'council', '--bench', 'trio', '--chair', 'chairmodel',
    ]));
    expect(code).toBe(0);
    expect(store().readPack('string-bench').pack.bench).toBe('trio');
  });

  test('solo kind uses --model, never --bench', async () => {
    const code = await handlePack(pa(['save', 'solo-pack', '--kind', 'solo', '--model', 'alpha']));
    expect(code).toBe(0);
    const saved = store().readPack('solo-pack').pack;
    expect(saved.model).toBe('alpha');
    expect(saved.bench).toBeUndefined();
  });
});

describe('handlePack: --debate / --no-debate (Task-10 both-forms ruling)', () => {
  test('--no-debate saves options.debate:false', async () => {
    const code = await handlePack(pa([
      'save', 'nd-pack', '--kind', 'council', '--bench', 'alpha,beta', '--chair', 'chairmodel', '--no-debate',
    ]));
    expect(code).toBe(0);
    expect(store().readPack('nd-pack').pack.options).toEqual({ debate: false });
  });

  test('--debate saves options.debate:true', async () => {
    const code = await handlePack(pa([
      'save', 'd-pack', '--kind', 'council', '--bench', 'alpha,beta', '--chair', 'chairmodel', '--debate',
    ]));
    expect(code).toBe(0);
    expect(store().readPack('d-pack').pack.options).toEqual({ debate: true });
  });

  test('neither form typed -> no options.debate key, and options is absent entirely', async () => {
    const code = await handlePack(pa([
      'save', 'nodebate-pack', '--kind', 'council', '--bench', 'alpha,beta', '--chair', 'chairmodel',
    ]));
    expect(code).toBe(0);
    expect('options' in store().readPack('nodebate-pack').pack).toBe(false);
  });
});

// ---- show on an invalid pack file: reports errors, exit 0 ----
describe('handlePack: show on an invalid pack file', () => {
  test('human mode: reports validation errors, exit 0 (show never fails on invalid content)', async () => {
    store().writePack({
      schemaVersion: 1, type: 'pack', name: 'broken', version: '1.0.0', kind: 'council',
      bench: ['alpha', 'beta'], options: { frobnicate: 1 },
    });
    const code = await handlePack(pa(['show', 'broken']));
    expect(code).toBe(0);
    expect(stdout()).toContain('INVALID');
    expect(stdout()).toContain('frobnicate');
  });

  test('--json mode: validation.ok is false, exit code is still 0', async () => {
    store().writePack({
      schemaVersion: 1, type: 'pack', name: 'broken-json', version: '1.0.0', kind: 'solo',
      model: 'not-an-alias-and-no-slash',
    });
    const code = await handlePack(pa(['show', 'broken-json', '--json']));
    expect(code).toBe(0);
    const doc = JSON.parse(stdout());
    expect(doc.validation.ok).toBe(false);
    expect(doc.validation.errors.join(' ')).toContain('unresolvable model');
  });
});

describe('handlePack: show missing pack -> PACK_NOT_FOUND', () => {
  test('exit 1, hint points at pack list', async () => {
    const code = await handlePack(pa(['show', 'ghost-pack']));
    expect(code).toBe(1);
    expect(stderr()).toContain('not found');
    expect(stderr()).toContain('amicus pack list');
  });
});

describe('handlePack: rm nonexistent pack -> BAD_ARGS', () => {
  test('exit 1', async () => {
    const code = await handlePack(pa(['rm', 'never-existed']));
    expect(code).toBe(1);
    expect(stderr()).toContain("pack 'never-existed' not found");
  });
});

// ---- --from-run: council ----
describe('handlePack: save --from-run (council pointer + run.json)', () => {
  let project;
  beforeEach(() => { project = fs.mkdtempSync(path.join(os.tmpdir(), 'from-run-council-')); });
  afterEach(() => { fs.rmSync(project, { recursive: true, force: true }); });

  test('reproduces bench/chair/critic/options/template from a real run.json (initCouncilRun)', async () => {
    const runDir = path.join(project, 'council-ck1');
    runState.initCouncilRun({
      runId: 'ck1', runDir, project,
      models: ['alpha', 'beta'], chair: 'chairmodel', critic: 'alpha', lenses: null,
      timeout: 20, maxCost: 2.5, gateway: 'direct', debate: true,
      template: { name: 'mini', hash: 'abcdef123456' },
    });

    const code = await handlePack(pa(['save', 'from-council', '--from-run', 'ck1', '--cwd', project]));
    expect(code).toBe(0);

    const saved = store().readPack('from-council').pack;
    expect(saved.kind).toBe('council');
    expect(saved.bench).toEqual(['alpha', 'beta']);
    expect(saved.chair).toBe('chairmodel');
    expect(saved.critic).toBe('alpha');
    expect(saved.lenses).toBeUndefined();
    expect(saved.options).toEqual({ timeout: 20, maxCost: 2.5, gateway: 'direct', debate: true });
    expect(saved.briefing).toEqual({ template: 'mini' });
  });

  test('a run with empty options / no template / no critic / no lenses omits all of them (absent, not null)', async () => {
    const runDir = path.join(project, 'council-ck2');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
      schemaVersion: 2, type: 'council-run', runId: 'ck2', status: 'complete',
      bench: ['alpha', 'beta'], chair: 'chairmodel', critic: null, lenses: null,
      options: {},
    }));
    runState.writePointer(project, 'ck2', runDir);

    const code = await handlePack(pa(['save', 'from-council-sparse', '--from-run', 'ck2', '--cwd', project]));
    expect(code).toBe(0);
    const saved = store().readPack('from-council-sparse').pack;
    expect(saved.kind).toBe('council');
    expect(saved.bench).toEqual(['alpha', 'beta']);
    expect('options' in saved).toBe(false);
    expect('briefing' in saved).toBe(false);
    expect('critic' in saved).toBe(false);
    expect('lenses' in saved).toBe(false);
  });
});

// ---- --from-run: wave/fanout ----
describe('handlePack: save --from-run (fanout wave)', () => {
  let project;
  beforeEach(() => { project = fs.mkdtempSync(path.join(os.tmpdir(), 'from-run-wave-')); });
  afterEach(() => { fs.rmSync(project, { recursive: true, force: true }); });

  function seedWave(waveId, { models, legs, promptMeta }) {
    const waveDir = getSessionDir(project, waveId);
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
      taskId: waveId, type: 'wave', status: 'complete', mode: 'headless',
      models, legs, promptMeta: promptMeta || null, project, createdAt: '2026-07-28T00:00:00.000Z',
    }));
  }
  function seedLeg(legId, { agent, thinking } = {}) {
    const legDir = getSessionDir(project, legId);
    fs.mkdirSync(legDir, { recursive: true });
    const meta = { taskId: legId, model: 'vendorx/alpha-model', project, mode: 'headless', status: 'complete' };
    if (agent) { meta.agent = agent; }
    if (thinking) { meta.thinking = thinking; }
    fs.writeFileSync(path.join(legDir, 'metadata.json'), JSON.stringify(meta));
  }

  test('bench + first-leg agent/thinking + briefing.template all captured', async () => {
    seedWave('wv1', {
      models: ['alpha', 'beta'], legs: ['wv1-1', 'wv1-2'],
      promptMeta: { source: 'template', file: '/x/mini.md', chars: 10, template: { name: 'mini', hash: 'abc123abc123' } },
    });
    seedLeg('wv1-1', { agent: 'code', thinking: 'high' });
    seedLeg('wv1-2', { agent: 'chat', thinking: 'low' }); // second leg must NOT be read

    const code = await handlePack(pa(['save', 'from-wave', '--from-run', 'wv1', '--cwd', project]));
    expect(code).toBe(0);
    const saved = store().readPack('from-wave').pack;
    expect(saved.kind).toBe('fanout');
    expect(saved.bench).toEqual(['alpha', 'beta']);
    expect(saved.options).toEqual({ agent: 'code', thinking: 'high' });
    expect(saved.briefing).toEqual({ template: 'mini' });
  });

  test('missing first-leg metadata.json -> options AND briefing both omitted (never null-stuffed)', async () => {
    seedWave('wv2', { models: ['alpha', 'beta'], legs: ['wv2-1', 'wv2-2'] });
    // deliberately do NOT seed wv2-1's metadata.json, and no promptMeta.template

    const code = await handlePack(pa(['save', 'from-wave-nolg', '--from-run', 'wv2', '--cwd', project]));
    expect(code).toBe(0);
    const saved = store().readPack('from-wave-nolg').pack;
    expect(saved.kind).toBe('fanout');
    expect(saved.bench).toEqual(['alpha', 'beta']);
    expect('options' in saved).toBe(false);
    expect('briefing' in saved).toBe(false);
  });
});

// ---- --from-run: solo session ----
describe('handlePack: save --from-run (solo session)', () => {
  let project;
  beforeEach(() => { project = fs.mkdtempSync(path.join(os.tmpdir(), 'from-run-solo-')); });
  afterEach(() => { fs.rmSync(project, { recursive: true, force: true }); });

  function seedSolo(taskId, { agent, thinking } = {}) {
    const dir = getSessionDir(project, taskId);
    fs.mkdirSync(dir, { recursive: true });
    const meta = { taskId, model: 'vendorx/alpha-model', project, mode: 'headless', status: 'complete', briefing: 'hi' };
    if (agent) { meta.agent = agent; }
    if (thinking) { meta.thinking = thinking; }
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(meta));
  }

  test('model + agent/thinking captured when present', async () => {
    seedSolo('so1', { agent: 'code', thinking: 'high' });
    const code = await handlePack(pa(['save', 'from-solo', '--from-run', 'so1', '--cwd', project]));
    expect(code).toBe(0);
    const saved = store().readPack('from-solo').pack;
    expect(saved.kind).toBe('solo');
    expect(saved.model).toBe('vendorx/alpha-model');
    expect(saved.options).toEqual({ agent: 'code', thinking: 'high' });
  });

  test('agent/thinking absent from metadata -> options key omitted entirely (not {})', async () => {
    seedSolo('so2');
    const code = await handlePack(pa(['save', 'from-solo-bare', '--from-run', 'so2', '--cwd', project]));
    expect(code).toBe(0);
    const saved = store().readPack('from-solo-bare').pack;
    expect(saved.kind).toBe('solo');
    expect('options' in saved).toBe(false);
  });
});

// ---- --from-run: unknown id ----
describe('handlePack: save --from-run unknown id -> BAD_SESSION', () => {
  test('human mode', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'from-run-ghost-'));
    try {
      const code = await handlePack(pa(['save', 'ghost', '--from-run', 'totally-unknown-id', '--cwd', project]));
      expect(code).toBe(1);
      expect(stderr()).toContain('Session totally-unknown-id not found');
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('--json mode carries the BAD_SESSION code', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'from-run-ghost-json-'));
    try {
      const code = await handlePack(pa([
        'save', 'ghost', '--from-run', 'totally-unknown-id', '--cwd', project, '--json',
      ]));
      expect(code).toBe(1);
      const doc = JSON.parse(stdout());
      expect(doc.error.code).toBe(ERROR_CODES.BAD_SESSION);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
