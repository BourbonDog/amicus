'use strict';
/**
 * src/utils/http-get.js — the always-resolves HTTPS GET shared by the
 * provider model fetch (#209 failure vocabulary) and the models.dev ceiling
 * fetch (#218 P3). Same mock shape as tests/model-fetcher.test.js:
 * https.get(url, { headers }, cb) returning an object with on()/destroy().
 */
const { EventEmitter } = require('events');
const https = require('https');

jest.mock('https');

const { httpGetText, getJson, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES, MAX_REDIRECTS } = require('../../src/utils/http-get');

/**
 * Serve a SCRIPTED sequence, one entry per https.get call (the last entry
 * repeats, so a one-entry sequence is an endless loop). Returns the array the
 * requested URLs are pushed into, which is how a hop count is asserted.
 * @param {Array<{status?: number, body?: string, headers?: object}>} seq
 * @returns {string[]}
 */
function mockSequence(seq) {
  const urls = [];
  https.get.mockImplementation((url, _opts, cb) => {
    urls.push(url);
    const o = seq[Math.min(urls.length - 1, seq.length - 1)];
    const req = new EventEmitter();
    req.destroy = jest.fn();
    const res = new EventEmitter();
    res.statusCode = o.status === undefined ? 200 : o.status;
    res.headers = o.headers || {};
    res.setEncoding = jest.fn();
    cb(res);
    process.nextTick(() => { if (o.body) { res.emit('data', o.body); } res.emit('end'); });
    return req;
  });
  return urls;
}

/** @param {{status?: number, body?: string, error?: Error, hang?: boolean, hangBody?: boolean}} o */
function mockGet(o = {}) {
  const req = new EventEmitter();
  req.destroy = jest.fn();
  https.get.mockImplementation((_url, _opts, cb) => {
    if (o.error) { process.nextTick(() => req.emit('error', o.error)); return req; }
    if (o.hang) { return req; }
    const res = new EventEmitter();
    res.statusCode = o.status === undefined ? 200 : o.status;
    res.setEncoding = jest.fn();
    cb(res);
    // hangBody: headers arrived, the body never ends — the timer must still fire.
    if (o.hangBody) { return req; }
    process.nextTick(() => { if (o.body) { res.emit('data', o.body); } res.emit('end'); });
    return req;
  });
  return req;
}

