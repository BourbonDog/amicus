// tests/council/seats.test.js
'use strict';
const { slug, sanitizeName, buildSeats, roleAt } = require('../../src/council/seats');

describe('slug / sanitizeName (moved here so seats.js needs zero requires)', () => {
  test('slug lowercases, hyphenates runs, and trims edges', () => {
    expect(slug('Devil Advocate!')).toBe('devil-advocate');
    expect(slug('  Red / Team  ')).toBe('red-team');
  });
  test('sanitizeName maps # to - (the seat-id collision surface)', () => {
    expect(sanitizeName('deepseek#2')).toBe('deepseek-2');
  });
});

describe('buildSeats', () => {
  test('a unique bench yields seat ids byte-identical to the aliases', () => {
    const seats = buildSeats(['glm', 'qwen', 'deepseek'], null, null);
    expect(seats.map(s => s.id)).toEqual(['glm', 'qwen', 'deepseek']);
    expect(seats.map(s => s.position)).toEqual([1, 2, 3]);
    expect(seats.every(s => s.role === 'seat')).toBe(true);
    expect(seats.every(s => s.lens === null)).toBe(true);
  });

  test('a duplicated alias gets #N suffixes, in bench order, on ALL of its seats', () => {
    const seats = buildSeats(['deepseek', 'glm', 'deepseek'], null, null);
    expect(seats.map(s => s.id)).toEqual(['deepseek#1', 'glm', 'deepseek#2']);
    expect(seats.map(s => s.alias)).toEqual(['deepseek', 'glm', 'deepseek']);
  });

  test('the critic role is by alias when there are no lenses', () => {
    expect(buildSeats(['glm', 'qwen'], 'qwen', null).map(s => s.role)).toEqual(['seat', 'critic']);
  });

  test('under lenses every role is a lens and critic is unreachable — roleFor precedence', () => {
    const seats = buildSeats(['glm', 'qwen'], 'qwen', ['Skeptic', 'Optimist!']);
    expect(seats.map(s => s.role)).toEqual(['lens:skeptic', 'lens:optimist']);
    expect(seats.map(s => s.lens)).toEqual(['Skeptic', 'Optimist!']);
  });

  test('lens roles are POSITIONAL — DELIBERATELY unlike roleFor, whose indexOf gives both twins the FIRST lens', () => {
    const seats = buildSeats(['glm', 'glm'], null, ['First', 'Second']);
    expect(seats.map(s => s.role)).toEqual(['lens:first', 'lens:second']);
  });

  test('an EMPTY lenses array is treated as no lenses — roleFor treats [] as truthy and yields lens:undefined', () => {
    expect(buildSeats(['glm'], 'glm', []).map(s => s.role)).toEqual(['critic']);
  });

  test('a lenses array SHORTER than the bench leaves trailing seats plain — roleFor yields lens:undefined', () => {
    expect(buildSeats(['glm', 'qwen'], null, ['A']).map(s => s.role)).toEqual(['lens:a', 'seat']);
  });

  test('total over legacy/degenerate inputs — never throws', () => {
    expect(buildSeats(null, null, null)).toEqual([]);
    expect(buildSeats([], null, null)).toEqual([]);
    expect(buildSeats(['glm'], null, ['A', 'B']).map(s => s.role)).toEqual(['lens:a']);
  });
});

describe('roleAt', () => {
  test('returns the seat role by id, and "seat" for an unknown id', () => {
    const seats = buildSeats(['glm', 'qwen'], 'qwen', null);
    expect(roleAt(seats, 'qwen')).toBe('critic');
    expect(roleAt(seats, 'glm')).toBe('seat');
    expect(roleAt(seats, 'nope')).toBe('seat');
    expect(roleAt(null, 'glm')).toBe('seat');
  });
});

