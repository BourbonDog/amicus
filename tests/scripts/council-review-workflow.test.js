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
    // close the workflow's own <details> wrapper. The tag/marker rules must
    // be case-insensitive AND whitespace-tolerant: `</DETAILS>`, `< details >`,
    // `</ details >` and `<!--council-review-sticky-->` are confirmed
    // bypasses of exact-string / case-sensitive rules.
    expect(y).toContain('neutralize()');
    expect(y).toContain('s/<!--[[:space:]]*council-review-sticky[[:space:]]*-->/');
    expect(y).toContain('s/not an adjudicated/');
    expect(y).toContain('s|<[[:space:]]*/[[:space:]]*details|');
    expect(y).toContain('s|<[[:space:]]*details|');
    expect(y).toContain('reviews-safe.md');
  });

  test('neutralization survives case + whitespace bypass variants (behavioral pin on the actual sed rules)', () => {
    const y = yml();
    // Extract the REAL sed substitution rules out of neutralize() and apply
    // them in JS. The translation is faithful for the shapes used there
    // (literal text + [[:space:]]* + g/I flags); sed is line-based and every
    // fixture variant below is single-line, so the semantics match.
    const rules = [...y.matchAll(/-e\s+'(s[/|][^']+)'/g)].map((m) => {
      const s = m[1];
      const d = s[1];
      const [, pattern, replacement, flags] = s.split(d);
      const jsPattern = pattern.replace(/\[\[:space:\]\]/g, '[ \\t\\r\\n\\f\\v]');
      return { re: new RegExp(jsPattern, 'g' + (flags.includes('I') ? 'i' : '')), replacement };
    });
    expect(rules.length).toBeGreaterThanOrEqual(4);
    const fixture = [
      'a <!-- council-review-sticky --> b',
      'tight <!--council-review-sticky--> c',
      'wide <!--  council-review-sticky  --> d',
      'upper </DETAILS> e',
      'spaced-open < details > f',
      'spaced-close </ details > g',
      'mixed <DeTaIlS open> h',
      'plain <details><summary>x</summary> i',
      'plain-close </details> j',
      'forged: this is not an adjudicated verdict / NOT AN ADJUDICATED',
    ].join('\n');
    const out = rules.reduce((t, r) => t.replace(r.re, r.replacement), fixture);
    // no marker shape survives (any internal spacing, any case)
    expect(out).not.toMatch(/<!--\s*council-review-sticky\s*-->/i);
    // no details tag shape survives (any case, any internal spacing)
    expect(out).not.toMatch(/<\s*\/?\s*details/i);
    // no footer-sentinel phrase survives (any case)
    expect(out).not.toMatch(/not an adjudicated/i);
    // and the neutralized placeholders actually landed
    expect(out).toContain('[model text removed: sticky marker]');
    expect(out).toContain('[/details');
    expect(out).toContain('[details');
    expect(out).toContain('not-an-adjudicated (model text)');
  });

  test('no leg requests verbose summaries (unbounded model output on a paid CI key)', () => {
    const y = yml();
    // --summary-length is prompt-only (src/prompt-builder.js) with no token
    // cap anywhere in the engine; verbose asks every model for maximally
    // long output. Both the review wave and the synthesis leg must stay at
    // the (default) 'normal' length.
    expect(y).not.toMatch(/--summary-length\s+verbose/);
  });

  test('synthesis briefing is built from NEUTRALIZED reviews, not raw reviews.md (model-to-model handoff)', () => {
    const y = yml();
    // The comment path already neutralizes model text before it reaches the
    // human-facing PR comment. The synthesis step is a SEPARATE shell (no
    // shared function) and previously fed the raw reviews.md straight into
    // another model's prompt with zero neutralization on that handoff.
    const synthStepIdx = y.indexOf('Synthesize the reviews');
    const commentStepIdx = y.indexOf('Post sticky PR comment');
    expect(synthStepIdx).toBeGreaterThan(-1);
    expect(commentStepIdx).toBeGreaterThan(synthStepIdx);
    const synthBlock = y.slice(synthStepIdx, commentStepIdx);

    // the synthesis step must define its own neutralize() (separate shell,
    // function isn't shared with the comment step) and consume the safe
    // file — never the raw reviews.md — when building synth-briefing.md
    expect(synthBlock).toContain('neutralize()');
    expect(synthBlock).not.toMatch(/cat reviews\.md/);

    // duplicated sed rules must be byte-for-byte identical to the comment
    // step's rules (same 4 substrings), so the whole-file sed-rule harvest
    // above still finds ≥4 total handled distinct occurrences across the file
    const sedRuleCount = (y.match(/-e\s+'s[/|][^']+'/g) || []).length;
    expect(sedRuleCount).toBeGreaterThanOrEqual(8); // 4 in comment step + 4 duplicated in synth step

    // untrusted-data fencing: reviews must be wrapped in a clearly delimited
    // block with an instruction line marking them as untrusted, non-instruction
    // model output — mirroring how the diff is fenced in briefing.md (lines ~100-116)
    expect(synthBlock.toLowerCase()).toMatch(/untrusted/);
  });
});
