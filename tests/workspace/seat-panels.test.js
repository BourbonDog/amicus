'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');
const { SCRIPT_LOAD_ORDER } = require('./helpers/script-load-order');

const UI = '../../electron/workspace-ui/';

/**
 * v4.8 PR5a T2 — the prose panels move to seat space.
 *
 * At HEAD these loops iterate `run.bench`, so a repeated alias yields TWO identical rows
 * that resolve to ONE alias-named file the engine never wrote; present() drops both and
 * the user sees nothing, with no banner. Recon proved the absence of any coverage here by
 * instrumentation, not grep: across all 883 workspace/electron/observe tests there were
 * zero duplicate-alias inputs and zero rows carrying a seat.
 *
 * ⚠️ The blind case is the one with teeth. `labelByModel` is ALIAS-keyed (run.json's
 * labelMap, which PR5a does not touch — R5-2), so keying it with a seat id yields
 * undefined and AmicusRender.display() falls through to `pair.model`, printing `gemini#1`
 * with blind mode ON. A seat id contains its alias, so rendering one defeats blind mode.
 * matrix-model.js:66-76 already documents this trap for the matrix columns; these panels
 * had no equivalent.
 */
function loadOrderedScripts() {
  jest.resetModules();
  SCRIPT_LOAD_ORDER.forEach((f) => {
    require(UI + f); // eslint-disable-line global-require
  });
}

const TWIN = ['gemini', 'gemini'];
const SEATS = [
  { id: 'gemini#1', alias: 'gemini', role: 'seat', lens: null, position: 1 },
  { id: 'gemini#2', alias: 'gemini', role: 'seat', lens: null, position: 2 },
];

function twinDetail(runId) {
  return {
    runId,
    runDir: '/fake/run/' + runId,
    run: {
      status: 'complete', schemaVersion: 2, bench: TWIN, chair: 'gpt', seats: SEATS,
      stages: [{ name: 'stage1', status: 'complete', startedAt: 't0', completedAt: 't1' }],
      // Both labels map to the SAME alias — this is what run.json actually holds for a twin,
      // and it is why the label must be resolved from the alias rather than the seat id.
      labelMap: { 'Review A': 'gemini', 'Review B': 'gemini' },
      usage: null, options: { maxCost: 2 }, error: null, debate: null,
    },
    tally: {}, verdict: {},
    artifacts: {
      'review-gemini-1.md': { present: true, bytes: 100 },
      'review-gemini-2.md': { present: true, bytes: 100 },
      'review-gemini.md': { present: false, bytes: 0 },
      'chair-output.md': { present: false, bytes: 0 },
      'report.html': { present: false, bytes: 0 },
    },
    derived: {
      schemaSupported: true,
      names: [{ model: 'gemini', label: 'Review A' }],
      artifactsByModel: {
        'gemini#1': { review: 'review-gemini-1.md', judge: 'judge-gemini-1.md' },
        'gemini#2': { review: 'review-gemini-2.md', judge: 'judge-gemini-2.md' },
      },
      stageRail: [{ name: 'stage1', label: 'Stage 1 — independent review', status: 'complete', startedAt: 't0', completedAt: 't1' }],
      matrix: { judges: [], rows: [], tierCounts: {}, judged: false },
      cost: { rows: [], totalDisplay: '$0.00', costAmount: 0, maxCost: 2 },
      verdictPanel: { present: false, overallVerdict: null, tierCounts: null, streetCred: [], decisions: [], reason: null },
      // Fix-wave (council B1): run-detail.js now ships WHICH SPACE the map above is
      // keyed in, decided by isSeatTable — the renderer no longer re-derives it.
      seatSpace: true,
    },
  };
}

