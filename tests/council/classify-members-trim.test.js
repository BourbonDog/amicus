// tests/council/classify-members-trim.test.js
'use strict';

/**
 * @module tests/council/classify-members-trim
 * v4.8 SI-22.4 — `src/utils/config.js :: classifyCouncilMembers` trims each
 * `--council` preset member before classifying it.
 *
 * WHY THIS FILE EXISTS. `--models` has always trimmed (`sidecar/fanout-validate.js
 * :: parseModelsList` on the fanout surface, `cli-council-run-bench.js ::
 * parseList` on the council-run one); `--council` did not. The same stray space
 * was therefore benign on one flag and, on the other, turned a typo into a
 * dropped member and a degraded (2) exit.
 *
 * ⚠️ THE DOMINANT EFFECT IS RESURRECTION, NOT DE-DUPLICATION. Four of the six
 * shapes pinned below have a member that is DROPPED before the trim and RUNS
 * after it, which is a new paid leg the user pays for; on two of them the bench
 * goes from empty to non-empty. Only one shape (padded + unpadded twin on an
 * empty catalog) is the twin-merge the filed item led with. Measured at BASE
 * `276d5a18` by calling the real function, and re-measured here against the
 * shipped one; the BEFORE column of each case is quoted in its own comment so a
 * future reader can see what moved without re-deriving it.
 *
 * The end-to-end knock-on of the twin case (`buildSeats` minting `alias#N`, the
 * `-2` artifact sibling, `meta.seats` appearing) is pinned from ARTIFACTS in
 * tests/council/preset-trim-twin-bench.test.js, not argued from here.
 *
 * NAMED MUTANTS for this file, with their measured red sets:
 * tests/council/preset-trim-mutants.js :: NOTRIM, TRIMDROPPED, KEEPEMPTY.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// The catalog the "present" rows use. `openai/gpt-5` is listed; the padded
// spelling `'openai/gpt-5 '` is not, which is the whole point of gate 3.
const CATALOG = [{ id: 'openai/gpt-5' }];

// The alias table is pinned by the fixture rather than inherited from
// curated-models, so a future curation change cannot silently retune what these
// cases measure. `gpt` is a real default alias today; the value below only has
// to be a resolvable id for gate 1 to pass.
const ALIASES = { gpt: 'openai/gpt-5.6-terra' };

let tempDir;
const origConfigDir = process.env.AMICUS_CONFIG_DIR;

/** Fresh config dir + alias table, and a fresh `config` module bound to it. */
function classifier() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si224-classify-'));
  process.env.AMICUS_CONFIG_DIR = tempDir;
  jest.resetModules();
  const config = require('../../src/utils/config');
  config.saveConfig({ aliases: ALIASES });
  return config;
}