describe('httpGetText', () => {
  afterEach(() => { jest.useRealTimers(); https.get.mockReset(); });

  it('resolves {ok:true, body} on a 200', async () => {
    mockGet({ body: '{"a":1}' });
    await expect(httpGetText('https://x.test/y')).resolves.toEqual({ ok: true, body: '{"a":1}' });
  });

  it('passes headers through and defaults the timeout', async () => {
    mockGet({ body: 'ok' });
    await httpGetText('https://x.test/y', { headers: { 'User-Agent': 'amicus/test' } });
    expect(https.get).toHaveBeenCalledWith('https://x.test/y', { headers: { 'User-Agent': 'amicus/test' } }, expect.any(Function));
    expect(DEFAULT_TIMEOUT_MS).toBe(5000);
  });

  it('reports a non-200 as http-status with the code', async () => {
    mockGet({ status: 401, body: 'nope' });
    await expect(httpGetText('https://x.test/y')).resolves.toEqual({ ok: false, failure: { reason: 'http-status', status: 401 } });
  });

  it('reports a socket error as network-error', async () => {
    mockGet({ error: new Error('ECONNRESET') });
    await expect(httpGetText('https://x.test/y')).resolves.toEqual({ ok: false, failure: { reason: 'network-error', detail: 'ECONNRESET' } });
  });

  it('destroys the request and reports timeout when nothing answers', async () => {
    jest.useFakeTimers();
    const req = mockGet({ hang: true });
    const p = httpGetText('https://x.test/y', { timeoutMs: 250 });
    jest.advanceTimersByTime(251);
    await expect(p).resolves.toEqual({ ok: false, failure: { reason: 'timeout', detail: 'no response within 250ms' } });
    expect(req.destroy).toHaveBeenCalledTimes(1);
  });

  it('times out a non-200 whose body never ends (the timer stays armed until end)', async () => {
    jest.useFakeTimers();
    const req = mockGet({ status: 500, hangBody: true });
    const p = httpGetText('https://x.test/y', { timeoutMs: 250 });
    jest.advanceTimersByTime(251);
    await expect(p).resolves.toEqual({ ok: false, failure: { reason: 'timeout', detail: 'no response within 250ms' } });
    expect(req.destroy).toHaveBeenCalledTimes(1);
  });

  // Council #230 A2/C1: a mid-body error is emitted on `res`, and an EventEmitter
  // with no 'error' listener rethrows it — the promise would never settle. Drop the
  // `res.on('error', onError)` line and this test fails with an uncaught error.
  it('resolves network-error when the response stream errors mid-body, and never throws', async () => {
    https.get.mockImplementation((_url, _opts, cb) => {
      const req = new EventEmitter();
      req.destroy = jest.fn();
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setEncoding = jest.fn();
      cb(res);
      process.nextTick(() => { res.emit('data', '{\"half\":'); res.emit('error', new Error('aborted mid-body')); });
      return req;
    });
    await expect(httpGetText('https://x.test/y')).resolves.toEqual({
      ok: false, failure: { reason: 'network-error', detail: 'aborted mid-body' },
    });
  });

  // Council #230 D6: https.get throws SYNCHRONOUSLY on a URL it cannot parse, which
  // would reject the promise and break the "always resolves" contract.
  it('resolves network-error when https.get throws synchronously on a malformed URL', async () => {
    https.get.mockImplementation(() => { throw new TypeError('Invalid URL'); });
    await expect(httpGetText('not a url')).resolves.toEqual({
      ok: false, failure: { reason: 'network-error', detail: 'Invalid URL' },
    });
  });

  // Council #230 A2: a redirect on models.dev/api.json used to be a terminal
  // http-status failure, so a domain move would silently stop filling ceilings.
  it('follows a 302 to the final 200 body', async () => {
    const urls = mockSequence([
      { status: 302, headers: { location: 'https://y.test/moved.json' } },
      { body: '{"final":true}' },
    ]);
    await expect(httpGetText('https://x.test/y')).resolves.toEqual({ ok: true, body: '{"final":true}' });
    expect(urls).toEqual(['https://x.test/y', 'https://y.test/moved.json']);
  });

  it('resolves a relative Location against the URL that produced it', async () => {
    const urls = mockSequence([
      { status: 301, headers: { location: '/moved.json' } },
      { body: 'ok' },
    ]);
    await expect(httpGetText('https://x.test/a/b')).resolves.toEqual({ ok: true, body: 'ok' });
    expect(urls[1]).toBe('https://x.test/moved.json');
  });

  it('gives up after two hops rather than chasing a redirect loop', async () => {
    const urls = mockSequence([{ status: 302, headers: { location: 'https://x.test/y' } }]);
    await expect(httpGetText('https://x.test/y')).resolves.toEqual({
      ok: false, failure: { reason: 'http-status', status: 302, detail: 'redirect limit reached' },
    });
    expect(urls).toHaveLength(MAX_REDIRECTS + 1);
  });

  it('refuses a redirect that downgrades to http and never re-sends the headers', async () => {
    const urls = mockSequence([{ status: 302, headers: { location: 'http://x.test/y' } }]);
    await expect(httpGetText('https://x.test/y', { headers: { Authorization: 'Bearer t' } })).resolves.toEqual({
      ok: false, failure: { reason: 'http-status', status: 302, detail: 'redirect to non-https location' },
    });
    expect(urls).toHaveLength(1);
  });

  it('reports a 3xx with no Location rather than hanging', async () => {
    mockSequence([{ status: 307 }]);
    await expect(httpGetText('https://x.test/y')).resolves.toEqual({
      ok: false, failure: { reason: 'http-status', status: 307, detail: 'redirect without Location' },
    });
  });

  // Council #230 B3: the body was accumulated into a string with no bound.
  it('destroys the request and reports too-large when the body passes maxBytes', async () => {
    const req = mockGet({ body: 'x'.repeat(20) });
    await expect(httpGetText('https://x.test/y', { maxBytes: 8 })).resolves.toEqual({
      ok: false, failure: { reason: 'too-large', detail: 'body exceeded 8 bytes' },
    });
    expect(req.destroy).toHaveBeenCalledTimes(1);
    expect(DEFAULT_MAX_BYTES).toBe(16 * 1024 * 1024);
  });

  it('decodes the body once at the stream rather than per chunk', async () => {
    let captured = null;
    https.get.mockImplementation((_url, _opts, cb) => {
      const req = new EventEmitter();
      req.destroy = jest.fn();
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setEncoding = jest.fn((enc) => { captured = enc; });
      cb(res);
      process.nextTick(() => { res.emit('data', 'ok'); res.emit('end'); });
      return req;
    });
    await httpGetText('https://x.test/y');
    expect(captured).toBe('utf8');
  });
});

describe('getJson', () => {
  afterEach(() => { https.get.mockReset(); });

  it('parses a JSON body', async () => {
    mockGet({ body: '{"models":[]}' });
    await expect(getJson('https://x.test/api.json')).resolves.toEqual({ ok: true, json: { models: [] } });
  });

  it('reports a non-JSON body as parse-error', async () => {
    mockGet({ body: '<html>' });
    const r = await getJson('https://x.test/api.json');
    expect(r.ok).toBe(false);
    expect(r.failure.reason).toBe('parse-error');
    expect(typeof r.failure.detail).toBe('string');
  });

  it('forwards a transport failure unchanged', async () => {
    mockGet({ status: 503 });
    await expect(getJson('https://x.test/api.json')).resolves.toEqual({ ok: false, failure: { reason: 'http-status', status: 503 } });
  });
});
