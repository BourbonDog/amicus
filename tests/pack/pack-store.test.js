// tests/pack/pack-store.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let tmp;
beforeEach(() => {
  jest.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-store-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
});
afterEach(() => {
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const load = () => require('../../src/pack/pack-store');
const PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'sec-review', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['deepseek', 'qwen-coder'], chair: 'gpt', critic: null, lenses: null,
  options: { timeout: 10 }, briefing: { template: 'review' },
});

describe('canonicalHash', () => {
  test('is stable under key order and 12 hex chars', () => {
    const { canonicalHash } = load();
    const a = canonicalHash({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalHash({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
  test('differs when a value differs', () => {
    const { canonicalHash } = load();
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });
});

describe('resolvePackRef', () => {
  test('path when it ends in .json or contains a separator', () => {
    const { resolvePackRef } = load();
    expect(resolvePackRef('./ci/sec.json').kind).toBe('path');
    expect(resolvePackRef('sec.json').kind).toBe('path');
    expect(resolvePackRef(path.join('a', 'b')).kind).toBe('path');
  });
  test('name otherwise, grammar-checked', () => {
    const { resolvePackRef } = load();
    expect(resolvePackRef('sec-review')).toEqual({ kind: 'name', name: 'sec-review' });
    expect(resolvePackRef('BAD NAME!').error).toMatch(/pack name/i);
  });
});

describe('writePack / readPack roundtrip', () => {
  test('writes to <packsDir>/<name>.json and reads back by name', () => {
    const { writePack, readPack, packsDir } = load();
    const w = writePack(PACK());
    expect(w.path).toBe(path.join(packsDir(), 'sec-review.json'));
    const r = readPack('sec-review');
    expect(r.error).toBeUndefined();
    expect(r.pack.name).toBe('sec-review');
    expect(r.source).toBe('dir');
    expect(r.hash).toBe(w.hash);
  });
  test('unchanged content is a no-op; changed content auto-bumps patch', () => {
    const { writePack } = load();
    writePack(PACK());
    expect(writePack(PACK()).noop).toBe(true);
    const changed = { ...PACK(), description: 'y' };
    const w2 = writePack(changed);
    expect(w2.noop).toBeUndefined();
    expect(w2.bumped).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(w2.path, 'utf-8'));
    expect(onDisk.version).toBe('1.0.1');
  });
  test('name-invoked pack with mismatched embedded name errors', () => {
    const { readPack, packsDir } = load();
    fs.mkdirSync(packsDir(), { recursive: true });
    fs.writeFileSync(path.join(packsDir(), 'alias.json'), JSON.stringify({ ...PACK(), name: 'other' }));
    expect(readPack('alias').error).toMatch(/declares name 'other' which does not match/);
  });
  test('path-invoked pack keeps its embedded name and source path', () => {
    const { readPack } = load();
    const f = path.join(tmp, 'anywhere.json');
    fs.writeFileSync(f, JSON.stringify(PACK()));
    const r = readPack(f);
    expect(r.pack.name).toBe('sec-review');
    expect(r.source).toBe('path');
  });
  test('unknown name errors with the pack list hint shape', () => {
    expect(load().readPack('ghost').error).toMatch(/Pack 'ghost' not found/);
  });
});

describe('listPacks / rmPack', () => {
  test('lists name/kind/version/description; rm removes', () => {
    const { writePack, listPacks, rmPack } = load();
    writePack(PACK());
    expect(listPacks().packs).toEqual([
      { name: 'sec-review', kind: 'council', version: '1.0.0', description: 'x' },
    ]);
    expect(rmPack('sec-review').removed).toBe(true);
    expect(listPacks().packs).toEqual([]);
    expect(rmPack('sec-review').removed).toBe(false);
  });
});

describe('readPack rejects non-object bodies (v4.7 PR6)', () => {
  // A pack file whose JSON body is valid but not an object used to return as a
  // SUCCESS with `pack: null` — `pack &&` in the name-match guard short-circuited —
  // and crashed both callers on `pack.kind` / `pack.name`.
  const cases = [
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', '5'],
    ['a string', '"x"'],
    ['a boolean', 'true'],
  ];
  for (const [label, body] of cases) {
    it(`returns {error} when the body is ${label}`, () => {
      const { readPack } = load();
      const file = path.join(tmp, 'bad.json');
      fs.writeFileSync(file, body);
      const r = readPack(file);
      expect(r.error).toMatch(/is not a pack object/);
      expect(r.pack).toBeUndefined();
    });
  }

  it('still accepts a well-formed object pack', () => {
    const { readPack } = load();
    const file = path.join(tmp, 'good.json');
    fs.writeFileSync(file, JSON.stringify({ name: 'good', kind: 'council', version: '1.0.0' }));
    expect(readPack(file).pack).toEqual({ name: 'good', kind: 'council', version: '1.0.0' });
  });
});