describe('v4.8 PR5a T2: prose panels iterate seats', () => {
  let requested;

  function invoke(channel, ...args) {
    if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
    if (channel === 'workspace:get-run') { return Promise.resolve(twinDetail(args[0])); }
    if (channel === 'workspace:read-artifact') {
      const name = args[args.length - 1];   // artifact name is the LAST arg on this channel
      requested.push(name);
      return Promise.resolve({ text: 'prose for ' + name });
    }
    return Promise.resolve(null);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    requested = [];
    const fake = makeFakeDom();
    global.window = fake.window;
    global.document = fake.document;
    global.document.visibilityState = 'visible';
    global.document.hasFocus = () => true;
    global.NodeFilter = fake.NodeFilter;
    global.window.amicusWorkspace.invoke = jest.fn(invoke);
    loadOrderedScripts();
    clearInterval(global.window.AmicusApp.state.listTimer);
    global.window.AmicusApp.state.listTimer = null;
  });

  afterEach(() => {
    if (global.window.AmicusApp && global.window.AmicusApp.state.listTimer) {
      clearInterval(global.window.AmicusApp.state.listTimer);
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    delete global.window;
    delete global.document;
    delete global.NodeFilter;
  });

  // The toggle handler kicks off an async read wave; the house idiom (see
  // lazy-panel-staleness.test.js) is to drain the microtask queue rather than await the
  // handler, which returns before its reads land.
  async function openReviews() {
    const p = global.document.getElementById('reviews-panel');
    p.open = true;
    p._listeners.toggle[0]();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await Promise.resolve(); await Promise.resolve();
  }
  function titles() {
    return global.document.getElementById('reviews-body').children
      .map((el) => el.querySelectorAll('h3')[0].textContent);
  }
  function flipBlind(checked) {
    global.document.getElementById('blind-toggle')._listeners.change[0]({ target: { checked } });
  }

  test('a twin bench requests BOTH seat files, not one alias file twice', async () => {
    await global.window.AmicusApp.openRun('r1');
    await openReviews();
    await Promise.resolve();
    expect(requested).toEqual(['review-gemini-1.md', 'review-gemini-2.md']);
    // Killing mutant: revert the loop to `bench.map` -> both rows resolve to
    // review-gemini.md, present() drops them, and `requested` is empty.
    expect(requested).not.toContain('review-gemini.md');
  });

  test('blind mode renders LABELS, never a seat id', async () => {
    await global.window.AmicusApp.openRun('r1');
    flipBlind(true);
    await openReviews();
    await Promise.resolve();
    const t = titles();
    expect(t).toHaveLength(2);
    for (const title of t) {
      // Killing mutant: label from `labelByModel[seat.id]` -> undefined -> display()
      // falls through to pair.model and this assertion sees `gemini#1`.
      expect(title).not.toMatch(/gemini/);
      expect(title).toMatch(/^Review [AB]$/);
    }
  });

  test('non-blind renders the seat ids, so twins are distinguishable', async () => {
    await global.window.AmicusApp.openRun('r1');
    await openReviews();
    await Promise.resolve();
    expect(titles()).toEqual(['gemini#1', 'gemini#2']);
  });
});

/**
 * v4.8 PR5a fix-wave — council findings B1 (predicate drift) and A1 (crash path).
 *
 * B1: the allowlist and the roster have to be in the SAME name space or every lookup
 * misses silently. They are now, because there is one predicate: run-detail.js calls
 * isSeatTable and ships the ANSWER as derived.seatSpace. This suite drives BOTH halves
 * from the real src modules — the fixture's map and its seatSpace flag are computed, never
 * hand-written — so a change to either half that breaks the agreement fails here.
 */
