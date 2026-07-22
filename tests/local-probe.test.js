'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const { probeLocalProvider, listLocalModels } = require('../src/utils/local-probe');

// Tracks every stub/raw server spun up by a test so the afterEach below can force-close
// it even if the test's own assertions throw first (finding 2: a leaked listening handle
// can hang the runner, and it hits hardest on exactly the failure path that most needs
// the server gone).
const activeServers = [];

/**
 * Spin a stub server; returns {url, origin, close, state}. Every server is pushed onto
 * `activeServers` and force-closed by the top-level afterEach below — `close` stays on
 * the return value only as an opt-in for a test that wants to close early mid-test, not
 * as the primary cleanup path.
 */
function stub(handler) {
  const state = { lastAuth: undefined };
  const server = http.createServer((req, res) => {
    state.lastAuth = req.headers.authorization;
    handler(req, res);
  });
  activeServers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ url: `http://127.0.0.1:${port}/v1`, origin: `http://127.0.0.1:${port}`,
        close: () => server.close(), state });
    });
  });
}

describe('local-probe', () => {
  afterEach(() => {
    while (activeServers.length) {
      const server = activeServers.pop();
      try { server.close(); } catch { /* no-op: already closed */ }
    }
  });

  test('probeLocalProvider: /v1/models → ok with <id>/<model> ids', async () => {
    const s = await stub((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'llama3.3' }, { id: 'qwen3:14b' }] }));
      } else { res.writeHead(404); res.end(); }
    });
    const r = await probeLocalProvider({ id: 'ollama', baseURL: s.url, flavor: 'ollama' }, { timeoutMs: 1000 });
    expect(r.status).toBe('ok');
    expect(r.models).toEqual(['ollama/llama3.3', 'ollama/qwen3:14b']);
  });

  test('probeLocalProvider: ollama-flavor 404 on /v1/models falls back to /api/tags', async () => {
    const s = await stub((req, res) => {
      if (req.url === '/v1/models') { res.writeHead(404); res.end(); return; }
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3.2' }] }));
        return;
      }
      res.writeHead(404); res.end();
    });
    const r = await probeLocalProvider({ id: 'ollama', baseURL: s.url, flavor: 'ollama' }, { timeoutMs: 1000 });
    expect(r.status).toBe('ok');
    expect(r.models).toEqual(['ollama/llama3.2']);
  });

  test('probeLocalProvider: unreachable → {status:"unreachable", models:[]} (never throws)', async () => {
    // Nothing listening on this port.
    const r = await probeLocalProvider({ id: 'x', baseURL: 'http://127.0.0.1:1/v1', flavor: 'generic' }, { timeoutMs: 300 });
    expect(r).toEqual({ status: 'unreachable', models: [] });
  });

  // Finding 3: the port-1 test above resolves via getJson's `error` handler (ECONNREFUSED)
  // before the timer ever fires — it never exercises the setTimeout/req.destroy() branch
  // (local-probe.js:37). Deleting that whole line left every other test green. Prove the
  // timeout/destroy path independently with a server that accepts the TCP connection and
  // then goes silent, so the ONLY way getJson can resolve is the timer firing.
  test('probeLocalProvider: connection accepted but never answered resolves unreachable via the timeout/destroy path', async () => {
    // The connection listener deliberately never touches the accepted socket — that's what
    // forces getJson down the timeout/destroy branch instead of an early 'error'/'end'. But
    // server.close() alone only stops accepting NEW connections; it does not terminate a
    // socket already accepted, so that socket would otherwise outlive the test as a leaked
    // handle (the same failure mode finding 2 flags). Track it as a close()-able too.
    const server = net.createServer((socket) => { activeServers.push({ close: () => socket.destroy() }); });
    activeServers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const timeoutMs = 150;
    const started = Date.now();
    const r = await probeLocalProvider({ id: 'x', baseURL: `http://127.0.0.1:${port}/v1`, flavor: 'generic' }, { timeoutMs });
    const elapsed = Date.now() - started;
    expect(r).toEqual({ status: 'unreachable', models: [] });
    // Bounded near timeoutMs: too fast would mean something other than the timer resolved
    // it; too slow (or a Jest per-test-timeout failure) would mean the timer never fired.
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 20);
    expect(elapsed).toBeLessThan(timeoutMs + 1000);
  });

  // C4: this asserts ONLY that the bearer is attached to the configured origin.
  // local-probe.js has zero console.*/stdout calls, so "redacted nowhere leaked" is
  // untestable here — that half belongs beside whichever Task 10/12/13/14 surface
  // actually prints probe data, if one is added.
  test('probeLocalProvider: attaches bearer to the configured origin', async () => {
    const s = await stub((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'm' }] }));
    });
    await probeLocalProvider({ id: 'lab', baseURL: s.url, flavor: 'generic' }, { timeoutMs: 1000, bearer: 'secret-token' });
    expect(s.state.lastAuth).toBe('Bearer secret-token');
  });

  test('probeLocalProvider: does NOT follow redirects', async () => {
    let hitTarget = false;
    const s = await stub((req, res) => {
      if (req.url === '/v1/models') { res.writeHead(302, { location: '/elsewhere' }); res.end(); return; }
      hitTarget = true; res.writeHead(200); res.end('{}');
    });
    const r = await probeLocalProvider({ id: 'x', baseURL: s.url, flavor: 'generic' }, { timeoutMs: 1000 });
    expect(r.status).toBe('unreachable'); // a 3xx is not a usable model list
    expect(hitTarget).toBe(false);
  });

  test('listLocalModels: catalog rows carry local:true + entry pricing', async () => {
    const s = await stub((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'm1' }] }));
    });
    const rows = await listLocalModels(
      { id: 'lab', baseURL: s.url, flavor: 'generic', pricing: { prompt: 0, completion: 0 } }, { timeoutMs: 1000 });
    expect(rows).toEqual([{ id: 'lab/m1', name: 'm1', contextLength: null, pricing: { prompt: 0, completion: 0 }, authoritative: true, local: true }]);
  });

  // Finding 6: the listLocalModels test above always supplies entry.pricing, so the
  // `entry.pricing || { prompt: 0, completion: 0 }` default (local-probe.js:94) was never
  // exercised. Omit pricing entirely and assert the $0 default lands on the emitted rows.
  test('listLocalModels: entry with no pricing defaults catalog rows to $0', async () => {
    const s = await stub((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'm1' }] }));
    });
    const rows = await listLocalModels({ id: 'lab', baseURL: s.url, flavor: 'generic' }, { timeoutMs: 1000 });
    expect(rows).toEqual([{ id: 'lab/m1', name: 'm1', contextLength: null, pricing: { prompt: 0, completion: 0 }, authoritative: true, local: true }]);
  });

  // Regression coverage for a defect found in review: getJson() used to pick the http/https
  // module with `protocol === 'https:' ? https : http`, which silently treats every non-https
  // scheme as http. For a genuinely different scheme (file:, ftp:, ...) Node's http module
  // validates the URL's own embedded protocol and throws ERR_INVALID_PROTOCOL *synchronously*
  // inside the Promise executor, which — with no try/catch around it — turned into a REJECTED
  // promise instead of the documented `{status:'unreachable', models:[]}` resolution. Both
  // entry points share the same getJson(), so both must be proven never to reject.
  const BAD_BASE_URLS = ['file:///etc/passwd', 'ftp://127.0.0.1/x', 'not a url'];

  test.each(BAD_BASE_URLS)(
    'probeLocalProvider: non-http(s)/malformed baseURL %s resolves unreachable (never rejects)',
    async (baseURL) => {
      const r = await probeLocalProvider({ id: 'x', baseURL, flavor: 'generic' }, { timeoutMs: 300 });
      expect(r).toEqual({ status: 'unreachable', models: [] });
    }
  );

  test.each(BAD_BASE_URLS)(
    'listLocalModels: non-http(s)/malformed baseURL %s resolves [] (never rejects)',
    async (baseURL) => {
      const rows = await listLocalModels({ id: 'x', baseURL, flavor: 'generic' }, { timeoutMs: 300 });
      expect(rows).toEqual([]);
    }
  );

  // Finding 4: the explicit scheme allowlist (local-probe.js:26) and the try/catch backstop
  // (:19, :40-44) produce the identical *outcome* for a rejected scheme, so deleting only
  // the allowlist line fails none of the BAD_BASE_URLS tests above — the backstop alone
  // still catches the resulting throw. Prove the allowlist branch independently by spying
  // on the dispatch calls: for a scheme it rejects, neither http.get nor https.get should
  // ever be invoked (the backstop, by contrast, would only run *after* one of them was
  // called and threw).
  test('probeLocalProvider: file: baseURL never dispatches to http.get/https.get (allowlist proven independently)', async () => {
    const httpSpy = jest.spyOn(http, 'get');
    const httpsSpy = jest.spyOn(https, 'get');
    try {
      const r = await probeLocalProvider({ id: 'x', baseURL: 'file:///etc/passwd', flavor: 'generic' }, { timeoutMs: 300 });
      expect(r).toEqual({ status: 'unreachable', models: [] });
      expect(httpSpy).not.toHaveBeenCalled();
      expect(httpsSpy).not.toHaveBeenCalled();
    } finally {
      httpSpy.mockRestore();
      httpsSpy.mockRestore();
    }
  });

  // Finding 1 (CRITICAL): probeLocalProvider did `entry.baseURL.replace(...)` before
  // getJson was ever called and outside any try/catch — a missing/null/non-string baseURL,
  // or a missing entry altogether, rejected the returned promise instead of resolving the
  // documented unreachable/[] shape. listLocalModels inherits the fix by calling through
  // probeLocalProvider. Assert the *resolved value*, not merely that the call didn't reject.
  const MALFORMED_ENTRIES = [
    ['undefined baseURL', { id: 'x', baseURL: undefined, flavor: 'generic' }],
    ['null baseURL', { id: 'x', baseURL: null, flavor: 'generic' }],
    ['numeric baseURL', { id: 'x', baseURL: 42, flavor: 'generic' }],
  ];

  test.each(MALFORMED_ENTRIES)(
    'probeLocalProvider: entry with %s resolves unreachable (never rejects)',
    async (_label, entry) => {
      await expect(probeLocalProvider(entry, { timeoutMs: 300 })).resolves.toEqual({ status: 'unreachable', models: [] });
    }
  );

  test('probeLocalProvider: called with no entry at all resolves unreachable (never rejects)', async () => {
    await expect(probeLocalProvider(undefined, { timeoutMs: 300 })).resolves.toEqual({ status: 'unreachable', models: [] });
  });

  test.each(MALFORMED_ENTRIES)(
    'listLocalModels: entry with %s resolves [] (never rejects)',
    async (_label, entry) => {
      await expect(listLocalModels(entry, { timeoutMs: 300 })).resolves.toEqual([]);
    }
  );

  test('listLocalModels: called with no entry at all resolves [] (never rejects)', async () => {
    await expect(listLocalModels(undefined, { timeoutMs: 300 })).resolves.toEqual([]);
  });
});
