// tests/sidecar/fanout.test.js
'use strict';

const mockValidateAgainstCatalog = jest.fn(async (m) => m);
jest.mock('../../src/utils/model-validator', () => ({
  validateAgainstCatalog: mockValidateAgainstCatalog,
}));

const mockValidateApiKey = jest.fn(() => ({ valid: true }));
jest.mock('../../src/utils/validators', () => {
  const actual = jest.requireActual('../../src/utils/validators');
  return { ...actual, validateApiKey: mockValidateApiKey };
});

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { parseModelsList, deriveLegIds, validateFanoutModels } = require('../../src/sidecar/fanout');

describe('fanout validation helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AMICUS_FANOUT_MAX_LEGS;
  });

  describe('parseModelsList', () => {
    it('splits, trims, drops empties', () => {
      expect(parseModelsList(' a/b, c/d ,,e/f ')).toEqual(['a/b', 'c/d', 'e/f']);
    });
    it('allows duplicates (distinct legs)', () => {
      expect(parseModelsList('a/b,a/b')).toEqual(['a/b', 'a/b']);
    });
    it('returns [] for empty/boolean input', () => {
      expect(parseModelsList('')).toEqual([]);
      expect(parseModelsList(true)).toEqual([]);
      expect(parseModelsList(undefined)).toEqual([]);
    });
  });

  describe('deriveLegIds', () => {
    it('derives <waveId>-1..N in order', () => {
      expect(deriveLegIds('deadbeef', 3)).toEqual(['deadbeef-1', 'deadbeef-2', 'deadbeef-3']);
    });
    it('derived ids satisfy the task-id pattern', () => {
      const { TASK_ID_PATTERN } = jest.requireActual('../../src/utils/validators');
      for (const id of deriveLegIds('a1b2c3d4', 10)) {
        expect(TASK_ID_PATTERN.test(id)).toBe(true);
      }
    });
  });

  describe('validateFanoutModels', () => {
    it('errors on an empty list', async () => {
      const r = await validateFanoutModels('');
      expect(r.error).toMatch(/--models requires/);
    });

    it('enforces the leg cap (default 10, env-overridable)', async () => {
      const eleven = Array.from({ length: 11 }, (_, i) => `p/m${i}`).join(',');
      const r = await validateFanoutModels(eleven);
      expect(r.error).toMatch(/cap of 10/);

      process.env.AMICUS_FANOUT_MAX_LEGS = '12';
      const r2 = await validateFanoutModels(eleven);
      expect(r2.legs).toHaveLength(11);
    });

    it('resolves every model and keeps the original input alongside', async () => {
      const r = await validateFanoutModels('openrouter/a/b,c/d');
      expect(r.legs).toEqual([
        { modelInput: 'openrouter/a/b', model: 'openrouter/a/b' },
        { modelInput: 'c/d', model: 'c/d' },
      ]);
      expect(mockValidateAgainstCatalog).toHaveBeenCalledTimes(2);
    });

    it('fails fast on a missing API key', async () => {
      mockValidateApiKey.mockReturnValueOnce({ valid: false, error: 'Error: no key for provider a' });
      const r = await validateFanoutModels('a/b,c/d');
      expect(r.error).toMatch(/no key/);
    });

    it('fails fast on catalog rejection unless noValidateModel', async () => {
      mockValidateAgainstCatalog.mockRejectedValueOnce(new Error('Model not in catalog: a/zzz'));
      const r = await validateFanoutModels('a/zzz');
      expect(r.error).toMatch(/not in catalog/);

      const r2 = await validateFanoutModels('a/zzz', { noValidateModel: true });
      expect(r2.legs).toHaveLength(1);
    });

    it('fails fast on an unresolvable alias', async () => {
      // 'nosuchalias' has no slash → resolveModel throws (no such alias in config)
      const r = await validateFanoutModels('nosuchalias-xyz-f4');
      expect(r.error).toBeDefined();
    });
  });
});
