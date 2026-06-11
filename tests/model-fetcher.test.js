/**
 * Tests for src/utils/model-fetcher.js
 *
 * Model list fetching from provider APIs for the dropdown selector.
 */

const https = require('https');

jest.mock('https');

const {
  fetchModelsFromProvider,
  fetchAllModels,
  groupModelsByFamily,
  ANTHROPIC_MODELS,
  PROVIDER_FETCH_CONFIG,
  PROVIDER_FAMILY_NAMES
} = require('../src/utils/model-fetcher');

describe('model-fetcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ANTHROPIC_MODELS', () => {
    it('should be a non-empty array of { id, name } objects', () => {
      expect(Array.isArray(ANTHROPIC_MODELS)).toBe(true);
      expect(ANTHROPIC_MODELS.length).toBeGreaterThan(0);
      ANTHROPIC_MODELS.forEach(m => {
        expect(m).toHaveProperty('id');
        expect(m).toHaveProperty('name');
        expect(typeof m.id).toBe('string');
        expect(typeof m.name).toBe('string');
      });
    });
  });

  describe('fetchModelsFromProvider', () => {
    function mockHttpsGet(statusCode, body) {
      const mockResponse = {
        statusCode,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb(typeof body === 'string' ? body : JSON.stringify(body)); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((_url, _opts, cb) => {
        cb(mockResponse);
        return { on: jest.fn(), destroy: jest.fn() };
      });
    }

    it('should fetch and normalize OpenRouter models', async () => {
      mockHttpsGet(200, {
        data: [
          { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash' },
          { id: 'openai/gpt-5', name: 'GPT-5' }
        ]
      });

      const result = await fetchModelsFromProvider('openrouter', 'sk-or-test');
      expect(result).toEqual([
        { id: 'openrouter/google/gemini-3-flash', name: 'Gemini 3 Flash', contextLength: null, pricing: null },
        { id: 'openrouter/openai/gpt-5', name: 'GPT-5', contextLength: null, pricing: null }
      ]);
    });

    it('should fetch and normalize Google models', async () => {
      mockHttpsGet(200, {
        models: [
          { name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash' },
          { name: 'models/gemini-3-pro', displayName: 'Gemini 3 Pro' }
        ]
      });

      const result = await fetchModelsFromProvider('google', 'AIza-test');
      expect(result).toEqual([
        { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash', contextLength: null, pricing: null },
        { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro', contextLength: null, pricing: null }
      ]);
    });

    it('should fetch and normalize OpenAI models', async () => {
      mockHttpsGet(200, {
        data: [
          { id: 'gpt-5', name: 'GPT-5' },
          { id: 'o3', name: 'O3' }
        ]
      });

      const result = await fetchModelsFromProvider('openai', 'sk-test');
      expect(result).toEqual([
        { id: 'openai/gpt-5', name: 'gpt-5', contextLength: null, pricing: null },
        { id: 'openai/o3', name: 'o3', contextLength: null, pricing: null }
      ]);
    });

    it('should return hardcoded models for anthropic (no API call)', async () => {
      const result = await fetchModelsFromProvider('anthropic', 'sk-ant-test');
      expect(result).toEqual(ANTHROPIC_MODELS);
      expect(https.get).not.toHaveBeenCalled();
    });

    it('should return empty array on network error', async () => {
      https.get.mockImplementation((_url, _opts, _cb) => {
        const req = {
          on: jest.fn((event, cb) => {
            if (event === 'error') { cb(new Error('ECONNREFUSED')); }
          }),
          destroy: jest.fn()
        };
        return req;
      });

      const result = await fetchModelsFromProvider('openrouter', 'sk-or-test');
      expect(result).toEqual([]);
    });

    it('should return empty array on 401 response', async () => {
      mockHttpsGet(401, 'Unauthorized');

      const result = await fetchModelsFromProvider('openrouter', 'sk-or-bad');
      expect(result).toEqual([]);
    });

    it('should return empty array for unknown provider', async () => {
      const result = await fetchModelsFromProvider('unknown', 'key');
      expect(result).toEqual([]);
    });

    it('should return empty array on malformed JSON', async () => {
      mockHttpsGet(200, 'not json{{{');

      const result = await fetchModelsFromProvider('openrouter', 'sk-or-test');
      expect(result).toEqual([]);
    });
  });

  describe('fetchAllModels', () => {
    function mockHttpsGet(statusCode, body) {
      const mockResponse = {
        statusCode,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb(typeof body === 'string' ? body : JSON.stringify(body)); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((_url, _opts, cb) => {
        cb(mockResponse);
        return { on: jest.fn(), destroy: jest.fn() };
      });
    }

    it('should always include anthropic models even with no keys', async () => {
      mockHttpsGet(200, { data: [] });
      const result = await fetchAllModels({});
      expect(result.length).toBeGreaterThan(0);
      expect(result.some(m => m.id.startsWith('anthropic/'))).toBe(true);
    });

    it('should fetch only from providers with keys', async () => {
      mockHttpsGet(200, { data: [{ id: 'google/gemini', name: 'Gemini' }] });

      const result = await fetchAllModels({ openrouter: 'sk-or-test' });
      // Should have anthropic + openrouter models
      expect(result.some(m => m.id.startsWith('anthropic/'))).toBe(true);
      expect(result.some(m => m.id.startsWith('openrouter/'))).toBe(true);
    });

    it('should handle all providers failing gracefully', async () => {
      https.get.mockImplementation((_url, _opts, _cb) => {
        const req = {
          on: jest.fn((event, cb) => {
            if (event === 'error') { cb(new Error('fail')); }
          }),
          destroy: jest.fn()
        };
        return req;
      });

      const result = await fetchAllModels({
        openrouter: 'key', google: 'key', openai: 'key'
      });
      // Should still have anthropic models at minimum
      expect(result.length).toBe(ANTHROPIC_MODELS.length);
    });
  });

  describe('groupModelsByFamily', () => {
    it('should group models by provider prefix', () => {
      const models = [
        { id: 'openrouter/google/gemini-3-flash', name: 'Gemini 3 Flash' },
        { id: 'openrouter/openai/gpt-5', name: 'GPT-5' },
        { id: 'anthropic/claude-4-sonnet', name: 'Claude 4 Sonnet' },
        { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro' }
      ];

      const groups = groupModelsByFamily(models);
      expect(Array.isArray(groups)).toBe(true);
      expect(groups.length).toBeGreaterThan(0);
      groups.forEach(g => {
        expect(g).toHaveProperty('family');
        expect(g).toHaveProperty('models');
        expect(Array.isArray(g.models)).toBe(true);
      });
    });

    it('should have correct family names', () => {
      const models = [
        { id: 'openrouter/google/gemini', name: 'Gemini' },
        { id: 'anthropic/claude', name: 'Claude' },
        { id: 'google/gemini-pro', name: 'Gemini Pro' },
        { id: 'openai/gpt-5', name: 'GPT-5' }
      ];

      const groups = groupModelsByFamily(models);
      const families = groups.map(g => g.family);
      expect(families).toContain('OpenRouter');
      expect(families).toContain('Anthropic');
      expect(families).toContain('Google');
      expect(families).toContain('OpenAI');
    });

    it('should return empty array for empty input', () => {
      expect(groupModelsByFamily([])).toEqual([]);
    });

    it('should preserve all models in groups', () => {
      const models = [
        { id: 'openrouter/a', name: 'A' },
        { id: 'openrouter/b', name: 'B' },
        { id: 'anthropic/c', name: 'C' }
      ];

      const groups = groupModelsByFamily(models);
      const totalModels = groups.reduce((sum, g) => sum + g.models.length, 0);
      expect(totalModels).toBe(3);
    });

    it('should label a deepseek model as family DeepSeek', () => {
      const models = [
        { id: 'deepseek/deepseek-chat', name: 'deepseek-chat' }
      ];
      const groups = groupModelsByFamily(models);
      expect(groups.length).toBe(1);
      expect(groups[0].family).toBe('DeepSeek');
    });
  });

  describe('DeepSeek provider', () => {
    function mockHttpsGet(statusCode, body) {
      const mockResponse = {
        statusCode,
        // Simplified sync mock: fires data/end immediately (real Node streams are async, but ordering holds here)
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb(typeof body === 'string' ? body : JSON.stringify(body)); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((_url, _opts, cb) => {
        cb(mockResponse);
        return { on: jest.fn(), destroy: jest.fn() };
      });
    }

    describe('PROVIDER_FETCH_CONFIG.deepseek', () => {
      it('exists and has the correct url', () => {
        expect(PROVIDER_FETCH_CONFIG.deepseek).toBeDefined();
        expect(PROVIDER_FETCH_CONFIG.deepseek.url).toBe('https://api.deepseek.com/models');
      });

      it('authHeader returns a Bearer Authorization header', () => {
        const header = PROVIDER_FETCH_CONFIG.deepseek.authHeader('sk-ds-test');
        expect(header).toEqual({ 'Authorization': 'Bearer sk-ds-test' });
      });


      it('normalize maps DeepSeek data array to correct shape', () => {
        const body = JSON.stringify({
          object: 'list',
          data: [
            { id: 'deepseek-chat', object: 'model' },
            { id: 'deepseek-reasoner', object: 'model' }
          ]
        });
        const result = PROVIDER_FETCH_CONFIG.deepseek.normalize(body);
        expect(result).toEqual([
          { id: 'deepseek/deepseek-chat', name: 'deepseek-chat', contextLength: null, pricing: null },
          { id: 'deepseek/deepseek-reasoner', name: 'deepseek-reasoner', contextLength: null, pricing: null }
        ]);
      });

      it('normalize returns [] on empty data array', () => {
        const body = JSON.stringify({ object: 'list', data: [] });
        const result = PROVIDER_FETCH_CONFIG.deepseek.normalize(body);
        expect(result).toEqual([]);
      });

      test('deepseek normalize returns [] when data key is missing', () => {
        const result = PROVIDER_FETCH_CONFIG.deepseek.normalize(JSON.stringify({ object: 'list' }));
        expect(result).toEqual([]);
      });
    });

    describe('PROVIDER_FAMILY_NAMES.deepseek', () => {
      it('equals DeepSeek', () => {
        expect(PROVIDER_FAMILY_NAMES.deepseek).toBe('DeepSeek');
      });
    });

    describe('fetchModelsFromProvider deepseek', () => {
      it('returns normalized list on HTTP 200', async () => {
        mockHttpsGet(200, {
          object: 'list',
          data: [
            { id: 'deepseek-chat', object: 'model' },
            { id: 'deepseek-reasoner', object: 'model' }
          ]
        });

        const result = await fetchModelsFromProvider('deepseek', 'sk-ds-test');
        expect(result).toEqual([
          { id: 'deepseek/deepseek-chat', name: 'deepseek-chat', contextLength: null, pricing: null },
          { id: 'deepseek/deepseek-reasoner', name: 'deepseek-reasoner', contextLength: null, pricing: null }
        ]);
      });

      it('returns [] on HTTP 401', async () => {
        mockHttpsGet(401, 'Unauthorized');
        const result = await fetchModelsFromProvider('deepseek', 'bad-key');
        expect(result).toEqual([]);
      });

      it('returns [] on network error', async () => {
        https.get.mockImplementation((_url, _opts, _cb) => {
          const req = {
            on: jest.fn((event, cb) => {
              if (event === 'error') { cb(new Error('ECONNREFUSED')); }
            }),
            destroy: jest.fn()
          };
          return req;
        });

        const result = await fetchModelsFromProvider('deepseek', 'sk-ds-test');
        expect(result).toEqual([]);
      });
    });

    describe('fetchModelsFromProvider anthropic (no https.get)', () => {
      it('returns ANTHROPIC_MODELS without calling https.get', async () => {
        const result = await fetchModelsFromProvider('anthropic', '');
        expect(result).toEqual(ANTHROPIC_MODELS);
        expect(https.get).not.toHaveBeenCalled();
      });
    });

    describe('fetchAllModels with deepseek key', () => {
      it('includes deepseek/deepseek-chat in results', async () => {
        mockHttpsGet(200, {
          object: 'list',
          data: [{ id: 'deepseek-chat', object: 'model' }]
        });

        const result = await fetchAllModels({ deepseek: 'sk-ds-test' });
        expect(result.some(m => m.id === 'deepseek/deepseek-chat')).toBe(true);
      });
    });
  });
});

const { listCuratedRoutes, toDefaultAliases } = require('../src/utils/curated-models');

describe('curated-models deepseek routes', () => {
  test('deepseek CARD has a direct deepseek route', () => {
    const routes = listCuratedRoutes();
    const direct = routes.find(r => r.alias === 'deepseek' && r.provider === 'deepseek');
    expect(direct).toBeDefined();
    expect(direct.model).toBe('deepseek/deepseek-chat');
  });

  test('toDefaultAliases deepseek still prefers openrouter route', () => {
    const aliases = toDefaultAliases();
    expect(aliases.deepseek).toMatch(/^openrouter\//);
  });
});
