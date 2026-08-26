'use strict';

/**
 * v4.9 W10 Task B (#133 piece 3) — runtime engine version-SKEW detection.
 *
 * #133's outage was one version of the opencode engine (npx cache, 1.17.3)
 * serving MCP while another (global install, 1.18.15) served the CLI, both
 * writing one shared SQLite file. `doctor` printed zero errors throughout,
 * because its skew check compares npx copies against the GLOBAL install and
 * says nothing about the copy the RUNNING process actually loaded. This module
 * closes that: the server tells us its own version on every session create, and
 * we compare it against the engine sitting in this install's node_modules.
 *
 * MEASURED (2026-08-25, against a real locally-spawned engine — not reasoned
 * from types): `client.session.create({})` returns
 * `data = {directory,id,projectID,slug,time,title,version}` with
 * `version === "1.2.20"`, which is EXACTLY the version in this checkout's
 * `node_modules/opencode-ai/package.json`. So `Session.version` is the engine's
 * own version and the two sides are directly comparable. The same run measured
 * `data.id` starting with `ses_` and NO nested `data.session` object.
 *
 * Named mutant **SKEWBLIND** — the comparison never fires (the mismatch branch
 * in `noteSessionVersion` returns null instead of recording + announcing).
 * Measured red set recorded at the foot of this file.
 *
 * No fixture here is a real log line or a real machine path.
 */

const {
  noteSessionVersion,
  currentEngineSkew,
  formatSkewWarning,
  formatSkewSuffix,
  installedEngineVersion,
  defaultReadInstalledEngineVersion,
  _resetEngineSkew,
} = require('../../src/utils/engine-skew');

