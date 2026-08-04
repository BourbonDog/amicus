'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');

/**
 * D8 extraction pin (Task 1, v4.6.2 PR4): renderSeatsPanel moved out of
 * workspace-panels.js into its own window.AmicusSeats module (workspace-seats.js);
 * panels.js keeps a thin delegate so window.AmicusPanels.renderSeatsPanel — the P2
 * contract surface workspace-app-boundary.test.js already pins — keeps working. That
 * existing boundary test only proves END-TO-END behavior (seats-body gets painted via a
 * full openRun()); it can't tell a genuine extraction apart from a copy-paste duplicate
 * left behind in panels.js. This is the one thin delegate pin the brief calls for: prove
 * panels.js's renderSeatsPanel actually ROUTES THROUGH window.AmicusSeats.renderSeatsPanel
 * at call time, not a second, silently-diverging copy of the logic.
 */
describe('workspace-seats.js extraction: panels.renderSeatsPanel delegates to AmicusSeats', () => {
  beforeEach(() => {
    jest.resetModules(); // force both IIFEs to re-run against THIS test's fresh globals below
    const fake = makeFakeDom();
    global.window = fake.window;
    global.document = fake.document;
    global.NodeFilter = fake.NodeFilter;
    // workspace-seats.js must load before workspace-panels.js (its delegate target),
    // same order as index.html and the canonical SCRIPT_LOAD_ORDER.
    // eslint-disable-next-line global-require
    require('../../electron/workspace-ui/workspace-seats');
    // eslint-disable-next-line global-require
    require('../../electron/workspace-ui/workspace-panels');
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.NodeFilter;
  });

  test('window.AmicusPanels.renderSeatsPanel still exists and delegates to window.AmicusSeats.renderSeatsPanel at call time', () => {
    expect(typeof global.window.AmicusPanels.renderSeatsPanel).toBe('function');
    const spy = jest.spyOn(global.window.AmicusSeats, 'renderSeatsPanel').mockImplementation(() => {});
    global.window.AmicusPanels.renderSeatsPanel();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
