'use strict';

const { pollDelay, seatCells, seatsFromRunStats, deadSeats, defaultBlind, isTerminal, dash, TERMINAL_STATUSES, STAGE_LABELS } =
  require('../../electron/workspace-ui/live-model');

describe('pollDelay (spec §4.3 cadences)', () => {
  test('1.5s visible+focused; 5s blurred/hidden; null at terminal', () => {
    expect(pollDelay({ terminal: false, visible: true, focused: true })).toBe(1500);
    expect(pollDelay({ terminal: false, visible: true, focused: false })).toBe(5000);
    expect(pollDelay({ terminal: false, visible: false, focused: true })).toBe(5000);
    expect(pollDelay({ terminal: true, visible: true, focused: true })).toBeNull();
  });
});

describe('isTerminal (v4.6.3 PR2 dedup)', () => {
  test('true for every TERMINAL_STATUSES member, false otherwise', () => {
    TERMINAL_STATUSES.forEach(function (s) { expect(isTerminal(s)).toBe(true); });
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal(null)).toBe(false);
    expect(isTerminal(undefined)).toBe(false);
  });
  test('defaultBlind is exactly !isTerminal', () => {
    TERMINAL_STATUSES.concat(['running', 'starting']).forEach(function (s) {
      expect(defaultBlind(s)).toBe(!isTerminal(s));
    });
  });
});

describe('defaultBlind (spec resolved Q2)', () => {
  test('ON for non-terminal, OFF for terminal statuses', () => {
    expect(defaultBlind('running')).toBe(true);
    for (const s of TERMINAL_STATUSES) { expect(defaultBlind(s)).toBe(false); }
  });

  // ⚠️ DE-ROT (F26/F41): drift pins. The renderer cannot require() main-process modules, so
  // both tables are hand-mirrors. These two asserts are the only thing keeping them honest.
  test('renderer mirrors match src/workspace/run-detail.js exactly', () => {
    const rd = require('../../src/workspace/run-detail');
    expect(TERMINAL_STATUSES).toEqual(rd.TERMINAL_STATUSES);
    expect(STAGE_LABELS).toEqual(rd.STAGE_LABELS);
  });
});

describe('seatCells', () => {
  // ⚠️ DE-ROT (F36): a LIVE seat's `model` is the RESOLVED executable id (metadata.model,
  // src/session-manager.js:74), while run.json's labelMap values are the council ALIAS — so
  // labelOf(seat.model) never matches live and Blind ON leaks the real model id. Fixture now
  // carries both; the alias arrives as `modelInput` (Task 0.5 must stamp it on each leg row,
  // Task 14's seatOf maps it through — normalizeLive is pure and cannot read run.json itself).
  // ⚠️ DE-ROT (F34): `role` exists on a live leg ONLY because Task 0.5 stamps it, and roleFor
  // (src/council/run-stages.js:95-101) keys on the ALIAS (run.json bench/critic/lenses are all
  // alias-valued). Deriving role from the resolved leg.model is a silent no-op that leaves the
  // Role column em-dash for the entire run.
  const seat = {
    model: 'google/gemini-2.5', modelInput: 'gemini',
    role: 'seat', status: 'running', stage: 'receiving', messages: 3,
    tokensIn: 3000, tokensOut: 400, costDisplay: '~$0.02',
    // ⚠️ DE-ROT (F35): was '2s ago'. No composed leg carries a `lastActivity` key — the status
    // composer stamps `leg.lastActivityAt` (ISO, src/mcp-server.js:603) and `leg.latestActivity`
    // (an action label like `Using <tool>`, NOT a time). Map the ISO; seatCells passes it
    // through verbatim, so this fixture pins the SHAPE — relTime() runs in renderSeats (Step 5).
    lastActivity: '2026-07-19T14:03:58.000Z',
    latestPreview: null, stalled: false,
  };
  const labelOf = (m) => (m === 'gemini' ? 'Review A' : null); // alias-keyed, as labelMap is on main

  test('blind ON swaps the model for its label; ids stay label-space elsewhere', () => {
    expect(seatCells(seat, true, labelOf)[0]).toBe('Review A');
    // ⚠️ DE-ROT (F36): blind OFF shows the ALIAS, not the resolved id — every other panel
    // (header chips from run.bench, cost rows from runStats, matrix judges) is alias-space.
    expect(seatCells(seat, false, labelOf)[0]).toBe('gemini');
  });

  test('absent live fields render as em-dash (A2 degradation)', () => {
    const bare = { model: 'gpt', status: 'running', stalled: false };
    const cells = seatCells(bare, false, () => null);
    expect(cells).toEqual(['gpt', '—', 'running', '—', '—', '—', '—', '—', '']);
  });

  test('stalled flag renders the badge cell', () => {
    expect(seatCells({ ...seat, stalled: true }, false, labelOf)[8]).toBe('⏳ stalled');
  });
});

