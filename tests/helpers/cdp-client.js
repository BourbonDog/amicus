/**
 * CDP Client - Thin Chrome DevTools Protocol helper for E2E tests.
 * Wraps ws + http to provide evaluate(), waitForSelector(), screenshot().
 */

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

class CdpClient {
  constructor(port = 9223) {
    this.port = port;
    this.ws = null;
    this._nextId = 1;
    this._pending = new Map();
    // v4.4.1 TST-6: CDP *events* (frames with no `id`) used to be dropped on the floor —
    // only command replies were routed. Buffer them so a suite can assert on what the page
    // logged, which is the only way to see a Content-Security-Policy violation from outside
    // the renderer.
    this._events = [];
  }

  /**
   * Fetch the list of debuggable targets from the CDP /json endpoint.
   * @returns {Promise<Array<{id: string, url: string, webSocketDebuggerUrl: string}>>}
   */
  getTargets() {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${this.port}/json`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`Failed to parse targets: ${e.message}`)); }
        });
      }).on('error', reject);
    });
  }

  /**
   * Find a target matching the given predicate.
   * @param {(target: object) => boolean} predicate
   * @returns {Promise<object|null>}
   */
  async findTarget(predicate) {
    const targets = await this.getTargets();
    return targets.find(predicate) || null;
  }

  /**
   * Open a WebSocket connection to a specific target.
   * @param {string} targetId - The target page ID
   * @returns {Promise<void>}
   */
  connect(targetId) {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.port}/devtools/page/${targetId}`;
      this.ws = new WebSocket(url);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id !== undefined && this._pending.has(msg.id)) {
          const pending = this._pending.get(msg.id);
          clearTimeout(pending.timer);
          pending.resolve(msg);
          this._pending.delete(msg.id);
          return;
        }
        if (msg.id === undefined && msg.method) { this._events.push(msg); }
      });
    });
  }

  /**
   * Send a CDP command and wait for the response.
   * @param {string} method - CDP method name
   * @param {object} params - Method parameters
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<object>}
   */
  _send(method, params = {}, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      const id = this._nextId++;
      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`CDP timeout: ${method} (id=${id})`));
        }
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Evaluate a JavaScript expression in the target page.
   * @param {string} expression - JS expression to evaluate
   * @returns {Promise<*>} The evaluated result value
   */
  async evaluate(expression) {
    const msg = await this._send('Runtime.evaluate', { expression, returnByValue: true });
    if (msg.result?.exceptionDetails) {
      throw new Error(`Evaluate error: ${msg.result.exceptionDetails.text}`);
    }
    return msg.result?.result?.value;
  }

  /**
   * Poll for a CSS selector to appear in the DOM.
   * @param {string} selector - CSS selector to wait for
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<boolean>}
   */
  async waitForSelector(selector, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await this.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
      if (exists) { return true; }
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`waitForSelector timeout: ${selector} (${timeoutMs}ms)`);
  }

  /**
   * Dispatch a real keydown+keyup pair via CDP's Input domain — proves a
   * page's keydown listener actually fires in a real browser event/focus
   * pipeline, which a unit test's hand-invoked `dispatchEvent` on a fake DOM
   * can never do (it never had a real listener-registration/bubbling path to
   * miss in the first place).
   * @param {'ArrowDown'|'ArrowUp'|'Escape'} key
   * @returns {Promise<void>}
   */
  async pressKey(key) {
    const CODES = { ArrowDown: 40, ArrowUp: 38, Escape: 27 };
    const windowsVirtualKeyCode = CODES[key];
    if (!windowsVirtualKeyCode) { throw new Error(`pressKey: unsupported key ${key}`); }
    const base = { key, code: key, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
    await this._send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await this._send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  /**
   * Turn on the two domains that report page-level diagnostics.
   *
   * `Log.enable` is the load-bearing one: per the CDP contract it REPLAYS every entry
   * collected so far, so violations emitted while the page was booting — long before this
   * client could connect — still arrive. Content-Security-Policy refusals land here with
   * `source: 'security'`, which is why a CSP assertion needs the Log domain and not just
   * console output.
   * @returns {Promise<void>}
   */
  async enableLogging() {
    await this._send('Log.enable');
    await this._send('Runtime.enable');
  }

  /**
   * Everything the page reported since enableLogging(), flattened to {source, level, text}.
   * Covers Log entries (CSP/security/network), console.* calls, and uncaught exceptions.
   * @returns {Array<{source: string, level: string, text: string}>}
   */
  consoleMessages() {
    const out = [];
    for (const evt of this._events) {
      const p = evt.params || {};
      if (evt.method === 'Log.entryAdded' && p.entry) {
        out.push({ source: p.entry.source || 'log', level: p.entry.level || 'info', text: String(p.entry.text || '') });
      } else if (evt.method === 'Runtime.consoleAPICalled') {
        const text = (p.args || [])
          .map((a) => (a.value !== undefined ? String(a.value) : (a.description || '')))
          .join(' ');
        out.push({ source: 'console', level: p.type || 'log', text });
      } else if (evt.method === 'Runtime.exceptionThrown' && p.exceptionDetails) {
        out.push({ source: 'exception', level: 'error', text: String(p.exceptionDetails.text || '') });
      }
    }
    return out;
  }

  /**
   * Capture a screenshot and save it as a PNG file.
   * @param {string} filePath - Absolute path to save the PNG
   * @returns {Promise<string>} The file path
   */
  async screenshot(filePath) {
    const msg = await this._send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(msg.result.data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  /**
   * Close the WebSocket connection and reject any pending commands.
   */
  close() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    for (const [, { reject, timer }] of this._pending) {
      clearTimeout(timer);
      reject(new Error('Client closed'));
    }
    this._pending.clear();
  }

  /**
   * Factory: connect to the toolbar target (data: URL).
   * Retries until the target appears or timeout.
   * @param {number} port - CDP debug port
   * @param {number} timeoutMs - Max wait time
   * @returns {Promise<CdpClient>}
   */
  static async toolbar(port = 9223, timeoutMs = 15000) {
    const cdp = new CdpClient(port);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        // type==='page' guards against new Chromium-150 background targets
        // (service workers etc.) whose url could false-match; the child
        // WebContentsView + the data: toolbar both enumerate as 'page' (spike).
        const target = await cdp.findTarget(t => t.type === 'page' && t.url && t.url.startsWith('data:'));
        if (target) { await cdp.connect(target.id); return cdp; }
      } catch { /* not ready */ }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Toolbar target not found after ${timeoutMs}ms`);
  }

  /**
   * Factory: connect to the content target (http://localhost).
   * Retries until the target appears or timeout.
   * @param {number} port - CDP debug port
   * @param {number} timeoutMs - Max wait time
   * @returns {Promise<CdpClient>}
   */
  static async content(port = 9223, timeoutMs = 15000) {
    const cdp = new CdpClient(port);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const target = await cdp.findTarget(t => t.type === 'page' && t.url && t.url.startsWith('http://localhost'));
        if (target) { await cdp.connect(target.id); return cdp; }
      } catch { /* not ready */ }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Content target not found after ${timeoutMs}ms`);
  }

  /**
   * Factory: connect to the Council Workspace target (file:// URL — the
   * workspace is the only file:// page; toolbar=data:, content=http).
   * @param {number} port - CDP debug port
   * @param {number} timeoutMs - Max wait time
   * @returns {Promise<CdpClient>}
   */
  static async workspace(port = 9223, timeoutMs = 15000) {
    const cdp = new CdpClient(port);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const target = await cdp.findTarget(t => t.type === 'page' && t.url && t.url.startsWith('file://'));
        // TST-6: logging is enabled for the workspace target only — the toolbar/content
        // factories are left byte-identical so no existing suite changes behaviour.
        if (target) { await cdp.connect(target.id); await cdp.enableLogging(); return cdp; }
      } catch { /* not ready */ }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Workspace target not found after ${timeoutMs}ms`);
  }
}

module.exports = { CdpClient };
