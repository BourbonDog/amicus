// tests/scripts/council-review-workflow.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '..', '..', '.github', 'workflows', 'council-review.yml');

describe('council-review workflow (Phase 10 v1)', () => {
  const yml = () => fs.readFileSync(WF, 'utf-8');

  test('exists, is reusable (workflow_call) and label-gated on pull_request', () => {
    const y = yml();
    expect(y).toContain('workflow_call');
    expect(y).toContain("types: [opened, synchronize, reopened, labeled]");
    expect(y).toContain("'council-review'");
  });

  test('soft-skips when the OpenRouter secret is unavailable (fork PRs)', () => {
    const y = yml();
    expect(y).toContain('secrets.OPENROUTER_API_KEY');
    expect(y).toContain('available=false');
  });

  test('fanout is headless-safe: no context harvest, no catalog fetch, cost + time bounded, JSON output', () => {
    const y = yml();
    for (const flag of ['--no-context', '--no-validate-model', '--max-cost', '--timeout 10', '--json', '--prompt-file']) {
      expect(y).toContain(flag);
    }
    expect(y).toContain('timeout-minutes: 25');
    expect(y).toContain('cancel-in-progress: true');
  });

  test('cheap bench only — never o3/o3-pro/opus', () => {
    const y = yml();
    expect(y).toContain("deepseek,gemini,glm");
    expect(y).not.toMatch(/\bo3\b|o3-pro|opus/);
  });

  test('never executes PR code (no checkout) and posts a sticky comment per repo convention', () => {
    const y = yml();
    expect(y).not.toContain('actions/checkout');
    expect(y).toContain('<!-- council-review-sticky -->');
    expect(y).toContain('pull-requests: write');
  });

  test('is honest about v1 scope: fanout only — never invokes the adjudicated council subcommands', () => {
    const y = yml();
    // Assert absence of actual INVOCATIONS — a prose mention in a comment must not trip this,
    // and the header comment is worded to avoid the bare subcommand literals anyway.
    expect(y).not.toMatch(/amicus\s+council\s+(tally|report)/);
    expect(y.toLowerCase()).toContain('deferred to v2');
  });
});
