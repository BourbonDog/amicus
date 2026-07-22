'use strict';

const http = require('http');
const { probeLocalProvider, listLocalModels } = require('../src/utils/local-probe');

/** Spin a stub server; returns {url, close, lastAuth}. */
function stub(handler) {
  const state = { lastAuth: undefined };
  const server = http.createServer((req, res) => {
    state.lastAuth = req.headers.authorization;
    handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ url: `http://127.0.0.1:${port}/v1`, origin: `http://127.0.0.1:${port}`,
        close: () => server.close(), state });
    });
  });
}

describe('local-probe', () => {
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
    s.close();
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
    s.close();
  });

  test('probeLocalProvider: unreachable → {status:"unreachable", models:[]} (never throws)', async () => {
    // Nothing listening on this port.
    const r = await probeLocalProvider({ id: 'x', baseURL: 'http://127.0.0.1:1/v1', flavor: 'generic' }, { timeoutMs: 300 });
    expect(r).toEqual({ status: 'unreachable', models: [] });
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
    s.close();
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
    s.close();
  });

  test('listLocalModels: catalog rows carry local:true + entry pricing', async () => {
    const s = await stub((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'm1' }] }));
    });
    const rows = await listLocalModels(
      { id: 'lab', baseURL: s.url, flavor: 'generic', pricing: { prompt: 0, completion: 0 } }, { timeoutMs: 1000 });
    expect(rows).toEqual([{ id: 'lab/m1', name: 'm1', contextLength: null, pricing: { prompt: 0, completion: 0 }, authoritative: true, local: true }]);
    s.close();
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
});