/** A fake fs whose readFileSync answers from a plain path->content map. */
function fakeFs(files, counter) {
  return {
    readFileSync: (p) => {
      if (counter) { counter.reads += 1; }
      const key = String(p).replace(/\\/g, '/');
      if (!(key in files)) {
        const err = new Error(`ENOENT: ${key}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files[key];
    },
  };
}

const pkg = (version) => JSON.stringify({ name: 'opencode-ai', version });

beforeEach(() => { _resetEngineSkew(); });
afterEach(() => { _resetEngineSkew(); });

describe('noteSessionVersion: the comparison', () => {
  test('server version equal to the installed engine is silent and records no skew', () => {
    const notify = jest.fn();
    const out = noteSessionVersion('1.18.15', { readInstalledVersion: () => '1.18.15', notify });
    expect(out).toBeNull();
    expect(currentEngineSkew()).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  test('a differing server version is recorded and announced once', () => {
    const notify = jest.fn();
    const out = noteSessionVersion('1.17.3', { readInstalledVersion: () => '1.18.15', notify });
    expect(out).toEqual({ server: '1.17.3', installed: '1.18.15' });
    expect(currentEngineSkew()).toEqual({ server: '1.17.3', installed: '1.18.15' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'engine version skew: server 1.17.3 ≠ installed 1.18.15 — '
      + 'MCP and CLI may be running different engines; see amicus doctor');
  });

  test('ONCE PER PROCESS, not once per session: five more skewed sessions announce nothing', () => {
    const notify = jest.fn();
    const deps = { readInstalledVersion: () => '1.18.15', notify };
    noteSessionVersion('1.17.3', deps);
    for (let i = 0; i < 5; i++) { noteSessionVersion('1.17.3', deps); }
    expect(notify).toHaveBeenCalledTimes(1);
    expect(currentEngineSkew()).toEqual({ server: '1.17.3', installed: '1.18.15' });
  });

  test('a SECOND, different skew does not re-announce — the first standing report wins', () => {
    const notify = jest.fn();
    noteSessionVersion('1.17.3', { readInstalledVersion: () => '1.18.15', notify });
    const second = noteSessionVersion('0.9.0', { readInstalledVersion: () => '1.18.15', notify });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ server: '1.17.3', installed: '1.18.15' });
  });

  test('a non-skewed session BEFORE a skewed one does not suppress the later announcement', () => {
    const notify = jest.fn();
    const deps = { readInstalledVersion: () => '1.18.15', notify };
    noteSessionVersion('1.18.15', deps);
    expect(notify).not.toHaveBeenCalled();
    noteSessionVersion('1.17.3', deps);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe('noteSessionVersion: every silent path', () => {
  test.each([
    ['undefined (older SDK: no version field on the response)', undefined],
    ['null', null],
    ['empty string', ''],
    ['a non-string', 3],
  ])('a server version that is %s is silent', (_label, value) => {
    const notify = jest.fn();
    expect(noteSessionVersion(value, { readInstalledVersion: () => '1.18.15', notify })).toBeNull();
    expect(currentEngineSkew()).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  test('an unreadable installed version is silent — absence of evidence is not evidence of skew', () => {
    const notify = jest.fn();
    expect(noteSessionVersion('1.17.3', { readInstalledVersion: () => undefined, notify })).toBeNull();
    expect(currentEngineSkew()).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  test('an installed-version reader that THROWS is silent, not fatal', () => {
    const notify = jest.fn();
    const boom = () => { throw new Error('node_modules is gone'); };
    expect(noteSessionVersion('1.17.3', { readInstalledVersion: boom, notify })).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  test('a notifier that THROWS cannot become the failure it reports on', () => {
    const boom = () => { throw new Error('stderr is closed'); };
    expect(() => noteSessionVersion('1.17.3', { readInstalledVersion: () => '1.18.15', notify: boom }))
      .not.toThrow();
    // The skew is still on the record even though announcing it failed.
    expect(currentEngineSkew()).toEqual({ server: '1.17.3', installed: '1.18.15' });
  });
});

describe('installedEngineVersion: the RUNNING install, read once', () => {
  test('reads opencode-ai/package.json from the first root that has one', () => {
    const files = { '/a/node_modules/opencode-ai/package.json': pkg('1.18.15') };
    expect(defaultReadInstalledEngineVersion({ roots: ['/a/node_modules'], fs: fakeFs(files) }))
      .toBe('1.18.15');
  });

  test('skips a root with no package.json, malformed JSON, or no version field', () => {
    const files = {
      '/b/node_modules/opencode-ai/package.json': '{ not json',
      '/c/node_modules/opencode-ai/package.json': JSON.stringify({ name: 'opencode-ai' }),
      '/d/node_modules/opencode-ai/package.json': pkg('1.2.20'),
    };
    const roots = ['/a/node_modules', '/b/node_modules', '/c/node_modules', '/d/node_modules'];
    expect(defaultReadInstalledEngineVersion({ roots, fs: fakeFs(files) })).toBe('1.2.20');
  });

  test('returns undefined when no root carries the engine package', () => {
    expect(defaultReadInstalledEngineVersion({ roots: ['/a', '/b'], fs: fakeFs({}) })).toBeUndefined();
  });

  test('the read is memoized per process — six sessions cost one disk read', () => {
    const counter = { reads: 0 };
    const deps = {
      roots: ['/a/node_modules'],
      fs: fakeFs({ '/a/node_modules/opencode-ai/package.json': pkg('1.18.15') }, counter),
    };
    for (let i = 0; i < 6; i++) { expect(installedEngineVersion(deps)).toBe('1.18.15'); }
    expect(counter.reads).toBe(1);
  });

  test('the default roots are the RUNNING install\'s, via path-setup :: opencodeRoots', () => {
    // Not the global-install baseline `doctor` uses: measured 2026-08-25, that
    // baseline compares global (1.18.15) against npx (1.18.15) and is
    // structurally unable to see the running checkout's own 1.2.20.
    const { opencodeRoots } = require('../../src/utils/path-setup');
    const counter = { reads: 0 };
    const seen = [];
    const fs = { readFileSync: (p) => { seen.push(String(p)); counter.reads += 1; throw new Error('nope'); } };
    defaultReadInstalledEngineVersion({ fs });
    expect(seen.length).toBe(opencodeRoots().length);
    for (const root of opencodeRoots()) {
      expect(seen.some((p) => p.startsWith(root))).toBe(true);
    }
  });
});

describe('the two rendered strings', () => {
  test('formatSkewWarning names both versions and points at the one command that can show them', () => {
    expect(formatSkewWarning({ server: '1.17.3', installed: '1.18.15' })).toBe(
      'engine version skew: server 1.17.3 ≠ installed 1.18.15 — '
      + 'MCP and CLI may be running different engines; see amicus doctor');
  });

  test('formatSkewSuffix is EMPTY with no skew — so every enriched message stays byte-identical', () => {
    expect(formatSkewSuffix(null)).toBe('');
    expect(formatSkewSuffix(undefined)).toBe('');
  });

  test('formatSkewSuffix renders the parenthesised clause with a leading space', () => {
    expect(formatSkewSuffix({ server: '1.17.3', installed: '1.18.15' }))
      .toBe(' (engine skew: server 1.17.3 ≠ installed 1.18.15)');
  });
});

/**
 * MUTANT RED SET (MEASURED 2026-08-25, not argued from where the code sits).
 *
 * Focused bench: engine-skew · no-output-backstop-wiring · no-output-backstop ·
 * opencode-client · engine-log · sidecar/models-probe · sidecar/models-command ·
 * council/run-retry · headless — 9 suites, 379 passed / 2 skipped at HEAD.
 *
 * **SKEWBLIND** — `noteSessionVersion`'s mismatch branch returns null instead of
 * recording the skew and announcing it (the comparison never fires):
 *   **2 suites / 8 tests red.**
 *   tests/utils/engine-skew.test.js (5):
 *     · a differing server version is recorded and announced once
 *     · ONCE PER PROCESS, not once per session
 *     · a SECOND, different skew does not re-announce
 *     · a non-skewed session BEFORE a skewed one does not suppress the later announcement
 *     · a notifier that THROWS cannot become the failure it reports on
 *   tests/no-output-backstop-wiring.test.js (3):
 *     · the #133 composite: the engine's line AND the two engine versions
 *     · a skew is reported even when the log read finds nothing
 *     · pre-send firing site: the skew clause reaches the site that dies upstream
 *
 * NOT in the red set, deliberately: tests/opencode-client.test.js. It
 * `jest.mock`s this module, so it pins the CAPTURE wiring only and is
 * structurally unable to see a comparison change. Its own red evidence is the
 * pre-implementation run — 3 of its 5 new tests failed with
 * "Number of calls: 0" before `createSession` forwarded the version.
 */
