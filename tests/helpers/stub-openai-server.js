'use strict';

const http = require('http');

/**
 * Minimal OpenAI-compatible stub server for the local-provider e2e (Task 7).
 * Serves GET /v1/models, GET /api/tags (the Ollama-flavor discovery fallback
 * local-probe.js falls back to on a 404 -- see idsFromTags there), and POST
 * /v1/chat/completions. Captures the most recent Authorization header on
 * `state.lastAuth` so a caller can assert a configured bearer actually
 * reached the wire (mirrors the `state.lastAuth` pattern already used by
 * tests/local-probe.test.js's own inline stub helper).
 *
 * Hermetic: binds 127.0.0.1:0 (OS-assigned port, never a fixed one); `close`
 * resolves only once the listener has actually shut down, so a caller can
 * `await` it in afterEach/afterAll without leaking an open handle.
 * @param {{models?: string[]}} [opts]
 * @returns {Promise<{url:string, origin:string, port:number,
 *   state:{lastAuth: string|undefined}, close: () => Promise<void>}>}
 */
function startStub(opts = {}) {
  const models = opts.models || ['test-model'];
  const state = { lastAuth: undefined };
  const server = http.createServer((req, res) => {
    state.lastAuth = req.headers.authorization;
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'stub-1',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hi from stub' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        origin: `http://127.0.0.1:${port}`,
        port,
        state,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

module.exports = { startStub };
