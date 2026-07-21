// tests/scripts/council-review-workflow.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '..', '..', '.github', 'workflows', 'council-review.yml');

describe('council-review workflow (v2 — adjudicated council engine)', () => {
  const yml = () => fs.readFileSync(WF, 'utf-8');

  test('exists, is reusable (workflow_call) and label-gated on pull_request', () => {
    const y = yml();
    expect(y).toContain('workflow_call');
    expect(y).toContain('types: [opened, synchronize, reopened, labeled]');
    expect(y).toContain("'council-review'");
  });

  test('soft-skips when the OpenRouter secret is unavailable (fork PRs)', () => {
    const y = yml();
    expect(y).toContain('secrets.OPENROUTER_API_KEY');
    expect(y).toContain('available=false');
  });

  test('council run is headless-safe: no catalog fetch, cost + time bounded, JSON output, pinned out-dir', () => {
    const y = yml();
    // NOTE: --no-context is deliberately NOT passed and NOT pinned here — the
    // engine pins no-context internally on every council leg (spec §5,
    // run-launch), unlike the v1 raw-fanout pipeline which had to pass it.
    for (const flag of ['--no-validate-model', '--max-cost', '--timeout 10', '--json', '--prompt-file', '--out-dir']) {
      expect(y).toContain(flag);
    }
    expect(y).toContain('timeout-minutes: 45');
    expect(y).toContain('cancel-in-progress: true');
  });

  test('cheap bench + cheap chair only — the expensive-model names never appear', () => {
    const y = yml();
    expect(y).toContain('glm,qwen,minimax,qwen-coder');
    expect(y).toContain("CHAIR: ${{ inputs.chair || 'deepseek' }}");
    expect(y).not.toMatch(/\bo3\b|o3-pro|opus/);
  });

  test('never executes PR code (no checkout) and posts a sticky comment per repo convention', () => {
    const y = yml();
    expect(y).not.toContain('actions/checkout');
    expect(y).toContain('<!-- council-review-sticky -->');
    expect(y).toContain('pull-requests: write');
  });

  test('v2 drives the real engine: council run invoked; the v1 fanout+synthesis pipeline and hand-rolled subcommand calls are gone', () => {
    const y = yml();
    expect(y).toMatch(/amicus council run/);
    expect(y).not.toMatch(/amicus\s+council\s+(tally|report|verdict|validate)\b/);
    expect(y).not.toMatch(/amicus fanout/);
  });

  test('exit codes 0 and 2 both proceed (degraded runs still report); anything else fails the job', () => {
    const y = yml();
    expect(y).toContain('[ "$EC" -ne 0 ] && [ "$EC" -ne 2 ]');
  });

  test('cost line reads the cost OBJECT shape (amount + source) from run.json — never the raw object', () => {
    const y = yml();
    // sumWaveUsage (src/utils/pricing.js) makes usage.cost an OBJECT
    // ({amount, currency, source, ...}); run.json carries the same shape.
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
      expect(l).toMatch(/^\s+[A-Z_]+:\s*\$\{\{\s*github\.event\.pull_request\.(title|body)\s*\}\}\s*$/);
    }
  });

  test('workflow_call surface: chair/critic/fail_on added with spec defaults; max_cost default doubled; models widened to four cheap seats', () => {
    const y = yml();
    expect(y).toContain("MODELS: ${{ inputs.models || 'glm,qwen,minimax,qwen-coder' }}");
    expect(y).toContain("CHAIR: ${{ inputs.chair || 'deepseek' }}");
    expect(y).toContain("CRITIC: ${{ inputs.critic || '' }}");
    expect(y).toContain("FAIL_ON: ${{ inputs.fail_on || 'none' }}");
    expect(y).toContain("MAX_COST: ${{ inputs.max_cost || '2.00' }}");
    expect(y).not.toContain("'1.00'");
    // fail_on is validated to the enum before any paid step
    expect(y).toContain('none|fix|rethink');
  });

  test('default chair-in-bench collision is resolved deterministically before any spend', () => {
    const y = yml();
    // The engine pre-flight requires chair NOT seated (spec §4); the default
    // inputs overlap. The workflow strips the chair from the bench with a
    // ::notice:: and refuses to run a bench below 2 seats.
    expect(y).toContain('BENCH=');
    expect(y).toContain('::notice::chair');
    expect(y).toContain('"$SEATS" -lt 2');
  });

  test('check run: checks: write permission, head SHA via env, named Council Review', () => {
    const y = yml();
    expect(y).toContain('checks: write');
    expect(y).toContain('HEAD_SHA: ${{ github.event.pull_request.head.sha }}');
    expect(y).toContain('name: "Council Review"');
  });

  test('conclusion mapping implements the spec table, with null decided before the gating branches', () => {
    const y = yml();
    const step = y.slice(y.indexOf('Publish the Council Review check run'), y.indexOf('Post sticky PR comment'));
    expect(step).toContain('if [ "$FAIL_ON" = "none" ]; then');
    expect(step).toContain('CONCLUSION="success"');
    expect(step).toContain('elif [ "$OVERALL" = "null" ]; then');
    expect(step).toContain('CONCLUSION="neutral"');
    expect(step).toContain('[ "$OVERALL" = "Ship it" ]');
    expect(step).toContain('[ "$OVERALL" = "Fundamental rethink" ]');
    expect(step).toContain('CONCLUSION="failure"');
    // A chair failure (overallVerdict null) must NEVER gate: null → neutral is
    // decided before the fix/rethink comparisons can run.
    expect(step.indexOf('CONCLUSION="neutral"')).toBeLessThan(step.indexOf('"Ship it"'));
  });

  test('annotations: Confirmed-only, 50-per-request chunking, file-level fallback, unmapped overflow to the summary', () => {
    const y = yml();
    const step = y.slice(y.indexOf('Publish the Council Review check run'), y.indexOf('Post sticky PR comment'));
    expect(step).toContain('"Confirmed"');
    expect(step).toContain('$i+50');
    expect(step).toContain('i=$((i + 50))');
    expect(step).toContain('start_line: 1'); // file-level fallback when no :line parses
    expect(step).toContain('unmapped');      // unmappable findings land in the summary
  });

  test('evidence artifact: the full run directory is uploaded even when the run degrades or fails', () => {
    const y = yml();
    expect(y).toContain('actions/upload-artifact');
    expect(y).toContain('name: council-run');
    expect(y).toContain('path: council-run/');
    expect(y).toContain('!cancelled()');
  });

  test('model output is neutralized before entering the sticky comment (no marker/footer/details forgery)', () => {
    const y = yml();
    // Untrusted model text must not be able to forge the sticky marker
    // (comment hijack on the next run), forge either footer disclosure
    // phrase (the v1 phrase stays neutralized as defense-in-depth), or
    // open/close <details> and break out of the workflow's own wrappers.
    expect(y).toContain('neutralize()');
    expect(y).toContain('s/<!--[[:space:]]*council-review-sticky[[:space:]]*-->/');
    expect(y).toContain('s/not an adjudicated/');
    expect(y).toContain('s/adjudicated council verdict/');
    expect(y).toContain('s|<[[:space:]]*/[[:space:]]*details|');
    expect(y).toContain('s|<[[:space:]]*details|');
    expect(y).toContain('-safe.md');
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
    expect(rules.length).toBeGreaterThanOrEqual(5);
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
      'forged-2: an adjudicated council verdict / ADJUDICATED COUNCIL VERDICT',
    ].join('\n');
    const out = rules.reduce((t, r) => t.replace(r.re, r.replacement), fixture);
    expect(out).not.toMatch(/<!--\s*council-review-sticky\s*-->/i);
    expect(out).not.toMatch(/<\s*\/?\s*details/i);
    expect(out).not.toMatch(/not an adjudicated/i);
    expect(out).not.toMatch(/adjudicated council verdict/i);
    expect(out).toContain('[model text removed: sticky marker]');
    expect(out).toContain('[/details');
    expect(out).toContain('[details');
    expect(out).toContain('not-an-adjudicated (model text)');
    expect(out).toContain('adjudicated-council-verdict (model text)');
  });

  test('no leg requests verbose summaries (unbounded model output on a paid CI key)', () => {
    const y = yml();
    expect(y).not.toMatch(/--summary-length\s+verbose/);
  });

  test('both model-text shells (check run + comment) neutralize, with byte-identical duplicated sed rules', () => {
    const y = yml();
    const checkIdx = y.indexOf('Publish the Council Review check run');
    const commentIdx = y.indexOf('Post sticky PR comment');
    expect(checkIdx).toBeGreaterThan(-1);
    expect(commentIdx).toBeGreaterThan(checkIdx);
    const checkBlock = y.slice(checkIdx, commentIdx);
    // the check-run step is a SEPARATE shell (the function isn't shared), so
    // it defines its own neutralize() and consumes only the -safe file
    expect(checkBlock).toContain('neutralize()');
    expect(checkBlock).toContain('confirmed-safe.json');
    // exactly 5 distinct rules, each duplicated byte-for-byte in both shells
    const sedRules = (y.match(/-e\s+'s[/|][^']+'/g) || []).map((s) => s.replace(/^-e\s+/, ''));
    expect(sedRules.length).toBe(10);
    expect(new Set(sedRules).size).toBe(5);
  });
});
