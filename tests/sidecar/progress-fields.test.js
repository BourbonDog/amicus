'use strict';
const {
  sanitizePreview, latestAssistantPreview, deriveStage, TERMINAL_PROGRESS_STAGES,
} = require('../../src/sidecar/progress-fields');
const { resolveTerminalState } = require('../../src/sidecar/session-finalize');

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
  test('skips assistant entries with non-string content (array/null) without crashing', () => {
    const entries = [
      { role: 'assistant', content: 'real text' },
      { role: 'assistant', content: [{ type: 'text', text: 'array form' }] },
      { role: 'assistant', content: null },
    ];
    expect(latestAssistantPreview(entries)).toBe('real text');
    expect(latestAssistantPreview([
      { role: 'assistant', content: [{ type: 'text', text: 'only array' }] },
    ])).toBeNull();
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

  /**
   * v4.4.1 LC-3. headless.js's terminal progress record used to hardcode
   * 'complete'; it now derives the stage from resolveTerminalState, so
   * 'aborted' / 'error' / 'timed-out' are reachable stage values for the first
   * time. deriveStage is the ONLY reader in src/ or electron/ that
   * string-matches a progress stage (everything else passes it through as
   * display text), so it is the only one that had to move — and if it had NOT
   * moved, a terminal-but-not-yet-finalized leg would have fallen through to
   * 'starting': a finished leg reported as barely begun, which is strictly
   * worse than the green check LC-3 removes.
   */
  describe('LC-3: every terminal progress stage folds, not just "complete"', () => {
    test.each([
      ['running', 'aborted', 'folding'],
      ['running', 'error', 'folding'],
      ['running', 'timed-out', 'folding'],
      // Still-live stages are untouched.
      ['running', 'session_created', 'starting'],
      ['running', 'receiving', 'generating'],
      // An unknown stage is still conservatively 'starting'.
      ['running', 'not-a-real-stage', 'starting'],
    ])('(%s, %s) -> %s', (status, stage, expected) => {
      expect(deriveStage(status, stage)).toBe(expected);
    });

    test('metadata status still wins over any terminal stage', () => {
      for (const stage of TERMINAL_PROGRESS_STAGES) {
        expect(deriveStage('aborted', stage)).toBe('terminal');
      }
    });

    /**
     * DRIFT PIN. headless.js writes `resolveTerminalState(...).status` verbatim
     * as the stage, so any status that function can return but this set does not
     * contain is a stage deriveStage would silently mis-bucket as 'starting'.
     */
    test('TERMINAL_PROGRESS_STAGES covers every status resolveTerminalState can return', () => {
      const produced = new Set([
        resolveTerminalState({ completed: true }).status,
        resolveTerminalState({ aborted: true }).status,
        resolveTerminalState({ timedOut: true }).status,
        resolveTerminalState({ error: new Error('x') }).status,
        resolveTerminalState({}).status,
        resolveTerminalState(null).status,
      ]);
      expect([...produced].sort()).toEqual(['aborted', 'complete', 'error', 'timed-out']);
      for (const status of produced) {
        expect(TERMINAL_PROGRESS_STAGES.has(status)).toBe(true);
      }
    });
  });
});
