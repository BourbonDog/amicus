// tests/scripts/council-review-workflow.test.js
'use strict';
const fs = require('fs');
const path = require('path');
// #256: compiles the credit-preflight heredoc without running it — a heredoc is
// invisible to eslint, so this is the only gate a broken edit would hit.
const vm = require('vm');
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

  test('#242: the unverified and refused counts reach the title and the footer, printed only when non-zero', () => {
    const y = yml();
    const checkIdx = y.indexOf('Publish the Council Review check run');
    const commentIdx = y.indexOf('Post sticky PR comment');
    // `> 0`, never a bare truthiness test: jq treats 0 as TRUE, so `if .seatsReviewed.unverified`
    // would print "(0 unverified)" on every clean run; and jq orders null below every number,
    // so a pre-4.9.8 verdict.json (no key) prints exactly as before. Named mutant TITLEBLIND
    // (the nested clause deleted from the TITLE line) reddens the first segment.
    // Measured red set: TITLEBLIND, 1 test.
    for (const seg of [y.slice(checkIdx, commentIdx), y.slice(commentIdx)]) {
      expect(seg).toContain('if .seatsReviewed.unverified > 0 then " (\\(.seatsReviewed.unverified) unverified)" else "" end');
      expect(seg).toContain('if .seatsReviewed.refused > 0 then " (\\(.seatsReviewed.refused) refused)" else "" end');
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

    test('the alias map is read from the BASE branch, never the PR head and never the frozen base sha', () => {
      const step = stepFor('Provision the alias map', 'Pre-flight the bench');
      // The branch NAME resolves to the base's current tip on every run. GitHub
      // freezes `pull_request.base.sha` at PR creation, so a map change merged
      // to main after that never reached an open PR (measured on PR #232).
      expect(step).toContain('github.event.pull_request.base.ref');
      // The EXPRESSION, not the substring — the comment above it in the workflow
      // names the frozen sha deliberately, to say why it is not used.
      expect(step).not.toContain('github.event.pull_request.base.sha');
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
      // Bounded by the step that now follows it (#256's credit preflight), not
      // by the briefing step two down — a slice that silently swallows a third
      // step stops being a pin on THIS one.
      const step = stepFor('Pre-flight the bench', 'Pre-flight the OpenRouter credit');
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
      expect(step).toContain('scripts/extract-workflow-env.js?ref=${BASE_REF}');
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

  /**
   * #256 — the OpenRouter credit preflight.
   *
   * MEASURED (run 35143585179, `309862bf`, 2026-09-16): the key's remaining
   * monthly limit was below this run's own `--max-cost`, so the provider refused
   * four of seven legs in 2–3 s, the once-only Stage-1 retries were spent on
   * those refusals, and the round ended COUNCIL_QUORUM with ONE seat reviewed.
   * No existing lever reached it: the backstop is irrelevant to an instant
   * refusal, and a second retry would have been refused the same way. The only
   * cure is to ask the key what it can afford BEFORE any seat is dispatched.
   */
  describe('OpenRouter credit preflight (#256)', () => {
    const CREDIT_STEP = 'Pre-flight the OpenRouter credit';
    const creditStep = () => {
      const y = yml();
      return y.slice(y.indexOf(CREDIT_STEP), y.indexOf('Build council briefing'));
    };

    test('the step exists, is gated like its neighbours, and sits between the bench pre-flight and the paid step', () => {
      const y = yml();
      const idx = y.indexOf(CREDIT_STEP);
      expect(idx).toBeGreaterThan(-1);
      // AFTER the bench pre-flight (so a bench that cannot bind fails first, for
      // free) and BEFORE the paid step (so a refusal costs nothing).
      expect(y.indexOf('Pre-flight the bench')).toBeLessThan(idx);
      expect(idx).toBeLessThan(y.indexOf('Run the adjudicated council'));
      expect(creditStep()).toContain("if: steps.gate.outputs.available == 'true'");
    });

    test('it reads BOTH key facts and prices the bench\'s reservation (council #264 r2, HQ1 + HQ2)', () => {
      const step = creditStep();
      // HQ2: the key's monthly cap and the ACCOUNT balance are two facts, and
      // the second one is what a key with `limit_remaining: null` hides.
      expect(step).toContain('checkOpenRouterBalance');
      // HQ1: the quantity OpenRouter refuses on is a per-request reservation,
      // priced from the provisioned map's outputBudget and the live catalog.
      expect(step).toContain('council-credit-reservation');
      expect(step).toContain('fetchOpenRouterModelPrices');
      expect(step).toContain('priceOneSeatReservation');
      expect(step).toContain('resolveBenchIds');
      expect(step).toContain('outputBudget');
      // The SAME file the "Provision the alias map" step above wrote.
      expect(step).toContain('AMICUS_CONFIG_DIR');
      expect(step).toContain("'config.json'");
    });

    test('the step says what it guarantees and what it cannot', () => {
      // Council #264 r2 read the earlier copy as a promise the probe cannot
      // keep; the boundary now travels in the decision's own messages and in
      // the step's documentation.
      const step = creditStep();
      expect(step).toContain('cannot prevent a per-request refusal');
    });

    test('it calls the SHIPPED probe and the shipped decision module, resolved the way preflight.js resolves them', () => {
      const step = creditStep();
      // The workflow never checks out; `npm root -g` against the installed
      // tarball is the only module path a runner has.
      expect(step).toContain('npm root -g');
      expect(step).toContain('openrouter-credit');
      expect(step).toContain('council-credit-preflight');
      expect(step).toContain('checkOpenRouterCredit');
      expect(step).toContain('decideCreditPreflight');
      // The run ceiling is the job-level MAX_COST, read from the environment by
      // the node program — the same value the paid step passes as --max-cost.
      expect(step).toContain('process.env.MAX_COST');
    });

    test('ONE exit point, and the only non-zero exit is a genuine refusal', () => {
      // Council #264 r1 / A1. Every decision, and every way this program can
      // FAIL, funnels through `finish`, which is the only caller of
      // process.exit — so "a preflight that cannot run never blocks a review"
      // is provable from the text rather than hoped for.
      const step = creditStep();
      expect(step.match(/process\.exit\(/g)).toHaveLength(1);
      expect(step).toContain("process.exit(level === 'error' ? 1 : 0)");
      // 'error' — the one level that exits non-zero — is PRODUCED in exactly one
      // place, and that place is the refusal ternary. (The other two mentions of
      // the string are comparisons inside `finish`, not producers.)
      expect(step).toContain("d.outcome === 'refuse' ? 'error'");
      expect(step.match(/\? 'error'/g)).toHaveLength(1);
      expect(step).toContain('::notice::');
    });

    test('the whole program is wrapped so nothing but a refusal can fail the job', () => {
      // Council #264 r1 / A1: a synchronous throw (a bad `npm root -g`, a module
      // that throws at load) and an unhandled rejection both used to leave a
      // non-zero exit and take the review down with them.
      const step = creditStep();
      expect(step).toContain("process.on('unhandledRejection'");
      expect(step).toContain('the preflight itself failed');
      expect(step).toContain('the probe rejected');
      // Two-arg `.then(onOk, onErr)`: a throw inside the SUCCESS handler must
      // not be swallowed by the probe's own error path — it belongs to the
      // unhandledRejection backstop, which is what makes the two distinguishable.
      expect(step).toMatch(/\.then\(\([a-z]+\) => \{[\s\S]*?\}, \(err\) => \{/);
    });

    test('effective_max_cost is written on EVERY path, and the paid step is what uses it', () => {
      // Council #264 r1 / B1. The clamp is only real if the paid step actually
      // takes the clamped ceiling; and a path that skipped the write would hand
      // it an empty --max-cost, which parseFloat turns into NaN — a silently
      // DISABLED cost gate, the opposite of the intent.
      const y = yml();
      const step = creditStep();
      expect(step).toContain('id: credit');
      expect(step).toContain("'effective_max_cost=' + value");
      // Written inside `finish`, the single exit point — so "every path" is
      // structural, not a list of call sites that can be forgotten.
      expect(step.match(/effective_max_cost=/g)).toHaveLength(1);
      expect(step).toContain('GITHUB_OUTPUT');
      const paid = y.slice(y.indexOf('Run the adjudicated council'), y.indexOf('Collect the spend receipt'));
      expect(paid).toContain('EFFECTIVE_MAX_COST: ${{ steps.credit.outputs.effective_max_cost }}');
      // Consumed as a shell variable, never as a `${{ }}` splice into the command
      // line: max_cost is a workflow_call input, so a direct splice would be a
      // script-injection seam.
      expect(paid).toContain('--max-cost "$CEILING"');
      expect(paid).not.toContain('--max-cost "$MAX_COST"');
    });

    test('the paid step VALIDATES the ceiling before it echoes or uses it (council #264 r2, HQ3/A2)', () => {
      // The ceiling reached a workflow command unvalidated, re-opening the exact
      // injection the preflight neutralises one step earlier — and a `grep -E`
      // on a multi-line value matches its FIRST LINE, so a regex alone is not a
      // guard. The `case` rejects any character outside the dollar alphabet,
      // newline included, before the shape is checked at all.
      const y = yml();
      const paid = y.slice(y.indexOf('Run the adjudicated council'), y.indexOf('Collect the spend receipt'));
      expect(paid).toContain('valid_ceiling()');
      expect(paid).toContain('*[!0-9.]*) return 1');
      expect(paid).toContain("'^[0-9]+(\\.[0-9]{1,2})?$'");
      // Falls back to MAX_COST, validated the SAME way, and refuses if neither is
      // a dollar amount — a non-numeric ceiling is a caller bug, not a spend call.
      expect(paid).toMatch(/valid_ceiling "\$CEILING"[\s\S]{0,400}CEILING="\$MAX_COST"/);
      expect(paid).toMatch(/::error::[^\n]*ceiling[\s\S]{0,300}exit 1/);
      // The invalid value is NEVER echoed — printing it is the injection.
      const guard = paid.slice(paid.indexOf('valid_ceiling()'), paid.indexOf('BENCH='));
      expect(guard).not.toMatch(/echo[^\n]*::error::[^\n]*\$(CEILING|MAX_COST)/);
    });

    test('the warning is mirrored into the step summary, not only into annotations', () => {
      // Council #264 r1 / C1: a broken shipped module warns and continues by
      // design; the accepted cost is that it can go unnoticed, so the same text
      // lands on the run page where a reader will meet it.
      const step = creditStep();
      expect(step).toContain('GITHUB_STEP_SUMMARY');
      expect(step).toContain('### OpenRouter credit preflight');
    });

    test('both modules resolve through ONE joined path, so a typo in it cannot pass this suite', () => {
      // Review fix round 1, Important #1: asserting only the bare file names let
      // `src/util/…` (or any other wrong join) through green, and a wrong path
      // throws MODULE_NOT_FOUND — i.e. it would have been reported as the
      // harmless bootstrap gap forever.
      const step = creditStep();
      expect(step).toContain("path.join(root, 'amicus', 'src', 'utils', file)");
      expect(step).toContain("load('openrouter-credit.js')");
      expect(step).toContain("load('council-credit-preflight.js')");
      // EXACTLY ONE MODULE resolution shape. A second `path.join(root,` would
      // be a second spelling this pin does not cover — the trap `models` walked
      // into. (The step also joins AMICUS_CONFIG_DIR for the alias map; that is
      // a different base, pinned by its own test above.)
      expect(step.match(/path\.join\(root,/g)).toHaveLength(1);
    });

    test('the bootstrap gap and a BROKEN module are reported as different facts, both exit 0', () => {
      // The runner installs `amicus@latest` from npm, never this PR's code, so
      // the release that ADDS the module cannot use it — the same one-time
      // bootstrap gap scripts/extract-workflow-env.js documents one step below.
      // But a SyntaxError, a broken transitive require or a path typo throw from
      // the same `require`, and calling those "not shipped yet" would be a false
      // sentence that leaves the step green forever on a real defect.
      const step = creditStep();
      // The bootstrap branch is gated on MODULE_NOT_FOUND *for the target path*,
      // not on any throw.
      expect(step).toContain("err.code === 'MODULE_NOT_FOUND'");
      // MEASURED: a broken transitive require also throws MODULE_NOT_FOUND and
      // puts `target` in its "Require stack:", so a bare substring test called
      // that the bootstrap gap too. The module WE asked for must be the one
      // Node names as missing, which is the message's first line.
      expect(step).toContain('String(err.message).indexOf("Cannot find module \'" + target + "\'") === 0');
      expect(step).toContain('does not ship src/utils/');
      expect(step).toContain('(bootstrap:');
      // The other branch names the module AND the error, and never claims the
      // module is merely unpublished. One line, bounded: a workflow command
      // ends at the first newline and a require-stack message has several.
      expect(step).toContain("'loading src/utils/' + file + ' failed: '");
      expect(step).toContain("replace(/\\s+/g, ' ').slice(0, 300)");
      // A renamed export throws nothing at require time; it is caught by shape.
      expect(step).toContain("typeof f !== 'function'");
      expect(step).toContain('does not export checkOpenRouterCredit/decideCreditPreflight');
      // Every load failure continues the review — both branches hand off to the
      // single exit point rather than exiting themselves (the exit code that
      // results is pinned by the ONE-exit-point test above, and executed by the
      // harness below).
      expect(step.match(/finish\('warning'/g).length).toBeGreaterThanOrEqual(2);
    });

    test('the step program is syntactically valid JavaScript as the runner will see it', () => {
      // Harvested and compiled (never executed) — the same "the test runs what
      // the runner runs" discipline the filter-diff suite above uses. A heredoc
      // is invisible to eslint, so nothing else would catch a broken edit.
      const y = yml();
      const open = y.indexOf("cat > credit-preflight.js <<'CREDIT'");
      const program = y.slice(y.indexOf('\n', open) + 1, y.indexOf('\n          CREDIT\n', open))
        .split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
      expect(program).toContain('checkOpenRouterCredit');
      expect(() => new vm.Script(program)).not.toThrow();
    });

    test('the key never reaches any output — it is passed by env and only figures are printed', () => {
      const step = creditStep();
      expect(step).toContain('OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}');
      // No shell expansion of the secret anywhere in the step: the node program
      // reads process.env directly, so there is nothing for `set -x` or an echo
      // to leak.
      expect(step).not.toContain('$OPENROUTER_API_KEY');
      expect(step).not.toMatch(/echo[^\n]*OPENROUTER_API_KEY/);
    });

    /**
     * The heredoc, EXECUTED — the same "run what the runner runs" discipline the
     * review-diff suite above uses for `filter-diff.js`.
     *
     * String pins cannot show that the program CONTINUES after a failure; only
     * running it can, and council #264 r1 / A1 is exactly a claim about exit
     * codes. `npm root -g`, `fs`, `console` and `process` are stubbed, so no
     * child process is spawned, nothing is written to disk and the run is
     * identical on every platform.
     *
     * `process.exit` records instead of throwing: the program's own `finished`
     * latch then absorbs the statements that follow a real exit, which is what
     * keeps each run to exactly one annotation — and the latch is a genuine
     * belt in production too, where `process.exit` really does stop the process.
     */
    describe('the harvested program, executed (council #264 r1 / A1, B1, C1)', () => {
      const FAKE_ROOT = path.join(path.sep, 'fake', 'global', 'root');
      const modPath = (file) => path.join(FAKE_ROOT, 'amicus', 'src', 'utils', file);

      const program = () => {
        const y = yml();
        const open = y.indexOf("cat > credit-preflight.js <<'CREDIT'");
        return y.slice(y.indexOf('\n', open) + 1, y.indexOf('\n          CREDIT\n', open))
          .split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
      };

      /**
       * @param {object} o.modules map of file name -> module object, or a
       *   function to throw (simulating a load failure). Missing = not shipped.
       */
      const run = async (o = {}) => {
        const out = { logs: [], errors: [], exits: [], files: {}, handlers: {} };
        const append = (f, data) => {
          if (o.failOutputWrite && f === 'OUT') { throw new Error('EACCES: read-only step file'); }
          out.files[f] = (out.files[f] || '') + data;
        };
        const stub = {
          'child_process': { execSync: () => `${FAKE_ROOT}\n` },
          'path': path,
          'fs': {
            appendFileSync: append,
            // The provisioned alias map the earlier step wrote — where the
            // reservation's outputBudget and bench ids come from.
            readFileSync: (f) => {
              out.reads = (out.reads || []).concat(f);
              if (o.aliasMap === null) {
                const e = new Error(`ENOENT: no such file or directory, open '${f}'`);
                e.code = 'ENOENT';
                throw e;
              }
              return typeof o.aliasMap === 'string' ? o.aliasMap
                : JSON.stringify(o.aliasMap || DEFAULT_MAP);
            },
          },
        };
        const req = (id) => {
          if (Object.prototype.hasOwnProperty.call(stub, id)) { return stub[id]; }
          for (const [file, mod] of Object.entries(o.modules || {})) {
            if (id === modPath(file)) {
              if (typeof mod === 'function') { throw mod(); }
              return mod;
            }
          }
          const err = new Error(`Cannot find module '${id}'\nRequire stack:\n- credit-preflight.js`);
          err.code = 'MODULE_NOT_FOUND';
          throw err;
        };
        const ctx = vm.createContext({
          require: req,
          console: { log: (m) => out.logs.push(m), error: (m) => out.errors.push(m) },
          process: {
            env: { MAX_COST: '2.00', OPENROUTER_API_KEY: 'sk-never-printed',
              MODELS: 'glm,qwen,gpt,deepseek', CHAIR: 'gemini-pro',
              AMICUS_CONFIG_DIR: path.join(path.sep, 'ws', 'amicus-cfg'),
              GITHUB_OUTPUT: 'OUT', GITHUB_STEP_SUMMARY: 'SUMMARY', ...(o.env || {}) },
            exit: (code) => { out.exits.push(code); },
            on: (name, fn) => { out.handlers[name] = fn; },
          },
        });
        new vm.Script(program()).runInContext(ctx);
        await new Promise((resolve) => setImmediate(resolve));
        out.annotations = out.logs.concat(out.errors).filter((l) => /^::/.test(l));
        return out;
      };

      /** The bench and chair of the real CI map, priced so one seat reserves $0.96. */
      const DEFAULT_MAP = {
        outputBudget: 64000,
        aliases: {
          glm: 'openrouter/z-ai/glm-5.3', qwen: 'openrouter/qwen/qwen3.8-27b',
          gpt: 'openrouter/openai/gpt-5.6-terra', deepseek: 'openrouter/deepseek/deepseek-v4-flash-0731',
          'gemini-pro': 'openrouter/google/gemini-3.1-pro-preview',
        },
      };
      const DEFAULT_PRICES = {
        'z-ai/glm-5.3': 0.0000005, 'qwen/qwen3.8-27b': 0.0000002,
        'openai/gpt-5.6-terra': 0.000015, 'deepseek/deepseek-v4-flash-0731': 0.0000003,
        'google/gemini-3.1-pro-preview': 0.00001,
      };

      /**
       * The three shipped modules the step loads. The two PURE ones are the real
       * implementations — the harness exercises the same ruling CI will run; only
       * the three network calls are stubbed.
       */
      const shipped = ({ credit = { checked: true, isFreeTier: false, limitRemaining: 50 },
        balance = { checked: true, balanceRemaining: 50, totalCredits: null, totalUsage: null },
        catalog = { checked: true, prices: DEFAULT_PRICES } } = {}) => ({
        'openrouter-credit.js': {
          checkOpenRouterCredit: () => Promise.resolve(credit),
          checkOpenRouterBalance: () => Promise.resolve(balance),
        },
        'council-credit-preflight.js': require('../../src/utils/council-credit-preflight'),
        'council-credit-reservation.js': {
          ...require('../../src/utils/council-credit-reservation'),
          fetchOpenRouterModelPrices: () => Promise.resolve(catalog),
        },
      });

      test('ok: ::notice::, exit 0, and the ORIGINAL ceiling is written', async () => {
        const r = await run({ modules: shipped() });
        expect(r.exits).toEqual([0]);
        expect(r.annotations).toHaveLength(1);
        expect(r.annotations[0]).toMatch(/^::notice::OpenRouter credit ok/);
        expect(r.files.OUT).toBe('effective_max_cost=2.00\n');
        expect(r.files.SUMMARY).toContain('### OpenRouter credit preflight');
        expect(r.files.SUMMARY).toContain('Run ceiling in force: $2.00');
      });

      test('the reservation is priced from the PROVISIONED map and the live catalog', async () => {
        // Council #264 r2 / HQ1: 64000 tokens x the bench's dearest completion
        // price ($0.000015) = $0.96 reserved by ONE seat, before it emits a token.
        const r = await run({ modules: shipped(), env: { MAX_COST: '10.00' } });
        expect(r.reads.join('|')).toContain(path.join('amicus-cfg', 'config.json'));
        expect(r.annotations[0]).toContain('$3.84'); // 4 bench seats x $0.96
      });

      test('clamp: ::warning::, exit 0, and the CLAMPED ceiling is what the paid step will read', async () => {
        const r = await run({ modules: shipped({
          credit: { checked: true, isFreeTier: false, limitRemaining: 5 },
          balance: { checked: true, balanceRemaining: 5 },
        }), env: { MAX_COST: '10.00' } });
        expect(r.exits).toEqual([0]);
        expect(r.annotations[0]).toMatch(/^::warning::OpenRouter money is below this run's ceiling/);
        expect(r.files.OUT).toBe('effective_max_cost=5\n');
        expect(r.files.SUMMARY).toContain('Run ceiling in force: $5');
      });

      test('refuse: ::error:: on stderr, exit 1, and the output is STILL written', async () => {
        const r = await run({ modules: shipped({ credit: { checked: true, isFreeTier: true, limitRemaining: null } }) });
        expect(r.exits).toEqual([1]);
        expect(r.errors[0]).toMatch(/^::error::OpenRouter key cannot cover this run/);
        expect(r.logs.filter((l) => /^::/.test(l))).toHaveLength(0); // never on stdout
        expect(r.files.OUT).toBe('effective_max_cost=2.00\n');
        // The summary still carries the diagnosis, but NOT a ceiling: a refusal
        // dispatches nothing, so no ceiling is "in force" (council #264 r1 nit 4).
        expect(r.files.SUMMARY).toContain('### OpenRouter credit preflight');
        expect(r.files.SUMMARY).not.toContain('Run ceiling in force');
      });

      test('HQ1 refuse-by-reservation: money below ONE seat\'s reservation exits 1', async () => {
        // The motivating run's exact shape, in dollars: $0.80 left against a
        // $0.96 per-seat reservation. No aggregate ceiling could ever see this.
        const r = await run({ modules: shipped({
          credit: { checked: true, isFreeTier: false, limitRemaining: 0.8 },
          balance: { checked: true, balanceRemaining: 0.8 },
        }) });
        expect(r.exits).toEqual([1]);
        expect(r.errors[0]).toContain('ONE seat reserves $0.96');
        expect(r.errors[0]).toContain('$0.80');
      });

      test('HQ1 warn-by-concurrency: money funds some seats but not the wave', async () => {
        const r = await run({ modules: shipped({
          credit: { checked: true, isFreeTier: false, limitRemaining: 2 },
          balance: { checked: true, balanceRemaining: 2 },
        }), env: { MAX_COST: '2.00' } });
        expect(r.exits).toEqual([0]);
        expect(r.annotations[0]).toMatch(/^::warning::OpenRouter key may not fund the first wave/);
        expect(r.annotations[0]).toContain('4 seats reserve $3.84');
      });

      test('HQ1 unpriced bench: the rule is skipped with a ::warning::, never an ok', async () => {
        for (const modules of [
          shipped({ catalog: { checked: false, prices: {} } }),               // catalog unreadable
          shipped({ catalog: { checked: true, prices: { 'z-ai/glm-5.3': 0.1 } } }), // partial table
        ]) {
          const r = await run({ modules });
          expect(r.exits).toEqual([0]);
          expect(r.annotations[0]).toMatch(/^::warning::/);
          expect(r.annotations[0]).toContain('could not price the bench');
        }
      });

      test('HQ1 an alias the provisioned map does not carry leaves the bench unpriced', async () => {
        const r = await run({ modules: shipped(), aliasMap: { outputBudget: 64000, aliases: { glm: 'openrouter/z-ai/glm-5.3' } } });
        expect(r.exits).toEqual([0]);
        expect(r.annotations[0]).toContain('could not price the bench');
        expect(r.annotations[0]).toContain('qwen');
      });

      test('a missing or unreadable alias map does not crash the step', async () => {
        for (const aliasMap of [null, 'not json {{{']) {
          const r = await run({ modules: shipped(), aliasMap });
          expect(r.exits).toEqual([0]);
          expect(r.annotations[0]).toMatch(/^::warning::/);
        }
      });

      test('HQ2 the ACCOUNT BALANCE is read, and an unchecked one can never be ok', async () => {
        const r = await run({ modules: shipped({ balance: { checked: false, balanceRemaining: null } }) });
        expect(r.exits).toEqual([0]);
        expect(r.annotations[0]).toMatch(/^::warning::/);
        expect(r.annotations[0]).toContain('account balance');
      });

      test('HQ2 a key with NO monthly cap on a depleted balance refuses', async () => {
        const r = await run({ modules: shipped({
          credit: { checked: true, isFreeTier: false, limitRemaining: null },
          balance: { checked: true, balanceRemaining: 0 },
        }) });
        expect(r.exits).toEqual([1]);
        expect(r.errors[0]).toContain('account balance');
      });

      test('a SUB-CENT remainder refuses — it must never reach the CLI as --max-cost 0', async () => {
        // Council #264 r1 round 2. `--max-cost 0` is a BAD ARGUMENT, not a tight
        // budget: cli-handlers-council-run.js rejects a non-positive ceiling with
        // exit 1, so a $0.00 clamp would fail the job outright.
        const r = await run({ modules: shipped({
          credit: { checked: true, isFreeTier: false, limitRemaining: 0.004 },
          balance: { checked: true, balanceRemaining: 0.004 },
          catalog: { checked: true, prices: Object.fromEntries(Object.keys(DEFAULT_PRICES).map((k) => [k, 1e-9])) },
        }) });
        expect(r.exits).toEqual([1]);
        expect(r.errors[0]).toContain('below one cent');
        expect(r.files.OUT).toBe('effective_max_cost=2.00\n');
      });

      test('when the output write FAILS, the summary does not claim a ceiling the paid step is not using', async () => {
        // Council #264 r1 round 2, folded minor: the two surfaces shared one
        // `try`, so a failed $GITHUB_OUTPUT write still printed "Run ceiling in
        // force: $X" — an assertion about a value the paid step never received.
        const r = await run({
          modules: shipped({
            credit: { checked: true, isFreeTier: false, limitRemaining: 5 },
            balance: { checked: true, balanceRemaining: 5 },
          }),
          env: { MAX_COST: '10.00' },
          failOutputWrite: true,
        });
        expect(r.exits).toEqual([0]);
        expect(r.files.SUMMARY).toContain('### OpenRouter credit preflight');
        expect(r.files.SUMMARY).not.toContain('Run ceiling in force');
        // And it says so out loud, naming the fallback the paid step will take.
        expect(r.logs.join('\n')).toContain('could not publish effective_max_cost');
      });

      test('A1: a probe that THROWS SYNCHRONOUSLY warns and exits 0', async () => {
        const r = await run({ modules: {
          ...shipped(),
          'openrouter-credit.js': { checkOpenRouterCredit: () => { throw new Error('boom sync'); },
            checkOpenRouterBalance: () => Promise.resolve({ checked: false }) },
        } });
        expect(r.exits).toEqual([0]);
        expect(r.annotations[0]).toContain('the preflight itself failed: boom sync');
        expect(r.files.OUT).toBe('effective_max_cost=2.00\n');
      });

      test('A1: a probe that REJECTS warns and exits 0', async () => {
        const r = await run({ modules: {
          ...shipped(),
          'openrouter-credit.js': { checkOpenRouterCredit: () => Promise.reject(new Error('boom async')),
            checkOpenRouterBalance: () => Promise.resolve({ checked: false }) },
        } });
        expect(r.exits).toEqual([0]);
        expect(r.annotations[0]).toContain('the probe rejected: boom async');
      });

      test('A1: the unhandledRejection backstop warns and exits 0', async () => {
        const r = await run({ modules: shipped() });
        expect(typeof r.handlers.unhandledRejection).toBe('function');
        const fresh = await run({ modules: { ...shipped(),
          'openrouter-credit.js': { checkOpenRouterCredit: () => new Promise(() => {}),
            checkOpenRouterBalance: () => new Promise(() => {}) } } });
        expect(fresh.exits).toEqual([]); // still pending — nothing decided yet
        fresh.handlers.unhandledRejection(new Error('stray'));
        expect(fresh.exits).toEqual([0]);
        // `annotations` was snapshotted before the handler fired, so read the
        // live stream rather than the snapshot.
        expect(fresh.logs[0]).toContain('an unhandled rejection: stray');
        expect(fresh.logs[0]).toMatch(/^::warning::/);
      });

      test('A1: a module the release has not shipped yet warns and exits 0', async () => {
        const all = shipped();
        const r = await run({ modules: { 'openrouter-credit.js': all['openrouter-credit.js'] } });
        expect(r.exits).toEqual([0]);
        expect(r.annotations).toHaveLength(1);
        expect(r.annotations[0]).toContain('does not ship src/utils/council-credit-preflight.js yet');
      });

      test('A1: a BROKEN shipped module warns, exits 0, and is NOT called the bootstrap gap', async () => {
        const r = await run({ modules: {
          ...shipped(),
          'council-credit-preflight.js': () => new SyntaxError('Unexpected identifier'),
        } });
        expect(r.exits).toEqual([0]);
        expect(r.annotations[0]).toContain('loading src/utils/council-credit-preflight.js failed');
        expect(r.annotations[0]).not.toContain('does not ship');
      });

      test('A1: a RENAMED export warns and exits 0 instead of dying on a TypeError', async () => {
        const r = await run({ modules: {
          ...shipped(),
          'council-credit-preflight.js': { decideCreditPreflightRenamed: () => ({}) },
        } });
        expect(r.exits).toEqual([0]);
        expect(r.annotations[0]).toContain('does not export checkOpenRouterCredit/decideCreditPreflight');
      });

      test('a newline in MAX_COST cannot open a second output key', async () => {
        // max_cost is a workflow_call input, so its value is caller-controlled.
        const r = await run({ env: { MAX_COST: '2.00\nADMIN=1' },
          modules: shipped() });
        const lines = r.files.OUT.split('\n').filter(Boolean);
        expect(lines).toHaveLength(1);
        // The newline is neutralised, so the injected text survives only as part
        // of the ONE value — it never becomes a key the runner will parse.
        const keys = lines.map((l) => l.slice(0, l.indexOf('=')));
        expect(keys).toEqual(['effective_max_cost']);
      });

      test('the key never appears in anything the program writes or prints', async () => {
        const r = await run({ modules: shipped() });
        const everything = JSON.stringify([r.logs, r.errors, r.files]);
        expect(everything).not.toContain('sk-never-printed');
      });
    });
  });
});
