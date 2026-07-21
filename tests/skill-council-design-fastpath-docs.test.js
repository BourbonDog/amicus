'use strict';
/**
 * Task 13 — COUNCIL-DESIGN.md gains a v4.1 "engine fast path" section (§13) and
 * SEAT-BRIEFS.md gets a headnote pointing at the engine's own briefing modules.
 * Both docs predate the v4.1 headless engine (COUNCIL-DESIGN.md is the v3 design
 * record; SEAT-BRIEFS.md is the v3.1 optional-elements boilerplate) — this suite
 * pins that they were updated to acknowledge it rather than silently going stale.
 */
const fs = require('fs'); const path = require('path');
const CD = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'COUNCIL-DESIGN.md'), 'utf-8');
const SB = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SEAT-BRIEFS.md'), 'utf-8');
test('COUNCIL-DESIGN gains a §13 engine-fast-path section', () => {
  expect(CD).toMatch(/v4\.1.*engine fast path/is);
});
test('SEAT-BRIEFS headnote points at the engine briefing modules', () => {
  expect(SB).toContain('briefings-debate.js');
  expect(SB).toMatch(/authoritative for the manual path/i);
});