afterEach(() => {
  jest.resetModules();
  if (origConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
  else { process.env.AMICUS_CONFIG_DIR = origConfigDir; }
  if (tempDir) { fs.rmSync(tempDir, { recursive: true, force: true }); tempDir = undefined; }
});

describe('SI-22.4: the six measured shapes (the AFTER column IS the specification)', () => {
  test('1. padded + unpadded full id, catalog PRESENT — was one member dropped, now both run', () => {
    // BEFORE: models ["openai/gpt-5"], dropped ["openai/gpt-5 "] (gate 3: the
    // padded id carried its space into the catalog lookup and missed).
    const { classifyCouncilMembers } = classifier();
    const r = classifyCouncilMembers(['openai/gpt-5 ', 'openai/gpt-5'], CATALOG);
    expect(r.models).toEqual(['openai/gpt-5', 'openai/gpt-5']);
    expect(r.dropped).toEqual([]);
    expect(r.droppedMembers).toEqual([]);
  });

  test('2. padded + unpadded full id, catalog EMPTY — was two distinct aliases, now a real twin', () => {
    // BEFORE: models ["openai/gpt-5 ","openai/gpt-5"] — nothing dropped (gate 3
    // is skipped on an empty catalog) but the two strings differ, so buildSeats
    // saw NO repeated alias. This is the ONE row the filed item described.
    const { classifyCouncilMembers } = classifier();
    const r = classifyCouncilMembers(['openai/gpt-5 ', 'openai/gpt-5'], []);
    expect(r.models).toEqual(['openai/gpt-5', 'openai/gpt-5']);
    expect(r.models[0]).toBe(r.models[1]);   // the collision, stated directly
    expect(r.dropped).toEqual([]);
  });

  test('3. lone padded full id, catalog PRESENT — was an EMPTY bench, now one leg runs', () => {
    // BEFORE: models [] — nothing ran at all.
    const { classifyCouncilMembers } = classifier();
    const r = classifyCouncilMembers(['openai/gpt-5 '], CATALOG);
    expect(r.models).toEqual(['openai/gpt-5']);
    expect(r.dropped).toEqual([]);
  });

  test('4. lone padded full id, catalog EMPTY — the padding no longer reaches the bench', () => {
    // BEFORE: models ["openai/gpt-5 "] — it ran, padded, and every seat/artifact
    // downstream keyed off the padded spelling.
    const { classifyCouncilMembers } = classifier();
    const r = classifyCouncilMembers(['openai/gpt-5 '], []);
    expect(r.models).toEqual(['openai/gpt-5']);
  });

  test('5. lone padded ALIAS, catalog EMPTY — was an EMPTY bench, now one leg runs', () => {
    // BEFORE: models [], dropped ["gpt "] (gate 1: 'gpt ' is not a key of the
    // alias table, so it read as an alias that no longer resolves).
    const { classifyCouncilMembers } = classifier();
    const r = classifyCouncilMembers(['gpt '], []);
    expect(r.models).toEqual(['gpt']);
    expect(r.dropped).toEqual([]);
  });

  test('6. padded + unpadded ALIAS, catalog EMPTY — was one member dropped, now a real twin', () => {
    // BEFORE: models ["gpt"], dropped ["gpt "] — the degraded-exit case: a
    // trailing space in a preset cost the user a seat and an exit code of 2.
    const { classifyCouncilMembers } = classifier();
    const r = classifyCouncilMembers(['gpt ', 'gpt'], []);
    expect(r.models).toEqual(['gpt', 'gpt']);
    expect(r.dropped).toEqual([]);
  });
});

describe('SI-22.4: the rules that bound the trim', () => {
  test('R22.4-3: an all-whitespace member never reaches `models`', () => {
    // PRESERVATION, not new behaviour: '   ' trims to '', no alias table names
    // '', so gate 1 drops it — measured identical BEFORE and AFTER the trim, on
    // both catalog states. This is `parseModelsList`'s `.filter(Boolean)` half,
    // reached without adding a third `reason` string (R22.4-4).
    // Named mutant: preset-trim-mutants.js :: KEEPEMPTY.
    const { classifyCouncilMembers } = classifier();
    // The companion member is there to prove the drop is selective rather than
    // total; its resolved id (`gpt` → openai/gpt-5.6-terra) has to be IN the
    // non-empty catalog or gate 3 would drop it for an unrelated reason.
    for (const catalog of [[{ id: 'openai/gpt-5.6-terra' }], []]) {
      const r = classifyCouncilMembers(['   ', 'gpt'], catalog);
      expect(r.models).not.toContain('');
      expect(r.models).toEqual(['gpt']);
      expect(r.dropped).toEqual(['   ']);
    }
  });

  test('R22.4-2: `dropped` and `droppedMembers` report the RAW string, not the trimmed one', () => {
    // A member still dropped after trimming must be echoed exactly as the user
    // wrote it, or they cannot grep their own config for it. The reason is the
    // catalog-miss one: '  openai/ghost  ' trims to a well-formed id that the
    // catalog simply does not list.
    // Named mutant: preset-trim-mutants.js :: TRIMDROPPED.
    const { classifyCouncilMembers } = classifier();
    const r = classifyCouncilMembers(['  openai/ghost  ', 'openai/gpt-5'], CATALOG);
    expect(r.models).toEqual(['openai/gpt-5']);
    expect(r.dropped).toEqual(['  openai/ghost  ']);
    expect(r.droppedMembers).toEqual([
      { member: '  openai/ghost  ', reason: 'resolved id is not present in the cached model catalog' },
    ]);
    // The same rule on the OTHER drop branch (gate 1, alias-miss).
    const r2 = classifyCouncilMembers([' nosuchalias ', 'gpt'], []);
    expect(r2.dropped).toEqual([' nosuchalias ']);
    expect(r2.droppedMembers).toEqual([
      { member: ' nosuchalias ', reason: 'alias no longer resolves to a known model' },
    ]);
  });

  test('preservation: an unpadded bench is byte-identical through the function', () => {
    // The trim must be a no-op wherever there is nothing to trim — this is what
    // keeps every existing preset's bench, seats, artifact names and documents
    // unchanged. Asserted on both catalog states and on both member spellings
    // (alias and full id), plus a local-vendor member, which takes the third
    // branch and pushes without consulting the catalog at all.
    const { classifyCouncilMembers } = classifier();
    const members = ['gpt', 'openai/gpt-5', 'ollama/llama3.3'];
    for (const catalog of [[], [{ id: 'openai/gpt-5' }, { id: 'openai/gpt-5.6-terra' },
      { id: 'ollama/llama3.3' }]]) {
      const r = classifyCouncilMembers(members, catalog);
      expect(r.models).toEqual(members);
      r.models.forEach((m, i) => expect(m).toBe(members[i]));  // same bytes, per member
      expect(r.dropped).toEqual([]);
    }
  });

  test('R22.4-4: the function still produces EXACTLY TWO distinct `reason` strings', () => {
    // A cheap tripwire guard, not a behaviour pin. `classifyCouncilMembers`'s
    // own docblock says that adding a THIRD reason string is the moment to stop
    // and re-decide whether `reason` should become a coded enum rather than free
    // text. SI-22.4 deliberately did not make that decision, so this trips at
    // the commit that would have forced it instead of letting it slip through a
    // hygiene fix.
    // ⚠️ BEHAVIOURAL, NOT TEXTUAL — rewritten in fix round 2 (council A1).
    // This used to regex `Function.prototype.toString()` output, which couples
    // the guard to how the SOURCE is spelled rather than to what the function
    // DOES, and that bit twice: the body comes back carrying its own comments
    // (so any comment quoting a reason string tripped it), and babel-jest
    // REFORMATS the source (so an exact-spacing pattern matched in plain node
    // and found NOTHING under jest, passing vacuously over an empty match set).
    // Driving the function and collecting the reasons it actually EMITS tests
    // the thing the tripwire exists for — a third reason reaching a user — and
    // is immune to reformatting, to comments, and to babel.
    // ⚠️ RESIDUAL, stated rather than left to be discovered: this observes
    // every reason reachable from the drivers below, which cover both drop
    // branches that exist today. A third reason added to EITHER branch reds
    // this. A third reason on a NEW branch is observed only if some driver
    // reaches it — so adding a branch means adding a driver here, and the
    // docblock's tripwire note is what tells the next author so.
    const { classifyCouncilMembers } = classifier();
    // One driver per way a member can be dropped, PLUS one that must survive,
    // so a mutation that drops everything cannot masquerade as a pass.
    const drivers = [
      [['nosuchalias'], []],            // gate 1, empty catalog
      [['nosuchalias'], CATALOG],       // gate 1, populated catalog
      [['   '], []],                    // trims to '' -> gate 1 (R22.4-3)
      [['toString'], []],               // Object.prototype key -> gate 1 (B1)
      [['openai/ghost'], CATALOG],      // gate 3, delisted full id
      [['gpt '], []],                   // ACCEPTED: emits no reason at all
    ];
    const reasons = [];
    let accepted = 0;
    for (const [members, catalog] of drivers) {
      const r = classifyCouncilMembers(members, catalog);
      accepted += r.models.length;
      for (const d of r.droppedMembers) { reasons.push(d.reason); }
    }
    expect(reasons).toHaveLength(5);          // five drivers dropped; a vacuous
    expect(accepted).toBe(1);                 // empty set cannot pass this pair
    expect(new Set(reasons).size).toBe(2);    // the tripwire itself
    expect(new Set(reasons)).toEqual(new Set([
      'alias no longer resolves to a known model',
      'resolved id is not present in the cached model catalog',
    ]));
  });

  describe('fix round 2 (council B1): the alias table has no Object.prototype', () => {
    // Before this fix `getEffectiveAliases()` returned a NORMAL object, so
    // `aliases['toString']` resolved off Object.prototype to a truthy Function
    // and every gate asking `!!aliases[m]` read it as a known alias.
    // ⚠️ SI-22.4 WIDENED that hole, which is why the pin lives in THIS file:
    // measured at BASE `ecf90f19`, `'toString'` was already accepted but
    // `'toString '` was correctly DROPPED — trimming before the lookup landed
    // the padded spelling on the inherited property too. Both halves close here.
    // Named mutant: tests/council/preset-trim-mutants.js :: PROTOALIASES.
    const INHERITED = ['toString', 'constructor', 'valueOf', 'hasOwnProperty',
      'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__'];

    test('getEffectiveAliases() is null-prototype and still carries the real aliases', () => {
      const config = classifier();
      const aliases = config.getEffectiveAliases();
      expect(Object.getPrototypeOf(aliases)).toBeNull();
      expect(aliases.gpt).toBe('openai/gpt-5.6-terra');   // the table still works
      for (const k of INHERITED) { expect(aliases[k]).toBeUndefined(); }
    });

    test('an inherited key is DROPPED, padded and unpadded, on an EMPTY catalog', () => {
      const { classifyCouncilMembers } = classifier();
      for (const key of INHERITED) {
        for (const member of [key, `${key} `, ` ${key}`, `  ${key}  `]) {
          const r = classifyCouncilMembers([member], []);
          expect(r.models).toEqual([]);
          // R22.4-2 still holds on this branch: the drop echoes the RAW member.
          expect(r.dropped).toEqual([member]);
          expect(r.droppedMembers).toEqual([
            { member, reason: 'alias no longer resolves to a known model' }]);
        }
      }
    });

    test('...and on a POPULATED catalog, where the gate that fires is still gate 1', () => {
      const { classifyCouncilMembers } = classifier();
      for (const member of ['toString', 'toString ', 'valueOf ', 'hasOwnProperty ']) {
        const r = classifyCouncilMembers([member], CATALOG);
        expect(r.models).toEqual([]);
        expect(r.droppedMembers[0].reason).toBe('alias no longer resolves to a known model');
      }
    });

    test('SI-22.4 itself is undisturbed: a padded REAL alias still runs', () => {
      const { classifyCouncilMembers } = classifier();
      expect(classifyCouncilMembers(['gpt '], []).models).toEqual(['gpt']);
      expect(classifyCouncilMembers([' gpt'], []).models).toEqual(['gpt']);
      expect(classifyCouncilMembers(['nope '], []).models).toEqual([]);
    });

    test('resolveModel stops returning a Function for an inherited key (ALIAS-TABLE path)', () => {
      // ⚠️ TITLE NARROWED IN FIX ROUND 3. This covers the `getEffectiveAliases`
      // lookup at `:111` only. `resolveModel` has a SECOND way to return an
      // inherited Function — the auto-repair branch at `:114`/`:145`, which reads
      // `DEFAULT_ALIASES` directly and which this test never enters (that needs a
      // NULL-valued alias on disk). It is pinned in
      // tests/config-null-alias.test.js :: 'Layer 2b'. The unqualified title
      // claimed more than the test measured.
      // The sharpest consumer: `:111` gates on `!== undefined`, which a
      // Function passes, so resolveModel RETURNED Function.prototype.toString
      // (typeof 'function') where every caller expects a model-id STRING.
      const config = classifier();
      for (const key of ['toString', 'valueOf', 'constructor']) {
        expect(() => config.resolveModel(key)).toThrow(/Unknown model alias/);
      }
      expect(config.resolveModel('gpt')).toBe('openai/gpt-5.6-terra');
    });
  });
});
