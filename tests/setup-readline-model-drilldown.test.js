'use strict';

const { promptForVendorModel } = require('../src/sidecar/setup');

function shortlist() {
  const mk = (id, price, rec) => ({
    id, name: id.split('/').pop(), contextLength: 128000,
    pricePerMInput: price, isRecommended: !!rec,
    directId: id, openrouterId: 'openrouter/' + id,
  });
  return {
    recommendedId: 'deepseek/deepseek-v4-pro',
    suggested: [
      mk('deepseek/deepseek-v4-pro', 0.52, true),
      mk('deepseek/deepseek-v4-flash', 0.06),
    ],
    rest: [mk('deepseek/deepseek-r1', 0.70)],
    total: 3,
  };
}

// FIFO mock: each call consumes the next scripted answer. Required — the
// shared mockReadline in setup-readline.test.js returns ONE answer to every
// prompt, which would silently absorb this new sub-prompt.
function fifoAsk(answers) {
  const queue = answers.slice();
  const asked = [];
  const ask = (q) => { asked.push(q); return Promise.resolve(queue.shift()); };
  return { ask, asked };
}

describe('promptForVendorModel', () => {
  test('bare Enter keeps the family default (returns null)', async () => {
    const { ask } = fifoAsk(['']);
    await expect(promptForVendorModel(ask, () => {}, shortlist(), 'deepseek'))
      .resolves.toBeNull();
  });

  test('a number selects that suggested row', async () => {
    const { ask } = fifoAsk(['2']);
    await expect(promptForVendorModel(ask, () => {}, shortlist(), 'deepseek'))
      .resolves.toBe('deepseek/deepseek-v4-flash');
  });

  test('"a" prints the full list and then accepts a number spanning it', async () => {
    const lines = [];
    const { ask } = fifoAsk(['a', '3']);
    const chosen = await promptForVendorModel(ask, l => lines.push(l), shortlist(), 'deepseek');
    expect(chosen).toBe('deepseek/deepseek-r1');
    expect(lines.join('\n')).toContain('deepseek/deepseek-r1');
  });

  test('a pasted full model id is accepted verbatim', async () => {
    const { ask } = fifoAsk(['deepseek/deepseek-chat']);
    await expect(promptForVendorModel(ask, () => {}, shortlist(), 'deepseek'))
      .resolves.toBe('deepseek/deepseek-chat');
  });

  test('an invalid entry re-prompts once, then keeps the family default', async () => {
    const { ask, asked } = fifoAsk(['zzz', 'zzz']);
    await expect(promptForVendorModel(ask, () => {}, shortlist(), 'deepseek'))
      .resolves.toBeNull();
    expect(asked).toHaveLength(2);
  });

  test('the prompt does NOT contain "Pick a number"', async () => {
    // Guard rail: tests/sidecar/setup.test.js:392,475 branch on that literal
    // and would answer '' here, making any new coverage fake-green.
    const { ask, asked } = fifoAsk(['']);
    await promptForVendorModel(ask, () => {}, shortlist(), 'deepseek');
    expect(asked.join(' ')).not.toContain('Pick a number');
  });

  test('an empty shortlist is a silent no-op — never prompts', async () => {
    const { ask, asked } = fifoAsk([]);
    const empty = { recommendedId: null, suggested: [], rest: [], total: 0 };
    await expect(promptForVendorModel(ask, () => {}, empty, 'deepseek'))
      .resolves.toBeNull();
    expect(asked).toHaveLength(0);
  });
});
