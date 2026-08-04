'use strict';

const {
  classifyBaseUrl, resolveBaseUrlOverride,
  announceBaseUrlNormalizationOnce, _resetBaseUrlNotice,
} = require('../src/utils/base-url-classify');

describe('classifyBaseUrl', () => {
  test.each([undefined, null, '', '   '])('absent for %p', (v) => {
    expect(classifyBaseUrl(v)).toEqual({ form: 'absent', normalized: null });
  });

  test('host form: bare origin', () => {
    expect(classifyBaseUrl('https://api.anthropic.com'))
      .toEqual({ form: 'host', normalized: 'https://api.anthropic.com/v1' });
  });

  test('host form: trailing slash is not doubled', () => {
    expect(classifyBaseUrl('https://proxy.corp/'))
      .toEqual({ form: 'host', normalized: 'https://proxy.corp/v1' });
  });

  test('host form: value is trimmed', () => {
    expect(classifyBaseUrl(' https://api.anthropic.com ').normalized)
      .toBe('https://api.anthropic.com/v1');
  });

  test.each(['https://x.test/v1', 'https://x.test/v1/', 'https://gw.test/api/v1'])(
    'v1 form passes through: %s', (v) => {
      expect(classifyBaseUrl(v)).toEqual({ form: 'v1', normalized: null });
    });

  test.each(['https://x.test/api', 'https://x.test/v2', 'not a url at all'])(
    'other form passes through: %s', (v) => {
      expect(classifyBaseUrl(v)).toEqual({ form: 'other', normalized: null });
    });
});

describe('resolveBaseUrlOverride', () => {
  test('host-form env yields the normalized override', () => {
    expect(resolveBaseUrlOverride({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }))
      .toBe('https://api.anthropic.com/v1');
  });

  test.each([
    [{}, 'unset'],
    [{ ANTHROPIC_BASE_URL: 'https://x.test/v1' }, 'already /v1'],
    [{ ANTHROPIC_BASE_URL: 'https://x.test/custom' }, 'nonstandard path'],
    [{ ANTHROPIC_BASE_URL: 'https://api.anthropic.com', AMICUS_BASE_URL_NORMALIZE: '0' }, 'knob off'],
  ])('null when %j (%s)', (env) => {
    expect(resolveBaseUrlOverride(env)).toBeNull();
  });
});

describe('announceBaseUrlNormalizationOnce', () => {
  beforeEach(() => _resetBaseUrlNotice());

  test('writes one Notice line, once per process', () => {
    const writes = [];
    const deps = { write: s => writes.push(s), logger: { info: () => {} } };
    announceBaseUrlNormalizationOnce('https://h', 'https://h/v1', deps);
    announceBaseUrlNormalizationOnce('https://h', 'https://h/v1', deps);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^Notice: ANTHROPIC_BASE_URL is host-form/);
    expect(writes[0]).toContain('https://h/v1');
    expect(writes[0]).toContain('AMICUS_BASE_URL_NORMALIZE=0');
  });
});
