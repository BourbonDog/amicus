// tests/postinstall-hooks.test.js
'use strict';

/**
 * #35: hook setup is folded into the postinstall flow (replacing the removed
 * consumer-facing `prepare` lifecycle). For developers installing from a git
 * checkout this still wires core.hooksPath; for consumers (npm tarball /
 * github: clone with no .git checkout exported, or the published package)
 * setup-hooks exits 0, so it is a harmless no-op.
 *
 * These tests assert the wiring is present and non-fatal WITHOUT running a
 * real install: postinstall.main() must invoke an injectable setupHooks dep,
 * a throwing setupHooks must not break the install (#29 non-fatal guard still
 * holds), and the exported setupHooks must be guarded against throwing.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const postinstall = require('../scripts/postinstall');

describe('postinstall folds in dev hook-setup (#35)', () => {
  test('setupHooks is exported', () => {
    expect(typeof postinstall.setupHooks).toBe('function');
  });

  test('main() invokes the injected setupHooks dependency', async () => {
    const calls = [];
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await postinstall.main({
        installSkill: () => calls.push('skill'),
        installCouncilSkill: () => calls.push('council'),
        registerClaudeCode: () => calls.push('code'),
        registerClaudeDesktop: () => calls.push('desktop'),
        setupHooks: () => calls.push('hooks'),
        provisionElectron: () => {},
      });
    } finally {
      logSpy.mockRestore();
    }
    expect(calls).toContain('hooks');
  });

  test('a throwing setupHooks does not break the install (#29 non-fatal)', async () => {
    const exits = [];
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { exits.push(code); });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await postinstall.runCli({
        installSkill: () => {},
        installCouncilSkill: () => {},
        registerClaudeCode: () => {},
        registerClaudeDesktop: () => {},
        setupHooks: () => { throw new Error('boom: hook setup failed'); },
        provisionElectron: () => {},
      });
    } finally {
      exitSpy.mockRestore();
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
    // Must still exit 0 — hook setup is best-effort, never a rollback trigger.
    expect(exits).toEqual([0]);
  });

  test('default setupHooks is a no-op (exits 0) outside a git checkout', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-hooks-'));
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GIT_'))
    );
    const prevCwd = process.cwd();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      process.chdir(tmp);
      // Block git from walking up into the real repo above tmp.
      process.env.GIT_CEILING_DIRECTORIES = tmp;
      // Must not throw even though there is no git repo here.
      expect(() => postinstall.setupHooks({ env: cleanEnv })).not.toThrow();
    } finally {
      delete process.env.GIT_CEILING_DIRECTORIES;
      process.chdir(prevCwd);
      logSpy.mockRestore();
      warnSpy.mockRestore();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
