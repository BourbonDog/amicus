'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');

/**
 * T19-m2 (v4.7 PR7): the matrix's dispute-cell click listener used to call
 * `onDrill(cell.judge, row.id)` and discard whatever it returned. Task 5 made
 * `loadPanel`'s IPC read terminate a rejection, but `drillIntoJudge` (workspace-panels.js)
 * can also throw synchronously inside its own post-load body — a failure Task 5's
 * onRejected handler never sees, because it lives past `loadPanel`'s own return. Both
 * failure modes must be terminated locally, by this listener, and announced via
 * console.error — never escape as an unhandled rejection or a thrown exception out of
 * the click handler.
 */
describe('workspace-matrix.js dispute-cell click terminates onDrill failures (T19-m2)', () => {
  let AmicusMatrix;
  let document;
  let consoleErrorSpy;

  function disputeMatrix() {
    return {
      judges: [{ model: 'gemini', label: 'Review A' }],
      rows: [{
        id: 'A1', severity: 'high', tier: 'Disputed', thin: false, tierOverride: null, debate: null,
        raiser: { model: 'gemini', label: 'Review A' }, basis: { a: 0, d: 1, n: 0 },
        cells: [{ judge: { model: 'gemini', label: 'Review A' }, verdict: 'dispute', sym: '✗', isRaiser: false }],
      }],
      tierCounts: { Disputed: 1 }, judged: true,
    };
  }

  function clickTheDisputeCell(onDrill) {
    const container = document.createElement('div');
    AmicusMatrix.renderMatrix(container, disputeMatrix(), onDrill);
    const voteCells = container.querySelectorAll('td').filter((td) => td.classList.contains('vote-cell'));
    expect(voteCells.length).toBe(1);
    expect(voteCells[0]._listeners.click.length).toBe(1);
    voteCells[0]._listeners.click[0]();
  }

  beforeEach(() => {
    jest.resetModules(); // force both IIFEs to re-run against THIS test's fresh globals below
    const fake = makeFakeDom();
    document = fake.document;
    global.window = fake.window;
    global.document = document;
    global.NodeFilter = fake.NodeFilter;
    // eslint-disable-next-line global-require
    require('../../electron/workspace-ui/workspace-render');
    // eslint-disable-next-line global-require
    require('../../electron/workspace-ui/workspace-matrix');
    AmicusMatrix = global.window.AmicusMatrix;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    delete global.window;
    delete global.document;
    delete global.NodeFilter;
  });

  test('onDrill returning a rejected promise does not escape the click handler, and console.error fires once', async () => {
    const err = new Error('drill: read-artifact rejected');
    const onDrill = jest.fn(() => Promise.reject(err));
    expect(() => clickTheDisputeCell(onDrill)).not.toThrow();
    // Drain the Promise.resolve().then(...).catch(...) chain the click handler kicked off.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(onDrill).toHaveBeenCalledWith({ model: 'gemini', label: 'Review A' }, 'A1');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('workspace matrix: drill into judge failed');
    expect(consoleErrorSpy.mock.calls[0][1]).toBe(err);
  });

  // The case that matters: it is what kills `Promise.resolve(onDrill(...))`, which evaluates
  // onDrill(...) BEFORE Promise.resolve ever sees it, so a synchronous throw escapes anyway.
  test('onDrill throwing synchronously does not escape the click handler, and console.error fires once', async () => {
    const err = new Error('drill: post-load painter threw');
    const onDrill = jest.fn(() => { throw err; });
    expect(() => clickTheDisputeCell(onDrill)).not.toThrow();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(onDrill).toHaveBeenCalledWith({ model: 'gemini', label: 'Review A' }, 'A1');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('workspace matrix: drill into judge failed');
    expect(consoleErrorSpy.mock.calls[0][1]).toBe(err);
  });
});
