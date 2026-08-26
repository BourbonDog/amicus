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
 * Named mutants **SKEWBLIND** (the comparison never fires — the mismatch branch
 * in `noteSessionVersion` returns null instead of recording + announcing),
 * **STICKYSKEW** (one process-wide slot, written once, never retracted) and
 * **DOCTORREMEDY** (the notice points at `amicus doctor` again). Measured red
 * sets recorded at the foot of this file.
 *
 * No fixture here is a real log line or a real machine path.
 */

const {
  noteSessionVersion,
  currentEngineSkew,
  serverKeyForClient,
  UNKNOWN_SERVER_KEY,
  formatSkewWarning,
  formatSkewSuffix,
  installedEngineVersion,
  defaultReadInstalledEngineVersion,
  _resetEngineSkew,
} = require('../../src/utils/engine-skew');

/**
 * A stand-in for the SDK client, carrying only what the identity read touches.
 *
 * MEASURED 2026-08-25 against the real SDK (`createOpencodeClient({ baseUrl })`
 * from `@opencode-ai/sdk`, this checkout's copy): the returned object's keys are
 * `_client` plus the resource namespaces (`session`, `app`, `config`, …), and
 * `client._client.getConfig()` answers `{bodySerializer, headers, parseAs,
 * querySerializer, baseUrl, fetch}` with `baseUrl` the exact string passed in.
 * With no `baseUrl` in the config, `getConfig().baseUrl` is `undefined` — which
 * is why "no identity" is a real case and not a defensive invention. In
 * production `src/opencode-client.js :: startServer` always builds the client
 * from `sdkServer.url`, so a per-server port is what this key carries.
 */
