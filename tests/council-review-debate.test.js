// tests/council-review-debate.test.js
'use strict';
const fs = require('fs');
const path = require('path');

const WF = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'council-review.yml'), 'utf-8');

describe('Council Review Action v2 — debate input (spec §5.2 / OQ-6)', () => {
  test('declares a debate input defaulting to false', () => {
    // \r?\n (not a bare \n) so this holds regardless of whether the checkout
    // has git-autocrlf-converted CRLF line endings (as on Windows) or LF.
    expect(WF).toMatch(/debate:\s*\r?\n(\s+.*\r?\n)*?\s+default:\s*['"]?false['"]?/);
  });
  test('forwards --debate through a string-safe input read (no loose-equality coercion)', () => {
    // On a plain pull_request event `inputs.*` is empty and GitHub's loose ==
    // coerces null→0 and false→0 — `inputs.debate == 'true'` is the exact trap
    // the label gate already guards against. Same idiom here: format() the
    // input into env:, then compare the string in bash.
    expect(WF).toContain("DEBATE: ${{ format('{0}', inputs.debate) }}");
    expect(WF).toContain('ARGS+=(--debate)');
    expect(WF).not.toMatch(/inputs\.debate\s*==/);
  });
  test('excludes withdrawn findings from check-run annotations', () => {
    // Scoped to the check-run step and pinned to the exact jq select clause,
    // applied before confirmed.json is captured — a loose "debate...withdrawn
    // appear somewhere" match would pass even with the filter deleted, since
    // both words also appear in the sticky-comment step and in comments.
    const step = WF.slice(WF.indexOf('Publish the Council Review check run'), WF.indexOf('Post sticky PR comment'));
    const clause = 'select((.debate.action // "") != "withdrawn")';
    expect(step).toContain(clause);
    expect(step.indexOf(clause)).toBeLessThan(step.indexOf('> confirmed.json'));
  });
  test('sticky comment has a Withdrawn in debate collapsible', () => {
    expect(WF).toContain('Withdrawn in debate');
  });
  test('excludes withdrawn findings from the sticky-comment tier collapsibles too (Finding 3)', () => {
    // A finding withdrawn during debate has its tier frozen pre-debate
    // (bundleFor excludes withdrawn findings from the re-vote) — so unlike
    // the Confirmed-only check-run filter (which is defensive: a withdrawn
    // finding can never reach Confirmed), this select is load-bearing here:
    // a withdrawn Contested/Disputed finding WOULD otherwise render under
    // its old tier, with no retraction marker, alongside its own dedicated
    // "Withdrawn in debate" collapsible below. Scoped to the sticky-comment
    // step and pinned inside the `for TIER in ...` loop specifically, so a
    // loose "debate...withdrawn appear somewhere" match can't pass with the
    // filter deleted (both words also appear in the Withdrawn collapsible's
    // own jq block and in comments).
    const step = WF.slice(WF.indexOf('Post sticky PR comment'));
    const loop = step.slice(step.indexOf('for TIER in'), step.indexOf('done'));
    const clause = 'select((.debate.action // "") != "withdrawn")';
    expect(loop).toContain(clause);
    expect(loop.indexOf('select(.tier == $tier)')).toBeLessThan(loop.indexOf(clause));
  });
  test('the neutralize() sed invariant is unchanged (byte-identical guard)', () => {
    // v4.0 pins EXACTLY 10 sed rules across the two model-text shells, 5
    // distinct. A third neutralize() copy, a sixth rule, or a reworded rule
    // breaks tests/scripts/council-review-workflow.test.js — so the withdrawn
    // collapsible must reuse the sticky-comment shell's existing function.
    const sedRules = (WF.match(/-e\s+'s[/|][^']+'/g) || []).map(s => s.replace(/^-e\s+/, ''));
    expect(sedRules.length).toBe(10);
    expect(new Set(sedRules).size).toBe(5);
  });
});