describe('bindSeats', () => {
  const { bindSeats } = require('../../src/council/seats');
  const leg = (over) => ({ waveId: 'r-s1', status: 'complete', ...over });

  test('binds by legId suffix against the WAVE ROSTER, so twins never cross', () => {
    const seats = buildSeats(['deepseek', 'deepseek'], null, null);
    const legs = [leg({ taskId: 'r-s1-2', model: 'deepseek', modelInput: 'deepseek' }),
      leg({ taskId: 'r-s1-1', model: 'deepseek', modelInput: 'deepseek' })];
    const { bound, unbound, orphanLegs } = bindSeats('r-s1', seats, legs);
    expect(bound.map(b => [b.seat.id, b.leg.taskId]))
      .toEqual([['deepseek#2', 'r-s1-2'], ['deepseek#1', 'r-s1-1']]);
    expect(unbound).toEqual([]);
    expect(orphanLegs).toEqual([]);
  });

  test('legId WINS over taskId — the two must resolve to different seats to prove precedence', () => {
    const seats = buildSeats(['glm', 'qwen'], null, null);
    const legs = [leg({ legId: 'r-s1-2', taskId: 'r-s1-1', model: 'qwen' })];
    expect(bindSeats('r-s1', seats, legs).bound[0].seat.id).toBe('qwen');
  });

  test('the roster is the WAVE roster, not the bench — a critic-filtered -s1 wave', () => {
    const seats = buildSeats(['glm', 'qwen', 'deepseek'], 'glm', null);
    const roster = seats.filter(s => s.role !== 'critic'); // run-stage1-launch.js:47
    const { bound } = bindSeats('r-s1', roster, [leg({ taskId: 'r-s1-1', modelInput: 'qwen' })]);
    expect(bound[0].seat.id).toBe('qwen');
  });

  test('falls back to alias ONLY when that alias holds exactly one seat', () => {
    const unique = buildSeats(['glm', 'qwen'], null, null);
    expect(bindSeats('r-s1', unique, [leg({ taskId: 'no-match', modelInput: 'qwen' })])
      .bound[0].seat.id).toBe('qwen');

    const twins = buildSeats(['glm', 'glm'], null, null);
    const ambiguous = bindSeats('r-s1', twins, [leg({ taskId: 'no-match', modelInput: 'glm' })]);
    expect(ambiguous.bound).toEqual([]);
    expect(ambiguous.orphanLegs).toHaveLength(1);
    expect(ambiguous.unbound.map(s => s.id)).toEqual(['glm#1', 'glm#2']);
  });

  test('a seat with no leg comes back unbound — the dead-seat input', () => {
    const seats = buildSeats(['glm', 'qwen'], null, null);
    const { bound, unbound } = bindSeats('r-s1', seats, [leg({ taskId: 'r-s1-1', modelInput: 'glm' })]);
    expect(bound).toHaveLength(1);
    expect(unbound.map(s => s.id)).toEqual(['qwen']);
  });

  test('legs stamped with another wave are IGNORED, not orphaned (callers hold concatenated arrays)', () => {
    const seats = buildSeats(['glm'], null, null);
    const legs = [leg({ taskId: 'r-s1-1', modelInput: 'glm' }),
      leg({ waveId: 'r-c1', taskId: 'r-c1-1', modelInput: 'critic-model' })];
    const out = bindSeats('r-s1', seats, legs);
    expect(out.bound).toHaveLength(1);
    expect(out.orphanLegs).toEqual([]);
  });

  test('an UNSTAMPED leg binds only by exact roster-slot id, never by alias', () => {
    const seats = buildSeats(['glm'], null, null);
    const bySlot = bindSeats('r-s1', seats, [{ taskId: 'r-s1-1', modelInput: 'glm' }]);
    expect(bySlot.bound).toHaveLength(1);
    // no waveId AND no matching slot id: adopting it by alias would silently
    // claim a foreign wave's leg.
    const byAlias = bindSeats('r-s1', seats, [{ taskId: 'zzz-9', modelInput: 'glm' }]);
    expect(byAlias.bound).toEqual([]);
    expect(byAlias.orphanLegs).toHaveLength(1);
  });

  test('a second leg claiming a bound seat is an orphan, never a silent overwrite', () => {
    const seats = buildSeats(['glm'], null, null);
    const legs = [leg({ taskId: 'r-s1-1', modelInput: 'glm' }), leg({ taskId: 'r-s1-1', modelInput: 'glm' })];
    const out = bindSeats('r-s1', seats, legs);
    expect(out.bound).toHaveLength(1);
    expect(out.orphanLegs).toHaveLength(1);
  });

  test('total over junk — never throws', () => {
    expect(bindSeats('r-s1', null, null)).toEqual({ bound: [], unbound: [], orphanLegs: [] });
    expect(bindSeats('r-s1', buildSeats(['glm'], null, null), [null]).orphanLegs).toEqual([]);
  });
});
