// tests/pack/pack-resolve.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// pack-resolve must never render a template itself (Task 11 brief, test g) —
// mock the render entry point so any accidental call is directly observable,
// while leaving template/store's real resolveTemplate (used by validatePack's
// existence check) untouched.
jest.mock('../../src/template/apply', () => ({ applyTemplate: jest.fn() }));

let tmp;
beforeEach(() => {
  jest.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-resolve-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
  // Base fixture idiom shared with Task 7/8 (pack-store.test.js, pack-validate.test.js):
  // getEffectiveAliases() merges defaults + user config; seed the names this
  // file's fixtures use as bench/chair/critic/model values.
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
    aliases: { deepseek: 'deepseek/deepseek-chat', 'qwen-coder': 'qwen/qwen3-coder', gpt: 'openai/gpt-5.3' },
  }));
});
afterEach(() => {
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const { parseArgs } = require('../../src/cli');
const { ERROR_CODES } = require('../../src/utils/error-doc');
const resolve = () => require('../../src/pack/pack-resolve').applyPackToArgs;
const store = () => require('../../src/pack/pack-store');

// ---- fixtures (kind-complete: every knob in the Task-11 table gets a real value) ----
// v4.5 HOLD-gate decision 2: agent/thinking/summaryLength were dropped from
// KIND_OPTIONS.council (inert on every council surface) — this fixture no
// longer carries them. Coverage of the shared agent/thinking/summaryLength
// fill mechanism (COMMON_OPTION_KNOBS + the dedicated agent-fill code) is
// unaffected: FANOUT_PACK/SOLO_PACK below exercise the identical shared code.
const COUNCIL_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'sec-review', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['deepseek', 'qwen-coder'], chair: 'gpt', critic: 'deepseek', lenses: null,
  options: { timeout: 10, maxCost: 2.5, gateway: 'direct', debate: true },
  briefing: { template: 'review' },
});
const COUNCIL_PACK_LENSES = () => ({
  ...COUNCIL_PACK(), name: 'lens-review', critic: null, lenses: ['sec', 'perf'],
});
const COUNCIL_PACK_STRING_BENCH = () => ({
  schemaVersion: 1, type: 'pack', name: 'preset-review', version: '1.0.0', kind: 'council',
  description: 'x', bench: 'budget', chair: null, critic: null, lenses: null,
  options: {}, briefing: {},
});
const SPARSE_COUNCIL_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'sparse-review', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['deepseek', 'qwen-coder'], chair: null, critic: null, lenses: null,
  options: {}, briefing: {},
});
const FANOUT_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'fanout-review', version: '1.0.0', kind: 'fanout',
  description: 'x', bench: ['deepseek', 'qwen-coder'],
  options: {
    timeout: 11, maxCost: 3.5, gateway: 'direct', agent: 'code', thinking: 'high',
    summaryLength: 'verbose', noContext: true, contextTurns: 5, contextMaxTokens: 1234,
  },
  briefing: { template: 'review' },
});
const SOLO_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'solo-review', version: '1.0.0', kind: 'solo',
  description: 'x', model: 'deepseek',
  options: {
    noUi: true, timeout: 12, maxCost: 4.5, gateway: 'direct', agent: 'code', thinking: 'high',
    summaryLength: 'verbose', noContext: true, contextTurns: 6, contextMaxTokens: 2345,
  },
  briefing: { template: 'review' },
});

