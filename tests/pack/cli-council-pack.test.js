// tests/pack/cli-council-pack.test.js
'use strict';

/**
 * v4.5 Task 12 (B7/F5) — `--pack` on `amicus council run`: real end-to-end
 * resolution (pack-store + pack-resolve, unmocked) reaching the CLI handler,
 * forwarded into runCouncil (mocked, model on tests/cli-council-run-flags.test.js)
 * and recorded on run.json (run-state.js, unmocked).
 *
 * Two Task-11-review rulings pinned here:
 *  (a) pack-attributed pre-flight errors — chair-is-a-bench-seat and critic-
 *      not-in-bench append " (set by pack '<name>')" to the failing value's
 *      mention, ONLY when that value was pack-filled and not explicit (an
 *      explicit flag is never "blamed" on the pack). critic×lenses is NO
 *      LONGER part of this pattern as of T11-d (see below): a pack supplying
 *      both fields now fails PACK_INVALID in pack-resolve.js, before the
 *      handler's own pre-flight checks (and packSuffix attribution) ever
 *      run, on EITHER bench shape.
 *  (b) the critic/lenses XOR integration assertion — a pack's critic is
 *      suppressed by a typed --lenses through the REAL handler + pack-resolve
 *      (not a mock), reaching runCouncil with lenses only and no error. This
 *      applies only when the PACK ITSELF sets at most one of the two fields;
 *      see the T11-d describe below for a pack that sets both.
 *
 * T11-d (fix wave, 2026-08): critic+lenses mutual exclusion is bench-
 * independent in pack-validate.js — a council pack supplying both fields
 * fails PACK_INVALID at resolve time regardless of bench shape (string or
 * array) and regardless of whether an explicit --lenses/--critic flag would
 * otherwise have suppressed the pack-filled side (pack-resolve's
 * explicit-vs-pack fill logic never gets a chance to run — validatePack
 * rejects the raw pack first). See the dedicated describe near the bottom.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/council/run', () => ({ runCouncil: jest.fn() }));
const { runCouncil } = require('../../src/council/run');
const { parseArgs, getUsage } = require('../../src/cli');
const { handleCouncilRun } = require('../../src/cli-handlers-council-run');
const { ERROR_CODES } = require('../../src/utils/error-doc');
const runState = require('../../src/council/run-state');

let tmp; let out; let err; let briefingFile;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-council-pack-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
  // Custom aliases + a user-saved council ('trio') so bench resolution is
  // fully under this test's control (no reliance on real default aliases or
  // built-in benches). 'trio' exists specifically so a STRING-bench pack
  // (chair-vs-seat and critic-vs-seat checks deferred to run time by
  // pack-validate, per its own docblock) can reach the handler's OWN
  // pre-flight checks for THOSE two conflicts — an ARRAY-bench pack with the
  // same conflict is rejected earlier as PACK_INVALID and never reaches them.
  // As of T11-d, critic+lenses-together is NOT one of the checks a string
  // bench defers: pack-validate now rejects it bench-independently, so a
  // 'trio'-bench pack setting both fields is ALSO caught as PACK_INVALID
  // before the handler runs (see the T11-d describe below) — 'trio' remains
  // useful only for the chair-alone and critic-alone (bench-membership)
  // conflicts.
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
    aliases: {
      alpha: 'vendorx/alpha-model', beta: 'vendorx/beta-model',
      gamma: 'vendorx/gamma-model', chairmodel: 'vendorx/chair-model',
    },
    councils: { trio: ['alpha', 'beta', 'gamma'] },
  }));
  briefingFile = path.join(tmp, 'briefing.md');
  fs.writeFileSync(briefingFile, 'Review this.');
  out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  runCouncil.mockReset();
  runCouncil.mockResolvedValue({ exitCode: 0, run: { runId: 'r', status: 'complete', exitCode: 0 } });
});

afterEach(() => {
  out.mockRestore(); err.mockRestore();
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const store = () => require('../../src/pack/pack-store');
const runArgs = (extra = []) => parseArgs(['council', 'run', '--json', '--prompt-file', briefingFile, ...extra]);

// ---- fixtures ----
const HAPPY_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'ship-review', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['alpha', 'beta'], chair: 'chairmodel', critic: null, lenses: null,
  options: { timeout: 20 }, briefing: {},
});
const FANOUT_KIND_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'wrong-kind', version: '1.0.0', kind: 'fanout',
  description: 'x', bench: ['alpha', 'beta'], options: {}, briefing: {},
});
const TEMPLATE_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'templated-review', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['alpha', 'beta'], chair: 'chairmodel', critic: null, lenses: null,
  options: {}, briefing: { template: 'mini' },
});
const XOR_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'xor-review', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['alpha', 'beta'], chair: 'chairmodel', critic: 'alpha', lenses: null,
  options: {}, briefing: {},
});
// STRING bench ('trio'): pack-validate defers chair-vs-seat and critic-vs-
// seat checks to run time (a warning only), so CHAIR_CONFLICT_PACK and
// CRITIC_CONFLICT_PACK below are VALID packs that reach the handler's own
// pre-flight checks unmodified. CRITIC_LENSES_CONFLICT_PACK below is
// different as of T11-d: pack-validate now rejects critic+lenses-together
// bench-independently, so that fixture is INVALID (PACK_INVALID) and never
// reaches the handler — see the dedicated T11-d describe further down.
const CHAIR_CONFLICT_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'chair-conflict', version: '1.0.0', kind: 'council',
  description: 'x', bench: 'trio', chair: 'alpha', critic: null, lenses: null,
  options: {}, briefing: {},
});
const CRITIC_CONFLICT_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'critic-conflict', version: '1.0.0', kind: 'council',
  description: 'x', bench: 'trio', chair: null, critic: 'not-a-member', lenses: null,
  options: {}, briefing: {},
});
const CRITIC_LENSES_CONFLICT_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'critic-lenses-conflict', version: '1.0.0', kind: 'council',
  description: 'x', bench: 'trio', chair: null, critic: 'alpha', lenses: ['x', 'y'],
  options: {}, briefing: {},
});
// F2 (v4.5 Task 12): array bench with default-chair collision, no chair field.
// The pack never fills `args.chair`, so the default 'deepseek' is NOT blamed on it.
const DEFAULT_CHAIR_COLLISION_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'default-chair-collision', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['deepseek', 'gpt'], chair: undefined, critic: null, lenses: null,
  options: {}, briefing: {},
});

describe('--pack reaches runCouncil (happy path)', () => {
  test('no --models: pack bench/chair/options + opts.pack all reach runCouncil', async () => {
    store().writePack(HAPPY_PACK());
    const code = await handleCouncilRun(runArgs(['--pack', 'ship-review']));
    expect(code).toBe(0);
    expect(runCouncil).toHaveBeenCalledTimes(1);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.models).toEqual(['alpha', 'beta']);
    expect(opts.chair).toBe('chairmodel');
    expect(opts.timeout).toBe(20);
    expect(opts.pack).toEqual({
      name: 'ship-review', version: '1.0.0', hash: expect.stringMatching(/^[0-9a-f]{12}$/), source: 'dir',
    });
  });

  test('explicit --chair beats the pack chair', async () => {
    store().writePack(HAPPY_PACK());
    const code = await handleCouncilRun(runArgs(['--pack', 'ship-review', '--chair', 'gamma']));
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.chair).toBe('gamma');
  });

  test('--models triggers the override notice on stderr and wins over the pack bench', async () => {
    store().writePack(HAPPY_PACK());
    const code = await handleCouncilRun(runArgs(['--pack', 'ship-review', '--models', 'beta,gamma']));
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.models).toEqual(['beta', 'gamma']);
    const messages = err.mock.calls.map(c => c[0]);
    expect(messages).toContain("Notice: --models overrides the bench from pack 'ship-review'\n");
  });
});

describe('--pack kind mismatch', () => {
  test('a fanout pack passed to council run fails PACK_KIND_MISMATCH (exit 1 envelope)', async () => {
    store().writePack(FANOUT_KIND_PACK());
    const code = await handleCouncilRun(runArgs(['--pack', 'wrong-kind']));
    expect(code).toBe(1);
    expect(runCouncil).not.toHaveBeenCalled();
    const doc = JSON.parse(out.mock.calls[0][0]);
    expect(doc.error.code).toBe(ERROR_CODES.PACK_KIND_MISMATCH);
  });
});

describe('--pack briefing.template renders through the single application point', () => {
  test('opts.briefing is the rendered text, not the raw prompt file content', async () => {
    fs.mkdirSync(path.join(tmp, 'templates'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'templates', 'mini.md'), '# T\n{{prompt}}\n');
    store().writePack(TEMPLATE_PACK());
    const code = await handleCouncilRun(runArgs(['--pack', 'templated-review']));
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.briefing).toBe('# T\nReview this.\n');
    expect(opts.briefing).not.toBe('Review this.');
  });
});

describe('critic×lenses XOR integration (2026-07-28 ruling b)', () => {
  test('pack critic suppressed by typed --lenses reaches runCouncil with lenses only, no error', async () => {
    store().writePack(XOR_PACK()); // critic: 'alpha'
    const code = await handleCouncilRun(runArgs(['--pack', 'xor-review', '--lenses', 'a,b']));
    expect(code).toBe(0);
    expect(runCouncil).toHaveBeenCalledTimes(1);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.lenses).toEqual(['a', 'b']);
    expect(opts.critic).toBeNull();
  });
});

describe('pack-attributed pre-flight errors (2026-07-28 ruling a)', () => {
  test('chair-is-a-bench-seat names the pack when the chair was pack-filled', async () => {
    store().writePack(CHAIR_CONFLICT_PACK()); // bench 'trio' -> alpha,beta,gamma; chair: 'alpha'
    const code = await handleCouncilRun(runArgs(['--pack', 'chair-conflict']));
    expect(code).toBe(1);
    expect(runCouncil).not.toHaveBeenCalled();
    const doc = JSON.parse(out.mock.calls[0][0]);
    expect(doc.error.message).toContain("chair 'alpha' is a bench seat");
    expect(doc.error.message).toContain("(set by pack 'chair-conflict')");
  });

  test('critic-not-in-bench names the pack when the critic was pack-filled', async () => {
    store().writePack(CRITIC_CONFLICT_PACK());
    const code = await handleCouncilRun(runArgs(['--pack', 'critic-conflict']));
    expect(code).toBe(1);
    const doc = JSON.parse(out.mock.calls[0][0]);
    expect(doc.error.message).toContain("critic 'not-a-member' must be one of the bench seats");
    expect(doc.error.message).toContain("(set by pack 'critic-conflict')");
  });

  test('explicit --chair equal to a bench seat fails WITHOUT pack attribution (explicit wins, no suffix)', async () => {
    // Same conflicting pack as the first attribution test, but --chair is
    // typed explicitly this time (also a bench seat) — the failure is real
    // but must not blame the pack, since the pack never got to fill chair.
    store().writePack(CHAIR_CONFLICT_PACK());
    const code = await handleCouncilRun(runArgs(['--pack', 'chair-conflict', '--chair', 'beta']));
    expect(code).toBe(1);
    const doc = JSON.parse(out.mock.calls[0][0]);
    expect(doc.error.message).toContain("chair 'beta' is a bench seat");
    expect(doc.error.message).not.toContain('set by pack');
  });

  test('the DEFAULT chair colliding with a pack bench is NOT blamed on the pack', async () => {
    // v4.5 Task 12 F2 (2026-07-28 ruling): packSuffix requires the pack to have
    // actually filled the key. A pack with bench=['deepseek','gpt'] and NO chair
    // field never fills args.chair; the handler's CHAIR_DEFAULT ('deepseek')
    // collides with the bench. The error must NOT append " (set by pack '...')"
    // because the pack did not set the chair — the default did. Uses real CLI
    // arg parsing with --pack and --prompt-file, nothing else typed.
    store().writePack(DEFAULT_CHAIR_COLLISION_PACK());
    const code = await handleCouncilRun(runArgs(['--pack', 'default-chair-collision']));
    expect(code).toBe(1);
    const doc = JSON.parse(out.mock.calls[0][0]);
    expect(doc.error.message).toContain("chair 'deepseek' is a bench seat");
    expect(doc.error.message).not.toContain('set by pack');
  });
});

// T11-d: critic+lenses is bench-independent (pack-validate.js), so a pack
// supplying both — even on a by-name (string) bench, which used to defer
// this check to the handler — is now rejected at pack-resolve time, before
// the handler's own pre-flight checks (and packSuffix attribution) ever run.
// This describe is deliberately separate from 'pack-attributed pre-flight
// errors' above: these two tests no longer exercise that handler-level
// attribution logic at all (PACK_INVALID fires first, pre-spend, from
// pack-resolve.js) — they belong to a different code path.
describe('critic+lenses conflict is bench-independent (T11-d)', () => {
  // The old test's subject here ('critic×lenses mutual exclusion names the
  // pack when both were pack-filled') no longer exists: that was the
  // HANDLER's own mutual-exclusion error naming the pack via packSuffix.
  // That code path is unreachable now that pack-validate catches the
  // conflict first. This test pins the new behavior instead.
  test('a pack supplying BOTH critic and lenses fails PACK_INVALID pre-spend', async () => {
    store().writePack(CRITIC_LENSES_CONFLICT_PACK());
    const code = await handleCouncilRun(runArgs(['--pack', 'critic-lenses-conflict']));
    expect(code).toBe(1);
    const doc = JSON.parse(out.mock.calls[0][0]);
    expect(doc.error.code).toBe(ERROR_CODES.PACK_INVALID);
    expect(doc.error.message).toMatch(/critic and lenses are mutually exclusive/);
    expect(runCouncil).not.toHaveBeenCalled();
  });

  // Fix wave (Task-2 review, Important 2): a behavior change with no prior
  // pin. Pre-hoist, a STRING-bench pack carrying both critic and lenses,
  // invoked with an explicit --lenses flag, used to RUN: pack-resolve's
  // explicit-vs-pack fill logic (pack-resolve.js:140/143) suppresses the
  // pack-filled critic whenever --lenses is typed explicitly, so the
  // handler's own mutual-exclusion pre-flight (critic && lenses) never saw
  // both truthy — the pack passed validatePack (the string-bench branch only
  // warned, T11-d's hole) and runCouncil ran with critic=null, lenses=the
  // typed value. Post-hoist, validatePack rejects the RAW pack object
  // (pack.critic && pack.lenses both set) before pack-resolve's fill logic
  // ever runs, so an explicit --lenses can no longer rescue it — the pack
  // now hard-fails PACK_INVALID regardless of what flags were typed. This is
  // correct: an ARRAY-bench pack with both fields set already behaved this
  // way pre-hoist (the mutex check lived in the array branch unconditionally,
  // with no explicit-flag escape hatch either) — the hoist makes the two
  // bench shapes consistent, which IS T11-d. Pinned here so the behavior
  // change is documented, not just incidentally true.
  test('an explicit --lenses does NOT rescue a pack that sets BOTH fields (consistency w/ array-bench)', async () => {
    store().writePack(CRITIC_LENSES_CONFLICT_PACK()); // bench 'trio'; critic: 'alpha', lenses: ['x','y']
    const code = await handleCouncilRun(runArgs(['--pack', 'critic-lenses-conflict', '--lenses', 'a,b,c']));
    expect(code).toBe(1);
    const doc = JSON.parse(out.mock.calls[0][0]);
    expect(doc.error.code).toBe(ERROR_CODES.PACK_INVALID);
    expect(doc.error.message).toMatch(/critic and lenses are mutually exclusive/);
    expect(runCouncil).not.toHaveBeenCalled();
  });
});

describe('run.json records the pack (run-state.js, v4.5 Task 12)', () => {
  let rsTmp;
  beforeEach(() => { rsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-pack-state-')); });
  afterEach(() => { fs.rmSync(rsTmp, { recursive: true, force: true }); });

  const runDirOf = () => path.join(rsTmp, 'council-pk123');
  const baseOpts = () => ({
    runId: 'pk123', runDir: runDirOf(), project: rsTmp,
    models: ['alpha', 'beta'], chair: 'chairmodel', critic: null, lenses: null,
  });
  const PACK_RECORD = { name: 'ship-review', version: '1.0.0', hash: 'abc123def456', source: 'dir' };

  test('o.pack present -> readRun(runDir).pack deep-equals it', () => {
    runState.initCouncilRun({ ...baseOpts(), pack: PACK_RECORD });
    expect(runState.readRun(runDirOf()).pack).toEqual(PACK_RECORD);
  });

  test('o.pack absent -> "pack" key is absent from run.json, not null', () => {
    runState.initCouncilRun(baseOpts());
    expect('pack' in runState.readRun(runDirOf())).toBe(false);
  });

  // Task 15's MCP path relies on this: a child initRun whose OWN seed omits
  // `pack` must not erase a pack recorded by an earlier (parent) initRun.
  test('MCP-preserve: a later initRun with a seed OMITTING pack leaves the pack field intact', () => {
    runState.initCouncilRun({ ...baseOpts(), pack: PACK_RECORD });
    runState.initRun(runDirOf(), { runId: 'pk123', status: 'running' }); // no `pack` key at all
    expect(runState.readRun(runDirOf()).pack).toEqual(PACK_RECORD);
  });
});

// v4.7 F8 (D13): --tag on `council run` — same absent-not-null seed idiom as
// pack above, mirrored verbatim (this describe's own siblings are the
// scaffolding authority).
describe('run.json records the tag (run-state.js, v4.7 F8)', () => {
  let rsTmp;
  beforeEach(() => { rsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-tag-state-')); });
  afterEach(() => { fs.rmSync(rsTmp, { recursive: true, force: true }); });

  const runDirOf = () => path.join(rsTmp, 'council-tg123');
  const baseOpts = () => ({
    runId: 'tg123', runDir: runDirOf(), project: rsTmp,
    models: ['alpha', 'beta'], chair: 'chairmodel', critic: null, lenses: null,
  });

  test('o.tag present -> readRun(runDir).tag equals it', () => {
    runState.initCouncilRun({ ...baseOpts(), tag: 'sprint-42' });
    expect(runState.readRun(runDirOf()).tag).toBe('sprint-42');
  });

  test('o.tag absent -> "tag" key is absent from run.json, not null', () => {
    runState.initCouncilRun(baseOpts());
    expect('tag' in runState.readRun(runDirOf())).toBe(false);
  });
});

describe('--pack flag surface (Step 3)', () => {
  test('--pack <name|path> is documented for council run, fanout, and start', () => {
    expect(getUsage('council')).toContain('--pack <name|path>');
    expect(getUsage('fanout')).toContain('--pack <name|path>');
    expect(getUsage('start')).toContain('--pack <name|path>');
  });
});
