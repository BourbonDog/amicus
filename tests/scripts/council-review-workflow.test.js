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

  test('cost footer reads the cost OBJECT shape (amount + source) — never the raw object', () => {
    const y = yml();
    // sumWaveUsage (src/utils/pricing.js) makes usage.cost an OBJECT
    // ({amount, currency, source, ...}), non-null even on cold runners —
    // a scalar-shaped `.usage.cost // "unknown"` read renders raw JSON in
    // every comment and its fallback never fires.
    expect(y).toContain('.usage.cost.amount');
    expect(y).toContain('.usage.cost.source');
    expect(y).not.toContain('.usage.cost // ');
  });

  test('label-gate waiver stays string-safe (bare loose-equality regression = spend on every PR)', () => {
    const y = yml();
    // On plain pull_request events inputs.* is empty and GitHub's loose ==
    // coerces null→0 and false→0, so a bare `require_label == false` is TRUE
    // on every same-repo PR — bypassing the label gate. Pin the string-safe form.
    expect(y).toContain("format('{0}', inputs.require_label) == 'false'");
    expect(y).not.toMatch(/require_label\s*==\s*false/);
  });

  test('raw PR text reaches the shell only via env: indirection, never inline in run:', () => {
    const lines = yml().split('\n');
    const prText = lines.filter((l) => /\$\{\{\s*github\.event\.pull_request\.(title|body)/.test(l));
    expect(prText.length).toBeGreaterThan(0); // the title IS used — but only through env
    for (const l of prText) {
      // Every use must be an env-assignment line (KEY: ${{ ... }}) — a raw
      // ${{ }} template expansion inside a run: script is the classic
      // GitHub Actions shell-injection vector.
      expect(l).toMatch(/^\s+[A-Z_]+:\s*\$\{\{\s*github\.event\.pull_request\.(title|body)\s*\}\}\s*$/);
    }
  });

  test('model output is neutralized before entering the sticky comment (no marker/footer/details forgery)', () => {
    const y = yml();
    // Untrusted model text must not be able to forge the sticky marker
    // (comment hijack on the next run), forge the footer disclosure, or
    // close the workflow's own <details> wrapper.
    expect(y).toContain('neutralize()');
    expect(y).toContain('s/<!-- council-review-sticky -->/');
    expect(y).toContain('s/not an adjudicated/');
    expect(y).toContain('s|</details|');
    expect(y).toContain('reviews-safe.md');
  });
});
