// tests/sidecar/aliases-review.test.js
'use strict';

const DAY = 24 * 60 * 60 * 1000;

function makeDeps({ proposals, rows = [], fetchedAt = Date.now(), answers = [], models = [] }) {
  const out = [];
  const err = [];
  const writes = { addAlias: [], removeAlias: [], recordDismissal: [] };
  const calls = { collectAliasView: [] };
  const queue = [...answers];
  return {
    deps: {
      isTTY: true,
      write: (s) => out.push(String(s)),
      ask: async () => { if (queue.length === 0) { throw new Error('no more scripted answers'); } return queue.shift(); },
      collectAliasView: async (opts) => { calls.collectAliasView.push(opts); return { rows, proposals, catalogInfo: { models, fetchedAt, providerFailures: [] }, catalogAvailable: models.length > 0 }; },
      renderAliasList: () => 'LIST\n',
      addAlias: (a, id) => writes.addAlias.push([a, id]),
      removeAlias: (a) => { writes.removeAlias.push(a); return true; },
      recordDismissal: (k) => writes.recordDismissal.push(k),
      effectiveAliasNames: () => new Set(rows.map(r => r.alias)),
      stderr: (s) => err.push(String(s)),
    },
    out: () => out.join(''), err: () => err.join(''), writes, calls,
  };
}

const glm = {
  alias: 'glm', state: 'pinned', current: 'openrouter/z-ai/glm-5.2', shipped: 'openrouter/z-ai/glm-5.3', curated: true,
  reasons: ['newer-sibling', 'differs-from-shipped'],
  candidates: [{ id: 'openrouter/z-ai/glm-5.4', why: 'newer-sibling', evidence: {} }, { id: 'openrouter/z-ai/glm-5.3', why: 'follow', evidence: {} }],
  dismissKey: 'glm@openrouter/z-ai/glm-5.4',
};
const atlas = {
  alias: 'atlas', state: 'unmapped', current: null, shipped: null, curated: false, reasons: ['notable-unmapped'],
  candidates: [{ id: 'openrouter/newco/atlas-1', why: 'notable', evidence: { note: 'new frontier entrant' } }],
  dismissKey: 'atlas@openrouter/newco/atlas-1',
};

