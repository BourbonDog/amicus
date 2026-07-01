/**
 * IPC guard helpers (M9 defense-in-depth + L10 fatal-exception quit).
 *
 * These pure helpers back the security-sensitive bits of main.js, which cannot
 * be imported here without heavy Electron side effects. They are unit-tested in
 * isolation; main.js wires them in.
 */

const {
  isPrivilegedSender,
  isAllowedContentNavigation,
  handleFatalException,
} = require('../../electron/ipc-guard');

describe('isPrivilegedSender', () => {
  const toolbarContents = { id: 'toolbar' };
  const toolbarWindow = { webContents: toolbarContents, isDestroyed: () => false };

  test('accepts an event from the toolbar window webContents', () => {
    const event = { sender: toolbarContents };
    expect(isPrivilegedSender(event, () => toolbarWindow)).toBe(true);
  });

  test('rejects an event from the content BrowserView (foreign sender)', () => {
    const event = { sender: { id: 'contentView' } };
    expect(isPrivilegedSender(event, () => toolbarWindow)).toBe(false);
  });

  test('rejects when the toolbar window is missing', () => {
    const event = { sender: toolbarContents };
    expect(isPrivilegedSender(event, () => null)).toBe(false);
  });

  test('rejects when the toolbar window is destroyed', () => {
    const event = { sender: toolbarContents };
    const destroyed = { webContents: toolbarContents, isDestroyed: () => true };
    expect(isPrivilegedSender(event, () => destroyed)).toBe(false);
  });

  test('rejects a malformed event with no sender', () => {
    expect(isPrivilegedSender({}, () => toolbarWindow)).toBe(false);
    expect(isPrivilegedSender(undefined, () => toolbarWindow)).toBe(false);
  });
});

describe('isAllowedContentNavigation', () => {
  const origin = 'http://localhost:4096';

  test('allows same-origin OpenCode URLs (any path)', () => {
    expect(isAllowedContentNavigation('http://localhost:4096/session/abc', origin)).toBe(true);
    expect(isAllowedContentNavigation('http://localhost:4096/', origin)).toBe(true);
  });

  test('allows data: URLs (in-app error page)', () => {
    expect(isAllowedContentNavigation('data:text/html,hello', origin)).toBe(true);
  });

  test('blocks a different host', () => {
    expect(isAllowedContentNavigation('http://evil.example.com/', origin)).toBe(false);
  });

  test('blocks a different port on localhost', () => {
    expect(isAllowedContentNavigation('http://localhost:9999/', origin)).toBe(false);
  });

  test('blocks a different scheme (https / file)', () => {
    expect(isAllowedContentNavigation('https://localhost:4096/', origin)).toBe(false);
    expect(isAllowedContentNavigation('file:///etc/passwd', origin)).toBe(false);
  });

  test('blocks empty / non-string targets', () => {
    expect(isAllowedContentNavigation('', origin)).toBe(false);
    expect(isAllowedContentNavigation(undefined, origin)).toBe(false);
  });
});

describe('handleFatalException', () => {
  test('EPIPE is a benign no-op: no log, no quit', () => {
    const quit = jest.fn();
    const log = jest.fn();
    handleFatalException(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }), { quit, log });
    expect(quit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  test('a genuine uncaught exception logs and quits', () => {
    const quit = jest.fn();
    const log = jest.fn();
    const err = new Error('boom');
    handleFatalException(err, { quit, log });
    expect(log).toHaveBeenCalledWith(err);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  test('quits even without a log function provided', () => {
    const quit = jest.fn();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    handleFatalException(new Error('boom'), { quit });
    expect(quit).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
