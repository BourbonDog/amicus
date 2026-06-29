const { createFoldHandler } = require('../electron/fold');

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
      },
    };

    const handler = createFoldHandler({
      model: 'gemini', client: 'cowork', cwd: '/tmp',
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
  });

  test('overlay spinner + title use accent/text tokens', async () => {
    const { showFoldOverlay } = require('../electron/fold');
    const scripts = [];
    const view = { webContents: { executeJavaScript: jest.fn((s) => { scripts.push(s); return Promise.resolve(); }) } };
    const win = { webContents: { executeJavaScript: jest.fn((s) => { scripts.push(s); return Promise.resolve(); }) } };
    showFoldOverlay(win, view);
    const all = scripts.join(' ');
    expect(all).toContain('var(--accent)');       // content spinner border-top
    expect(all).toContain('var(--accent-line)');  // content spinner track
    expect(all).toContain('var(--text-1)');       // overlay title
    expect(all).toContain('var(--text-3)');       // overlay subtitle
    expect(all).not.toContain('#D97757');
    expect(all).not.toContain('rgba(217,119,87,0.3)');
  });
});