describe('v4.8 PR5a fix-wave: roster and allowlist agree on the name space', () => {
  const { artifactAllowlist, isSeatTable } = require('../../src/workspace/artifact-guard'); // eslint-disable-line global-require
  const { buildSeats } = require('../../src/council/seats'); // eslint-disable-line global-require

  // Every shape below is a run.json a hand-edit (or a future producer) can really hold.
  // Only the first is seat space; the rest fail isSeatTable for a DIFFERENT reason each,
  // and all three send artifactAllowlist to alias space.
  const SHAPES = {
    'well-formed seats': { bench: ['gemini', 'gpt'], seats: buildSeats(['gemini', 'gpt'], null, null) },
    'duplicate seat ids': {
      bench: ['gemini', 'gpt'],
      seats: [{ id: 'x#1', alias: 'gemini' }, { id: 'x#1', alias: 'gpt' }],
    },
    'an empty seat id': {
      bench: ['gemini', 'gpt'],
      seats: [{ id: '', alias: 'gemini' }, { id: 'gpt', alias: 'gpt' }],
    },
    'a non-string seat id': {
      bench: ['gemini', 'gpt'],
      seats: [{ id: null, alias: 'gemini' }, { id: 'gpt', alias: 'gpt' }],
    },
  };

  function detailFor(runId, shape) {
    const run = {
      status: 'complete', schemaVersion: 2, chair: 'deepseek',
      stages: [{ name: 'stage1', status: 'complete', startedAt: 't0', completedAt: 't1' }],
      labelMap: { 'Review A': 'gemini', 'Review B': 'gpt' },
      usage: null, options: { maxCost: 2 }, error: null, debate: null,
      ...shape,
    };
    const list = artifactAllowlist(run);
    const artifacts = {};
    // Every allowlisted name is PRESENT, so present() can never be what empties a panel —
    // the only thing left to observe is which names the roster asked for.
    for (const n of list) { artifacts[n] = { present: true, bytes: 10 }; }
    return {
      runId,
      runDir: '/fake/run/' + runId,
      run,
      tally: {},
      verdict: {},
      artifacts,
      derived: {
        schemaSupported: true,
        names: [],
        artifactsByModel: list.artifactsByModel || null,
        stageRail: [{ name: 'stage1', label: 'Stage 1 — independent review', status: 'complete', startedAt: 't0', completedAt: 't1' }],
        matrix: { judges: [], rows: [], tierCounts: {}, judged: false },
        cost: { rows: [], totalDisplay: '$0.00', costAmount: 0, maxCost: 2 },
        verdictPanel: { present: false, overallVerdict: null, tierCounts: null, streetCred: [], decisions: [], reason: null },
        artifactCollisions: list.collisions || [],
        seatSpace: isSeatTable(run.seats),
      },
    };
  }

  let requested;
  let shapeKey;

  beforeEach(() => {
    jest.useFakeTimers();
    requested = [];
    const fake = makeFakeDom();
    global.window = fake.window;
    global.document = fake.document;
    global.document.visibilityState = 'visible';
    global.document.hasFocus = () => true;
    global.NodeFilter = fake.NodeFilter;
    global.window.amicusWorkspace.invoke = jest.fn((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') { return Promise.resolve(detailFor(args[0], SHAPES[shapeKey])); }
      if (channel === 'workspace:read-artifact') {
        const name = args[args.length - 1];
        requested.push(name);
        return Promise.resolve({ text: 'prose for ' + name });
      }
      return Promise.resolve(null);
    });
    loadOrderedScripts();
    clearInterval(global.window.AmicusApp.state.listTimer);
    global.window.AmicusApp.state.listTimer = null;
  });

  afterEach(() => {
    if (global.window.AmicusApp && global.window.AmicusApp.state.listTimer) {
      clearInterval(global.window.AmicusApp.state.listTimer);
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    delete global.window; delete global.document; delete global.NodeFilter;
  });

  async function openReviewsPanel() {
    const p = global.document.getElementById('reviews-panel');
    p.open = true;
    p._listeners.toggle[0]();
    for (let i = 0; i < 6; i += 1) { await Promise.resolve(); }   // eslint-disable-line no-await-in-loop
  }

  for (const key of Object.keys(SHAPES)) {
    test(`${key}: every roster key resolves to a real file`, async () => {
      shapeKey = key;
      await global.window.AmicusApp.openRun('r1');
      await openReviewsPanel();
      await Promise.resolve();
      const map = global.window.AmicusApp.state.detail.derived.artifactsByModel;
      const expected = Object.values(map).map((r) => r.review);
      // The reviews panel is not the only reader that fires on openRun (the fold path
      // pulls chair-output.md), so scope to the names this roster is responsible for.
      const asked = requested.filter((n) => n.startsWith('review-'));
      // Not `toHaveLength(2)` — the point is that the roster asked for exactly the files
      // the SERVER attributed, in its order. A miss resolves to null and present(null)
      // silently drops the row, so an empty list is the defect's signature.
      expect(asked).toEqual(expected);
      expect(asked.length).toBeGreaterThan(0);
      // Killing mutant (MEASURED red on the three malformed shapes): restore roster()'s
      // `if (!seats || !seats.length)` gate -> it iterates the malformed seats while the
      // map stays alias-keyed, every lookup misses, and `requested` is [].
    });
  }

  test('A1: roster survives the detail being replaced by an unreadable run', async () => {
    shapeKey = 'well-formed seats';
    await global.window.AmicusApp.openRun('r1');
    // The panel spec is wired, but its `files()` closure does not run until the user
    // opens the panel — and by then the state can hold a DIFFERENT payload. An
    // unreadable run's detail carries `error` and no `run` at all (run-detail.js
    // returns that shape from four separate guards).
    global.window.AmicusApp.state.detail = { runId: 'r1', runDir: '/fake/run/r1', error: 'run.json missing' };
    // Killing mutant (MEASURED red): read `A.state.detail.run.seats` inside roster()
    // instead of the wire-time capture -> TypeError, thrown straight out of the DOM
    // toggle handler, and the panel is dead for the rest of the session.
    await expect(openReviewsPanel()).resolves.toBeUndefined();
    await Promise.resolve();
    // …and it still serves the run it was WIRED for, rather than half of one run and
    // half of another: `bench`/`debated` were always captured, `seats` now is too.
    expect(requested.filter((n) => n.startsWith('review-')))
      .toEqual(['review-gemini.md', 'review-gpt.md']);
  });
});

describe('v4.8 PR5a T2: resolveArtifactName no longer guesses', () => {
  beforeEach(() => {
    const fake = makeFakeDom();
    global.window = fake.window;
    global.document = fake.document;
    global.NodeFilter = fake.NodeFilter;
    // workspace-app.js boots eagerly and renders the run list; without this the boot
    // throws on a null rows array before any assertion runs.
    global.window.amicusWorkspace.invoke = jest.fn(() => Promise.resolve([]));
    loadOrderedScripts();
    clearInterval(global.window.AmicusApp.state.listTimer);
    global.window.AmicusApp.state.listTimer = null;
  });
  afterEach(() => {
    if (global.window.AmicusApp && global.window.AmicusApp.state.listTimer) {
      clearInterval(global.window.AmicusApp.state.listTimer);
    }
    delete global.window; delete global.document; delete global.NodeFilter;
  });

  // With a seat-keyed map, an alias-keyed caller MISSES. Re-deriving the name would
  // hand back a real file belonging to a different seat — the RN-1 cross-match this
  // whole block exists to kill — so a miss must be null, not a guess.
  test('a map MISS returns null rather than re-deriving a name', () => {
    global.window.AmicusApp.state.detail = {
      derived: { artifactsByModel: { 'gemini#1': { review: 'review-gemini-1.md' } } },
    };
    const r = window.AmicusPanels.resolveArtifactName;
    expect(r('gemini#1', 'review')).toBe('review-gemini-1.md');
    expect(r('gemini', 'review')).toBeNull();
    expect(r('gemini#1', 'judge')).toBeNull();
  });

  // Pre-v4.5 payloads carry no map at all and their callers still pass aliases, so the
  // legacy derivation must survive untouched for them.
  test('an ABSENT map keeps the legacy derivation', () => {
    global.window.AmicusApp.state.detail = { derived: { artifactsByModel: null } };
    expect(window.AmicusPanels.resolveArtifactName('vendor/a', 'review'))
      .toBe('review-vendor-a.md');
  });
});