const clientAt = (baseUrl) => ({ _client: { getConfig: () => ({ baseUrl }) } });

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
    expect(notify).toHaveBeenCalledWith(formatSkewWarning({ server: '1.17.3', installed: '1.18.15' }));
  });

  test('ONCE PER STANDING SKEW, not once per session: five more identical sessions announce nothing', () => {
    const notify = jest.fn();
    const deps = { readInstalledVersion: () => '1.18.15', notify };
    noteSessionVersion('1.17.3', deps);
    for (let i = 0; i < 5; i++) { noteSessionVersion('1.17.3', deps); }
    expect(notify).toHaveBeenCalledTimes(1);
    expect(currentEngineSkew()).toEqual({ server: '1.17.3', installed: '1.18.15' });
  });

  test('a DIFFERENT skew on the same server replaces the record and is announced', () => {
    // W10 round-1 review B3: the record used to be write-once, so the first
    // observation stood for the life of the process even after the server it
    // described was replaced by one at another version. A new observation about
    // the same server is newer truth, not noise.
    const notify = jest.fn();
    noteSessionVersion('1.17.3', { readInstalledVersion: () => '1.18.15', notify });
    const second = noteSessionVersion('0.9.0', { readInstalledVersion: () => '1.18.15', notify });
    expect(second).toEqual({ server: '0.9.0', installed: '1.18.15' });
    expect(currentEngineSkew()).toEqual({ server: '0.9.0', installed: '1.18.15' });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  test('a non-skewed session BEFORE a skewed one does not suppress the later announcement', () => {
    const notify = jest.fn();
    const deps = { readInstalledVersion: () => '1.18.15', notify };
    noteSessionVersion('1.18.15', deps);
    expect(notify).not.toHaveBeenCalled();
    noteSessionVersion('1.17.3', deps);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  /**
   * W10 round-1 review A3+B3. A skew observed once used to be stamped on every
   * later failure in the process — including failures of a DIFFERENT server, and
   * including failures after the skew was fixed mid-run. The record is now the
   * LAST observation for THAT server, and a matching session retracts it.
   */
  test('a version MATCH clears the standing skew — a mid-process fix is not reported forever', () => {
    const notify = jest.fn();
    const deps = { readInstalledVersion: () => '1.18.15', notify };
    noteSessionVersion('1.17.3', deps);
    expect(currentEngineSkew()).toEqual({ server: '1.17.3', installed: '1.18.15' });

    expect(noteSessionVersion('1.18.15', deps)).toBeNull(); // the operator upgraded the server
    expect(currentEngineSkew()).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1); // the retraction is silent, not a second notice
  });

  test('a skew is recorded PER SERVER — another server\'s failure never wears it', () => {
    const notify = jest.fn();
    const skewed = clientAt('http://127.0.0.1:4096');
    const healthy = clientAt('http://127.0.0.1:4097');
    noteSessionVersion('1.17.3', { readInstalledVersion: () => '1.18.15', notify, client: skewed });

    expect(currentEngineSkew(skewed)).toEqual({ server: '1.17.3', installed: '1.18.15' });
    expect(currentEngineSkew(healthy)).toBeNull();
    expect(currentEngineSkew()).toBeNull(); // no identity ⇒ no borrowed record
  });

  test('two skewed servers keep two records, and both are announced', () => {
    const notify = jest.fn();
    const a = clientAt('http://127.0.0.1:4096');
    const b = clientAt('http://127.0.0.1:4097');
    noteSessionVersion('1.17.3', { readInstalledVersion: () => '1.18.15', notify, client: a });
    noteSessionVersion('0.9.0', { readInstalledVersion: () => '1.18.15', notify, client: b });

    expect(currentEngineSkew(a)).toEqual({ server: '1.17.3', installed: '1.18.15' });
    expect(currentEngineSkew(b)).toEqual({ server: '0.9.0', installed: '1.18.15' });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  test('clearing one server\'s skew leaves another server\'s standing', () => {
    const notify = jest.fn();
    const a = clientAt('http://127.0.0.1:4096');
    const b = clientAt('http://127.0.0.1:4097');
    const deps = { readInstalledVersion: () => '1.18.15', notify };
    noteSessionVersion('1.17.3', { ...deps, client: a });
    noteSessionVersion('0.9.0', { ...deps, client: b });

    noteSessionVersion('1.18.15', { ...deps, client: a }); // a was fixed
    expect(currentEngineSkew(a)).toBeNull();
    expect(currentEngineSkew(b)).toEqual({ server: '0.9.0', installed: '1.18.15' });
  });
});

/**
 * The server identity, measured rather than assumed — see `clientAt` above for
 * the real SDK shape this mirrors. The base URL is the smallest honest key: it
 * is what `createSession` can see without a round trip, and in production every
 * client is built from one spawned server's own `sdkServer.url`.
 */
describe('serverKeyForClient: the smallest honest identity', () => {
  test('the client\'s base URL, normalized to its origin', () => {
    expect(serverKeyForClient(clientAt('http://127.0.0.1:4096'))).toBe('http://127.0.0.1:4096');
    expect(serverKeyForClient(clientAt('http://127.0.0.1:4096/'))).toBe('http://127.0.0.1:4096');
    expect(serverKeyForClient(clientAt('http://127.0.0.1:4097'))).not
      .toBe(serverKeyForClient(clientAt('http://127.0.0.1:4096')));
  });

  test.each([
    ['no client at all', undefined],
    ['a client with no internal transport', {}],
    ['a config with no baseUrl (measured: the SDK omits it when none was passed)',
      clientAt(undefined)],
    ['a getConfig that throws', { _client: { getConfig: () => { throw new Error('nope'); } } }],
    ['a non-URL baseUrl', clientAt('   ')],
  ])('%s falls back to the UNKNOWN key, never to a throw', (_label, client) => {
    expect(serverKeyForClient(client)).toBe(UNKNOWN_SERVER_KEY);
  });

  test('an unparseable but non-empty baseUrl is used verbatim rather than discarded', () => {
    expect(serverKeyForClient(clientAt('not-a-url'))).toBe('not-a-url');
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
  /**
   * W10 round-1 review B1: the notice used to end "see amicus doctor", and
   * doctor is STRUCTURALLY unable to see this skew — `doctor-engine-check.js`
   * compares npx-cache copies against the GLOBAL install and says nothing about
   * the copy the running server loaded (this module's own docblock records the
   * measurement: that baseline reports clean at 1.18.15/1.18.15 while the
   * running checkout loads 1.2.20). Sending a user there is a dead end at the
   * exact moment they need an answer, so the notice now names the real remedy.
   */
  test('formatSkewWarning names both versions AND an action that can actually fix it', () => {
    const msg = formatSkewWarning({ server: '1.17.3', installed: '1.18.15' });
    expect(msg).toBe(
      'engine version skew: server 1.17.3 ≠ installed 1.18.15 — MCP and CLI may be running '
      + 'different engines; update whichever copy is behind (`npm i -g amicus`, or re-run the '
      + 'failing surface\'s installer). `amicus doctor` cannot see this skew: its baseline '
      + 'compares npx against global, not the server actually answering.');
    expect(msg.split('\n')).toHaveLength(1); // one line — it rides on stderr as a notice
  });

  test('formatSkewWarning does NOT send the user to doctor for this class', () => {
    const msg = formatSkewWarning({ server: '1.17.3', installed: '1.18.15' });
    expect(msg).not.toMatch(/see amicus doctor/);
    expect(msg).not.toMatch(/run `?amicus doctor/);
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
 * MUTANT RED SETS (MEASURED, not argued from where the code sits).
 *
 * Focused bench: engine-skew · no-output-backstop-wiring · no-output-backstop ·
 * opencode-client · engine-log · sidecar/models-probe · sidecar/models-command ·
 * council/run-retry · headless — 9 suites, **402 passed / 2 skipped at HEAD**
 * (re-measured 2026-08-26; it read 379/2 before the round-1 review tests landed
 * in this suite, the wiring suite and engine-log).
 *
 * **SKEWBLIND** (re-run 2026-08-26; the earlier record read 8) —
 * `noteSessionVersion`'s mismatch branch returns null instead of recording the
 * skew and announcing it (the comparison never fires):
 *   **2 suites / 13 tests red.**
 *   tests/utils/engine-skew.test.js (9):
 *     · a differing server version is recorded and announced once
 *     · ONCE PER STANDING SKEW, not once per session
 *     · a DIFFERENT skew on the same server replaces the record and is announced
 *     · a non-skewed session BEFORE a skewed one does not suppress the later announcement
 *     · a version MATCH clears the standing skew
 *     · a skew is recorded PER SERVER
 *     · two skewed servers keep two records, and both are announced
 *     · clearing one server's skew leaves another server's standing
 *     · a notifier that THROWS cannot become the failure it reports on
 *   tests/no-output-backstop-wiring.test.js (4):
 *     · the #133 composite: the engine's line AND the two engine versions
 *     · a skew is reported even when the log read finds nothing
 *     · pre-send firing site: the skew clause reaches the site that dies upstream
 *     · THIS leg's own server's skew still reaches the report
 *
 * **STICKYSKEW** (round-1 review A3+B3; measured 2026-08-26 on the three suites
 * that can observe the record — engine-skew · no-output-backstop-wiring ·
 * opencode-client) — the records degrade to ONE process-wide slot, written once
 * and never retracted, which is exactly the pre-review behaviour:
 *   **2 suites / 7 tests red.**
 *   tests/utils/engine-skew.test.js (5):
 *     · a DIFFERENT skew on the same server replaces the record and is announced
 *     · a version MATCH clears the standing skew
 *     · a skew is recorded PER SERVER
 *     · two skewed servers keep two records, and both are announced
 *     · clearing one server's skew leaves another server's standing
 *   tests/no-output-backstop-wiring.test.js (2):
 *     · a skew observed on ANOTHER server is not stamped on this leg
 *     · a skew RETRACTED by a later matching session is not reported
 *
 * **DOCTORREMEDY** (round-1 review B1; measured 2026-08-26) — the notice reverts
 * to "… ; see amicus doctor":
 *   **1 suite / 2 tests red**, both here — "formatSkewWarning names both
 *   versions AND an action that can actually fix it" and "formatSkewWarning does
 *   NOT send the user to doctor for this class".
 *
 * NOT in any of these red sets, deliberately: tests/opencode-client.test.js. It
 * `jest.mock`s this module, so it pins the CAPTURE wiring only and is
 * structurally unable to see a comparison change. Its own red evidence is the
 * pre-implementation run — 3 of its 5 original tests failed with
 * "Number of calls: 0" before `createSession` forwarded the version, and 4 of
 * its 6 failed on the arguments before it forwarded the client too.
 */
