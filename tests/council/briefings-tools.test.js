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
  test('with tools, the seat briefing\'s second paragraph is the tools line, naming exactly them', () => {
    const text = briefings.stage1SeatBriefing('task', args({ tools: ['webfetch'] }));
    const [role, second] = text.split('\n\n');
    expect(role).toMatch(/^You are/);
    expect(second).toBe('Your tools: webfetch. You have no others — do not attempt to read files, search directories, or run commands; if research is incomplete, say so in the deliverable rather than leave it unwritten.');
    expect(text).not.toContain('Do NOT use any tools');
  });
  // Review finding (round 1): the lens/critic dispatch is the one non-mechanical edit in this
  // diff — buildLensBriefing and buildTaskLensBriefing each rebuild a NARROWER args object
  // instead of forwarding the one they already have, so a dropped `tools` key is silent. Every
  // assertion above calls a lens/critic briefing with NO tools, where a drop is indistinguishable
  // from correct forwarding. Named mutant LENSTOOLSDROP (see src/council/briefings.js ::
  // buildLensBriefing and src/council/briefings-task.js :: buildTaskLensBriefing).
  test('lens and critic briefings carry a real tools line too, not just the seat (LENSTOOLSDROP guard)', () => {
    expect(briefings.stage1LensBriefing('task', args({ lens: 'x', tools: ['webfetch'] })))
      .toContain('Your tools: webfetch.');
    expect(briefings.stage1LensBriefing(undefined, args({ lens: 'x', tools: ['webfetch'] })))
      .toContain('Your tools: webfetch.');
    expect(briefings.stage1CriticBriefing('task', args({ tools: ['webfetch'] })))
      .toContain('Your tools: webfetch.');
  });
  test('a local+remote mix names both and drops the remote-only forbid clause', () => {
    const text = briefings.stage1SeatBriefing('task', args({ tools: ['read', 'webfetch'] }));
    expect(text).toContain('Your tools: read, webfetch. You have no others; if research is incomplete');
    expect(text).not.toContain('do not attempt to read files');
  });
  test('the repair prompts are untouched (they carry their own no-tools line)', () => {
    const p = briefings.stage1RepairPrompt(undefined, { errors: [{ code: 'X', detail: 'y' }], review: 'r' });
    expect(p.startsWith('Do NOT use any tools or read any files; everything is in this message; begin immediately with the JSON block.')).toBe(true);
    expect(p).not.toContain('Your tools:');
  });
});
