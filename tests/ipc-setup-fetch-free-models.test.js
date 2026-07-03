'use strict';

// Capture handlers registered on ipcMain (F2e virtual-mock pattern, mirrors
// ipc-setup-save-config.test.js).
const handlers = {};
jest.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
  BrowserWindow: { fromWebContents: jest.fn() },
}), { virtual: true });

const CATALOG = [
  { id: 'openrouter/deepseek/deepseek-r1:free', name: 'DeepSeek R1 (free)', pricing: { prompt: '0', completion: '0' } },
  { id: 'openrouter/google/gemini-2.0-flash-exp:free', name: 'Gemini Flash (free)', pricing: { prompt: '0', completion: '0' } },
  { id: 'openrouter/qwen/qwen3-coder:free', name: 'Qwen Coder (free)', pricing: null },
  { id: 'openrouter/anthropic/claude-opus-4.8', name: 'Claude Opus', pricing: { prompt: '0.000015', completion: '0.000075' } },
];

jest.mock('../src/utils/model-catalog', () => ({
  getCatalog: jest.fn(async () => CATALOG),
}));

const { registerSetupHandlers } = require('../electron/ipc-setup');

beforeAll(() => { registerSetupHandlers(() => null); });

const fetchFree = () => handlers['sidecar:fetch-free-models']({});

describe('sidecar:fetch-free-models (display-data passthrough)', () => {
  test('returns id, suggested, name, and vendor for each free row (additive over the old {id,suggested} shape)', async () => {
    const rows = await fetchFree();
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(r => {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('suggested');
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('vendor');
    });
  });

  test('vendor is the id.split("/")[1] segment listFreeModels already sorts by', async () => {
    const rows = await fetchFree();
    const deepseek = rows.find(r => r.id === 'openrouter/deepseek/deepseek-r1:free');
    expect(deepseek.vendor).toBe('deepseek');
    const google = rows.find(r => r.id === 'openrouter/google/gemini-2.0-flash-exp:free');
    expect(google.vendor).toBe('google');
  });

  test('name is passed through from the catalog row', async () => {
    const rows = await fetchFree();
    const deepseek = rows.find(r => r.id === 'openrouter/deepseek/deepseek-r1:free');
    expect(deepseek.name).toBe('DeepSeek R1 (free)');
  });

  test('non-free rows are excluded (unchanged filtering behavior)', async () => {
    const rows = await fetchFree();
    expect(rows.find(r => r.id === 'openrouter/anthropic/claude-opus-4.8')).toBeUndefined();
  });

  test('marks the vendor-diverse suggested set (unchanged selection semantics)', async () => {
    const rows = await fetchFree();
    const suggestedCount = rows.filter(r => r.suggested).length;
    expect(suggestedCount).toBeGreaterThan(0);
    expect(suggestedCount).toBeLessThanOrEqual(3);
  });

  test('returns [] on catalog failure (unchanged error handling)', async () => {
    const { getCatalog } = require('../src/utils/model-catalog');
    getCatalog.mockRejectedValueOnce(new Error('offline'));
    const rows = await fetchFree();
    expect(rows).toEqual([]);
  });
});
