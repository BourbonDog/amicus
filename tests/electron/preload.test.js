/**
 * Preload startup regression: the preload script evaluates before the page has
 * a documentElement (captured live via CDP — the unguarded appendChild threw
 * "Cannot read properties of null", killing the script before the contextBridge
 * exposure ran). The bridge must always be exposed; the branding CSS is
 * cosmetic and must defer until the DOM exists.
 */

const mockExposeInMainWorld = jest.fn();
const mockIpcRenderer = { invoke: jest.fn(), on: jest.fn() };

// virtual: true lets this mock register even when electron is not installed
// (local dev omits it via --omit=optional). When electron IS present (CI), the
// factory still overrides it, so behavior is identical either way.
jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: mockIpcRenderer,
}), { virtual: true });

const PRELOAD_PATH = '../../electron/preload.js';

/** Minimal document stub; documentElement=null reproduces preload-eval time. */
function makeDocument(documentElement) {
  return {
    documentElement,
    createElement: jest.fn(() => ({ textContent: '' })),
    addEventListener: jest.fn(),
  };
}

describe('electron/preload.js', () => {
  beforeEach(() => {
    jest.resetModules();
    mockExposeInMainWorld.mockClear();
  });

  afterEach(() => {
    delete global.document;
  });

  test('exposes the sidecar bridge without throwing when documentElement is null', () => {
    global.document = makeDocument(null);

    expect(() => require(PRELOAD_PATH)).not.toThrow();

    expect(mockExposeInMainWorld).toHaveBeenCalledTimes(1);
    const [name, api] = mockExposeInMainWorld.mock.calls[0];
    expect(name).toBe('sidecar');
    expect(api).toHaveProperty('fold');
  });

  test('defers branding CSS to DOMContentLoaded when documentElement is null', () => {
    global.document = makeDocument(null);

    // No-throw is pinned by the test above; swallow here so this test stays
    // focused on the deferral contract even if evaluation regresses.
    try { require(PRELOAD_PATH); } catch { /* asserted elsewhere */ }

    const dclCalls = global.document.addEventListener.mock.calls
      .filter(([event]) => event === 'DOMContentLoaded');
    expect(dclCalls).toHaveLength(1);

    // Fire the deferred injection once the DOM exists
    const appendChild = jest.fn();
    global.document.documentElement = { appendChild };
    dclCalls[0][1]();

    expect(appendChild).toHaveBeenCalledTimes(1);
    const style = appendChild.mock.calls[0][0];
    expect(style.textContent).toContain('header { display: none');
    expect(style.textContent).toContain('background-color');
  });

  test('appends branding CSS immediately when documentElement already exists', () => {
    const appendChild = jest.fn();
    global.document = makeDocument({ appendChild });

    require(PRELOAD_PATH);

    expect(appendChild).toHaveBeenCalledTimes(1);
    const style = appendChild.mock.calls[0][0];
    expect(style.textContent).toContain('header { display: none');
    expect(global.document.addEventListener).not.toHaveBeenCalled();
  });

  test('a throwing DOM cannot kill the bridge exposure', () => {
    global.document = makeDocument({
      appendChild: () => { throw new Error('hostile DOM'); },
    });

    expect(() => require(PRELOAD_PATH)).not.toThrow();
    expect(mockExposeInMainWorld).toHaveBeenCalledWith('sidecar', expect.any(Object));
  });
});
