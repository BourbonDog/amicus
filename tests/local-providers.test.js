'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

// Point config at a temp dir so loadConfig() reads our fixture.
function withConfig(providers, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  const cfgDir = path.join(dir, '.config', 'amicus');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({ default: 'x', providers }));
  jest.resetModules();
  try { return fn(require('../src/utils/local-providers')); }
  finally { process.env.HOME = prev.HOME; process.env.USERPROFILE = prev.USERPROFILE; }
}

describe('local-providers', () => {
  test('deriveKeyEnv: id → SHOUT_SNAKE + _API_KEY', () => {
    const { deriveKeyEnv } = require('../src/utils/local-providers');
    expect(deriveKeyEnv('vllm-lab')).toBe('VLLM_LAB_API_KEY');
    expect(deriveKeyEnv('ollama')).toBe('OLLAMA_API_KEY');
    expect(deriveKeyEnv('my.lab')).toBe('MY_LAB_API_KEY');
  });

  test('validateProviderEntry: accepts a minimal valid entry and defaults flavor/pricing', () => {
    const { validateProviderEntry } = require('../src/utils/local-providers');
    const r = validateProviderEntry({ type: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1' });
    expect(r.ok).toBe(true);
    expect(r.normalized.flavor).toBe('generic');
    expect(r.normalized.pricing).toEqual({ prompt: 0, completion: 0 });
  });

  test('validateProviderEntry: rejects non-http scheme, unknown type, bad flavor, negative pricing', () => {
    const { validateProviderEntry } = require('../src/utils/local-providers');
    expect(validateProviderEntry({ type: 'openai-compatible', baseURL: 'file:///etc/passwd' }).ok).toBe(false);
    expect(validateProviderEntry({ type: 'aws', baseURL: 'http://127.0.0.1/v1' }).ok).toBe(false);
    expect(validateProviderEntry({ type: 'openai-compatible', baseURL: 'http://x/v1', flavor: 'nope' }).ok).toBe(false);
    expect(validateProviderEntry({ type: 'openai-compatible', baseURL: 'http://x/v1', pricing: { prompt: -1, completion: 0 } }).ok).toBe(false);
  });

  test('validateProviderEntry: rejects a non-object entry (e.g. config typo { ollama: "oops" })', () => {
    const { validateProviderEntry } = require('../src/utils/local-providers');
    const r = validateProviderEntry('oops');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('entry must be an object');
  });

  test('getLocalProviders: normalizes valid entries, skips invalid ones (never throws), rejects reserved ids', () => {
    const warn = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const map = withConfig({
      ollama: { type: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' },
      lmstudio: { type: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1', flavor: 'lmstudio' },
      openai: { type: 'openai-compatible', baseURL: 'http://127.0.0.1:9/v1' },   // reserved → skipped
      bad: { type: 'openai-compatible', baseURL: 'ftp://nope' },                  // bad scheme → skipped
      'BAD ID': { type: 'openai-compatible', baseURL: 'http://x/v1' }             // bad id → skipped
    }, (m) => m.getLocalProviders());
    // Prove it's the right three entries that warned — not just that something did.
    expect(warn).toHaveBeenCalledTimes(3);
    const warnings = warn.mock.calls.map((call) => call[0]).join('\n');
    expect(warnings).toContain("'openai'");
    expect(warnings).toContain("'bad'");
    expect(warnings).toContain("'BAD ID'");
    expect(Object.keys(map).sort()).toEqual(['lmstudio', 'ollama']);
    expect(map.ollama.id).toBe('ollama');
    expect(map.lmstudio.flavor).toBe('lmstudio');
    warn.mockRestore();
  });

  test('getLocalProviders: absent providers key → {} (byte-identical to today)', () => {
    const map = withConfig(undefined, (m) => m.getLocalProviders());
    expect(map).toEqual({});
  });

  test('isLocalProvider reflects the configured map', () => {
    const yes = withConfig({ ollama: { type: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1' } },
      (m) => m.isLocalProvider('ollama'));
    expect(yes).toBe(true);
    const no = withConfig({}, (m) => m.isLocalProvider('ollama'));
    expect(no).toBe(false);
  });
});
