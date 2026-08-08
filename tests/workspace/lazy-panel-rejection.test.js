'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

/**
 * T19-m2 (v4.7 PR7, Task 5): jest driver for the raw-node probe next to this file
 * (lazy-panel-rejection.probe.js). Spawned out-of-process via execFileSync because jest itself
 * swallows unhandled rejections (converts each into a failed test), which would make any
 * in-process `process.on('unhandledRejection')` assertion here pass on broken code — see that
 * file's own header and the plan's Global Constraints, testing rule 1.
 */
describe('lazy panel rejection (Task 5, v4.7 PR7, T19-m2): terminate and evict, announced', () => {
  test('a rejected read-artifact load leaves no unhandled rejection, logs at least once, and the panel recovers on reopen', () => {
    const probePath = path.join(__dirname, 'lazy-panel-rejection.probe.js');
    const out = execFileSync(process.execPath, [probePath], { encoding: 'utf8' });
    const result = JSON.parse(out.trim().split('\n').pop());

    expect(result.unhandled).toEqual([]);
    expect(result.sectionsAfterRecovery).toBeGreaterThan(0);
    expect(result.consoleErrors).toBeGreaterThanOrEqual(1);
  });
});
