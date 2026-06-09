'use strict';

jest.mock('child_process', () => ({ execFileSync: jest.fn() }));
const { execFileSync } = require('child_process');
const { findListenerPid } = require('../../src/utils/port-pid');

const realPlatform = process.platform;
function setPlatform(p) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
afterEach(() => { setPlatform(realPlatform); jest.clearAllMocks(); });

describe('findListenerPid', () => {
  test('parses the LISTENING pid from netstat on win32', () => {
    setPlatform('win32');
    execFileSync.mockReturnValue(
      '\r\n  Proto  Local Address      Foreign Address    State        PID\r\n' +
      '  TCP    127.0.0.1:4096     0.0.0.0:0          LISTENING    4321\r\n' +
      '  TCP    127.0.0.1:5000     0.0.0.0:0          LISTENING    9999\r\n'
    );
    expect(findListenerPid(4096)).toBe(4321);
  });

  test('parses the pid from lsof on unix', () => {
    setPlatform('linux');
    execFileSync.mockReturnValue('5678\n');
    expect(findListenerPid(4096)).toBe(5678);
  });

  test('returns null when no listener is found', () => {
    setPlatform('linux');
    execFileSync.mockImplementation(() => { throw new Error('no process'); });
    expect(findListenerPid(4096)).toBe(null);
  });

  test('returns null when port is not listed on win32', () => {
    setPlatform('win32');
    execFileSync.mockReturnValue('  TCP    127.0.0.1:5000     0.0.0.0:0          LISTENING    9999\r\n');
    expect(findListenerPid(4096)).toBe(null);
  });
});
