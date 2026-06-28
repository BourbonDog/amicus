// tests/free-council-readline.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('runFreeCouncilBranch', () => {
  let tempDir, originalEnv;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-council-rl-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    process.env.AMICUS_ENV_DIR = tempDir; // isolate .env lookups from real user config
    jest.resetModules();
    jest.doMock('../src/utils/model-catalog', () => ({
      getCatalog: jest.fn(async () => ([
        { id: 'openrouter/deepseek/deepseek-r1:free' },
        { id: 'openrouter/google/gemini-2.0-flash-exp:free' },
        { id: 'openrouter/qwen/qwen3-coder:free' },
      ])),
      refreshCatalog: jest.fn(async () => []),
    }));
  });
  afterEach(() => { process.env = originalEnv; fs.rmSync(tempDir, { recursive: true, force: true }); jest.dontMock('../src/utils/model-catalog'); });

  function fakeRl(answers) {
    let i = 0;
    return { question: (_q, cb) => cb(answers[i++]), close: () => {} };
  }

  it('with OPENROUTER_API_KEY, default selection seeds councils.free and leaves default untouched', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const { runFreeCouncilBranch } = require('../src/sidecar/setup');
    const { loadConfig } = require('../src/utils/config');
    await runFreeCouncilBranch(fakeRl([''])); // Enter = accept diverse default
    const cfg = loadConfig();
    expect(cfg.councils.free.length).toBeGreaterThanOrEqual(2);
    expect(cfg.default).toBeUndefined();
  });

  it('aborts with no writes when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { runFreeCouncilBranch } = require('../src/sidecar/setup');
    const { loadConfig } = require('../src/utils/config');
    await runFreeCouncilBranch(fakeRl(['']));
    expect(loadConfig()).toBeNull();
  });
});