describe('applyPackToArgs: council — pack fills every knob when not explicit (seeded-defaults trap)', () => {
  test('chair/critic/options/template/bench(models) all fill; lenses stays untouched (pack lenses is null)', () => {
    store().writePack(COUNCIL_PACK());
    const args = parseArgs(['council', 'run']); // nothing typed

    // Seeded-defaults trap sanity: parseArgs' own DEFAULTS already put a
    // built-in value here even though the user typed nothing.
    expect(args.timeout).toBe(15);
    expect(args['summary-length']).toBe('normal');
    expect(args.__explicit.has('timeout')).toBe(false);
    expect(args.__explicit.has('summary-length')).toBe(false);

    const res = resolve()({ packRef: 'sec-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });

    expect(res.error).toBeUndefined();
    expect(res.packRecord).toEqual({
      name: 'sec-review', version: '1.0.0', hash: expect.stringMatching(/^[0-9a-f]{12}$/), source: 'dir',
    });
    expect(res.notices).toEqual([]);

    expect(args.chair).toBe('gpt');
    expect(args.critic).toBe('deepseek');
    expect(args.lenses).toBeUndefined(); // pack.lenses is null -> untouched, not overwritten with null
    expect(args.timeout).toBe(10); // overwrote the DEFAULTS-seeded 15
    expect(args['max-cost']).toBe(2.5);
    expect(args.gateway).toBe('direct');
    // v4.5 HOLD-gate decision 2: council packs can no longer carry
    // agent/thinking/summaryLength — the DEFAULTS-seeded values survive
    // untouched (there is nothing left in the pack to fill them with).
    expect(args.agent).toBeUndefined();
    expect(args.thinking).toBeUndefined();
    expect(args['summary-length']).toBe('normal'); // DEFAULTS-seeded, unchanged
    expect(args.debate).toBe(true);
    expect(args.template).toBe('review');
    expect(args.models).toBe('deepseek,qwen-coder'); // array bench -> csv
    expect(args.council).toBeUndefined();
  });
});

describe('applyPackToArgs: council — explicit CLI flag wins over every knob', () => {
  test('typed flags are never overwritten by the pack, including the seeded-defaults-trap direction', () => {
    store().writePack(COUNCIL_PACK());
    // --agent/--thinking/--summary-length are still typed here even though the
    // pack itself no longer carries those three (v4.5 HOLD-gate decision 2) —
    // proves typing them on a council run is harmless (they simply have no pack
    // value to compete with); the "explicit beats pack" case for these knobs is
    // still covered on fanout/solo below, where the pack genuinely sets them.
    const args = parseArgs(['council', 'run',
      '--chair', 'claude', '--critic', 'qwen-coder', '--lenses', 'x,y',
      '--timeout', '30', '--max-cost', '9.9', '--gateway', 'openrouter',
      '--agent', 'chat', '--thinking', 'low', '--summary-length', 'brief',
      '--debate', '--template', 'mine', '--models', 'a,b']);

    const res = resolve()({ packRef: 'sec-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });

    expect(res.error).toBeUndefined();
    expect(args.chair).toBe('claude');
    expect(args.critic).toBe('qwen-coder');
    expect(args.lenses).toBe('x,y');
    expect(args.timeout).toBe(30); // explicit 30 beats pack's 10
    expect(args['max-cost']).toBe(9.9);
    expect(args.gateway).toBe('openrouter');
    expect(args.debate).toBe(true);
    expect(args.template).toBe('mine');
    expect(args.models).toBe('a,b'); // explicit beats the bench array fill
    expect(res.notices).toEqual(['Notice: --models overrides the bench from pack \'sec-review\'']);
  });
});

describe('applyPackToArgs: council — debate skip rule covers both negation forms (Task 10 ruling)', () => {
  test('--debate typed skips the pack fill, proven against a pack that disagrees (debate:false)', () => {
    const pack = { ...COUNCIL_PACK(), name: 'debate-false-pack', options: { ...COUNCIL_PACK().options, debate: false } };
    store().writePack(pack);
    const args = parseArgs(['council', 'run', '--debate']);
    const res = resolve()({ packRef: 'debate-false-pack', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.debate).toBe(true); // stayed true (typed) despite pack's debate:false
  });

  test('--no-debate typed skips the pack fill even though only the negation form was typed', () => {
    store().writePack(COUNCIL_PACK()); // debate: true in the pack
    const args = parseArgs(['council', 'run', '--no-debate']);
    const res = resolve()({ packRef: 'sec-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.debate).toBeUndefined(); // NOT filled with the pack's true
    expect(args['no-debate']).toBe(true); // the literal typed key, from the CLI
  });

  test('debate fills from the pack when neither form is typed', () => {
    store().writePack(COUNCIL_PACK());
    const args = parseArgs(['council', 'run']);
    resolve()({ packRef: 'sec-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(args.debate).toBe(true);
  });
});

describe('applyPackToArgs: fanout/solo — a typed --mode counts as agent-explicit (F4, final-review)', () => {
  // cli-handlers-run.js normalizes a legacy --mode flag into args.agent AFTER
  // this merge runs (`args.agent = args.agent || args.mode`, handleStart:62 /
  // handleFanout:232) — but only 'mode' lands in `explicit` when the caller
  // typed --mode without --agent. Before the fix, the generic COMMON_OPTION_KNOBS
  // fill saw args.agent still undefined and explicit.has('agent') === false, so
  // it clobbered args.agent with the pack's options.agent BEFORE the handler's
  // fallback ever got a chance to read args.mode — the typed --mode silently lost.
  test('--mode typed (no --agent) is NOT overwritten by the pack\'s options.agent — the handler\'s --mode fallback must see args.mode untouched', () => {
    store().writePack(FANOUT_PACK()); // options.agent: 'code'
    const args = parseArgs(['fanout', '--mode', 'chat']);
    const res = resolve()({ packRef: 'fanout-review', expectedKind: 'fanout', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.agent).toBeUndefined(); // NOT filled with the pack's 'code'
    expect(args.mode).toBe('chat'); // untouched, so `args.agent || args.mode` resolves to 'chat'
  });

  test('explicit --agent still beats the pack even when --mode is ALSO typed', () => {
    store().writePack(FANOUT_PACK());
    const args = parseArgs(['fanout', '--mode', 'chat', '--agent', 'plan']);
    const res = resolve()({ packRef: 'fanout-review', expectedKind: 'fanout', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.agent).toBe('plan'); // typed --agent wins over both --mode and the pack
  });

  test('agent still fills from the pack when neither --agent nor --mode is typed (no false pack-attribution regression)', () => {
    store().writePack(FANOUT_PACK());
    const args = parseArgs(['fanout']);
    const res = resolve()({ packRef: 'fanout-review', expectedKind: 'fanout', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.agent).toBe('code');
  });
});

describe('applyPackToArgs: council — falsy pack values still fill (guard is null/undefined, not truthiness)', () => {
  test('a pack value of FALSE fills (the guard is null/undefined, not truthiness)', () => {
    const pack = { ...COUNCIL_PACK(), name: 'debate-false-untyped', options: { ...COUNCIL_PACK().options, debate: false } };
    store().writePack(pack);
    const args = parseArgs(['council', 'run']); // nothing debate-related typed
    const res = resolve()({ packRef: 'debate-false-untyped', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.debate).toBe(false); // strictly false, not undefined — every other false-carrying
    // fixture in this file pairs the false with a typed flag, exercising only the skip path
  });

  test('shared fill() guard pins falsy 0: pack maxCost fills when untyped (spec §5.4: 0 fills here, then handler pre-flight rejects)', () => {
    const pack = { ...COUNCIL_PACK(), name: 'maxcost-zero', options: { ...COUNCIL_PACK().options, maxCost: 0 } };
    store().writePack(pack);
    const args = parseArgs(['council', 'run']); // nothing typed
    const res = resolve()({ packRef: 'maxcost-zero', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args['max-cost']).toBe(0); // strictly 0, pinning the shared fill guard's null/undefined check
  });
});

describe('applyPackToArgs: council — lenses (array pack field) comma-joins into the string arg', () => {
  test('fills as a comma-joined string when not explicit; critic stays untouched (pack critic is null)', () => {
    store().writePack(COUNCIL_PACK_LENSES());
    const args = parseArgs(['council', 'run']);
    const res = resolve()({ packRef: 'lens-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.lenses).toBe('sec,perf');
    expect(args.critic).toBeUndefined();
  });

  test('explicit --lenses beats the pack array', () => {
    store().writePack(COUNCIL_PACK_LENSES());
    const args = parseArgs(['council', 'run', '--lenses', 'x,y,z']);
    resolve()({ packRef: 'lens-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(args.lenses).toBe('x,y,z');
  });
});

describe('applyPackToArgs: council — critic/lenses XOR suppression (2026-07-28 ruling)', () => {
  test('pack critic does not fill when --lenses is explicit (no error, no notice)', () => {
    store().writePack(COUNCIL_PACK()); // critic: 'deepseek'
    const args = parseArgs(['council', 'run', '--lenses', 'a,b']);
    const res = resolve()({ packRef: 'sec-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.critic).toBeUndefined(); // suppressed: --lenses was explicit, not the pack's critic
    expect(args.lenses).toBe('a,b'); // the typed value, untouched
    expect(res.notices).toEqual([]);
  });

  test('pack lenses does not fill when --critic is explicit', () => {
    store().writePack(COUNCIL_PACK_LENSES()); // lenses: ['sec', 'perf']
    const args = parseArgs(['council', 'run', '--critic', 'x']);
    const res = resolve()({ packRef: 'lens-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.lenses).toBeUndefined(); // suppressed: --critic was explicit, not the pack's lenses
    expect(args.critic).toBe('x'); // the typed value, untouched
  });
});

describe('applyPackToArgs: bench — string form fills args.council; notice names whichever flag was typed', () => {
  test('string bench fills args.council when neither --models nor --council is typed', () => {
    store().writePack(COUNCIL_PACK_STRING_BENCH());
    const args = parseArgs(['council', 'run']);
    const res = resolve()({ packRef: 'preset-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.council).toBe('budget');
    expect(args.models).toBeUndefined();
    expect(res.notices).toEqual([]);
  });

  test('explicit --council (no --models) produces the --council notice and is not overwritten', () => {
    store().writePack(COUNCIL_PACK_STRING_BENCH());
    const args = parseArgs(['council', 'run', '--council', 'frontier']);
    const res = resolve()({ packRef: 'preset-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.council).toBe('frontier');
    expect(res.notices).toEqual(['Notice: --council overrides the bench from pack \'preset-review\'']);
  });

  test('explicit --models produces the --models notice on an array-bench pack', () => {
    store().writePack(FANOUT_PACK());
    const args = parseArgs(['fanout', '--models', 'z,y']);
    const res = resolve()({ packRef: 'fanout-review', expectedKind: 'fanout', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.models).toBe('z,y');
    expect(res.notices).toEqual(['Notice: --models overrides the bench from pack \'fanout-review\'']);
  });
});

describe('packRecord provenance (T11-b)', () => {
  test('packRecord.hash round-trips canonicalHash and readPack', () => {
    store().writePack(COUNCIL_PACK());
    const args = parseArgs(['council', 'run']);
    const res = resolve()({ packRef: 'sec-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    const rp = store().readPack('sec-review');
    expect(res.packRecord.hash).toBe(rp.hash);
    expect(res.packRecord.hash).toBe(store().canonicalHash(rp.pack));
  });

  test("a .json path packRef resolves with packRecord.source 'path'", () => {
    const w = store().writePack(COUNCIL_PACK());
    const args = parseArgs(['council', 'run']);
    const res = resolve()({ packRef: w.path, expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(res.packRecord).toEqual({
      name: 'sec-review', version: '1.0.0', hash: expect.stringMatching(/^[0-9a-f]{12}$/), source: 'path',
    });
  });
});

describe('applyPackToArgs: absent pack fields (undefined, not just null) leave args untouched', () => {
  test('a pack that omits chair/options/briefing entirely does not disturb those args', () => {
    store().writePack(SPARSE_COUNCIL_PACK());
    const args = parseArgs(['council', 'run']);
    const seededTimeout = args.timeout;
    const seededSummaryLength = args['summary-length'];

    const res = resolve()({ packRef: 'sparse-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });

    expect(res.error).toBeUndefined();
    expect(args.chair).toBeUndefined();
    expect(args.critic).toBeUndefined();
    expect(args.lenses).toBeUndefined();
    expect(args.template).toBeUndefined();
    expect(args.debate).toBeUndefined();
    // No pack.options at all: parseArgs' own built-in DEFAULTS survive completely untouched.
    expect(args.timeout).toBe(seededTimeout);
    expect(args['summary-length']).toBe(seededSummaryLength);
    // bench is still present on this fixture, so that fill still happens.
    expect(args.models).toBe('deepseek,qwen-coder');
  });
});

describe('applyPackToArgs: fanout — context knobs plus shared knobs', () => {
  test('fills every fanout knob when not explicit, including the context-turns/context-max-tokens seeded-defaults trap', () => {
    store().writePack(FANOUT_PACK());
    const args = parseArgs(['fanout']);
    expect(args['context-turns']).toBe(50); // DEFAULTS-seeded
    expect(args['context-max-tokens']).toBe(80000); // DEFAULTS-seeded

    const res = resolve()({ packRef: 'fanout-review', expectedKind: 'fanout', args, explicit: args.__explicit, useJson: false });

    expect(res.error).toBeUndefined();
    expect(args.timeout).toBe(11);
    expect(args['max-cost']).toBe(3.5);
    expect(args.gateway).toBe('direct');
    expect(args.agent).toBe('code');
    expect(args.thinking).toBe('high');
    expect(args['summary-length']).toBe('verbose');
    expect(args['no-context']).toBe(true);
    expect(args['context-turns']).toBe(5); // overwrote the DEFAULTS-seeded 50
    expect(args['context-max-tokens']).toBe(1234); // overwrote the DEFAULTS-seeded 80000
    expect(args.models).toBe('deepseek,qwen-coder');
    expect(args.template).toBe('review');
    expect(args.chair).toBeUndefined(); // fanout has no chair knob at all
  });

  test('explicit CLI flags beat every fanout knob', () => {
    store().writePack(FANOUT_PACK());
    const args = parseArgs(['fanout',
      '--timeout', '77', '--max-cost', '1.1', '--gateway', 'auto', '--agent', 'chat',
      '--thinking', 'low', '--summary-length', 'brief', '--no-context',
      '--context-turns', '3', '--context-max-tokens', '999', '--models', 'z,y']);

    const res = resolve()({ packRef: 'fanout-review', expectedKind: 'fanout', args, explicit: args.__explicit, useJson: false });

    expect(res.error).toBeUndefined();
    expect(args.timeout).toBe(77);
    expect(args['max-cost']).toBe(1.1);
    expect(args.gateway).toBe('auto');
    expect(args.agent).toBe('chat');
    expect(args.thinking).toBe('low');
    expect(args['summary-length']).toBe('brief');
    expect(args['no-context']).toBe(true);
    expect(args['context-turns']).toBe(3);
    expect(args['context-max-tokens']).toBe(999);
    expect(args.models).toBe('z,y');
  });

  test('explicit --no-context beats a pack that disagrees (noContext:false) — meaningful direction proof', () => {
    const pack = { ...FANOUT_PACK(), name: 'fanout-nc-false', options: { ...FANOUT_PACK().options, noContext: false } };
    store().writePack(pack);
    const args = parseArgs(['fanout', '--no-context', '--models', 'a,b']);
    const res = resolve()({ packRef: 'fanout-nc-false', expectedKind: 'fanout', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args['no-context']).toBe(true);
  });
});

describe('applyPackToArgs: solo — model/no-ui plus shared + context knobs', () => {
  test('fills model/no-ui/shared/context knobs when not explicit', () => {
    store().writePack(SOLO_PACK());
    const args = parseArgs(['start']);
    expect(args['no-ui']).toBe(false); // DEFAULTS-seeded

    const res = resolve()({ packRef: 'solo-review', expectedKind: 'solo', args, explicit: args.__explicit, useJson: false });

    expect(res.error).toBeUndefined();
    expect(args.model).toBe('deepseek');
    expect(args['no-ui']).toBe(true); // overwrote the DEFAULTS-seeded false
    expect(args.timeout).toBe(12);
    expect(args['max-cost']).toBe(4.5);
    expect(args.gateway).toBe('direct');
    expect(args.agent).toBe('code');
    expect(args.thinking).toBe('high');
    expect(args['summary-length']).toBe('verbose');
    expect(args['no-context']).toBe(true);
    expect(args['context-turns']).toBe(6);
    expect(args['context-max-tokens']).toBe(2345);
    expect(args.template).toBe('review');
    expect(res.packRecord.name).toBe('solo-review');
    // solo packs have no bench concept at all
    expect(args.models).toBeUndefined();
    expect(args.council).toBeUndefined();
    expect(res.notices).toEqual([]);
  });

  test('explicit CLI flags beat every solo knob, including no-ui vs. a pack that disagrees (noUi:false)', () => {
    const pack = { ...SOLO_PACK(), name: 'solo-no-ui-false', options: { ...SOLO_PACK().options, noUi: false } };
    store().writePack(pack);
    const args = parseArgs(['start',
      '--model', 'openai/gpt-5.3', '--no-ui', '--timeout', '88', '--max-cost', '1.2',
      '--gateway', 'auto', '--agent', 'chat', '--thinking', 'low', '--summary-length', 'brief',
      '--no-context', '--context-turns', '4', '--context-max-tokens', '111']);
    const res = resolve()({ packRef: 'solo-no-ui-false', expectedKind: 'solo', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.model).toBe('openai/gpt-5.3');
    expect(args['no-ui']).toBe(true); // typed, despite the pack's disagreeing noUi:false
    expect(args.timeout).toBe(88);
    expect(args['max-cost']).toBe(1.2);
    expect(args.gateway).toBe('auto');
    expect(args.agent).toBe('chat');
    expect(args.thinking).toBe('low');
    expect(args['summary-length']).toBe('brief');
    expect(args['no-context']).toBe(true);
    expect(args['context-turns']).toBe(4);
    expect(args['context-max-tokens']).toBe(111);
  });
});

describe('applyPackToArgs: error triple', () => {
  test('PACK_NOT_FOUND on a ghost name, hint amicus pack list', () => {
    const args = parseArgs(['council', 'run']);
    const res = resolve()({ packRef: 'ghost-pack-does-not-exist', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.packRecord).toBeUndefined();
    expect(res.error.code).toBe(ERROR_CODES.PACK_NOT_FOUND);
    expect(res.error.hint).toBe('amicus pack list');
    expect(res.error.message).toMatch(/ghost-pack-does-not-exist/);
  });

  test('PACK_KIND_MISMATCH names both kinds and the concrete command, not "this command"', () => {
    store().writePack(SOLO_PACK());
    const args = parseArgs(['council', 'run']);
    const res = resolve()({ packRef: 'solo-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.packRecord).toBeUndefined();
    expect(res.error.code).toBe(ERROR_CODES.PACK_KIND_MISMATCH);
    expect(res.error.message).toContain("kind 'solo'");
    expect(res.error.message).toContain("kind 'council'");
    expect(res.error.message).toContain("— council run accepts kind 'council'"); // concrete command name, unforgeable
    expect(res.error.message).not.toContain('this command');
    expect(res.error.message).toContain('make two packs if you want both shapes');
  });

  test('PACK_INVALID carries the field errors', () => {
    const bad = { ...COUNCIL_PACK(), name: 'bad-pack', options: { ...COUNCIL_PACK().options, frobnicate: 1 } };
    store().writePack(bad);
    const args = parseArgs(['council', 'run']);
    const res = resolve()({ packRef: 'bad-pack', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.packRecord).toBeUndefined();
    expect(res.error.code).toBe(ERROR_CODES.PACK_INVALID);
    expect(res.error.message).toContain('frobnicate');
  });
});

describe('applyPackToArgs: template — fills the ref only, never renders (single application point stays in the handler)', () => {
  test('fills args.template with the pack ref; no render, no prompt mutation, applyTemplate never called', () => {
    const { applyTemplate } = require('../../src/template/apply');
    store().writePack(COUNCIL_PACK()); // briefing.template: 'review'
    const args = parseArgs(['council', 'run']);
    expect(args.prompt).toBeUndefined();

    const res = resolve()({ packRef: 'sec-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });

    expect(res.error).toBeUndefined();
    expect(args.template).toBe('review'); // the raw ref, not rendered markdown
    expect(args.prompt).toBeUndefined(); // untouched
    expect(args.promptMeta).toBeUndefined(); // no rendering metadata appeared
    expect(res.packRecord).toBeDefined();
    expect(applyTemplate).not.toHaveBeenCalled(); // the render call itself never happened
  });

  test('explicit --template beats the pack ref (pack briefing.template ignored)', () => {
    const { applyTemplate } = require('../../src/template/apply');
    store().writePack(COUNCIL_PACK());
    const args = parseArgs(['council', 'run', '--template', 'my-own-template']);

    const res = resolve()({ packRef: 'sec-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });

    expect(res.error).toBeUndefined();
    expect(args.template).toBe('my-own-template');
    expect(applyTemplate).not.toHaveBeenCalled();
  });
});
