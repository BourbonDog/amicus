// tests/pack/cli-fanout-start-pack.test.js
'use strict';

/**
 * v4.5 Task 13 (B7/F5) — `--pack` on `amicus fanout` and `amicus start`: real
 * end-to-end resolution (pack-store + pack-resolve, unmocked) reaching the
 * CLI handlers (mirrors tests/pack/cli-council-pack.test.js, Task 12), plus
 * direct real-writer coverage of the absent-not-null recording contract on
 * wave metadata.json/wave.json, solo session metadata.json, and the
 * buildRunResultFromSession/buildWaveResultFromSession rebuild path.
 *
 * No packSuffix here (unlike council): neither fanout nor start has a
 * chair/critic/lenses pre-flight to attribute a failure to (Task-12 reviewer
 * confirmed no analog is needed).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/sidecar/fanout', () => ({
  ...jest.requireActual('../../src/sidecar/fanout'),
  runFanout: jest.fn(),
}));
jest.mock('../../src/index', () => ({
  ...jest.requireActual('../../src/index'),
  startAmicus: jest.fn(),
}));
// resolveLaunchModel is mocked to a passthrough so these tests exercise ONLY
// the pack-wiring seam (args.model / args['no-ui'] before resolution), not
// real gateway routing/catalog lookups — that's covered exhaustively by
// route-launch.test.js and friends. Every model literal used below is
// already slash-ful, so the passthrough needs no alias map of its own.
jest.mock('../../src/utils/start-helpers', () => ({
  ...jest.requireActual('../../src/utils/start-helpers'),
  resolveLaunchModel: jest.fn(async (args) => ({ model: args.model, alias: undefined })),
}));

const { runFanout, writeWaveMetadata } = require('../../src/sidecar/fanout');
const { startAmicus } = require('../../src/index');
const { resolveLaunchModel } = require('../../src/utils/start-helpers');
const { parseArgs } = require('../../src/cli');
const { handleFanout, handleStart } = require('../../src/cli-handlers-run');
const { ERROR_CODES } = require('../../src/utils/error-doc');
const { createSessionMetadata } = require('../../src/sidecar/start');
const { buildWaveResult, buildRunResult, buildWaveResultFromSession } = require('../../src/utils/result-schema');
const { getSessionDir } = require('../../src/session-manager');

const store = () => require('../../src/pack/pack-store');

let tmp; let out; let err; let exit; let briefingFile;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-fanout-start-pack-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
  // Only 'alpha'/'beta' need alias resolution (bare, no slash); every model
  // literal used directly as --model/pack.model below is already slash-ful,
  // so seatOk()/isValidModelFormat() pass without any alias entry.
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
    aliases: { alpha: 'vendorx/alpha-model', beta: 'vendorx/beta-model' },
  }));
  briefingFile = path.join(tmp, 'briefing.md');
  fs.writeFileSync(briefingFile, 'Review this.');
  out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  exit = jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit ${code}`); });
  runFanout.mockReset();
  runFanout.mockResolvedValue({ exitCode: 0 });
  startAmicus.mockReset();
  startAmicus.mockResolvedValue(0);
  resolveLaunchModel.mockClear();
});

afterEach(() => {
  out.mockRestore(); err.mockRestore(); exit.mockRestore();
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- fixtures ----
const FANOUT_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'fanout-review', version: '1.0.0', kind: 'fanout',
  description: 'x', bench: ['alpha', 'beta'], options: { timeout: 20 }, briefing: {},
});
const SOLO_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'quick-check', version: '1.0.0', kind: 'solo',
  description: 'x', model: 'vendorx/solo-model', options: { noUi: true }, briefing: {},
});
const COUNCIL_KIND_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'wrong-kind', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['alpha', 'beta'], chair: null, critic: null, lenses: null,
  options: {}, briefing: {},
});

describe('--pack reaches runFanout (happy path)', () => {
  test('no --models: pack bench + opts.pack + pack-filled options reach runFanout', async () => {
    store().writePack(FANOUT_PACK());
    const code = await handleFanout(parseArgs([
      'fanout', '--pack', 'fanout-review', '--prompt-file', briefingFile, '--json',
    ]));
    expect(code).toBe(0);
    expect(runFanout).toHaveBeenCalledTimes(1);
    const opts = runFanout.mock.calls[0][0];
    expect(opts.models).toBe('alpha,beta');
    expect(opts.timeout).toBe(20);
    expect(opts.pack).toEqual({
      name: 'fanout-review', version: '1.0.0', hash: expect.stringMatching(/^[0-9a-f]{12}$/), source: 'dir',
    });
  });
});

describe('--pack kind mismatch', () => {
  test('a council pack passed to fanout fails PACK_KIND_MISMATCH; message names fanout', async () => {
    store().writePack(COUNCIL_KIND_PACK());
    await expect(handleFanout(parseArgs([
      'fanout', '--pack', 'wrong-kind', '--prompt-file', briefingFile, '--json',
    ]))).rejects.toThrow('exit 1');
    expect(runFanout).not.toHaveBeenCalled();
    const doc = JSON.parse(out.mock.calls.map((c) => c[0]).join(''));
    expect(doc.error.code).toBe(ERROR_CODES.PACK_KIND_MISMATCH);
    expect(doc.error.message).toBe(
      "Error: pack 'wrong-kind' is kind 'council' — fanout accepts kind 'fanout'; make two packs if you want both shapes",
    );
  });
});

describe('explicit --models over the pack bench (T13-m4)', () => {
  test('the override notice reaches stderr through handleFanout, and the typed value wins', async () => {
    store().writePack(FANOUT_PACK());
    const code = await handleFanout(parseArgs([
      'fanout', '--pack', 'fanout-review', '--models', 'vendorx/model-z',
      '--prompt-file', briefingFile, '--json',
    ]));
    expect(code).toBe(0);
    expect(err.mock.calls.map((c) => c[0]).join(''))
      .toContain("Notice: --models overrides the bench from pack 'fanout-review'");
    expect(runFanout.mock.calls[0][0].models).toBe('vendorx/model-z');
  });
});

// T11-c: a string-bench (by-name) FANOUT pack fills args.council (not
// args.models — see pack-resolve.test.js's unit coverage of the fill
// itself); handleFanout then expands it via resolveCouncilMembers exactly
// like a typed --council would (cli-handlers-fanout.js:85-95). Seeds a USER
// council (not a built-in) so this proves the real expansion call, not just
// a name passing through untouched.
describe('string-bench FANOUT pack expands via resolveCouncilMembers (T11-c)', () => {
  test('pack-filled args.council reaches runFanout as the expanded, comma-joined member list', async () => {
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
      aliases: { alpha: 'vendorx/alpha-model', beta: 'vendorx/beta-model' },
      councils: { mybench: ['alpha', 'beta'] },
    }));
    store().writePack({
      schemaVersion: 1, type: 'pack', name: 'fanout-bench-pack', version: '1.0.0', kind: 'fanout',
      description: 'x', bench: 'mybench', options: {}, briefing: {},
    });
    const code = await handleFanout(parseArgs([
      'fanout', '--pack', 'fanout-bench-pack', '--prompt-file', briefingFile, '--json',
    ]));
    expect(code).toBe(0);
    expect(runFanout).toHaveBeenCalledTimes(1);
    // resolveCouncilMembers returns members RAW (alias, not resolved id) —
    // pinned directly against src/utils/config.js's classifyCouncilMembers
    // (`models.push(member)`, never the resolved `id`) and against
    // tests/council-members-local.test.js, which proves the same contract
    // on the council-run surface (`r.models` holds the alias, e.g. 'gemini',
    // not the resolved provider/model id).
    expect(runFanout.mock.calls[0][0].models).toBe('alpha,beta');
    expect(err).not.toHaveBeenCalled(); // neither --models nor --council was typed: no override notice
  });
});

// T11-c Step 4 (decision procedure): Step 1 verified BOTH the fanout and
// council-run surfaces reject --models+--council both typed, and on BOTH
// surfaces the pack apply (which can print the both-typed notice) runs
// BEFORE that guard — so pin the fanout half of that ordering fact directly:
// a both-typed run prints the notice AND THEN hits the hard exit, in that
// order, never reaching runFanout.
describe('both --models and --council typed: notice fires, then the exactly-one-of guard exits (T11-c ordering pin)', () => {
  test('pack apply\'s notice reaches stderr before the BAD_ARGS exit; runFanout never called', async () => {
    store().writePack({
      schemaVersion: 1, type: 'pack', name: 'fanout-both-typed', version: '1.0.0', kind: 'fanout',
      description: 'x', bench: 'budget', options: {}, briefing: {},
    });
    await expect(handleFanout(parseArgs([
      'fanout', '--pack', 'fanout-both-typed', '--models', 'vendorx/model-z', '--council', 'budget',
      '--prompt-file', briefingFile, '--json',
    ]))).rejects.toThrow('exit 1');
    expect(err.mock.calls.map((c) => c[0]).join(''))
      .toContain("Notice: --models overrides the bench from pack 'fanout-both-typed'");
    const doc = JSON.parse(out.mock.calls.map((c) => c[0]).join(''));
    expect(doc.error.message).toBe('Error: pass exactly one of --models / --council, not both');
    expect(runFanout).not.toHaveBeenCalled();
  });
});

describe('--pack reaches startAmicus (happy path)', () => {
  test('solo pack fills model + no-ui when neither is explicit; opts.pack matches', async () => {
    store().writePack(SOLO_PACK());
    const code = await handleStart(parseArgs([
      'start', '--pack', 'quick-check', '--prompt', 'hi', '--json', '--no-cost-gate',
    ]));
    expect(code).toBe(0);
    expect(startAmicus).toHaveBeenCalledTimes(1);
    const opts = startAmicus.mock.calls[0][0];
    expect(opts.model).toBe('vendorx/solo-model');
    expect(opts.noUi).toBe(true);
    expect(opts.pack).toEqual({
      name: 'quick-check', version: '1.0.0', hash: expect.stringMatching(/^[0-9a-f]{12}$/), source: 'dir',
    });
  });
});

describe('explicit --model beats pack.model silently (spec §5.4)', () => {
  test('opts.model is the explicit value; no notice on stderr', async () => {
    store().writePack(SOLO_PACK());
    const code = await handleStart(parseArgs([
      'start', '--pack', 'quick-check', '--model', 'vendorx/explicit-model', '--prompt', 'hi', '--json', '--no-cost-gate',
    ]));
    expect(code).toBe(0);
    const opts = startAmicus.mock.calls[0][0];
    expect(opts.model).toBe('vendorx/explicit-model');
    expect(opts.noUi).toBe(true); // still pack-filled: only --model was explicit
    expect(err).not.toHaveBeenCalled();
  });
});

// v4.7 F8 (D13): --tag is reject-style (unlike sanitizeCouncilName, which
// cleans) — a stored tag is a user-chosen search key, so silent truncation/
// stripping would make --search/--group-by tag miss it. handleStart's check
// sits past resolveLaunchModel, so it needs this suite's mocked passthrough.
describe('--tag validation (v4.7 F8)', () => {
  test('start --tag with an invalid value exits 1 before startAmicus is called', async () => {
    await expect(handleStart(parseArgs([
      'start', '--model', 'vendorx/explicit-model', '--prompt', 'hi', '--no-ui', '--json', '--no-cost-gate',
      '--tag', 'bad tag!',
    ]))).rejects.toThrow('exit 1');
    expect(startAmicus).not.toHaveBeenCalled();
    const doc = JSON.parse(out.mock.calls.map((c) => c[0]).join(''));
    expect(doc.error.code).toBe(ERROR_CODES.BAD_ARGS);
    expect(doc.error.message).toMatch(/Invalid --tag/);
  });

  test('start --tag with a valid value forwards tag to startAmicus', async () => {
    const code = await handleStart(parseArgs([
      'start', '--model', 'vendorx/explicit-model', '--prompt', 'hi', '--no-ui', '--json', '--no-cost-gate',
      '--tag', 'sprint-42',
    ]));
    expect(code).toBe(0);
    expect(startAmicus.mock.calls[0][0].tag).toBe('sprint-42');
  });
});

describe('no-pack invocations are unaffected', () => {
  test('fanout without --pack: opts.pack is null', async () => {
    const code = await handleFanout(parseArgs([
      'fanout', '--models', 'alpha,beta', '--prompt-file', briefingFile, '--json',
    ]));
    expect(code).toBe(0);
    expect(runFanout.mock.calls[0][0].pack).toBeNull();
  });

  test('start without --pack: opts.pack is null', async () => {
    const code = await handleStart(parseArgs([
      'start', '--model', 'vendorx/explicit-model', '--prompt', 'hi', '--no-ui', '--json', '--no-cost-gate',
    ]));
    expect(code).toBe(0);
    expect(startAmicus.mock.calls[0][0].pack).toBeNull();
  });
});

describe('wave metadata + wave.json carry the pack object (real writers, Task-12 merge-preserve style)', () => {
  let waveTmp;
  beforeEach(() => { waveTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-pack-wave-')); });
  afterEach(() => { fs.rmSync(waveTmp, { recursive: true, force: true }); });

  const PACK_RECORD = { name: 'fanout-review', version: '1.0.0', hash: 'abc123def456', source: 'dir' };

  test('metadata.json: pack present when writeWaveMetadata is given options.pack', () => {
    const waveDir = getSessionDir(waveTmp, 'wv-pk-1');
    fs.mkdirSync(waveDir, { recursive: true });
    writeWaveMetadata(waveDir, { taskId: 'wv-pk-1', type: 'wave', pack: PACK_RECORD });
    const meta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8'));
    expect(meta.pack).toEqual(PACK_RECORD);
  });

  test('metadata.json: "pack" key absent (not null) when no pack was passed', () => {
    const waveDir = getSessionDir(waveTmp, 'wv-pk-2');
    fs.mkdirSync(waveDir, { recursive: true });
    writeWaveMetadata(waveDir, { taskId: 'wv-pk-2', type: 'wave' });
    const meta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8'));
    expect('pack' in meta).toBe(false);
  });

  test('merge-preserve: a later status-only patch (no pack key) leaves the recorded pack intact', () => {
    const waveDir = getSessionDir(waveTmp, 'wv-pk-3');
    fs.mkdirSync(waveDir, { recursive: true });
    writeWaveMetadata(waveDir, { taskId: 'wv-pk-3', type: 'wave', pack: PACK_RECORD });
    writeWaveMetadata(waveDir, { status: 'complete', completedAt: '2026-07-28T00:00:00.000Z' });
    const meta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8'));
    expect(meta.pack).toEqual(PACK_RECORD);
    expect(meta.status).toBe('complete');
  });

  test('wave.json (buildWaveResult): pack present beside prompt when passed', () => {
    const doc = buildWaveResult({ waveId: 'wv-pk-4', legs: [], promptMeta: { source: 'file' }, pack: PACK_RECORD });
    expect(doc.pack).toEqual(PACK_RECORD);
  });

  test('wave.json (buildWaveResult): "pack" key absent (not null) without --pack', () => {
    const doc = buildWaveResult({ waveId: 'wv-pk-5', legs: [] });
    expect('pack' in doc).toBe(false);
  });
});

describe('the rebuild path carries pack (buildWaveResultFromSession)', () => {
  let rbTmp;
  beforeEach(() => { rbTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-pack-rebuild-')); });
  afterEach(() => { fs.rmSync(rbTmp, { recursive: true, force: true }); });

  const PACK_RECORD = { name: 'fanout-review', version: '1.0.0', hash: 'abc123def456', source: 'dir' };

  test('live rebuild (no wave.json) carries pack from metadata.json', () => {
    const waveDir = getSessionDir(rbTmp, 'wv-rb-1');
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
      taskId: 'wv-rb-1', type: 'wave', legs: [], pack: PACK_RECORD, createdAt: '2026-07-28T00:00:00.000Z',
    }));
    const doc = buildWaveResultFromSession(rbTmp, 'wv-rb-1');
    expect(doc.pack).toEqual(PACK_RECORD);
  });

  test('live rebuild without a recorded pack omits the key (not null)', () => {
    const waveDir = getSessionDir(rbTmp, 'wv-rb-2');
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
      taskId: 'wv-rb-2', type: 'wave', legs: [], createdAt: '2026-07-28T00:00:00.000Z',
    }));
    const doc = buildWaveResultFromSession(rbTmp, 'wv-rb-2');
    expect('pack' in doc).toBe(false);
  });
});

describe('solo session metadata.json carries the pack (createSessionMetadata, real writer)', () => {
  let soloTmp;
  beforeEach(() => { soloTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'start-pack-meta-')); });
  afterEach(() => { fs.rmSync(soloTmp, { recursive: true, force: true }); });

  const PACK_RECORD = { name: 'quick-check', version: '1.0.0', hash: 'def456abc123', source: 'dir' };

  test('pack present -> metadata.json .pack deep-equals it', () => {
    const sessDir = createSessionMetadata('so1', soloTmp, {
      model: 'vendorx/solo-model', prompt: 'hi', noUi: true, pack: PACK_RECORD,
    });
    const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
    expect(meta.pack).toEqual(PACK_RECORD);
  });

  test('pack absent -> "pack" key absent from metadata.json, not null', () => {
    const sessDir = createSessionMetadata('so2', soloTmp, { model: 'vendorx/solo-model', prompt: 'hi', noUi: true });
    const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
    expect('pack' in meta).toBe(false);
  });

  test('merge-preserve: a later call omitting pack leaves the recorded pack intact', () => {
    createSessionMetadata('so3', soloTmp, { model: 'vendorx/solo-model', prompt: 'hi', noUi: true, pack: PACK_RECORD });
    const sessDir = createSessionMetadata('so3', soloTmp, { model: 'vendorx/solo-model', prompt: 'hi', noUi: true });
    const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
    expect(meta.pack).toEqual(PACK_RECORD);
  });
});

describe('run doc (solo) carries the pack (buildRunResult)', () => {
  const PACK_RECORD = { name: 'quick-check', version: '1.0.0', hash: 'def456abc123', source: 'dir' };

  test('metadata.pack -> run doc .pack deep-equals it', () => {
    const doc = buildRunResult({ taskId: 't1', metadata: { status: 'complete', pack: PACK_RECORD } });
    expect(doc.pack).toEqual(PACK_RECORD);
  });

  test('metadata without pack -> "pack" key is absent from the run doc, not null', () => {
    const doc = buildRunResult({ taskId: 't2', metadata: { status: 'complete' } });
    expect('pack' in doc).toBe(false);
  });
});

// v4.7 F8 (D13): --tag storage — the same absent-not-null idiom as --pack
// above, mirrored verbatim (scaffolding authority: the pack describes this
// file already carries). tag is a plain string (not a resolved record like
// pack), so fixtures are simple string literals rather than PACK_RECORD-style
// objects.
describe('solo session metadata.json carries the tag (createSessionMetadata, real writer)', () => {
  let soloTmp;
  beforeEach(() => { soloTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'start-tag-meta-')); });
  afterEach(() => { fs.rmSync(soloTmp, { recursive: true, force: true }); });

  test('tag present -> metadata.json .tag equals it', () => {
    const sessDir = createSessionMetadata('st1', soloTmp, {
      model: 'vendorx/solo-model', prompt: 'hi', noUi: true, tag: 'sprint-42',
    });
    const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
    expect(meta.tag).toBe('sprint-42');
  });

  test('tag absent -> "tag" key absent from metadata.json, not null', () => {
    const sessDir = createSessionMetadata('st2', soloTmp, { model: 'vendorx/solo-model', prompt: 'hi', noUi: true });
    const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
    expect('tag' in meta).toBe(false);
  });

  test('merge-preserve: a later call omitting tag leaves the recorded tag intact', () => {
    createSessionMetadata('st3', soloTmp, { model: 'vendorx/solo-model', prompt: 'hi', noUi: true, tag: 'sprint-42' });
    const sessDir = createSessionMetadata('st3', soloTmp, { model: 'vendorx/solo-model', prompt: 'hi', noUi: true });
    const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
    expect(meta.tag).toBe('sprint-42');
  });
});

describe('run doc (solo) carries the tag (buildRunResult)', () => {
  test('metadata.tag -> run doc .tag equals it', () => {
    const doc = buildRunResult({ taskId: 't3', metadata: { status: 'complete', tag: 'sprint-42' } });
    expect(doc.tag).toBe('sprint-42');
  });

  test('metadata without tag -> "tag" key is absent from the run doc, not null', () => {
    const doc = buildRunResult({ taskId: 't4', metadata: { status: 'complete' } });
    expect('tag' in doc).toBe(false);
  });
});

describe('wave metadata + wave.json carry the tag (real writers, mirrors the pack section above)', () => {
  let waveTmp;
  beforeEach(() => { waveTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-tag-wave-')); });
  afterEach(() => { fs.rmSync(waveTmp, { recursive: true, force: true }); });

  test('metadata.json: tag present when writeWaveMetadata is given options.tag', () => {
    const waveDir = getSessionDir(waveTmp, 'wv-tg-1');
    fs.mkdirSync(waveDir, { recursive: true });
    writeWaveMetadata(waveDir, { taskId: 'wv-tg-1', type: 'wave', tag: 'sprint-42' });
    const meta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8'));
    expect(meta.tag).toBe('sprint-42');
  });

  test('metadata.json: "tag" key absent (not null) when no tag was passed', () => {
    const waveDir = getSessionDir(waveTmp, 'wv-tg-2');
    fs.mkdirSync(waveDir, { recursive: true });
    writeWaveMetadata(waveDir, { taskId: 'wv-tg-2', type: 'wave' });
    const meta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8'));
    expect('tag' in meta).toBe(false);
  });

  test('wave.json (buildWaveResult): tag present beside prompt when passed', () => {
    const doc = buildWaveResult({ waveId: 'wv-tg-3', legs: [], promptMeta: { source: 'file' }, tag: 'sprint-42' });
    expect(doc.tag).toBe('sprint-42');
  });

  test('wave.json (buildWaveResult): "tag" key absent (not null) without --tag', () => {
    const doc = buildWaveResult({ waveId: 'wv-tg-4', legs: [] });
    expect('tag' in doc).toBe(false);
  });
});

describe('the rebuild path carries tag (buildWaveResultFromSession)', () => {
  let rbTmp;
  beforeEach(() => { rbTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-tag-rebuild-')); });
  afterEach(() => { fs.rmSync(rbTmp, { recursive: true, force: true }); });

  test('live rebuild (no wave.json) carries tag from metadata.json', () => {
    const waveDir = getSessionDir(rbTmp, 'wv-rbtg-1');
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
      taskId: 'wv-rbtg-1', type: 'wave', legs: [], tag: 'sprint-42', createdAt: '2026-07-28T00:00:00.000Z',
    }));
    const doc = buildWaveResultFromSession(rbTmp, 'wv-rbtg-1');
    expect(doc.tag).toBe('sprint-42');
  });

  test('live rebuild without a recorded tag omits the key (not null)', () => {
    const waveDir = getSessionDir(rbTmp, 'wv-rbtg-2');
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
      taskId: 'wv-rbtg-2', type: 'wave', legs: [], createdAt: '2026-07-28T00:00:00.000Z',
    }));
    const doc = buildWaveResultFromSession(rbTmp, 'wv-rbtg-2');
    expect('tag' in doc).toBe(false);
  });
});
