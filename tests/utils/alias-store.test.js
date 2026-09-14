// tests/utils/alias-store.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('alias-store (#238 — the non-set write sinks)', () => {
  let cfg, store;
  beforeEach(() => {
    jest.resetModules();
    process.env.AMICUS_CONFIG_DIR = path.join(os.tmpdir(), `amicus-alias-store-${process.pid}-${Date.now()}`);
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cfg = require('../../src/utils/config');
    store = require('../../src/utils/alias-store');
  });
  afterEach(() => {
    process.stderr.write.mockRestore();
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
  });
  const disk = () => JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));

  test('removeAlias deletes the key, preserves everything else, returns true', () => {
    cfg.saveConfig({ default: 'gemini', aliases: { glm: 'openrouter/z-ai/glm-5.4', mine: 'openrouter/a/b-1' }, routing: { prefer: 'direct' } });
    expect(store.removeAlias('glm')).toBe(true);
    expect(disk()).toEqual({ default: 'gemini', aliases: { mine: 'openrouter/a/b-1' }, routing: { prefer: 'direct' } });
  });
  test('removeAlias is a no-write when the key is absent or there is no config', () => {
    expect(store.removeAlias('glm')).toBe(false);
    expect(fs.existsSync(cfg.getConfigPath())).toBe(false);
    cfg.saveConfig({ aliases: { mine: 'openrouter/a/b-1' } });
    const mtime = fs.statSync(cfg.getConfigPath()).mtimeMs;
    expect(store.removeAlias('glm')).toBe(false);
    expect(fs.statSync(cfg.getConfigPath()).mtimeMs).toBe(mtime);
  });
  test('removeAlias validates the name like addAlias', () => {
    expect(() => store.removeAlias('')).toThrow(/Invalid alias name/);
    expect(() => store.removeAlias('null')).toThrow(/Invalid alias name/);
    expect(() => store.removeAlias(42)).toThrow(/Invalid alias name/);
  });
  test('recordDismissal writes alias@id -> ISO date under aliasReview.dismissed and keeps siblings', () => {
    cfg.saveConfig({ aliases: {}, aliasReview: { autoRefresh: false } });
    store.recordDismissal('glm@openrouter/z-ai/glm-5.4', new Date('2026-09-14T00:00:00Z'));
    expect(disk().aliasReview).toEqual({ autoRefresh: false, dismissed: { 'glm@openrouter/z-ai/glm-5.4': '2026-09-14T00:00:00.000Z' } });
    expect(store.readDismissals()).toEqual({ 'glm@openrouter/z-ai/glm-5.4': '2026-09-14T00:00:00.000Z' });
  });
  test('readDismissals is {} with no config and is null-prototype', () => {
    const d = store.readDismissals();
    expect(d).toEqual({});
    expect(Object.getPrototypeOf(d)).toBeNull();
  });
  test('recordDismissal rejects a key without @', () => {
    expect(() => store.recordDismissal('glm')).toThrow(/dismissKey/);
  });
});
