'use strict';
const { sanitizePreview, latestAssistantPreview, deriveStage } = require('../../src/sidecar/progress-fields');

describe('sanitizePreview', () => {
  test('collapses newlines, strips fence/tag chars, caps at 120 + ellipsis', () => {
    const raw = '```js\nconst x = 1;\n```\n<system-reminder>hi</system-reminder> ' + 'y'.repeat(200);
    const out = sanitizePreview(raw);
    expect(out).not.toMatch(/[`<>\n]/);
    expect(out.length).toBeLessThanOrEqual(121);
    expect(out.endsWith('…')).toBe(true);
  });
  test('short clean text passes through', () => {
    expect(sanitizePreview('all good')).toBe('all good');
  });
});

describe('latestAssistantPreview', () => {
  test('returns the NEWEST assistant text, skipping tool lines', () => {
    const entries = [
      { role: 'assistant', content: 'first answer' },
      { role: 'assistant', type: 'tool_use', toolCall: { id: 't1', name: 'Bash' } },
      { role: 'tool', type: 'tool_result', content: 'ok' },
      { role: 'assistant', content: 'final answer' },
    ];
    expect(latestAssistantPreview(entries)).toBe('final answer');
  });
  test('null when no assistant text yet', () => {
    expect(latestAssistantPreview([{ role: 'user', content: 'hi' }])).toBeNull();
    expect(latestAssistantPreview([])).toBeNull();
  });
});

describe('deriveStage', () => {
  test.each([
    ['complete', undefined, 'terminal'],
    ['error', 'receiving', 'terminal'],
    ['timed-out', undefined, 'terminal'],
    ['running', 'receiving', 'generating'],
    ['running', 'complete', 'folding'],
    ['running', 'prompt_sent', 'starting'],
    ['running', undefined, 'starting'],
    [undefined, undefined, 'starting'],
  ])('(%s, %s) -> %s', (status, stage, expected) => {
    expect(deriveStage(status, stage)).toBe(expected);
  });
});
