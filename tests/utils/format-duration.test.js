// tests/utils/format-duration.test.js
'use strict';

const { formatDuration } = require('../../src/utils/format-duration');

describe('formatDuration (shared ms->human helper)', () => {
  it('rolls minutes up and renders seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(42000)).toBe('42s');
    expect(formatDuration(65000)).toBe('1m5s');
    expect(formatDuration(90000)).toBe('1m30s');
  });

  it('defaults null/undefined to a "-" placeholder', () => {
    expect(formatDuration(null)).toBe('-');
    expect(formatDuration(undefined)).toBe('-');
  });

  it('honors a caller-supplied null placeholder (e.g. the council em dash)', () => {
    expect(formatDuration(null, '—')).toBe('—');
    expect(formatDuration(undefined, '—')).toBe('—');
    // a real duration ignores the placeholder
    expect(formatDuration(65000, '—')).toBe('1m5s');
  });
});
