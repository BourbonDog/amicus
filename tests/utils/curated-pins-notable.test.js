// tests/utils/curated-pins-notable.test.js
'use strict';
/**
 * #238 D7 (editorial half) — the SHIPPED notable list obeys the curation rule
 * docs/usage.md states (Owner mode → "The notable list"): every entrant is a
 * standing `add <alias> → <id>` proposal for every user, so the mechanical
 * half of the rule is enforced here — a note on every entry, a concrete
 * release (no :free / -latest / preview id), and no id a shipped pin already
 * names in any route form. The shape itself is validateCuratedPins's job
 * (tests/utils/curated-pins.test.js).
 */
const { loadCuratedPins } = require('../../src/utils/curated-pins');
const { stripGatewayPrefix } = require('../../src/utils/curated-models');

const { pins, notable } = loadCuratedPins();
const pinnedIds = new Set(Object.values(pins).flatMap(p => Object.values(p.routes || {})).map(stripGatewayPrefix));

describe('the shipped notable list follows its curation rule', () => {
  test('is an array (possibly empty) whose entries each carry a one-line note', () => {
    expect(Array.isArray(notable)).toBe(true);
    for (const n of notable) {
      expect(typeof n.note).toBe('string');
      expect(n.note.trim().length).toBeGreaterThan(0);
      expect(n.note).not.toMatch(/\n/);
    }
  });
  test('names concrete releases: no :free, -latest or preview id', () => {
    for (const n of notable) { expect(n.id).not.toMatch(/:free$|-latest$|preview/i); }
  });
  test('names nothing a shipped pin already covers, in any route form', () => {
    for (const n of notable) { expect(pinnedIds.has(stripGatewayPrefix(n.id))).toBe(false); }
  });
  test('suggests distinct aliases', () => {
    const names = notable.map(n => n.suggestedAlias);
    expect(new Set(names).size).toBe(names.length);
  });
});
