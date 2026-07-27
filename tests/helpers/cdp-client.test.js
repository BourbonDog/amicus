const http = require('http');
const WebSocket = require('ws');
const { CdpClient } = require('./cdp-client');

describe('CdpClient', () => {
  let mockServer;
  let wss;
  let serverPort;
  let dispatchedKeyEvents;
  let sentCommands;

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
          },
          {
            // The Council Workspace target — the only file:// page (toolbar=data:,
            // content=http). CdpClient.workspace() must find this one.
            id: 'workspace-page-id',
            type: 'page',
            url: 'file:///C:/x/workspace-ui/index.html?runId=aaaa1111',
            webSocketDebuggerUrl: `ws://127.0.0.1:${serverPort}/devtools/page/workspace-page-id`
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
        sentCommands.push(msg.method);
        if (msg.method === 'Log.enable') {
          // Real CDP semantics (v4.4.1 TST-6): Log.enable REPLAYS every entry collected so
          // far as `Log.entryAdded` notifications, THEN answers the command. A CSP refusal
          // arrives on this channel with source 'security' — that ordering is what lets a
          // client connected after page load still observe a boot-time violation.
          ws.send(JSON.stringify({
            method: 'Log.entryAdded',
            params: { entry: { source: 'security', level: 'error', text: 'Refused to execute inline script because it violates the following Content Security Policy directive' } },
          }));
          ws.send(JSON.stringify({ id: msg.id, result: {} }));
          return;
        }
        if (msg.method === 'Runtime.evaluate') {
          ws.send(JSON.stringify({
            id: msg.id,
            result: { result: { type: 'object', value: { found: true, text: 'test-value' } } }
          }));
        } else if (msg.method === 'Page.captureScreenshot') {
          const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
          ws.send(JSON.stringify({ id: msg.id, result: { data: pngBase64 } }));
        } else if (msg.method === 'Input.dispatchKeyEvent') {
          dispatchedKeyEvents.push(msg.params);
          ws.send(JSON.stringify({ id: msg.id, result: {} }));
        } else {
          // A real CDP endpoint answers EVERY command. Without this catch-all the mock
          // silently drops unknown methods and the client hangs on its 10s _send timeout —
          // which is exactly what a new domain command (Runtime.enable) did here.
          ws.send(JSON.stringify({ id: msg.id, result: {} }));
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

  beforeEach(() => { dispatchedKeyEvents = []; sentCommands = []; });

  it('pressKey sends a keyDown then a keyUp Input.dispatchKeyEvent pair', async () => {
    const cdp = new CdpClient(serverPort);
    await cdp.connect('toolbar-page-id');
    await cdp.pressKey('ArrowDown');
    cdp.close();
    expect(dispatchedKeyEvents.map((e) => e.type)).toEqual(['keyDown', 'keyUp']);
    expect(dispatchedKeyEvents[0]).toMatchObject({ key: 'ArrowDown', windowsVirtualKeyCode: 40 });
  });

  it('pressKey rejects an unsupported key name', async () => {
    const cdp = new CdpClient(serverPort);
    await cdp.connect('toolbar-page-id');
    await expect(cdp.pressKey('Tab')).rejects.toThrow('unsupported key');
    cdp.close();
  });

  it('getTargets returns parsed target list', async () => {
    const cdp = new CdpClient(serverPort);
    const targets = await cdp.getTargets();
    expect(targets).toHaveLength(4);
    expect(targets[0].id).toBe('toolbar-page-id');
    expect(targets[1].url).toContain('http://localhost');
    expect(targets[2].type).toBe('service_worker');
    expect(targets[3].url).toContain('file://');
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

    it('CdpClient.workspace connects to file:// URL target', async () => {
      const cdp = await CdpClient.workspace(serverPort);
      expect(cdp).toBeInstanceOf(CdpClient);
      const result = await cdp.evaluate('1+1');
      expect(result).toBeDefined();
      cdp.close();
    });

    it('CdpClient.workspace turns the diagnostic domains on; toolbar/content do not', async () => {
      // TST-6 wires enableLogging() into the workspace factory only, so no existing suite
      // changes behaviour. Pinned both ways.
      const ws = await CdpClient.workspace(serverPort);
      expect(sentCommands).toEqual(expect.arrayContaining(['Log.enable', 'Runtime.enable']));
      ws.close();

      sentCommands = [];
      const tb = await CdpClient.toolbar(serverPort);
      expect(sentCommands).not.toContain('Log.enable');
      tb.close();
    });
  });

  /**
   * v4.4.1 TST-6. CDP *events* (frames with no `id`) used to be dropped: the message
   * handler only routed command replies, so nothing the page reported was observable from a
   * test. A CSP violation is reported as a `Log.entryAdded` with source 'security' — not as
   * a console.* call — which is why the CSP regression guard needs this buffer.
   */
  describe('event buffering / consoleMessages', () => {
    it('captures the Log.entryAdded replay that Log.enable triggers, CSP text intact', async () => {
      const cdp = await CdpClient.workspace(serverPort);
      const messages = cdp.consoleMessages();
      cdp.close();
      expect(messages).toEqual([
        expect.objectContaining({
          source: 'security',
          level: 'error',
          text: expect.stringContaining('Content Security Policy'),
        }),
      ]);
    });

    it('normalizes console API calls and thrown exceptions alongside log entries', async () => {
      const cdp = new CdpClient(serverPort);
      await cdp.connect('workspace-page-id');
      // Drive the buffer directly: these two shapes are emitted by a real page, and the mock
      // server has no way to provoke them.
      cdp._events.push({
        method: 'Runtime.consoleAPICalled',
        params: { type: 'warn', args: [{ value: 'lazy panel' }, { description: 'Object' }] },
      });
      cdp._events.push({
        method: 'Runtime.exceptionThrown',
        params: { exceptionDetails: { text: 'Uncaught TypeError: x is not a function' } },
      });
      cdp._events.push({ method: 'Network.requestWillBeSent', params: {} }); // ignored shape
      const messages = cdp.consoleMessages();
      cdp.close();
      expect(messages).toEqual([
        { source: 'console', level: 'warn', text: 'lazy panel Object' },
        { source: 'exception', level: 'error', text: 'Uncaught TypeError: x is not a function' },
      ]);
    });

    it('a command reply is never mistaken for an event', async () => {
      const cdp = new CdpClient(serverPort);
      await cdp.connect('toolbar-page-id');
      await cdp.evaluate('1+1');
      const messages = cdp.consoleMessages();
      cdp.close();
      expect(messages).toEqual([]);
    });
  });
});