describe('aliases --review (#238 §4, Q2, Q4)', () => {
  let runReview;
  beforeEach(() => { jest.resetModules(); ({ runReview } = require('../../src/sidecar/aliases-review')); });

  test('Q2: without a TTY it prints the list, one reason line on stderr, exit 1, writes nothing', async () => {
    const t = makeDeps({ proposals: [glm], models: [{ id: 'x/y' }] });
    t.deps.isTTY = false;
    expect(await runReview({}, t.deps)).toBe(1);
    expect(t.out()).toBe('LIST\n');
    expect(t.err()).toContain('aliases --review is interactive');
    expect(t.writes.addAlias).toEqual([]);
  });
  test('nothing to review exits 0 with a sentence', async () => {
    const t = makeDeps({ proposals: [], rows: [{ alias: 'gemini' }], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('Nothing to review');
  });
  test('accept [1] pins the sibling; the screen shows current, shipped, proposed and a numbered menu', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['1'], models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toMatch(/\[1\/1\] glm/);
    expect(t.out()).toContain('currently  openrouter/z-ai/glm-5.2');
    expect(t.out()).toContain('shipped    openrouter/z-ai/glm-5.3');
    expect(t.out()).toContain('[1] accept openrouter/z-ai/glm-5.4');
    expect(t.out()).toContain('[2] follow the shipped pin (openrouter/z-ai/glm-5.3)');
    expect(t.out()).toContain('[3] choose another');
    expect(t.writes.addAlias).toEqual([['glm', 'openrouter/z-ai/glm-5.4']]);
    expect(t.out()).toContain('✓ glm → openrouter/z-ai/glm-5.4 (pinned)');
    expect(t.out()).toContain('Reviewed 1 proposal: 1 accepted, 0 skipped, 0 dismissed.');
  });
  test('follow [2] removes the key (Q4: the encoding decides the state)', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['2'], models: [{ id: 'x/y' }] });
    await runReview({}, t.deps);
    expect(t.writes.removeAlias).toEqual(['glm']);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).toContain('✓ glm now follows the shipped recommendation (openrouter/z-ai/glm-5.3)');
  });
  test('choose another [3] validates against the catalog and pins; blank cancels back to the menu', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', 'nope', 'openrouter/z-ai/glm-5.9', 'openrouter/z-ai/glm-5.4'], models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    await runReview({}, t.deps);
    expect(t.out()).toContain('not in the catalog');
    expect(t.writes.addAlias).toEqual([['glm', 'openrouter/z-ai/glm-5.4']]);
  });
  test('skip [4] writes nothing; never ask again [5] records the dismissKey', async () => {
    const t = makeDeps({ proposals: [glm, { ...glm, alias: 'glm2', dismissKey: 'glm2@openrouter/z-ai/glm-5.4' }], answers: ['4', '5'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.writes.recordDismissal).toEqual(['glm2@openrouter/z-ai/glm-5.4']);
    expect(t.out()).toContain('Reviewed 2 proposals: 0 accepted, 1 skipped, 1 dismissed.');
  });
  test('an invalid answer re-prompts', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['9', 'x', '4'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect((t.out().match(/choose 1-5/g) || []).length).toBe(2);
  });
  test('§5 write gate: a stale catalog shows proposals but refuses accept and choose; follow still works', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['1', '2'], fetchedAt: Date.now() - 3 * DAY, models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('catalog is 3 days old and could not be refreshed');
    expect(t.out()).toContain('cannot accept: the catalog is not fresh');
    expect(t.writes.addAlias).toEqual([]);
    expect(t.writes.removeAlias).toEqual(['glm']);
  });
  test('notable accept adds the alias, suffixing -2 when the suggested name is already taken (M4)', async () => {
    const t = makeDeps({ proposals: [atlas], rows: [{ alias: 'atlas', id: 'x/z' }], answers: ['1'], models: [{ id: 'openrouter/newco/atlas-1' }] });
    await runReview({}, t.deps);
    expect(t.writes.addAlias).toEqual([['atlas-2', 'openrouter/newco/atlas-1']]);
    expect(t.out()).toContain('[1] add atlas → openrouter/newco/atlas-1');
    expect(t.out()).toContain('✓ atlas-2 → openrouter/newco/atlas-1 (pinned)');
  });

  test('IMPORTANT 1: no cache at all (fetchedAt: null) shows the no-cache banner, never a bogus day count; follow still works, accept refused', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['1', '2'], fetchedAt: null, models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('no catalog cache and it could not be fetched');
    expect(t.out()).not.toContain('days old');
    expect(t.writes.addAlias).toEqual([]);
    expect(t.writes.removeAlias).toEqual(['glm']);
  });

  test('IMPORTANT 2a: a stale catalog also gates "choose another" — a catalog-valid id is still refused, not pinned', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', 'openrouter/z-ai/glm-5.4', '4'], fetchedAt: Date.now() - 3 * DAY, models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).toContain('cannot accept: the catalog is not fresh');
  });

  test('IMPORTANT 2b: collectAliasView is called with { maxAgeMs: Infinity } off a TTY and {} on a TTY', async () => {
    const t1 = makeDeps({ proposals: [], rows: [], models: [] });
    t1.deps.isTTY = false;
    await runReview({}, t1.deps);
    expect(t1.calls.collectAliasView).toEqual([{ maxAgeMs: Number.POSITIVE_INFINITY }]);

    const t2 = makeDeps({ proposals: [], rows: [{ alias: 'gemini' }], models: [{ id: 'x/y' }] });
    await runReview({}, t2.deps);
    expect(t2.calls.collectAliasView).toEqual([{}]);
  });

  test('IMPORTANT 2c: a blank answer to "choose another" cancels back to the menu with no write', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', '', '4'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).toContain('Reviewed 1 proposal: 0 accepted, 1 skipped, 0 dismissed.');
  });

  test('M1: an aborted ask (Ctrl-C/D mid-prompt) does not exit silently — it interrupts with a running summary and exit 1', async () => {
    const t = makeDeps({ proposals: [glm, { ...glm, alias: 'glm2', dismissKey: 'glm2@x' }], models: [{ id: 'x/y' }] });
    let calls = 0;
    t.deps.ask = async () => {
      calls += 1;
      if (calls === 2) { const e = new Error('aborted'); e.code = 'REVIEW_ABORTED'; throw e; }
      return '4';
    };
    expect(await runReview({}, t.deps)).toBe(1);
    expect(t.out()).toContain('review interrupted — 0 accepted, 1 skipped, 0 dismissed so far');
  });

  test('M2: a throwing write does not abort the review — it reports and re-shows the menu, then continues', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['1', '4'], models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    t.deps.addAlias = () => { throw new Error('disk full'); };
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('could not write: disk full');
    expect(t.out()).toContain('Reviewed 1 proposal: 0 accepted, 1 skipped, 0 dismissed.');
  });

  test('F1: no catalog at all refuses to review before "Nothing to review", exit 1, no writes', async () => {
    const t = makeDeps({ proposals: [], rows: [], models: [] });
    expect(await runReview({}, t.deps)).toBe(1);
    expect(t.out()).toContain('no catalog — cannot review; run amicus models --refresh');
    expect(t.out()).not.toContain('Nothing to review');
    expect(t.writes.addAlias).toEqual([]);
    expect(t.writes.removeAlias).toEqual([]);
    expect(t.writes.recordDismissal).toEqual([]);
  });

  test('M3: "choose another" typed with the shipped id follows, never pins a redundant copy', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', 'openrouter/z-ai/glm-5.3'], models: [{ id: 'openrouter/z-ai/glm-5.3' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.removeAlias).toEqual(['glm']);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).toContain('✓ glm now follows the shipped recommendation (openrouter/z-ai/glm-5.3)');
  });
});
