'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('resolveCouncilMembers: local vendors never dropped on catalog absence', () => {
  const origConfigDir = process.env.AMICUS_CONFIG_DIR;
  let tempDir;
  afterEach(() => {
    jest.resetModules();
    if (origConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = origConfigDir; }
    if (tempDir) { fs.rmSync(tempDir, { recursive: true, force: true }); tempDir = undefined; }
  });

  test('a member on a configured local vendor survives a non-empty catalog that omits it', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-local-'));
    process.env.AMICUS_CONFIG_DIR = tempDir;
    jest.resetModules();
    jest.doMock('../src/utils/local-providers', () => ({
      isLocalProvider: (id) => id === 'ollama',
      getLocalProviders: () => ({ ollama: { id: 'ollama' } }),
    }));
    const { saveConfig, resolveCouncilMembers } = require('../src/utils/config');
    // A council with one cloud + one local member; catalog lists only the cloud one.
    saveConfig({
      aliases: { gemini: 'google/gemini-2.5-flash' },
      councils: { mixed: ['gemini', 'ollama/llama3.3'] },
    });
    const catalog = [{ id: 'google/gemini-2.5-flash' }];
    const r = resolveCouncilMembers('mixed', catalog);
    expect(r.error).toBeUndefined();
    expect(r.models).toContain('ollama/llama3.3');
    expect(r.dropped).not.toContain('ollama/llama3.3');
  });

  // Bite-test: the local bypass must not swallow the delisted-drop check for
  // everyone else. A member on a vendor NOT in getLocalProviders() (and not
  // in the catalog) must still be dropped, in the SAME resolution as a
  // surviving local member — proving the two code paths are independent
  // (e.g. an overly-broad isLocalProvider check, or a bug that treats "not
  // found in catalog" as "must be local", would make this test fail).
  test('a genuinely-unknown non-local member is still dropped, alongside a surviving local member', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-local-'));
    process.env.AMICUS_CONFIG_DIR = tempDir;
    jest.resetModules();
    jest.doMock('../src/utils/local-providers', () => ({
      isLocalProvider: (id) => id === 'ollama',
      getLocalProviders: () => ({ ollama: { id: 'ollama' } }),
    }));
    const { saveConfig, resolveCouncilMembers } = require('../src/utils/config');
    saveConfig({
      aliases: { gemini: 'google/gemini-2.5-flash' },
      councils: { mixed3: ['gemini', 'ollama/llama3.3', 'ghostvendor/nope'] },
    });
    const catalog = [{ id: 'google/gemini-2.5-flash' }];
    const r = resolveCouncilMembers('mixed3', catalog);
    expect(r.error).toBeUndefined();
    expect(r.models).toEqual(['gemini', 'ollama/llama3.3']);
    expect(r.dropped).toEqual(['ghostvendor/nope']);
  });
});