describe('seatsFromRunStats (terminal fallback, spec §5.2)', () => {
  test('maps cost rows into seat-shaped rows', () => {
    const rows = seatsFromRunStats([
      { model: 'gemini', role: 'seat', status: 'complete', durationMs: 120000, costDisplay: '$0.11' },
    ]);
    expect(rows[0]).toMatchObject({ model: 'gemini', role: 'seat', status: 'complete', costDisplay: '$0.11', stalled: false });
    expect(rows[0].stage).toBeNull();
  });

  // ⚠️ DE-ROT (F37): v4.1 `--debate` appends EXTRA runStats rows for the SAME bench alias
  // (role 'rebuttal' per defense leg, 'revote' per re-vote leg — src/council/debate.js:88-96,
  // merged at src/council/run.js:271). renderSeats keys on `seat.id || seat.model`, and
  // seatsFromRunStats set no id, so on any debate run the seat row was silently overwritten
  // by the re-vote leg. This case is the regression guard.
  test('debate rows for the same model get distinct ids', () => {
    const rows = seatsFromRunStats([
      { model: 'gemini', role: 'seat', status: 'complete', durationMs: 120000, costDisplay: '$0.11' },
      { model: 'gemini', role: 'rebuttal', status: 'complete', durationMs: 9000, costDisplay: '$0.03' },
      { model: 'gemini', role: 'revote', status: 'complete', durationMs: 4000, costDisplay: '$0.01' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['gemini:seat', 'gemini:rebuttal', 'gemini:revote']);
  });
});

/**
 * v4.6.3 PR2 (spec D3, Global Constraints "reviewing-role set"): direct unit coverage of the
 * role-aware suppression logic, complementing the paint()-level scenarios in
 * dead-seat-rows.test.js (which exercise the same function through the real DOM-painting call
 * chain). These pin `isReviewing`'s allowlist and the alias-space critic match in isolation.
 */
describe('deadSeats (role-aware D6, v4.6.3 PR2)', () => {
  function deadLeg(seat) {
    return { kind: 'degrade', channel: 'dead-leg', what: 'seat ' + seat + ' did not review',
      why: "the leg ended 'error'", effect: '2 of 3 seats reviewed',
      data: { seat: seat, status: 'error', reason: 'timed out' } };
  }

  test('a dead-leg candidate whose alias matches runMeta.critic is tagged role: "critic"; others are role: null', () => {
    const result = deadSeats([deadLeg('foxtrot'), deadLeg('echo')], null, [], { critic: 'foxtrot' });
    expect(result).toEqual([
      { model: 'foxtrot', role: 'critic', statusText: 'did not review' },
      { model: 'echo', role: null, statusText: 'did not review' },
    ]);
  });

  test('a chair-only live row for the dead critic\'s alias does NOT suppress it (chair is not reviewing)', () => {
    const liveSeats = [{ model: 'foxtrot', role: 'chair' }];
    const result = deadSeats([deadLeg('foxtrot')], null, liveSeats, { critic: 'foxtrot' });
    expect(result).toEqual([{ model: 'foxtrot', role: 'critic', statusText: 'did not review' }]);
  });

  test('a live CRITIC row for the same alias DOES suppress the dead-critic candidate', () => {
    const liveSeats = [{ model: 'foxtrot', role: 'critic' }];
    const result = deadSeats([deadLeg('foxtrot')], null, liveSeats, { critic: 'foxtrot' });
    expect(result).toEqual([]);
  });

  test('a null-role candidate is suppressed by ANY reviewing-role live leg for its alias: seat, critic, or lens:*', () => {
    expect(deadSeats([deadLeg('echo')], null, [{ model: 'echo', role: 'seat' }], null)).toEqual([]);
    expect(deadSeats([deadLeg('echo')], null, [{ model: 'echo', role: 'critic' }], null)).toEqual([]);
    expect(deadSeats([deadLeg('echo')], null, [{ model: 'echo', role: 'lens:precision' }], null)).toEqual([]);
  });

  test('a null-role candidate is NOT suppressed by a chair/judge/rebuttal/revote-only live leg for its alias', () => {
    ['chair', 'judge', 'rebuttal', 'revote'].forEach(function (role) {
      const result = deadSeats([deadLeg('echo')], null, [{ model: 'echo', role: role }], null);
      expect(result).toEqual([{ model: 'echo', role: null, statusText: 'did not review' }]);
    });
  });

  test('suppression keys on the alias (modelInput || model), never the resolved id — F36', () => {
    const liveSeats = [{ model: 'google/gemini-2.5-pro', modelInput: 'gemini', role: 'seat' }];
    expect(deadSeats([deadLeg('gemini')], null, liveSeats, null)).toEqual([]);
  });

  test('the seatLoss backstop candidate always carries role: "critic" (it IS the critic-loss backstop)', () => {
    const seatLoss = { criticRequested: 'foxtrot', criticSeated: false };
    const result = deadSeats([], seatLoss, [], null);
    expect(result).toEqual([{ model: 'foxtrot', role: 'critic', statusText: 'did not review' }]);
  });

  test('a missing runMeta (3-arg call, pre-PR2 call shape) behaves exactly as no critic requested', () => {
    const result = deadSeats([deadLeg('foxtrot')], null, []);
    expect(result).toEqual([{ model: 'foxtrot', role: null, statusText: 'did not review' }]);
  });
});

describe('dash', () => {
  test('nullish/empty → em-dash; values pass through as strings', () => {
    expect(dash(null)).toBe('—');
    expect(dash(undefined)).toBe('—');
    expect(dash('')).toBe('—');
    expect(dash(0)).toBe('0');
  });
});
