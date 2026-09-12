// tests/council/briefings-tools.test.js
'use strict';
const briefings = require('../../src/council/briefings');

const NO_TOOLS_REVIEW = 'Do NOT use any tools or read any files; everything is in this message; begin immediately with the review.';
const NO_TOOLS_ANSWER = 'Do NOT use any tools or read any files; everything is in this message; begin immediately with the answer.';
const args = (extra = {}) => ({ briefing: 'MATERIAL', date: '2026-09-12', ...extra });

describe('stage-1 briefings carry the seat tools sentence (spec 2026-09-11 §4)', () => {
  test('review seat, critic and lens with no tools get the shared no-tools sentence ending in "review."', () => {
    expect(briefings.stage1SeatBriefing(undefined, args())).toContain(NO_TOOLS_REVIEW);
    expect(briefings.stage1CriticBriefing(undefined, args())).toContain(NO_TOOLS_REVIEW);
    expect(briefings.stage1LensBriefing(undefined, args({ lens: 'security engineer' }))).toContain(NO_TOOLS_REVIEW);
  });
  test('task seat, critic and lens with no tools end in "answer."', () => {
    expect(briefings.stage1SeatBriefing('task', args())).toContain(NO_TOOLS_ANSWER);
    expect(briefings.stage1CriticBriefing('task', args())).toContain(NO_TOOLS_ANSWER);
    expect(briefings.stage1LensBriefing('task', args({ lens: 'security engineer' }))).toContain(NO_TOOLS_ANSWER);
  });
  test('with tools, the line names exactly them and sits right after the role paragraph', () => {
    const text = briefings.stage1SeatBriefing('task', args({ tools: ['webfetch'] }));
    const [role, second] = text.split('\n\n');
    expect(role).toMatch(/^You are/);
    expect(second).toBe('Your tools: webfetch. You have no others — do not attempt to read files, search directories, or run commands; if research is incomplete, say so in the deliverable rather than leave it unwritten.');
    expect(text).not.toContain('Do NOT use any tools');
  });
  test('the repair prompts are untouched (they carry their own no-tools line)', () => {
    const p = briefings.stage1RepairPrompt(undefined, { errors: [{ code: 'X', detail: 'y' }], review: 'r' });
    expect(p.startsWith('Do NOT use any tools or read any files; everything is in this message; begin immediately with the JSON block.')).toBe(true);
    expect(p).not.toContain('Your tools:');
  });
});
