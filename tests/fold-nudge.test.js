const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFoldHandler } = require('../electron/fold');

// v4.7 PR3 rider (hermeticity): sandbox, not the literal '/tmp' (= C:\tmp on
// Windows, outside any sandbox). Pinned by tests/hermetic-tmp-guard.test.js.
const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-fold-'));
afterAll(() => { fs.rmSync(PROJECT, { recursive: true, force: true }); });

// Mock dependencies
jest.mock('../electron/summary', () => ({
  requestSummaryFromModel: jest.fn().mockResolvedValue('Test summary'),
}));
jest.mock('../src/prompt-builder', () => ({
  getSummaryTemplate: jest.fn().mockReturnValue('template'),
}));
// virtual: true lets this mock register even when electron is not installed
// (local dev omits it via --omit=optional). When electron IS present (CI), the
// factory still overrides it, so behavior is identical either way.
jest.mock('electron', () => ({
  app: { quit: jest.fn() },
}), { virtual: true });

describe('Fold nudge message', () => {
  let stdoutSpy;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  test('shows nudge overlay after fold completes', async () => {
    const executedScripts = [];
    const injectedCss = [];
    const mockWindow = {
      close: jest.fn(),
      isDestroyed: () => false,
      webContents: {
        executeJavaScript: jest.fn((script) => {
          executedScripts.push(script);
          return Promise.resolve();
        }),
      },
    };
    const mockContentView = {
      webContents: {
        executeJavaScript: jest.fn((script) => {
          executedScripts.push(script);
          return Promise.resolve();
        }),
        insertCSS: jest.fn((css) => {
          injectedCss.push(css);
          return Promise.resolve();
        }),
      },
    };

    const handler = createFoldHandler({
      model: 'gemini', client: 'cowork', cwd: PROJECT,
      sessionId: 'ses_123', taskId: 'task-1', port: 4096,
    });

    await handler.triggerFold(mockWindow, mockContentView);

    const allScripts = executedScripts.join(' ');
    expect(allScripts).toContain('Tell Claude');
    expect(allScripts).toContain('done with the Amicus session');
    // token adoption: no hardcoded hex left in the injected overlay scripts
    expect(allScripts).not.toContain('#E8E0D8');
    expect(allScripts).not.toContain('#7A756F');
    expect(allScripts).not.toContain('#D97757');
    expect(allScripts).not.toContain('rgba(217,119,87,0.3)');
    expect(allScripts).toContain('var(--text-1)');
    expect(allScripts).toContain('var(--font-sans)');

    // (a) content-view insertCSS is scoped to #amicus-fold-overlay and contains a token var
    const allCss = injectedCss.join(' ');
    expect(allCss).toContain('#amicus-fold-overlay');
    expect(allCss).toContain('--accent');
    // (b) no bare global :root injected into the content view
    expect(allCss).not.toMatch(/:root\s*\{/);
    // (c) overlay element carries id="amicus-fold-overlay"
    expect(allScripts).toContain("overlay.id = 'amicus-fold-overlay'");
    // (d) overlay children still reference var(--accent) and var(--text-1)
    expect(allScripts).toContain('var(--accent)');
    expect(allScripts).toContain('var(--text-1)');
  });

  test('overlay spinner + title use accent/text tokens', async () => {
    const { showFoldOverlay } = require('../electron/fold');
    const scripts = [];
    const cssBlocks = [];
    const view = {
      webContents: {
        executeJavaScript: jest.fn((s) => { scripts.push(s); return Promise.resolve(); }),
        insertCSS: jest.fn((css) => { cssBlocks.push(css); return Promise.resolve(); }),
      },
    };
    const win = { webContents: { executeJavaScript: jest.fn((s) => { scripts.push(s); return Promise.resolve(); }) } };
    showFoldOverlay(win, view);
    const all = scripts.join(' ');
    expect(all).toContain('var(--accent)');       // content spinner border-top
    expect(all).toContain('var(--accent-line)');  // content spinner track
    expect(all).toContain('var(--text-1)');       // overlay title
    expect(all).toContain('var(--text-3)');       // overlay subtitle
    expect(all).not.toContain('#D97757');
    expect(all).not.toContain('rgba(217,119,87,0.3)');
    // scoped token injection assertions
    const allCss = cssBlocks.join(' ');
    expect(allCss).toContain('#amicus-fold-overlay'); // (a) scoped to overlay id
    expect(allCss).toContain('--accent');             // (a) contains a token var
    expect(allCss).not.toMatch(/:root\s*\{/);         // (b) no bare global :root
    expect(all).toContain("overlay.id = 'amicus-fold-overlay'"); // (c) element has correct id
  });
});
