// tests/utils/engine-ensure.test.js
'use strict';
const ee = require('../../src/utils/engine-ensure');

beforeEach(() => { ee._resetEnsureEngine(); });

const noop = () => {};

describe('ensureEngine — fast path', () => {
  test('already present → ok:true, repairEngine NOT called', async () => {
    const repairEngine = jest.fn();
    const r = await ee.ensureEngine({
      deps: { hasOpencodeBinary: () => true, repairEngine, ensurePath: noop, logProgress: noop },
    });
    expect(r).toEqual({ ok: true });
    expect(repairEngine).not.toHaveBeenCalled();
  });
});

describe('ensureEngine — self-heal path', () => {
  test('missing → repairs, refreshes PATH, re-checks → ok:true with donor', async () => {
    let present = false;
    const ensurePath = jest.fn();
    const repairEngine = jest.fn(async () => { present = true; return { repaired: true, donor: 'C:/global/amicus' }; });
    const r = await ee.ensureEngine({
      deps: { hasOpencodeBinary: () => present, repairEngine, ensurePath, logProgress: noop },
    });
    expect(repairEngine).toHaveBeenCalledTimes(1);
    expect(ensurePath).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: true, donor: 'C:/global/amicus' });
  });

  test('repair does not restore the binary → ok:false with the repair reason', async () => {
    const repairEngine = jest.fn(async () => ({ repaired: false, reason: 'no healthy sibling install to copy the engine from' }));
    const r = await ee.ensureEngine({
      deps: { hasOpencodeBinary: () => false, repairEngine, ensurePath: noop, logProgress: noop },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no healthy sibling/i);
  });

  test('a thrown repairEngine → ok:false with a reason (never rejects)', async () => {
    const repairEngine = jest.fn(async () => { throw new Error('boom'); });
    const r = await ee.ensureEngine({
      deps: { hasOpencodeBinary: () => false, repairEngine, ensurePath: noop, logProgress: noop },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/boom/);
  });
});

describe('ensureEngine — single-flight', () => {
  test('concurrent calls share ONE repair', async () => {
    let present = false;
    let release;
    const repairEngine = jest.fn(() => new Promise((res) => { release = () => { present = true; res({ repaired: true }); }; }));
    const deps = { hasOpencodeBinary: () => present, repairEngine, ensurePath: noop, logProgress: noop };
    const p1 = ee.ensureEngine({ deps });
    const p2 = ee.ensureEngine({ deps });
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(repairEngine).toHaveBeenCalledTimes(1);
  });

  test('a FAILED repair is not memoized — a later call retries', async () => {
    let present = false;
    const repairEngine = jest.fn()
      .mockImplementationOnce(async () => ({ repaired: false, reason: 'no donor' }))
      .mockImplementationOnce(async () => { present = true; return { repaired: true }; });
    const deps = { hasOpencodeBinary: () => present, repairEngine, ensurePath: noop, logProgress: noop };
    const first = await ee.ensureEngine({ deps });
    expect(first.ok).toBe(false);
    const second = await ee.ensureEngine({ deps });
    expect(second.ok).toBe(true);
    expect(repairEngine).toHaveBeenCalledTimes(2);
  });
});
