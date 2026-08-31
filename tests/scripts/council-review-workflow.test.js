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
    for (const flag of ['--no-validate-model', '--max-cost', '--timeout 16', '--json', '--prompt-file', '--out-dir']) {
      expect(y).toContain(flag);
    }
    // Parsed, not substring-matched (#219 r2, deepseek): `toContain` would also
    // pass on a commented-out line or a different job's cap.
    expect(Number(/^\s*timeout-minutes:\s*(\d+)\s*$/m.exec(y)[1])).toBe(75);
    expect(y).toContain('cancel-in-progress: true');
  });

  /**
   * #202 — the two stall detectors and the leg cap are ONE budget, so they are
   * pinned as a relationship rather than as three magic numbers.
   *
   * WHY the tool-call window moved off its 180 s default here: B53 killed a glm
   * leg that was streaming AND billing (9,750 in + 8,373 reasoning + 55 out,
   * $0.0526 REPORTED) after `read pending 181s`. src/headless.js's own comment
   * already records a measured 190.6 s `task` call as "already longer than B53's
   * 180 s" — that measurement widened the neighbouring settle deferral to 300 s
   * and left B53 itself untouched. On this egress the measured first-token times
   * reach 384.2 s (CI run 33030485388), so a 180 s mid-turn gap is inside the
   * ordinary distribution, not evidence of a wedge.
   *
   * ⚠️ KNOWN COST of matching the backstop rather than undercutting it (owner's
   * call, recorded so nobody reads it as an oversight): with a 600 s leg cap a
   * 480 s window means B53 can only fire for a tool call that starts inside the
   * first ~120 s of a leg. The detector is deliberately traded down in reach to
   * stop it killing healthy legs. If a wedged tool call later needs catching
   * mid-leg, the lever is `--timeout`, not a tighter window.
   */
  test('the stall detectors and the leg cap form one coherent budget', () => {
    const y = yml();
    const ms = (name, re) => {
      const m = re.exec(y);
      expect(`${name} set in the workflow: ${m !== null}`).toBe(`${name} set in the workflow: true`);
      return Number(m[1]);
    };
    const noOutput = ms('AMICUS_NO_OUTPUT_BACKSTOP_MS', /AMICUS_NO_OUTPUT_BACKSTOP_MS:\s*'(\d+)'/);
    const toolStall = ms('AMICUS_TOOL_CALL_STALL_MS', /AMICUS_TOOL_CALL_STALL_MS:\s*'(\d+)'/);
    const legCap = Number(/--timeout (\d+)/.exec(y)[1]) * 60 * 1000;

    // Both detectors must be able to fire BEFORE the leg cap, or the leg dies an
    // uninformative `timeout` instead of a named, diagnosable stall.
    expect(noOutput).toBeLessThan(legCap);
    expect(toolStall).toBeLessThan(legCap);
    // A mid-turn gap gets AT LEAST the patience a first-token gap gets: both are
    // the same egress-latency phenomenon, and a tighter tool window would kill
    // legs the backstop deliberately spared.
    expect(toolStall).toBeGreaterThanOrEqual(noOutput);
    // And neither may silently fall back to a shipped default.
    expect(toolStall).toBeGreaterThan(180000); // src/headless.js's default

    // #202 follow-up — B53's REACH, and the job cap that pays for it.
    //
    // B53 can only fire for a tool call that starts before `legCap - toolStall`;
    // after that the leg times out first and dies an uninformative `timeout`.
    // At the shipped 600 s cap that reach was 120 s of a 600 s leg — the
    // detector was effectively early-leg only.
    const reachMs = legCap - toolStall;
    expect(reachMs).toBeGreaterThanOrEqual(480000);

    // What that reach COSTS, from the workflow's own numbers rather than a
    // remembered total. `--timeout` is per-leg for EVERY stage, so raising it
    // for stage-1's sake also inflates stage 2 and the chair — the `2 * legCap`
    // term below is those two, and it is what dominates. The retry window is
    // `min(2 * backstop, legCap)` (src/council/run-retry.js), so it stops
    // growing once legCap passes twice the backstop.
    const jobCapMs = Number(/timeout-minutes:\s*(\d+)/.exec(y)[1]) * 60 * 1000;
    // ⚠️ CORRECTED (council #219, raised independently by glm/gpt/deepseek). The
    // first term used to be `noOutput`, which UNDERCOUNTS stage 1 by up to a full
    // leg: the backstop only kills a leg that produces NOTHING. A leg that streams
    // is bounded by the leg cap, not the backstop — and that is the common case,
    // not a corner. MEASURED on the very run that raised the finding (33093722538):
    // `qwen seat` ran 688,723 ms, far past the 480 s the old term assumed.
    //
    // ⚠️ Still a FLOOR, not a ceiling: Stage-2 repairs are serial, up to 2 per
    // judge, each bounded by the leg cap (run-stage2.js). A run that repairs every
    // judge exceeds this. `--max-cost` is what bounds that in practice, not time.
    // ⚠️ mirrors run-retry-window.js EXACTLY (#219 r2, deepseek): the retry clamp
    // is `floor(legCap * 0.95)`, not `legCap`. A model that drifts from the code
    // it pins is the round-1 defect all over again.
    const worstCaseMs = legCap + Math.min(2 * noOutput, Math.floor(legCap * 0.95)) + 2 * legCap;

    // ⚠️ This must FIT, with room. A `timeout-minutes` kill CANCELS the job, and
    // the evidence-artifact step is `if: !cancelled()` — so busting the cap does
    // not merely fail the run, it DELETES the run-dir artifact every #202
    // decision has been made from. (The spend receipt and ledger-only upload
    // now run on cancellation — best-effort, #220 — but reviews/judge
    // outputs/tally still die with the runner.) 3 minutes of slack is the floor.
    expect(`worst ${Math.round(worstCaseMs / 60000)}m fits job cap `
      + `${Math.round(jobCapMs / 60000)}m: ${worstCaseMs + 180000 <= jobCapMs}`)
      .toBe(`worst ${Math.round(worstCaseMs / 60000)}m fits job cap `
        + `${Math.round(jobCapMs / 60000)}m: true`);
  });

  /**
   * #202 — the honest seat census on both published surfaces.
   *
   * The footer prints `models: ${MODELS}`, which is the bench that was ASKED
   * FOR, and `deriveSeatLoss` returns null with no `--critic` (CI runs
   * `CRITIC: ''`), so `seatLoss` is structurally absent from every CI verdict.
   * MEASURED, run 4424218c: a TWO-seat bench published a four-model street-cred
   * table whose dead seats rendered `n/a` — indistinguishable from the legend's
   * "neutral". Nothing said the verdict rested on half a bench.
   */
  test('#202: the seat census reaches BOTH the check title and the comment footer', () => {
    const y = yml();
    const checkIdx = y.indexOf('Publish the Council Review check run');
    const commentIdx = y.indexOf('Post sticky PR comment');
    expect(checkIdx).toBeGreaterThan(-1);
    expect(commentIdx).toBeGreaterThan(checkIdx);
    expect(y.slice(checkIdx, commentIdx)).toContain('seatsReviewed');
    expect(y.slice(commentIdx)).toContain('seatsReviewed');
  });

  test('#202: the census read tolerates the key being ABSENT (emit-when-set)', () => {
    const y = yml();
    // verdict.json omits seatsReviewed when the record carried no bench rows, so
    // every read must have an else-branch. A bare `\(.seatsReviewed.reviewed)`
    // would render "null" into a published title on exactly the degraded runs
    // this exists to describe.
    for (const line of y.split('\n').filter(l => l.includes('seatsReviewed'))) {
      expect(`${line.trim().slice(0, 60)} :: guarded=${/if \.seatsReviewed|\/\/ *""|\/\/ *empty/.test(line)}`)
        .toBe(`${line.trim().slice(0, 60)} :: guarded=true`);
    }
  });

  test('cheap bench + cheap chair only — the expensive-model names never appear', () => {
    const y = yml();
    // 2026-08-26 owner ruling: kimi off the bench (cost vs contribution — the
    // #202 stall record), deepseek promoted from chair to bench, gemini-pro
    // chairs. kimi's alias-map pin stays so an explicit `models: kimi` input
    // still resolves to the pinned id instead of silently falling back to the
    // shipped curated table (the known CI config-skew class).
    expect(y).toContain('glm,qwen,gpt,deepseek');
    expect(y).toContain("CHAIR: ${{ inputs.chair || 'gemini-pro' }}");
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

  test('workflow_call surface: callers and this repo\'s pull_request fallback bench the same four seats', () => {
    const y = yml();
    expect(y).toContain("MODELS: ${{ inputs.models || 'glm,qwen,gpt,deepseek' }}");
    expect(y).toContain("CHAIR: ${{ inputs.chair || 'gemini-pro' }}");
    expect(y).toContain("CRITIC: ${{ inputs.critic || '' }}");
    expect(y).toContain("FAIL_ON: ${{ inputs.fail_on || 'rethink' }}");
    expect(y).toContain("MAX_COST: ${{ inputs.max_cost || '2.00' }}");
    expect(y).not.toContain("'1.00'");
    // fail_on is validated to the enum before any paid step
    expect(y).toContain('none|fix|rethink');
  });

  // The bench is spelled TWICE in this file and the two spellings serve
  // disjoint triggers: workflow_call callers read the input default, while
  // plain pull_request runs carry empty inputs and read the `||` fallback.
  // Editing one alone is invisible — it type-checks, it lints, and CI stays
  // green while every PR on this repo silently keeps the OLD bench. That is
  // exactly what happened on cb7c90fd (2026-08-14). Derive both from the
  // file and compare them instead of pinning each literal separately.
  test('the two bench spellings cannot drift apart (input default === pull_request fallback)', () => {
    const y = yml();
    const inputDefault = y.match(/models:\s*\n\s*description:[^\n]*\n\s*type: string\s*\n\s*default: '([^']*)'/);
    const prFallback = y.match(/MODELS: \$\{\{ inputs\.models \|\| '([^']*)' \}\}/);
    expect(inputDefault).not.toBeNull();
    expect(prFallback).not.toBeNull();
    expect(prFallback[1]).toBe(inputDefault[1]);
  });

  // Same trap, same fix, for fail_on: the workflow_call input default and the
  // pull_request `||` fallback are two independent spellings of one gate
  // policy, and only the fallback is read on a plain pull_request run (empty
  // inputs). This is the exact mistake cb7c90fd made for `models` --
  // changing one spelling and not the other is invisible to lint/actionlint
  // and leaves real PRs on the stale policy. fail_on's own `description:`
  // line contains single quotes ('Gate policy: none (report-only), ...'), so
  // the capture below anchors on the literal `type: string` line between
  // `description:` and `default:` rather than a bare `default: '([^']*)'`
  // scan, which a loose quote-count could latch onto inside the description.
  test('the two fail_on spellings cannot drift apart (input default === pull_request fallback)', () => {
    const y = yml();
    const inputDefault = y.match(/fail_on:\s*\n\s*description:[^\n]*\n\s*type: string\s*\n\s*default: '([^']*)'/);
    const prFallback = y.match(/FAIL_ON: \$\{\{ inputs\.fail_on \|\| '([^']*)' \}\}/);
    expect(inputDefault).not.toBeNull();
    expect(prFallback).not.toBeNull();
    expect(prFallback[1]).toBe(inputDefault[1]);
  });

  // The workflow now provisions .github/amicus-ci-aliases.json into
  // AMICUS_CONFIG_DIR, and the pre-flight step kills an unresolvable seat
  // BEFORE any spend rather than letting it die mid-run. This assertion still
  // holds the FALLBACK path honest: a workflow_call caller (or a fork with no
  // map on its base ref) gets only the table this repo SHIPS, so the defaults
  // must stay resolvable there too.
  test('every default bench seat and the chair are shipped curated aliases (no local-only aliases)', () => {
    const { toDefaultAliases } = require('../../src/utils/curated-models');
    const shipped = toDefaultAliases();
    const y = yml();
    const bench = y.match(/MODELS: \$\{\{ inputs\.models \|\| '([^']*)' \}\}/)[1].split(',');
    const chair = y.match(/CHAIR: \$\{\{ inputs\.chair \|\| '([^']*)' \}\}/)[1];
    for (const alias of [...bench, chair]) {
      expect(Object.keys(shipped)).toContain(alias);
    }
    // The engine refuses a bench under 2 seats, and the chair is stripped
    // from the bench before launch — so the default must survive that strip.
    expect(bench.filter((m) => m !== chair).length).toBeGreaterThanOrEqual(2);
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

  /**
   * #220 — a cancelled run must still leave its spend receipt.
   *
   * Cancellation is ROUTINE (concurrency cancel-in-progress on every re-push;
   * the opened+labeled double-event on a labelled PR; a timeout-minutes bust),
   * and it lands after the paid step has launched legs. Under a shared
   * `!cancelled()` gate, cancellation was the ONE terminal state where a run
   * that spent money left no record of having spent it — observed live on
   * PR #219, where two cancelled runs reached the paid step and every
   * downstream evidence step read `skipped`.
   */
  test('#220: the spend receipt runs on cancellation; the artifact upload does not have to', () => {
    const y = yml();
    const receipt = y.slice(y.indexOf('Collect the spend receipt'), y.indexOf('Upload evidence artifact'));
    const upload = y.slice(y.indexOf('Upload evidence artifact'), y.indexOf('Publish the Council Review check run'));
    // The receipt is a fast file copy + step-summary write — best odds of
    // landing inside the post-cancellation grace (best-effort, not a
    // guarantee: #229 council B1/D1). The gate guard must stay alongside it:
    // bare always() would run the receipt on fork PRs where nothing was spent.
    expect(receipt).toContain("if: ${{ always() && steps.gate.outputs.available == 'true' }}");
    // The if: LINE, not the whole slice — the step's own comment names
    // !cancelled() while explaining why it was wrong.
    expect(receipt).not.toContain('if: ${{ !cancelled()');
    // #229 round-2 A2: the non-cancelled path's ledger durability is a CHAIN —
    // the receipt cp lands inside RUN_DIR, and RUN_DIR is what the full
    // artifact uploads. Pin every link, not just the file name.
    expect(receipt).toContain('cp "$LEDGER" "$RUN_DIR/spend-ledger.jsonl"');
    expect(y).toContain('RUN_DIR: council-run');
    // upload-artifact of the FULL run dir on a cancelled job may not finish,
    // and a truncated artifact is worse than none — this one deliberately
    // stays !cancelled().
    expect(upload).toContain("if: ${{ !cancelled() && steps.gate.outputs.available == 'true' }}");
  });

  /**
   * #229 council B1/D3 — the cancelled path also gets a machine-readable
   * record, not just the rendered step summary. A ledger-only artifact is a
   * single small file: unlike the full run directory it has a real chance of
   * finishing inside the post-cancellation grace, and it cannot upload a
   * truncated half-directory. It fires ONLY on cancellation — every other
   * outcome already carries the ledger inside the council-run artifact.
   *
   * #229 round-2 A1/D1: it must also come FIRST among the post-run steps —
   * every step that runs after a cancellation shares one bounded grace
   * window, so the machine-readable artifact takes the first claim on it
   * rather than queueing behind the receipt's shell block.
   */
  test('#229: a ledger-only artifact upload fires on the cancelled path only, ahead of the receipt', () => {
    const y = yml();
    const ledgerIdx = y.indexOf('Upload the spend ledger alone');
    const receiptIdx = y.indexOf('Collect the spend receipt');
    expect(ledgerIdx).toBeGreaterThan(y.indexOf('Run the adjudicated council'));
    expect(ledgerIdx).toBeLessThan(receiptIdx);
    const step = y.slice(ledgerIdx, receiptIdx);
    expect(step).toContain("if: ${{ cancelled() && steps.gate.outputs.available == 'true' }}");
    expect(step).toContain('name: spend-ledger');
    expect(step).toContain('path: ${{ env.AMICUS_CONFIG_DIR }}/spend-ledger.jsonl');
  });

  /**
   * #229 round-3 C1 — the workflow's two ledger-path spellings must point at
   * the file the ENGINE actually writes, and this repo ships that engine, so
   * the equivalence is enforced against the exported constant rather than
   * asserted in prose: spend-ledger.js appends SPEND_LEDGER_FILE inside
   * getConfigDir(), and the workflow points getConfigDir() at
   * AMICUS_CONFIG_DIR via the job-level env (pinned elsewhere in this suite).
   * If the engine ever renames the file, this fails before the workflow
   * silently uploads nothing.
   */
  test('#229: both workflow ledger paths name the exact file the engine writes', () => {
    const { SPEND_LEDGER_FILE } = require('../../src/utils/spend-ledger');
    const y = yml();
    // The receipt step's shell spelling…
    expect(y).toContain('LEDGER="${AMICUS_CONFIG_DIR}/' + SPEND_LEDGER_FILE + '"');
    // …and the ledger-only upload's expression spelling.
    expect(y).toContain('path: ${{ env.AMICUS_CONFIG_DIR }}/' + SPEND_LEDGER_FILE);
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

  describe('review-diff filter (harvested from the workflow and executed verbatim)', () => {
    const os = require('os');
    const { execFileSync } = require('child_process');

    /** Pull the filter program out of the YAML heredoc and write it to a temp file. */
    function harvestFilter() {
      const y = yml();
      const m = y.match(/<<'FILTER_EOF'\n([\s\S]*?)\n([ ]*)FILTER_EOF/);
      if (!m) { throw new Error('filter program not found in council-review.yml'); }
      // Dedent exactly as YAML does: the block scalar strips the run-block's
      // base indent, so the executed script (and this harness) must too.
      const program = m[1].split('\n').map((l) => l.slice(m[2].length)).join('\n');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-filter-'));
      const file = path.join(dir, 'filter-diff.js');
      fs.writeFileSync(file, program, 'utf-8');
      return { file, dir };
    }

    /** Run the harvested filter exactly as the workflow does. */
    function runFilter(diffText, cap) {
      const { file, dir } = harvestFilter();
      const input = path.join(dir, 'full.diff');
      fs.writeFileSync(input, diffText, 'utf-8');
      const stdout = execFileSync(process.execPath, [file, input, String(cap)], { encoding: 'utf-8' });
      return stdout;
    }

    const block = (p, body) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n+${body}\n`;

    test('drops docs/superpowers and package-lock.json, keeps src/', () => {
      const diff = block('docs/superpowers/plans/big.md', 'PLANTEXT')
        + block('package-lock.json', 'LOCKTEXT')
        + block('src/council/tally.js', 'SRCTEXT');
      const out = runFilter(diff, 100000);
      expect(out).toContain('SRCTEXT');
      expect(out).not.toContain('PLANTEXT');
      expect(out).not.toContain('LOCKTEXT');
    });

    test('orders src/ and tests/ ahead of everything else', () => {
      const diff = block('README.md', 'READMETEXT')
        + block('tests/foo.test.js', 'TESTTEXT')
        + block('src/cli.js', 'SRCTEXT');
      const out = runFilter(diff, 100000);
      expect(out.indexOf('SRCTEXT')).toBeLessThan(out.indexOf('TESTTEXT'));
      expect(out.indexOf('TESTTEXT')).toBeLessThan(out.indexOf('READMETEXT'));
    });

    test('packs WHOLE files — a budget overflow never emits a half hunk', () => {
      const big = block('docs/other/big.md', 'X'.repeat(500));
      const small = block('src/cli.js', 'SRCTEXT');
      const out = runFilter(small + big, small.length + 50);
      expect(out).toContain('SRCTEXT');
      expect(out).not.toContain('XXXXX');
      expect(out.endsWith('\n')).toBe(true);
    });

    test('a single file larger than the whole budget is truncated, never silently dropped to nothing', () => {
      const out = runFilter(block('src/huge.js', 'Y'.repeat(5000)), 400);
      expect(out.length).toBeGreaterThan(0);
      expect(out).toContain('diff --git a/src/huge.js');
    });

    test('the briefing declares exclusions and elisions instead of claiming a byte truncation', () => {
      const y = yml();
      const step = y.slice(y.indexOf('Build council briefing from the PR diff'),
                           y.indexOf('Run the adjudicated council'));
      expect(step).toContain('diff-notes.txt');
      // the stale byte-prefix wording must be gone
      expect(step).not.toContain('diff truncated to ${DIFF_CAP} bytes');
      expect(step).toContain('Not shown');
      expect(step).toContain('|| [ -n "$line" ]');
    });
  });

  // The bug this suite's `no local-only aliases` test could only work AROUND:
  // a runner resolved every alias from the shipped table, so `glm` reviewed at
  // whatever curated-models.js pinned rather than what the bench intended, and
  // an alias absent from that table was dropped by classifyCouncilMembers with
  // nothing but a run.json note. Provisioning supplies the map; the pre-flight
  // makes an unresolvable seat loud and free instead of silent and paid.
  describe('alias provisioning and its observability', () => {
    const stepFor = (name, next) => {
      const y = yml();
      return y.slice(y.indexOf(name), y.indexOf(next));
    };

    test('the config dir is redirected into the workspace at job level', () => {
      // Also where spend-ledger.jsonl lands — getConfigDir() owns both.
      // github.workspace, not runner.temp: `runner` is not an available context
      // in a job-level env block, where it expands to '' — rooting the config dir
      // at the filesystem root. A local test that sets the var by hand cannot see it.
      expect(yml()).toContain('AMICUS_CONFIG_DIR: ${{ github.workspace }}/amicus-cfg');
      // The EXPRESSION, not the substring — the comment above it in the workflow
      // names runner.temp deliberately.
      expect(yml()).not.toContain('${{ runner.temp }}');
    });

    test('the alias map is read from the BASE ref, never the PR head', () => {
      const step = stepFor('Provision the alias map', 'Pre-flight the bench');
      expect(step).toContain('github.event.pull_request.base.sha');
      expect(step).not.toContain('pull_request.head.sha');
      expect(step).toContain('.github/amicus-ci-aliases.json');
      // Still no checkout anywhere — the map comes over the API.
      expect(yml()).not.toContain('actions/checkout');
    });

    test('an unparseable map fails loudly instead of degrading to the shipped table', () => {
      // loadConfig() swallows a parse error and returns null, which would look
      // exactly like "no map provisioned" — the failure this step removes.
      const step = stepFor('Provision the alias map', 'Pre-flight the bench');
      expect(step).toContain('JSON.parse');
      expect(step).toContain('::error::');
      expect(step).toContain('exit 1');
    });

    // Council finding A2: JSON.parse proves syntax, not shape. A file that
    // parses to {"foo":1} yields zero aliases and degrades silently.
    test('the map is validated by SHAPE, not merely parsed', () => {
      const step = stepFor('Provision the alias map', 'Pre-flight the bench');
      expect(step).toContain('has no aliases object');
      expect(step).toContain('declares zero aliases');
      expect(step).toContain('does not map to a fully-qualified model id');
      // The argv slot must be the path itself — `node x.js -- path` puts '--'
      // in argv[2] and reads the wrong file (this bit the receipt step once).
      expect(step).not.toContain('validate-map.js --');
    });

    // Council finding A1/C2: a blanket else-branch turned ANY gh failure into
    // "no map", so a rate limit or DNS blip silently swapped the bench's models.
    test('only a 404 falls back; every other gh failure fails the run', () => {
      const step = stepFor('Provision the alias map', 'Pre-flight the bench');
      expect(step).toContain("grep -q 'HTTP 404' alias-map.err");
      expect(step).toContain('was NOT a 404');
      // stderr must be captured, not discarded — 2>/dev/null makes the 404
      // indistinguishable from every other failure.
      expect(step).toContain('2> alias-map.err');
      expect(step).not.toContain('2>/dev/null');
    });

    test('the pre-flight runs before the paid council step and can fail the job', () => {
      const y = yml();
      expect(y.indexOf('Pre-flight the bench')).toBeLessThan(
        y.indexOf('Run the adjudicated council'));
      const step = stepFor('Pre-flight the bench', 'Build council briefing');
      expect(step).toContain('getEffectiveAliases');
      expect(step).toContain('::error::');
      expect(step).toContain('exit "$PF"');
    });

    test('the spend receipt is collected — the only artifact with concrete ids', () => {
      const step = stepFor('Collect the spend receipt', 'Upload evidence artifact');
      expect(step).toContain('spend-ledger.jsonl');
      expect(step).toContain('$RUN_DIR/spend-ledger.jsonl');
      // Guarded: an unguarded crash inside the summary group is masked by the
      // trailing echo and publishes an empty "billed" section.
      expect(step).toContain('if node receipt.js "$LEDGER" > receipt.txt; then');
    });

    // #193 was reviewed twice, and BOTH councils unanimously raised a blocker
    // that $GH_REPO / $MODELS / $CHAIR were undefined. They were defined — in
    // the job-level `env:` block, which the PR did not change and which
    // therefore never appears in a diff. Four seats agreed off one shared
    // blind spot, which is one observation, not four.
    test('the briefing appends env definitions a diff structurally cannot show', () => {
      const step = stepFor('Build council briefing', 'Run the adjudicated council');
      expect(step).toContain('env-context.js');
      expect(step).toContain('Workflow env definitions');
      // #194 B1: the parser is the repo's own tested module, fetched from the
      // BASE ref, not a copy inlined in the heredoc. One source, one test suite.
      // Base and not head so a PR cannot swap the parser reading its own workflow.
      expect(step).toContain('scripts/extract-workflow-env.js?ref=${BASE_SHA}');
      // Supplementary context, so an absent parser is a notice and a skip, never
      // a silently EMPTY section that reads as "this workflow defines no env".
      expect(step).toContain('ENV_CTX=0');
      expect(step).toContain('env context skipped');
      // #194 finding C1. grep exits 1 on zero matches — the ordinary case, since
      // most PRs touch no workflow. Today's bare `run:` is `bash -e` (confirmed
      // from a real run log: `shell: /usr/bin/bash -e {0}`), so a pipeline masks
      // it; adding `shell: bash` anywhere turns pipefail on and `-e` then kills
      // the step, losing the WHOLE briefing. Measured both ways before and after:
      // `bash -eo pipefail` went exit 1 / no briefing -> exit 0 / briefing written.
      expect(step).toContain('> wf-raw.txt || true');
      // grep must not sit in a pipeline whose status can propagate.
      expect(step).not.toContain('capped.diff \\');
      // Only workflows whose diff survived the cap — annotating an elided file
      // would describe code the bench was explicitly told it cannot see.
      expect(step).toContain('capped.diff');
      // HEAD, not base: the bench must see the env block as this PR leaves it.
      expect(step).toContain('ref=${HEAD_SHA}');
    });

    test('every pin in the map is a fully-qualified, non-floating model id', () => {
      const map = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '.github', 'amicus-ci-aliases.json'), 'utf-8'));
      const aliases = map.aliases || {};
      expect(Object.keys(aliases).length).toBeGreaterThan(0);
      for (const [alias, id] of Object.entries(aliases)) {
        expect(typeof id).toBe('string');
        expect(alias).not.toContain('/');
        expect(id).toContain('/');
        // A `~vendor/x-latest` pointer names no concrete release, so it is
        // invisible in both the pre-flight table and the spend ledger.
        expect(id).not.toContain('~');
      }
    });

    test('the default bench and chair are all covered by the map', () => {
      const y = yml();
      const map = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '.github', 'amicus-ci-aliases.json'), 'utf-8'));
      const bench = y.match(/MODELS: \$\{\{ inputs\.models \|\| '([^']*)' \}\}/)[1].split(',');
      const chair = y.match(/CHAIR: \$\{\{ inputs\.chair \|\| '([^']*)' \}\}/)[1];
      for (const alias of [...bench, chair]) {
        expect(Object.keys(map.aliases)).toContain(alias);
      }
    });
  });

  /**
   * v4.9 W13 Task B — CI backstop headroom. The 4.8.1-cycle stall class is
   * CI-side, not a bad pin: across five councils on 2026-08-24/25, kimi, qwen and
   * glm each hit `NO_OUTPUT_BACKSTOP` at the 300 s default on their FIRST attempt
   * over OpenRouter (session open, assistant message minted, zero tokens), and
   * glm survived only because its one Stage-1 retry happened to land. #196's
   * verdict was published on a 2-of-4 bench because of it.
   */
  describe('no-output backstop headroom (v4.9 W13 Task B)', () => {
    const councilStep = () => {
      const y = yml();
      return y.slice(y.indexOf('Run the adjudicated council'), y.indexOf('Collect the spend receipt'));
    };

    /**
     * The council step with its COMMENT lines removed — i.e. what the runner
     * actually executes, plus the step's `env:` assignments.
     *
     * PR #203 council round 1, finding A7. The ordering test below used to read
     * `--timeout` off the whole document, and the first `--timeout` in this file
     * is not a flag at all: it is the phrase "the per-leg `--timeout 10`
     * (600000 ms) set below" inside this very step's evidence comment, roughly
     * thirty lines above the `run:` block that spells the real one. The two
     * numbers agree today, which is exactly why the anchor was worth fixing
     * before they stop agreeing — edit the real flag and the assertion would
     * have gone on comparing against the prose.
     *
     * Named mutant PROSEANCHOR: drop the comment filter from the helper below.
     * RED measured 2026-08-26 at the 7-suite/273-test focused scope — 1 test /
     * 1 suite: "the ordering test reads the RUN command, not the prose that
     * quotes the flag". The ordering assertion itself stays green under it,
     * because today's two numbers agree — which is the point of the extra pin.
     */
    const councilRunCommand = () => councilStep()
      .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

    test('the ordering test reads the RUN command, not the prose that quotes the flag', () => {
      // The decoy is real and deliberate — the comment must keep explaining the
      // relationship — so the extractor, not the comment, is what has to change.
      expect(councilStep()).toMatch(/#.*--timeout \d+/);
      expect(councilRunCommand()).not.toMatch(/#/);
      // Exactly one executable spelling, so the match below cannot be ambiguous.
      expect(councilRunCommand().match(/--timeout \d+/g)).toHaveLength(1);
    });

    test('the paid council step raises the no-output backstop, with its evidence', () => {
      const step = councilStep();
      expect(step).toContain("AMICUS_NO_OUTPUT_BACKSTOP_MS: '480000'");
      // The evidence must travel WITH the number: a bare 480000 is a magic
      // constant nobody can re-derive or safely lower.
      expect(step).toContain('2026-08-24');
      expect(step).toContain('NO_OUTPUT_BACKSTOP');
      expect(step).toContain('#196');
    });

    test('it is scoped to the paid step, not the job — no other step pays for the wait', () => {
      const y = yml();
      const jobEnv = y.slice(y.indexOf('    env:\n      PR_NUMBER'), y.indexOf('    steps:'));
      expect(jobEnv).not.toContain('AMICUS_NO_OUTPUT_BACKSTOP_MS');
    });

    // The two-spellings trap (cb7c90fd) applies to anything that gets BOTH a
    // workflow_call input default and a `${{ inputs.x || '...' }}` fallback:
    // a plain pull_request run reads only the fallback, so editing one spelling
    // is invisible. This value deliberately has ONE spelling and no input, which
    // is what makes it exempt — pin that, so adding an input later forces the
    // drift test that would then be required.
    test('single-spelled: exactly one assignment, and no workflow_call input twin', () => {
      const y = yml();
      const assignments = y.split('\n').filter((l) => /^\s*AMICUS_NO_OUTPUT_BACKSTOP_MS:/.test(l));
      expect(assignments).toHaveLength(1);
      expect(y).not.toMatch(/inputs\.[a-z_]*backstop/i);
      expect(y).not.toMatch(/AMICUS_NO_OUTPUT_BACKSTOP_MS:\s*\$\{\{/);
    });

    // Ordering is the whole point of the knob: the backstop is the leg-level
    // dead-man's switch and must still fire BEFORE the whole-leg timeout, or a
    // silent seat burns the full wall clock instead of being reported and retried.
    test('the headroom stays under the council step\'s OWN per-leg --timeout, so the backstop still fires first', () => {
      // Both numbers come from the same step's executable lines (A7): the env
      // assignment and the flag the runner will actually pass.
      const cmd = councilRunCommand();
      const ms = Number(cmd.match(/AMICUS_NO_OUTPUT_BACKSTOP_MS: '(\d+)'/)[1]);
      const timeoutMinutes = Number(cmd.match(/--timeout (\d+)/)[1]);
      expect(ms).toBeGreaterThan(300000); // strictly more headroom than the default
      expect(ms).toBeLessThan(timeoutMinutes * 60000);
    });
  });
});
