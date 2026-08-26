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
 * SERVER IDENTITY AND THE RECORD STORE MOVED (round 2) to
 * src/utils/engine-skew-records.js, re-exported from engine-skew.js — see the
 * extraction pin below. This suite still drives everything through the parent,
 * because the rules under test are about the comparison, not the map.
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
  MAX_SKEW_SERVERS,
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

/**
 * The extraction pin (W10 round 2). Server identity and the bounded record
 * store moved to `src/utils/engine-skew-records.js` when this module hit the
 * 300-line gate; `engine-skew.js` re-exports the public half so callers keep
 * one import site. These are the SAME objects, not a second copy.
 */
describe('the extraction to engine-skew-records.js is a move, not a copy', () => {
  const records = require('../../src/utils/engine-skew-records');
  const skew = require('../../src/utils/engine-skew');

  test.each([
    ['serverKeyForClient'], ['currentEngineSkew'], ['UNKNOWN_SERVER_KEY'], ['MAX_SKEW_SERVERS'],
  ])('engine-skew.%s is engine-skew-records\' own value', (name) => {
    expect(records[name]).toBeDefined();
    expect(skew[name]).toBe(records[name]);
  });

  test('one store, not two: a record written through the parent is visible in the child', () => {
    const a = clientAt('http://127.0.0.1:4096');
    noteSessionVersion('1.17.3', { readInstalledVersion: () => '1.18.15', notify: () => {}, client: a });
    expect(records.currentEngineSkew(a)).toEqual({ server: '1.17.3', installed: '1.18.15' });
  });
});

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
  test('the client\'s base URL, normalized to origin + path', () => {
    expect(serverKeyForClient(clientAt('http://127.0.0.1:4096'))).toBe('http://127.0.0.1:4096');
    expect(serverKeyForClient(clientAt('http://127.0.0.1:4096/'))).toBe('http://127.0.0.1:4096');
    expect(serverKeyForClient(clientAt('http://127.0.0.1:4097'))).not
      .toBe(serverKeyForClient(clientAt('http://127.0.0.1:4096')));
  });

  /**
   * W10 round-2 review A3. The key used to be `new URL(raw).origin`, which
   * DISCARDS the path — and, MEASURED 2026-08-26, collapses every opaque-origin
   * URL to the literal string `"null"`:
   *   new URL('unix:///tmp/a.sock').origin === 'null'
   *   new URL('unix:///tmp/b.sock').origin === 'null'
   * Two distinct servers sharing one record is the exact failure per-server
   * keying exists to prevent — a skew on one is stamped on the other's death
   * report, and a match on one RETRACTS the other's real skew. Keeping the path
   * costs one expression and closes the class.
   *
   * It is not reachable from amicus's own topology today: `startServer` is the
   * only production client builder and always passes one spawned server's
   * `http://127.0.0.1:<port>`, so distinct servers already get distinct ports.
   * The fix is for the external/shared-server case this module was written for
   * (see the SCOPE paragraph in the module docblock).
   */
  test('two servers behind ONE origin keep two identities', () => {
    expect(serverKeyForClient(clientAt('http://gw:8080/engine-a')))
      .not.toBe(serverKeyForClient(clientAt('http://gw:8080/engine-b')));
    expect(serverKeyForClient(clientAt('unix:///tmp/a.sock')))
      .not.toBe(serverKeyForClient(clientAt('unix:///tmp/b.sock')));
  });

  test('a path-keyed server\'s skew never rides out on its neighbour', () => {
    const notify = jest.fn();
    const a = clientAt('http://gw:8080/engine-a');
    const b = clientAt('http://gw:8080/engine-b');
    noteSessionVersion('1.17.3', { readInstalledVersion: () => '1.18.15', notify, client: a });
    expect(currentEngineSkew(a)).toEqual({ server: '1.17.3', installed: '1.18.15' });
    expect(currentEngineSkew(b)).toBeNull();
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

/**
 * W10 round-3 review C1(b) — THE SHAPE PIN, and the half that makes the notice
 * above a backstop rather than the only defence.
 *
 * Every other identity test on this page runs against `clientAt`, a hand-written
 * stand-in. A stand-in cannot notice that the real SDK stopped having the shape
 * it stands in for: rename `_client` upstream and every one of them stays green
 * while production quietly collapses to one process-wide bucket. This builds a
 * REAL client from the INSTALLED `@opencode-ai/sdk` and asserts the key comes
 * back as the base URL's origin + path — so an SDK shape change REDS in CI.
 *
 * VIA A CHILD PROCESS, deliberately: the SDK is ESM-only (`"type": "module"`,
 * `exports` with an `import` condition and no CJS main), and jest without
 * `--experimental-vm-modules` fails a dynamic `import()` with "A dynamic import
 * callback was invoked without --experimental-vm-modules" — MEASURED 2026-08-26,
 * which is why `src/opencode-client.js` reaches it through `await import()` at
 * runtime rather than a top-level require. One spawn, one assertion.
 */
describe('serverKeyForClient against a REAL SDK client (the shape pin)', () => {
  const { execFileSync } = require('child_process');
  const repoRoot = require('path').join(__dirname, '..', '..');

  test('the installed @opencode-ai/sdk still yields origin + path', () => {
    const script = [
      "const sdk = await import('@opencode-ai/sdk');",
      "const { createRequire } = await import('module');",
      "const req = createRequire(process.cwd() + '/probe.js');",
      "const { serverKeyForClient, UNKNOWN_SERVER_KEY } =",
      "  req('./src/utils/engine-skew-records.js');",
      "const client = sdk.createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096/engine-a' });",
      'console.log(JSON.stringify({',
      '  key: serverKeyForClient(client),',
      '  unknown: UNKNOWN_SERVER_KEY,',
      "  hasPrivateHandle: Object.prototype.hasOwnProperty.call(client, '_client'),",
      '}));',
    ].join('\n');

    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
      { cwd: repoRoot, encoding: 'utf-8', timeout: 60000 });
    const seen = JSON.parse(out.trim().split('\n').pop());

    expect(seen.hasPrivateHandle).toBe(true);
    expect(seen.key).toBe('http://127.0.0.1:4096/engine-a');
    expect(seen.key).not.toBe(seen.unknown);
  }, 60000);
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

/**
 * W10 round-2 review B3 — the half that was REFUTED, pinned so it stays that
 * way. The finding is right that the docblock's old claim ("a coarser
 * attribution, never a wrong retraction") was false in both halves: under the
 * shared UNKNOWN bucket a record can be attributed to the wrong server AND
 * retracted by the wrong one. The proposed hardening — never retract under
 * UNKNOWN — was measured against the property it was meant to protect, over the
 * sequence "A skewed, B healthy, A fixed, A regresses":
 *   retract       → B dies clean; A-after-fix dies clean; A's regression is
 *                   re-recorded on its very next create
 *   never retract → B wears A's skew; A wears its own stale skew after the fix;
 *                   nothing can ever clear either
 * Retraction's error is transient (this runs on EVERY create, so a wrongly
 * cleared skew comes back); no-retraction's error is a permanent wrong
 * attribution. Retraction stays.
 */
describe('the UNKNOWN bucket retracts too — the recoverable error', () => {
  test('a matching version DOES retract a skew recorded under the UNKNOWN key', () => {
    const notify = jest.fn();
    const deps = { readInstalledVersion: () => '1.18.15', notify };
    noteSessionVersion('1.17.3', deps); // no client ⇒ the UNKNOWN bucket
    expect(currentEngineSkew()).toEqual({ server: '1.17.3', installed: '1.18.15' });

    expect(noteSessionVersion('1.18.15', deps)).toBeNull();
    expect(currentEngineSkew()).toBeNull();
  });

  test('and a skew wrongly cleared there comes straight back on the next create', () => {
    // This is what makes retraction the recoverable error rather than a loss.
    const notify = jest.fn();
    const deps = { readInstalledVersion: () => '1.18.15', notify };
    noteSessionVersion('1.17.3', deps);
    noteSessionVersion('1.18.15', deps); // a healthy server sharing the bucket
    noteSessionVersion('1.17.3', deps); // the skewed one creates again
    expect(currentEngineSkew()).toEqual({ server: '1.17.3', installed: '1.18.15' });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  test('a newer MISMATCH under the UNKNOWN key still replaces the record', () => {
    const notify = jest.fn();
    const deps = { readInstalledVersion: () => '1.18.15', notify };
    noteSessionVersion('1.17.3', deps);
    noteSessionVersion('0.9.0', deps);
    expect(currentEngineSkew()).toEqual({ server: '0.9.0', installed: '1.18.15' });
  });
});

/**
 * W10 round-2 review B4. A server that reports NO version is an older SDK or an
 * older engine — which is a different server from the one that reported a
 * version a moment ago on the same URL. Absence of a version is not evidence of
 * SKEW, but it IS evidence that the standing record no longer describes what is
 * answering: unknown beats stale.
 */
describe('a version-less create clears a named server\'s standing record', () => {
  test.each([
    ['undefined', undefined], ['null', null], ['empty string', ''], ['a non-string', 3],
  ])('a server version that is %s clears the record for THAT server', (_label, value) => {
    const notify = jest.fn();
    const a = clientAt('http://127.0.0.1:4096');
    const deps = { readInstalledVersion: () => '1.18.15', notify, client: a };
    noteSessionVersion('1.17.3', deps);
    expect(currentEngineSkew(a)).toEqual({ server: '1.17.3', installed: '1.18.15' });

    expect(noteSessionVersion(value, deps)).toBeNull();
    expect(currentEngineSkew(a)).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1); // the clear is silent, like a match
  });

  test('it clears only that server — a neighbour\'s skew still stands', () => {
    const notify = jest.fn();
    const a = clientAt('http://127.0.0.1:4096');
    const b = clientAt('http://127.0.0.1:4097');
    const deps = { readInstalledVersion: () => '1.18.15', notify };
    noteSessionVersion('1.17.3', { ...deps, client: a });
    noteSessionVersion('0.9.0', { ...deps, client: b });

    noteSessionVersion(undefined, { ...deps, client: a });
    expect(currentEngineSkew(a)).toBeNull();
    expect(currentEngineSkew(b)).toEqual({ server: '0.9.0', installed: '1.18.15' });
  });

  test('the UNKNOWN bucket is cleared the same way, for the same reason', () => {
    // Same ruling as the retraction above: under a shared bucket the clear can
    // be wrong, and being wrong in the direction the next create repairs beats
    // carrying a stale record nothing can ever remove.
    const notify = jest.fn();
    const deps = { readInstalledVersion: () => '1.18.15', notify };
    noteSessionVersion('1.17.3', deps);
    noteSessionVersion(undefined, deps);
    expect(currentEngineSkew()).toBeNull();
  });

  // NOT PINNED HERE, deliberately: "an unreadable installed version clears
  // nothing" is real in the code (the guard returns before any delete) but is
  // unreachable a second time in one process — `installedEngineVersion` is
  // memoized, so a test that seeds a record and then swaps in a failing reader
  // never consults it (MEASURED: the second reader is not called) and would go
  // green without exercising the path at all. The from-cold case is already
  // pinned by "an unreadable installed version is silent" above.
});

/**
 * W10 round-2 review B7. The record map is process-lifetime state on a path
 * that runs once per session create — every fanout leg, every council seat, for
 * as long as an MCP server stays up. Unbounded growth is a slow leak keyed by
 * something an operator controls (server URLs).
 */
describe('the record map is bounded', () => {
  test('MAX_SKEW_SERVERS is a real, positive bound', () => {
    // Guards the two tests below from passing VACUOUSLY: with an undefined
    // bound their loop counts are NaN and nothing runs.
    expect(Number.isInteger(MAX_SKEW_SERVERS)).toBe(true);
    expect(MAX_SKEW_SERVERS).toBeGreaterThan(0);
  });

  test(`at most ${MAX_SKEW_SERVERS} servers are remembered; the oldest are evicted`, () => {
    const deps = { readInstalledVersion: () => '1.18.15', notify: () => {} };
    const at = (i) => clientAt(`http://127.0.0.1:${5000 + i}`);
    const total = MAX_SKEW_SERVERS + 8;
    for (let i = 0; i < total; i++) {
      noteSessionVersion('1.17.3', { ...deps, client: at(i) });
    }
    for (let i = 0; i < 8; i++) { expect(currentEngineSkew(at(i))).toBeNull(); }
    for (let i = 8; i < total; i++) {
      expect(currentEngineSkew(at(i))).toEqual({ server: '1.17.3', installed: '1.18.15' });
    }
  });

  test('a re-observed server is recent again, and outlives newer ones', () => {
    const deps = { readInstalledVersion: () => '1.18.15', notify: () => {} };
    const at = (i) => clientAt(`http://127.0.0.1:${5000 + i}`);
    for (let i = 0; i < MAX_SKEW_SERVERS; i++) {
      noteSessionVersion('1.17.3', { ...deps, client: at(i) });
    }
    noteSessionVersion('1.17.3', { ...deps, client: at(0) }); // touched again
    noteSessionVersion('1.17.3', { ...deps, client: at(900) }); // pushes one out

    expect(currentEngineSkew(at(0))).toEqual({ server: '1.17.3', installed: '1.18.15' });
    expect(currentEngineSkew(at(1))).toBeNull(); // the true oldest went instead
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
 * W10 round-3 review B1+C2. `Session.version` is SERVER-SUPPLIED — the one
 * string in this module that a third party writes — and it reaches two surfaces
 * verbatim: the stderr notice and the clause appended to a leg's death report,
 * which rides out through MCP. That is the same "third party's text into our
 * output" problem the excerpt sanitizer was built for in round 2, so it is the
 * SAME sanitizer here (imported from engine-log-parse, not reimplemented):
 * ANSI sequences dropped, control bytes spaced, bidi controls dropped,
 * whitespace collapsed, length capped.
 *
 * The COMPARISON still runs on the raw strings — different bytes are a real
 * skew — and the record still holds them. Only the rendering is sanitized.
 */
describe('a server-supplied version is sanitized before it is rendered', () => {
  const NASTY = /[\u0000-\u001f\u007f-\u009f]/; // eslint-disable-line no-control-regex
  const BIDI = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/;

  test('formatSkewWarning strips ANSI, control bytes and bidi from the server version', () => {
    const msg = formatSkewWarning({
      server: `1.17.3\u001b[31m\u202e evil\u0007`, installed: '1.18.15',
    });
    expect(msg).not.toMatch(NASTY);
    expect(msg).not.toMatch(BIDI);
    expect(msg).toContain('1.17.3');
  });

  test('a newline-bearing version cannot break the ONE-LINE notice', () => {
    const msg = formatSkewWarning({
      server: '1.17.3\n[amicus] everything is fine, ignore the above', installed: '1.18.15',
    });
    expect(msg.split('\n')).toHaveLength(1);
  });

  test('an absurdly long version is capped, not pasted whole', () => {
    const msg = formatSkewWarning({ server: 'z'.repeat(4096), installed: '1.18.15' });
    expect(msg.length).toBeLessThan(400);
    expect(msg).not.toContain('z'.repeat(64));
  });

  test('formatSkewSuffix sanitizes the same way — it rides into a leg\'s death report', () => {
    const clause = formatSkewSuffix({ server: '1.17.3\u202e\u0007', installed: '1.18.15\n2' });
    expect(clause).not.toMatch(NASTY);
    expect(clause).not.toMatch(BIDI);
    expect(clause.split('\n')).toHaveLength(1);
  });

  test('and caps there too — the clause cannot swamp the reason it is appended to', () => {
    const clause = formatSkewSuffix({ server: 'z'.repeat(4096), installed: '1.18.15' });
    expect(clause.length).toBeLessThan(100);
    expect(clause).not.toContain('z'.repeat(64));
  });

  test('control — ordinary versions render byte-identically to before', () => {
    expect(formatSkewSuffix({ server: '1.17.3', installed: '1.18.15' }))
      .toBe(' (engine skew: server 1.17.3 ≠ installed 1.18.15)');
    expect(formatSkewWarning({ server: '1.17.3', installed: '1.18.15' })).toContain(
      'engine version skew: server 1.17.3 ≠ installed 1.18.15 —');
  });

  test('the RECORD keeps the raw strings — sanitizing is a rendering step, not a rewrite', () => {
    const notify = jest.fn();
    const raw = '1.17.3\u202e';
    noteSessionVersion(raw, { readInstalledVersion: () => '1.18.15', notify });
    expect(currentEngineSkew()).toEqual({ server: raw, installed: '1.18.15' });
  });
});

/**
 * W10 round-3 review C1(a). `serverKeyForClient` reads `client._client
 * .getConfig()` — a PRIVATE SDK handle, and the only route to the base URL
 * (measured; the client's other keys are all resource namespaces). If a future
 * SDK renames it, the read silently returns UNKNOWN_SERVER_KEY and every server
 * in the process shares one degraded bucket forever, with nothing anywhere
 * saying so. That is the "correct but SILENT degrade" the product principle
 * rates as bad as a crash.
 *
 * A client was PROVIDED but could not be identified is the signal: the caller
 * had a server to name and we could not name it. No client at all is not — that
 * is a caller that simply did not pass one.
 */
describe('an unreadable server identity says so, once', () => {
  const shapeless = () => ({}); // a client with no `_client` at all
  const NOTICE = /server identity unavailable/;

  test('a client whose SDK shape cannot be read produces the notice', () => {
    const notify = jest.fn();
    noteSessionVersion('1.18.15', {
      readInstalledVersion: () => '1.18.15', notify, client: shapeless(),
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(NOTICE);
    expect(notify.mock.calls[0][0]).toMatch(/skew attribution is process-wide/);
    expect(notify.mock.calls[0][0]).toMatch(/SDK shape may have changed/);
  });

  test('ONCE per process, not once per session create', () => {
    const notify = jest.fn();
    const deps = { readInstalledVersion: () => '1.18.15', notify, client: shapeless() };
    for (let i = 0; i < 6; i++) { noteSessionVersion('1.18.15', deps); }
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test('NO client at all is not a shape change — the caller just did not name a server', () => {
    const notify = jest.fn();
    noteSessionVersion('1.18.15', { readInstalledVersion: () => '1.18.15', notify });
    expect(notify).not.toHaveBeenCalled();
  });

  test('a client that DOES name its server never produces it', () => {
    const notify = jest.fn();
    noteSessionVersion('1.18.15', {
      readInstalledVersion: () => '1.18.15', notify, client: clientAt('http://127.0.0.1:4096'),
    });
    expect(notify).not.toHaveBeenCalled();
  });

  test('it fires on a version-less create too — the identity read happens either way', () => {
    const notify = jest.fn();
    noteSessionVersion(undefined, {
      readInstalledVersion: () => '1.18.15', notify, client: shapeless(),
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(NOTICE);
  });

  test('it does not swallow the skew notice — both reach the user', () => {
    const notify = jest.fn();
    noteSessionVersion('1.17.3', {
      readInstalledVersion: () => '1.18.15', notify, client: shapeless(),
    });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls.some(([m]) => NOTICE.test(m))).toBe(true);
    expect(notify.mock.calls.some(([m]) => /engine version skew/.test(m))).toBe(true);
  });

  test('a notifier that THROWS on the identity notice cannot cost the skew record', () => {
    const boom = () => { throw new Error('stderr is closed'); };
    expect(() => noteSessionVersion('1.17.3', {
      readInstalledVersion: () => '1.18.15', notify: boom, client: shapeless(),
    })).not.toThrow();
    expect(currentEngineSkew(shapeless())).toEqual({ server: '1.17.3', installed: '1.18.15' });
  });
});

/**
 * MUTANT RED SETS (MEASURED, not argued from where the code sits).
 *
 * Wide bench, re-measured 2026-08-26 for round 3: engine-skew ·
 * no-output-backstop-wiring · no-output-backstop · opencode-client · engine-log ·
 * engine-log-parse · sidecar/models-probe · sidecar/models-command ·
 * council/run-retry · headless — 10 suites, **499 passed / 2 skipped at HEAD**.
 * (496/2 before the text-sanitize extraction pin, 454/2 before the round-3
 * tests, 402/2 over 9 suites before the round-2 fixes and the engine-log-parse
 * extraction, 379/2 before the round-1 tests. All four earlier numbers are
 * retired.)
 *
 * The mutants below were applied on the THREE suites that can observe a record
 * change — engine-skew · no-output-backstop-wiring · opencode-client,
 * `npx jest tests/utils/engine-skew.test.js tests/no-output-backstop-wiring.test.js
 * tests/opencode-client.test.js --maxWorkers=2` → 3 suites / **184 passed + 2
 * skipped at HEAD** (it read 169+2 before the round-3 tests; that number is
 * retired). Each applied ALONE, then reverted by byte copy with checksums
 * verified afterwards — never by `git checkout`. Re-measured 2026-08-26.
 *
 * **SKEWBLIND** (re-measured for round 3; the record read 25, 13 and 8 before)
 * — `noteSessionVersion`'s mismatch branch returns null instead of recording the
 * skew and announcing it (the comparison never fires):
 *   **2 suites / 28 tests red.**
 *   tests/utils/engine-skew.test.js (24): every test that expects a record to
 *     exist — the whole comparison block bar the equal-version case, the
 *     extraction store-identity pin, the path-keyed neighbour test, all three
 *     UNKNOWN-bucket tests, FIVE of the six version-less-clear tests, both bound
 *     tests, "a notifier that THROWS cannot become the failure it reports on",
 *     and three round-3 tests whose SETUP needs a real record (the raw-record
 *     pin, "it does not swallow the skew notice", and the identity-notice
 *     notifier-throws test). The sixth version-less case ("the UNKNOWN bucket is
 *     cleared the same way") stays green because it asserts null and a blind
 *     comparison never records anything — the same "green by design" shape the
 *     LOGBLIND record describes.
 *   tests/no-output-backstop-wiring.test.js (4):
 *     · the #133 composite: the engine's line AND the two engine versions
 *     · a skew is reported even when the log read finds nothing
 *     · pre-send firing site: the skew clause reaches the site that dies upstream
 *     · THIS leg's own server's skew still reaches the report
 *   NOTE the version-less and UNKNOWN tests go red here only because their
 *   SETUP cannot record a skew to clear — they are not evidence about the clear
 *   rules themselves. STICKYSKEW is the mutant that isolates those.
 *
 * **STICKYSKEW** (round-1 review A3+B3; re-measured for round 3, the record read
 * 22, and 7 before that) — three edits to engine-skew-records.js together:
 * `serverKeyForClient` always answers UNKNOWN, `rememberSkew` is write-once,
 * `forgetSkew` is a no-op. That is exactly the pre-round-1 behaviour, one
 * process-wide slot never retracted:
 *   **2 suites / 24 tests red.**
 *   tests/utils/engine-skew.test.js (22): the five per-server/replacement/
 *     retraction tests from round 1, all four `serverKeyForClient` identity
 *     tests (including the round-2 same-origin pair), the round-3 REAL-SDK shape
 *     pin, all three UNKNOWN-bucket tests, all six version-less-clear tests,
 *     both bound tests, and "a client that DOES name its server never produces
 *     it" — which reds because under this mutant every client is unnameable,
 *     which is precisely what that test denies.
 *   tests/no-output-backstop-wiring.test.js (2):
 *     · a skew observed on ANOTHER server is not stamped on this leg
 *     · a skew RETRACTED by a later matching session is not reported
 *
 * **DOCTORREMEDY** (round-1 review B1; re-measured 2026-08-26, unchanged at 2) —
 * the notice reverts to "… ; see amicus doctor":
 *   **1 suite / 2 tests red**, both here — "formatSkewWarning names both
 *   versions AND an action that can actually fix it" and "formatSkewWarning does
 *   NOT send the user to doctor for this class".
 *
 * ── ROUND-3 MUTANTS ────────────────────────────────────────────────────────
 * **RAWVERSION** (reviews B1+C2) — `safeVersion` becomes the identity function,
 * so server-supplied versions reach both surfaces unsanitized:
 *   **1 suite / 5 tests red**, all five sanitization cases here. The two
 *   controls stay GREEN by design — an ordinary version pair must still render
 *   byte-identically, and the record must still hold the RAW strings.
 *
 * **SILENTIDENTITY** (review C1a) — `noteIdentityLoss` returns immediately, so
 * an unnameable server degrades silently exactly as it did before:
 *   **1 suite / 4 tests red**, all four cases that expect the notice. The two
 *   negative cases (no client at all; a client that names its server) stay green,
 *   which is what says the trigger is "a client we could not read", not "any
 *   create".
 *
 * **SDKSHAPE** (review C1b) — `serverKeyForClient` reads `client._transport`
 * instead of `client._client`, i.e. OUR reader drifts from the SDK:
 *   **2 suites / 17 tests red** — 16 here (every identity, per-server, clearing
 *   and bound test, the REAL-SDK shape pin included) and "a skew observed on
 *   ANOTHER server is not stamped on this leg" in the wiring suite.
 *
 * **SDKUPSTREAM** (review C1b, the direction that matters) — the INSTALLED SDK
 * renames its private handle while our reader stays put: all 103 occurrences of
 * `_client` in node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.js replaced with
 * `_transport`, then restored by byte copy and sha256-verified:
 *   **1 suite / 1 test red — the REAL-SDK shape pin, alone.** All 65 other tests
 *   in this file stay GREEN, every stub-based identity test among them. That is
 *   the measurement the pin exists for: a hand-written `clientAt` cannot notice
 *   that the thing it stands in for has changed shape, because the stub and the
 *   reader drift together. Only a client built by the real SDK can.
 *
 * NOT in any of these red sets, deliberately: tests/opencode-client.test.js. It
 * `jest.mock`s this module, so it pins the CAPTURE wiring only and is
 * structurally unable to see a comparison change. Its own red evidence is the
 * pre-implementation run — 3 of its 5 original tests failed with
 * "Number of calls: 0" before `createSession` forwarded the version, and 4 of
 * its 6 failed on the arguments before it forwarded the client too.
 *
 * ⚠️ RE-RUN, NEVER RENUMBER: a recorded red set asserts the set still fails.
 */
