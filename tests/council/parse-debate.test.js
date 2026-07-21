// tests/council/parse-debate.test.js
'use strict';
const { parseDebateDefense, parseRevote } = require('../../src/council/parse-stage2');

const wrap = (obj) => `Prose reasoning here.\n\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;

describe('parseDebateDefense — good input', () => {
  const ids = ['A1', 'A3', 'B2'];

  test('parses defend/amend/withdraw per id', () => {
    const r = parseDebateDefense(wrap({ responses: [
      { id: 'A1', action: 'defend', argument: 'still holds because X' },
      { id: 'A3', action: 'amend', claim: 'corrected claim text', argument: 'narrowed scope' },
      { id: 'B2', action: 'withdraw' },
    ] }), ids);
    expect(r.ok).toBe(true);
    expect(r.byId.A1).toEqual({ action: 'defend', argument: 'still holds because X' });
    expect(r.byId.A3).toEqual({ action: 'amend', claim: 'corrected claim text', argument: 'narrowed scope' });
    expect(r.byId.B2).toEqual({ action: 'withdraw' });
  });

  test('an absent expected id becomes no-response (original stands)', () => {
    const r = parseDebateDefense(wrap({ responses: [{ id: 'A1', action: 'defend', argument: 'x' }] }), ids);
    expect(r.ok).toBe(true);
    expect(r.byId.A3).toEqual({ action: 'no-response' });
    expect(r.byId.B2).toEqual({ action: 'no-response' });
  });

  test('present-but-invalid entries become no-response without triggering a repair', () => {
    const r = parseDebateDefense(wrap({ responses: [
      { id: 'A1', action: 'defend' },                 // missing argument
      { id: 'A3', action: 'amend', argument: 'why' },  // missing claim
      { id: 'B2', action: 'shrug' },                   // bad action
    ] }), ids);
    expect(r.ok).toBe(true);
    expect(r.byId.A1).toEqual({ action: 'no-response' });
    expect(r.byId.A3).toEqual({ action: 'no-response' });
    expect(r.byId.B2).toEqual({ action: 'no-response' });
  });

  test('unknown ids are ignored', () => {
    const r = parseDebateDefense(wrap({ responses: [
      { id: 'A1', action: 'withdraw' }, { id: 'Z9', action: 'withdraw' },
    ] }), ids);
    expect(r.ok).toBe(true);
    expect(r.byId.Z9).toBeUndefined();
    expect(r.byId.A1).toEqual({ action: 'withdraw' });
  });
});

describe('parseDebateDefense — block-level failure', () => {
  const ids = ['A1', 'A3'];
  test('no fenced block → ok:false, every id no-response', () => {
    const r = parseDebateDefense('just prose, no json', ids);
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('NO_FENCED_BLOCK');
    expect(r.byId).toEqual({ A1: { action: 'no-response' }, A3: { action: 'no-response' } });
  });
  test('unparseable json → NOT_PARSEABLE, every id no-response', () => {
    const r = parseDebateDefense('x\n```json\n{nope\n```\n', ids);
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('NOT_PARSEABLE');
    expect(r.byId.A1).toEqual({ action: 'no-response' });
  });
  test('responses not an array → BAD_RESPONSES', () => {
    const r = parseDebateDefense(wrap({ responses: 'nope' }), ids);
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('BAD_RESPONSES');
  });
});

describe('parseRevote', () => {
  const ids = ['A1', 'A3'];
  test('parses per-id verdicts with reasons', () => {
    const r = parseRevote(wrap({ revotes: [
      { id: 'A1', verdict: 'agree', reason: 'defense convincing' },
      { id: 'A3', verdict: 'dispute', reason: 'still unsupported' },
    ] }), ids);
    expect(r.ok).toBe(true);
    expect(r.byId.A1).toEqual({ verdict: 'agree', reason: 'defense convincing' });
    expect(r.byId.A3).toEqual({ verdict: 'dispute', reason: 'still unsupported' });
  });
  test('bad verdict enum / absent id are simply omitted (original stands)', () => {
    const r = parseRevote(wrap({ revotes: [
      { id: 'A1', verdict: 'maybe' }, // bad enum → omitted
    ] }), ids);
    expect(r.ok).toBe(true);
    expect(r.byId.A1).toBeUndefined();
    expect(r.byId.A3).toBeUndefined();
  });
  test('unknown ids ignored; reason optional', () => {
    const r = parseRevote(wrap({ revotes: [
      { id: 'A1', verdict: 'neutral' }, { id: 'Q9', verdict: 'agree' },
    ] }), ids);
    expect(r.ok).toBe(true);
    expect(r.byId.A1).toEqual({ verdict: 'neutral' });
    expect(r.byId.Q9).toBeUndefined();
  });
  test('block-level failure → ok:false, byId empty', () => {
    const r = parseRevote('no json here', ids);
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('NO_FENCED_BLOCK');
    expect(r.byId).toEqual({});
  });
});
