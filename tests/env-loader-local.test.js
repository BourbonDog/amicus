'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

// M6: do NOT set HOME/USERPROFILE. Jest reuses one OS process per worker across test
// FILES, so an unrestored HOME leaks into whichever suite runs next in that worker.
// getConfigDir() (config.js:23-34) and getEnvPath() (api-key-store.js:16-27) both check
// their own override FIRST — that is the mechanism the rest of the suite uses.
describe('loadCredentials: local bearer projection', () => {
  const orig = { cfg: process.env.AMICUS_CONFIG_DIR, env: process.env.AMICUS_ENV_DIR, lab: process.env.LAB_API_KEY };
  let dir;

  afterEach(() => {
    jest.resetModules();
    for (const [k, v] of [['AMICUS_CONFIG_DIR', orig.cfg], ['AMICUS_ENV_DIR', orig.env], ['LAB_API_KEY', orig.lab]]) {
      if (v === undefined) { delete process.env[k]; } else { process.env[k] = v; }
    }
    if (dir) { fs.rmSync(dir, { recursive: true, force: true }); dir = undefined; }
  });

  test('projects a configured apiKeyEnv from .env into process.env (never overwrites)', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-'));
    process.env.AMICUS_CONFIG_DIR = dir;
    process.env.AMICUS_ENV_DIR = dir;
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      providers: { lab: { type: 'openai-compatible', baseURL: 'https://x/v1', apiKeyEnv: 'LAB_API_KEY' } },
    }));
    fs.writeFileSync(path.join(dir, '.env'), 'LAB_API_KEY=from-env-file\n');
    delete process.env.LAB_API_KEY;
    jest.resetModules();
    require('../src/utils/env-loader').loadCredentials();
    expect(process.env.LAB_API_KEY).toBe('from-env-file');
  });

  test('does NOT overwrite an existing process.env value with the .env file value', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-'));
    process.env.AMICUS_CONFIG_DIR = dir;
    process.env.AMICUS_ENV_DIR = dir;
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      providers: { lab: { type: 'openai-compatible', baseURL: 'https://x/v1', apiKeyEnv: 'LAB_API_KEY' } },
    }));
    fs.writeFileSync(path.join(dir, '.env'), 'LAB_API_KEY=from-env-file\n');
    process.env.LAB_API_KEY = 'already-set-in-process-env';
    jest.resetModules();
    require('../src/utils/env-loader').loadCredentials();
    expect(process.env.LAB_API_KEY).toBe('already-set-in-process-env');
  });
});
