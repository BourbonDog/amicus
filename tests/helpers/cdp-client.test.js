const http = require('http');
const WebSocket = require('ws');
const { CdpClient } = require('./cdp-client');

describe('CdpClient', () => {
  let mockServer;
  let wss;
  let serverPort;

  beforeAll((done) => {
    mockServer = http.createServer((req, res) => {
      if (req.url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([
          {
            id: 'toolbar-page-id',
            type: 'page',
            url: 'data:text/html;charset=utf-8,toolbar',
            webSocketDebuggerUrl: `ws://127.0.0.1:${serverPort}/devtools/page/toolbar-page-id`
          },
          {
            id: 'content-page-id',
            type: 'page',
            url: 'http://localhost:4096/',
            webSocketDebuggerUrl: `ws://127.0.0.1:${serverPort}/devtools/page/content-page-id`
          },
          {
            // A non-page background target that shares the data:/localhost URL shape —
            // the type==='page' filter must exclude it (Chromium 150 enumerates these).
            id: 'sw-id',
            type: 'service_worker',
            url: 'data:text/html,sw',
            webSocketDebuggerUrl: `ws://127.0.0.1:${serverPort}/devtools/page/sw-id`
          }
        ]));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    wss = new WebSocket.Server({ server: mockServer });
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'Runtime.evaluate') {
          ws.send(JSON.stringify({
            id: msg.id,
            result: { result: { type: 'object', value: { found: true, text: 'test-value' } } }
          }));
        } else if (msg.method === 'Page.captureScreenshot') {
          const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
          ws.send(JSON.stringify({ id: msg.id, result: { data: pngBase64 } }));
        }
      });
    });

    mockServer.listen(0, '127.0.0.1', () => {
      serverPort = mockServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    // Terminate all server-side WebSocket connections to avoid open handles
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close(() => {
      mockServer.close(done);
    });
  });

  it('getTargets returns parsed target list', async () => {
    const cdp = new CdpClient(serverPort);
    const targets = await cdp.getTargets();
    expect(targets).toHaveLength(3);
    expect(targets[0].id).toBe('toolbar-page-id');
    expect(targets[1].url).toContain('http://localhost');
    expect(targets[2].type).toBe('service_worker');
  });

  it('findTarget filters by predicate', async () => {
    const cdp = new CdpClient(serverPort);
    const toolbar = await cdp.findTarget(t => t.url.startsWith('data:'));
    expect(toolbar.id).toBe('toolbar-page-id');
    const content = await cdp.findTarget(t => t.url.startsWith('http://localhost'));
    expect(content.id).toBe('content-page-id');
  });

  it("type==='page' filter excludes a non-page target with a data: URL", async () => {
    const cdp = new CdpClient(serverPort);
    // The sw-id target has a data: URL but type 'service_worker' — the factory filter
    // must return the real page, not the background target.
    const match = await cdp.findTarget(t => t.type === 'page' && t.url.startsWith('data:'));
    expect(match.id).toBe('toolbar-page-id');
  });

  it('findTarget returns null when no match', async () => {
    const cdp = new CdpClient(serverPort);
    const result = await cdp.findTarget(t => t.url === 'nonexistent');
    expect(result).toBeNull();
  });

  it('connect + evaluate returns value', async () => {
    const cdp = new CdpClient(serverPort);
    await cdp.connect('toolbar-page-id');
    const result = await cdp.evaluate('document.title');
    expect(result).toEqual({ found: true, text: 'test-value' });
    cdp.close();
  });

  it('screenshot saves PNG to disk', async () => {
    const fs = require('fs');
    const path = require('path');
    const tmpFile = path.join(require('os').tmpdir(), `cdp-test-${Date.now()}.png`);
    const cdp = new CdpClient(serverPort);
    await cdp.connect('toolbar-page-id');
    await cdp.screenshot(tmpFile);
    cdp.close();
    expect(fs.existsSync(tmpFile)).toBe(true);
    const buf = fs.readFileSync(tmpFile);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4E);
    expect(buf[3]).toBe(0x47);
    fs.unlinkSync(tmpFile);
  });

  it('close is safe to call multiple times', async () => {
    const cdp = new CdpClient(serverPort);
    await cdp.connect('toolbar-page-id');
    cdp.close();
    cdp.close();
  });

  describe('factory methods', () => {
    it('CdpClient.toolbar connects to data: URL target', async () => {
      const cdp = await CdpClient.toolbar(serverPort);
      expect(cdp).toBeInstanceOf(CdpClient);
      const result = await cdp.evaluate('1+1');
      expect(result).toBeDefined();
      cdp.close();
    });

    it('CdpClient.content connects to http: URL target', async () => {
      const cdp = await CdpClient.content(serverPort);
      expect(cdp).toBeInstanceOf(CdpClient);
      cdp.close();
    });
  });
});
