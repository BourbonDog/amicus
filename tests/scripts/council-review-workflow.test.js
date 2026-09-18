// tests/scripts/council-review-workflow.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
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

    // Green at HEAD by construction (Task 1 shipped `extendWindowMs`): this is a
    // PRESERVATION pin on CI's geometry, not a new behaviour. Its named mutant is
    // the WORKFLOW value, not the code — `--timeout 16` → `--timeout 8` in a scratch
    // copy of the workflow: legCap becomes 480000, extendWindowMs(480000, 480000) =
    // min(960000, 456000) = 456000, so the FIRST assertion (`extended > ms`) fails
    // (456000 vs 480000). Measured 2026-09-18 on a scratch copy; the real workflow's
    // values were not touched.
    test('#251 item 1: one extension of the first attempt still fires before the leg cap, and the retry leg has no room to extend — both derived from the workflow\'s own values', () => {
      const { extendWindowMs } = require('../../src/utils/no-output-backstop');
      const cmd = councilRunCommand();
      const ms = Number(cmd.match(/AMICUS_NO_OUTPUT_BACKSTOP_MS: '(\d+)'/)[1]);
      const legCap = Number(cmd.match(/--timeout (\d+)/)[1]) * 60 * 1000;
      const extended = extendWindowMs(ms, legCap);
      expect(extended).toBeGreaterThan(ms);          // the first attempt CAN be extended in CI …
      expect(extended).toBeLessThan(legCap);         // … and still dies under its own name, not `timeout`
      expect(extendWindowMs(extended, legCap)).toBe(extended); // the retry (already at that window) cannot: `at-cap`
      // The worst-case pin above is unchanged by design: its first term is already legCap.
    });
  });

  /**
   * #202 Lever 2 — the provider-routing experiment.
   *
   * The one untried cause-level lever on #202's heavy TTFT tail is OpenRouter
   * PROVIDER pinning: OpenRouter fans a model out across several upstreams, and
   * a run records nothing about which one served a leg. PR #265 measured on the
   * pinned engine (keyless) that a per-model `options.provider` block reaches
   * the OpenRouter request body verbatim, and that an `opencode.json` placed in
   * the per-call directory is live (cases R12/R14/R15 — the engine walks up from
   * the session directory). `only: ["<one-slug>"]` is the only SELF-ATTRIBUTING
   * form, because nothing in the run names the serving upstream: if exactly one
   * upstream can serve the leg, the leg's outcome is that upstream's.
   *
   * The document is written into `$RUN_DIR`, which is the surface the launch-
   * time agent tripwire (`verifyAgentRendering`/`verifyAgentFields`, rulings
   * P2-R33/R44/R53) polices — a tree's opencode.json CAN move a council agent's
   * permission rules. That it does not here is MEASURED, not argued:
   * scripts/probe-council-agents.js's `PROBE_TREE_ROUTING_JSON` case, run by
   * tests/council-agents-engine.integration.test.js.
   */
  describe('provider-routing experiment (#202 Lever 2)', () => {
    const ROUTING_STEP = 'Write the provider-routing experiment into the run directory';
    const routingStep = () => {
      const y = yml();
      return y.slice(y.indexOf(`- name: ${ROUTING_STEP}`), y.indexOf('- name: Run the adjudicated council'));
    };
    /**
     * The raw `COUNCIL_PROVIDER_ROUTING` scalar, with every spelling of "blank"
     * normalised to `''` (re-review N5). `''` and a bare
     * `COUNCIL_PROVIDER_ROUTING:` (YAML null) both reach the runner as an empty
     * string and both correctly SKIP the step, so the suite must be green for
     * both — A3 was fixed for only the first. The key itself is still required:
     * its presence is what documents the off-switch and what the step's `if:`
     * reads, so deleting the line fails here on purpose, with a message that
     * says so rather than a `SyntaxError` from somewhere downstream.
     */
    const routingValue = () => {
      const y = yml();
      const m = /^\s*COUNCIL_PROVIDER_ROUTING:[ \t]*(?:'(.*)')?[ \t]*$/m.exec(y);
      expect(`COUNCIL_PROVIDER_ROUTING declared: ${m !== null}`).toBe('COUNCIL_PROVIDER_ROUTING declared: true');
      return m[1] === undefined ? '' : m[1];
    };
    // The routing step lives BEFORE the paid step; the health warning below
    // lives after the evidence upload. Two slices, each bounded by the step that
    // actually follows it, so neither can silently swallow a third step.
    const HEALTH_STEP = "Warn when a pinned model's leg died";
    const healthStep = () => {
      const y = yml();
      return y.slice(y.indexOf(`- name: ${HEALTH_STEP}`), y.indexOf('- name: Publish the Council Review check run'));
    };
    /**
     * The routing step with its COMMENT lines removed — i.e. what the runner
     * actually executes. Council #266 r2 / A6: a `toContain` over the whole
     * slice is satisfied by prose, so `expect(step).toContain('jq -e .')` went
     * on passing after the executable form changed, held up only by a comment
     * that quoted the removed spelling. The same trap the `councilRunCommand`
     * helper above was written for.
     */
    const routingRunCommand = () => routingStep()
      .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

    /**
     * THE DOCUMENTED EXAMPLE, and the fixture every gate is exercised with.
     * The shipped value is BLANK (owner's decision after two live rounds moved
     * nothing), so the default path now pins "no pin in force" and this is what
     * pins the non-blank path. It is byte-identical to the example carried in
     * the workflow's own env comment, which is asserted below.
     */
    const FIXTURE = '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"only":["reka"]}}}}}}}';

    /**
     * The documented OpenRouter provider-routing fields ("The provider object
     * can contain the following fields") from
     * https://openrouter.ai/docs/features/provider-routing.
     *
     * ⚠️ A DATED MANUAL TRANSCRIPTION (2026-09-17) WITH NO MACHINE-CHECKABLE
     * SOURCE IN THIS REPO (re-review N3). The saved page it was read from is in
     * the owner's evidence store, not the tree, so the equality asserted below
     * proves gate == test and catches gate/test drift — it cannot catch drift
     * from OpenRouter. Re-read the URL when the docs move; the list is data in
     * both places precisely so that re-check is a one-line edit.
     */
    const DOCUMENTED_PROVIDER_KEYS = [
      'allow_fallbacks', 'data_collection', 'enforce_distillable_text', 'ignore', 'max_price',
      'only', 'order', 'preferred_max_latency', 'preferred_min_throughput', 'quantizations',
      'require_parameters', 'sort', 'zdr',
    ];

    /**
     * The document pins, as a function of the VALUE — council #266 r1 / A3.
     *
     * These used to run `JSON.parse(routingValue())` unconditionally, so
     * blanking `COUNCIL_PROVIDER_ROUTING` — the off-switch the env comment, the
     * CHANGELOG and the README all document — turned this suite RED with
     * `SyntaxError: Unexpected end of JSON input`. A maintainer following the
     * documented procedure would have had to edit the tests too, which is the
     * off-switch not working. A blank value is a valid shipped state: there is
     * no document, so there is no shape to check — only that the step can still
     * be skipped.
     * @param {string} value the raw COUNCIL_PROVIDER_ROUTING scalar
     */
    const assertRoutingDocument = (value) => {
      if (value === '') {
        // The shipped state: no pin. Nothing to check about a document that
        // does not exist — only that the step still refuses to write one.
        expect(routingRunCommand()).toContain('if [ -z "$COUNCIL_PROVIDER_ROUTING" ]; then');
        return;
      }
      const doc = JSON.parse(value);
      expect(Object.keys(doc)).toEqual(['provider']);
      // ⚠️ EVERY GATE-VALID FORM, NOT TODAY'S (council #266 r2, A2). This used
      // to index `doc.provider.openrouter.models` and demand `only` with one
      // slug, so a two-gateway document TypeError'd and an `order`-only one —
      // which every workflow gate accepts — failed on a missing property
      // instead of being recognised as valid. The suite and the gate disagreed
      // about what a valid shipped state is, and the suite lost cleanly only by
      // accident of what was shipped that day.
      const gateways = Object.entries(doc.provider);
      expect(gateways.length).toBeGreaterThan(0);
      for (const [gateway, provider] of gateways) {
        expect(typeof gateway).toBe('string');
        // Round-1 review F1: nothing may sit between `provider.<name>` and
        // `models` — `options` there is the engine's baseURL/apiKey channel.
        expect(Object.keys(provider)).toEqual(['models']);
        const models = Object.entries(provider.models);
        expect(models.length).toBeGreaterThan(0);
        for (const [id, entry] of models) {
          expect(typeof id).toBe('string');
          expect(id.length).toBeGreaterThan(0);
          // ONLY options.provider. Anything else (a prompt, a model override, a
          // permission block) would be exactly the P2-R33/R44/R53 attack shape.
          expect(Object.keys(entry)).toEqual(['options']);
          expect(Object.keys(entry.options)).toEqual(['provider']);
          // Council #266 r1 / B1 + A2: the CONTENTS, not just the key. An empty
          // object, an undocumented key, or an empty `only` list would all be
          // accepted by a shape-only gate and then reported as an active,
          // attributable pin.
          const routing = entry.options.provider;
          expect(Object.keys(routing).length).toBeGreaterThan(0);
          for (const key of Object.keys(routing)) { expect(DOCUMENTED_PROVIDER_KEYS).toContain(key); }
          for (const key of ['only', 'order', 'ignore']) {
            if (!Object.prototype.hasOwnProperty.call(routing, key)) { continue; }
            expect(Array.isArray(routing[key])).toBe(true);
            expect(routing[key].length).toBeGreaterThan(0);
            for (const slug of routing[key]) {
              expect(typeof slug).toBe('string');
              expect(slug.length).toBeGreaterThan(0);
            }
          }
          // ⚠️ `only` IS NOT REQUIRED (council #266 r2, C1 — the ruling on a
          // contested finding). An order-only document is a valid experiment;
          // it is simply not self-attributing, and the run's ::notice:: is
          // where that is said. When `only` IS present it must name exactly one
          // upstream, because a two-slug `only` is the shape that reads as
          // attributable while not being it.
          if (Object.prototype.hasOwnProperty.call(routing, 'only')) {
            expect(routing.only).toHaveLength(1);
          }
        }
      }
    };

    test('the step exists and runs BEFORE the paid council step', () => {
      const y = yml();
      expect(y.indexOf(`- name: ${ROUTING_STEP}`)).toBeGreaterThan(-1);
      expect(y.indexOf(`- name: ${ROUTING_STEP}`))
        .toBeLessThan(y.indexOf('- name: Run the adjudicated council'));
      // A file written AFTER the run starts reaches nothing.
      expect(routingStep()).toContain('$RUN_DIR/opencode.json');
    });

    test('blanking the value turns the experiment off — nothing is written', () => {
      const step = routingStep();
      // ⚠️ THE ROUTING STEP ITSELF NO LONGER CARRIES THE ENV CONDITION (council
      // #266 r2, A1): it must run on a blank value too, so that its `find`
      // assertion covers the ordinary run. The off-switch moved into the shell,
      // and the POST-RUN health step is what is still skipped outright.
      expect(healthStep()).toContain('env.COUNCIL_PROVIDER_ROUTING }}');
      expect(routingRunCommand()).toContain('if [ -z "$COUNCIL_PROVIDER_ROUTING" ]; then');
      // Truthiness, NOT `!= ''` (round-1 review F5). GitHub's loose equality
      // coerces numerically, so the value `0` — valid JSON, not a valid
      // experiment — compares EQUAL to '' and would skip the step with no
      // annotation at all: the "ran silently as no experiment" degrade every
      // other malformed value is made to fail loudly on. The empty string is
      // the only falsy string, so plain truthiness skips on blank (and on an
      // absent key, which is also correct) and runs on any JSON document,
      // leaving `0` to the jq gates below, which refuse it loudly.
      expect(step).not.toContain("COUNCIL_PROVIDER_ROUTING != ''");
      // Gated on the secret like every other step in this job: a soft-skipped
      // fork PR must not announce an experiment that no council ran.
      expect(step).toContain("steps.gate.outputs.available == 'true'");
    });

    test('the value reaches the shell through env:, never spliced into run:', () => {
      const step = routingStep();
      const runBlock = step.slice(step.indexOf('run: |'));
      // The established rule from #256/#264: a `${{ }}` splice inside run: is a
      // script-injection seam, and this value is a JSON document full of quotes.
      expect(runBlock).not.toContain('${{');
      expect(step).toContain('"$COUNCIL_PROVIDER_ROUTING"');
    });

    test('a malformed document fails the job loudly instead of running as "no experiment"', () => {
      const step = routingStep();
      // Council #266 r2 / A6: pinned on the EXECUTABLE line (see the dedicated
      // A6 test below), not on a `jq -e .` substring a comment could satisfy.
      expect(routingRunCommand()).toContain("jq -e 'type == \"object\"'");
      expect(step).toContain('::error::');
      expect(step).toContain('exit 1');
      // The shape assertions the invariant argument rests on, not merely a
      // parse: a document carrying anything but the routing key would be inside
      // the agent-rendering surface with nothing measured about it.
      // Round-1 review F4: the run directory must be created at 0700, not the
      // runner's 0755 umask. `fs.mkdirSync(runDir, { recursive: true, mode:
      // 0o700 })` in src/council/run-state.js is a NO-OP on a directory that
      // already exists — it never chmods — so pre-creating it here would
      // silently downgrade the mode the council code asks for.
      expect(step).toContain('(umask 077; mkdir -p "$RUN_DIR")');
      expect(step).toContain('::notice::');
    });

    test('the shape gate constrains the PROVIDER level too — not only the model entries', () => {
      // Round-1 review F1, recorded as the document that passed the first three
      // assertions: `provider.<name>.options` is the engine's own
      // baseURL/apiKey channel — the exact channel PR #265's rig used to point
      // the engine at its capture server (digest R3) — and it sits BETWEEN
      // `provider.<name>` and `models`, which a models-only gate never reads.
      const smuggled = {
        provider: {
          openrouter: {
            options: { baseURL: 'http://elsewhere/api/v1' },
            models: { 'qwen/qwen3.8-27b': { options: { provider: { only: ['reka'] } } } },
          },
        },
      };
      // It satisfies every other assertion the step makes …
      expect(Object.keys(smuggled)).toEqual(['provider']);
      for (const entry of Object.values(smuggled.provider.openrouter.models)) {
        expect(Object.keys(entry)).toEqual(['options']);
        expect(Object.keys(entry.options)).toEqual(['provider']);
      }
      // … and only a PROVIDER-level assertion can refuse it. Without one, the
      // invariant sentence in the env comment ("the document carries ONLY the
      // routing key") is a claim nothing asserts, and the probe measured
      // nothing about a document of that shape.
      expect(Object.keys(smuggled.provider.openrouter)).not.toEqual(['models']);
      expect(routingStep()).toContain('[.provider[] | keys == ["models"]]');
    });

    test('the shipped default is BLANK — infrastructure on, no pin in force', () => {
      // Owner's decision after two live rounds (#266 r1 and r2) pinned qwen to
      // reka and did not move the #202 tail. Stated as measured (re-review N8):
      // five legs ran under the pin across the two rounds and three failed —
      // both FIRST attempts died at the 480 s backstop, round 1's retry died
      // too (912 s) and lost the seat, and round 2's retry and judge leg
      // COMPLETED through reka (first token 380 s and 209 s). The
      // `(session: busy)` clause is on exactly one pinned leg; round 1 ran on
      // 4.11.0, which had no such clause. A merge-gating seat does not stay on
      // a single upstream for no measured benefit, so the machinery ships armed
      // and unfired.
      expect(routingValue()).toBe('');
      assertRoutingDocument(routingValue());
      const cmd = routingRunCommand();
      // Blank must write NOTHING and say so, and it must stop before every gate.
      expect(cmd).toContain('if [ -z "$COUNCIL_PROVIDER_ROUTING" ]; then');
      expect(cmd).toMatch(/NO provider pin is in force[\s\S]*?exit 0\n\s*fi/);
      expect(cmd.indexOf('if [ -z "$COUNCIL_PROVIDER_ROUTING" ]; then'))
        .toBeLessThan(cmd.indexOf('opencode.json"'));
      // And the post-run health step is skipped entirely — it still carries the
      // env condition the routing step no longer can (it must run on blank).
      expect(healthStep()).toContain('env.COUNCIL_PROVIDER_ROUTING');
    });

    test('the documented example is the fixture, byte for byte', () => {
      // The example in the env comment is what a maintainer will copy, and the
      // fixture below is what every gate is exercised with. If they drift, the
      // tests stop covering the thing the docs tell people to paste.
      expect(yml()).toContain(`COUNCIL_PROVIDER_ROUTING: '${FIXTURE}'`);
      assertRoutingDocument(FIXTURE);
    });

    test('A2 — every gate-valid document shape passes the suite cleanly', () => {
      // Council #266 r2 / A2: the forms the workflow gates accept. Each of
      // these reddened the old helper with a TypeError or a missing-property
      // failure rather than passing or failing on its merits.
      const doc = (models, gateway = 'openrouter') => JSON.stringify({ provider: { [gateway]: { models } } });
      const pin = (provider) => ({ options: { provider } });
      const valid = [
        doc({ 'qwen/qwen3.8-27b': pin({ order: ['reka', 'novita'], allow_fallbacks: false }) }),
        doc({ 'qwen/qwen3.8-27b': pin({ ignore: ['deepinfra'] }) }),
        doc({ 'qwen/qwen3.8-27b': pin({ sort: 'latency' }) }),
        doc({ 'qwen/qwen3.8-27b': pin({ only: ['reka'] }), 'z-ai/glm-5.3': pin({ only: ['novita'] }) }),
        doc({ 'qwen/qwen3.8-27b': pin({ only: ['reka'] }) }, 'some-other-gateway'),
      ];
      for (const value of valid) { expect(() => assertRoutingDocument(value)).not.toThrow(); }
      // And it still FAILS — cleanly, on an expectation, never a TypeError —
      // for documents the gates refuse.
      const bad = [
        doc({ 'qwen/qwen3.8-27b': pin({}) }),
        doc({ 'qwen/qwen3.8-27b': pin({ onlyy: ['reka'] }) }),
        doc({ 'qwen/qwen3.8-27b': pin({ only: [] }) }),
        doc({ 'qwen/qwen3.8-27b': pin({ only: ['reka', 'novita'] }) }),
        doc({}),
      ];
      for (const value of bad) {
        expect(() => assertRoutingDocument(value)).toThrow(/expect|Expected/);
      }
    });

    test('the documented off-switch is a valid shipped state, not a red suite', () => {
      // Council #266 r1 / A3. Measured RED before this landed: blanking the
      // value in the workflow failed two tests with `SyntaxError: Unexpected
      // end of JSON input`.
      expect(() => assertRoutingDocument('')).not.toThrow();
    });

    test('every pinned model id is one the CI alias map actually seats', () => {
      // If the alias map drops qwen (or re-pins it to another id), this pin
      // silently stops applying to any seat — a routing experiment nobody is
      // running. Read the map rather than restating its ids here.
      // Round-1 review F2: compared in GATEWAY form. Stripping the
      // `openrouter/` prefix off the map's ids is the idiom .eslintrc.js's
      // `no-restricted-syntax` rule bans outright (issue #214) — and no gate on
      // this branch lints tests/scripts/, so nothing would have caught it. The
      // routing document's keys are engine model ids, so the prefix is added to
      // THEM instead of removed from the map.
      // The shipped value is blank, so the FIXTURE is what carries ids to check
      // — and it is the same document the env comment documents as the example.
      const value = FIXTURE;
      const map = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '.github', 'amicus-ci-aliases.json'), 'utf-8'));
      const aliasIds = new Set(Object.values(map.aliases).map(String));
      const models = JSON.parse(value).provider.openrouter.models;
      for (const id of Object.keys(models)) { expect(aliasIds).toContain(`openrouter/${id}`); }
    });

    // ---- council #266 round 1 ------------------------------------------------

    test('A5 — a valid-but-falsy value is refused as "not an object", not mislabelled "not valid JSON"', () => {
      const step = routingStep();
      // `0`, `null` and `false` are all VALID JSON and all useless as a routing
      // document. `jq -e .` exits 1 on them, which the step then reported as a
      // parse failure — a maintainer reading "is not valid JSON" about the
      // literal text `0` has been told something false about their own value.
      expect(step).toContain("jq -e 'type == \"object\"'");
      expect(step).toContain('must be a JSON object');
      expect(step).not.toContain('is not valid JSON');
    });

    test('B1/A2 — the gate validates options.provider CONTENTS against the documented key set', () => {
      const step = routingStep();
      // The allowlist is DATA in the step (`--argjson ok`), so this test can
      // compare it with the documented set instead of restating a filter.
      const m = /--argjson ok '(\[[^']*\])'/.exec(step);
      expect(`the routing gate declares an --argjson allowlist: ${m !== null}`)
        .toBe('the routing gate declares an --argjson allowlist: true');
      expect(JSON.parse(m[1]).slice().sort()).toEqual(DOCUMENTED_PROVIDER_KEYS.slice().sort());
      // And it must REJECT, not merely list: every key known, and at least one.
      expect(step).toContain('(keys | length > 0) and ((keys - $ok) | length == 0)');
    });

    test('B1/A2 — the documents a contents gate has to refuse, recorded', () => {
      // The shapes that passed every gate before this round. Each is valid JSON,
      // routing-only at every structural level, and inert or wrong as an
      // experiment — and the step reported all of them as an active,
      // attributable pin.
      const inert = { options: { provider: {} } };
      const unknownKey = { options: { provider: { onlyy: ['reka'] } } };
      const emptyList = { options: { provider: { only: [] } } };
      const blankSlug = { options: { provider: { only: [''] } } };
      const nonString = { options: { provider: { only: [1] } } };
      for (const bad of [inert, unknownKey, emptyList, blankSlug, nonString]) {
        // structurally identical to the shipped default …
        expect(Object.keys(bad)).toEqual(['options']);
        expect(Object.keys(bad.options)).toEqual(['provider']);
        // … and refused by the contents rules the gate now enforces.
        const routing = bad.options.provider;
        const known = Object.keys(routing).every((k) => DOCUMENTED_PROVIDER_KEYS.includes(k));
        const lists = ['only', 'order', 'ignore']
          .filter((k) => Object.prototype.hasOwnProperty.call(routing, k))
          .every((k) => Array.isArray(routing[k]) && routing[k].length > 0
            && routing[k].every((s) => typeof s === 'string' && s.length > 0));
        expect(Object.keys(routing).length > 0 && known && lists).toBe(false);
      }
      const step = routingStep();
      // The list-shape rule, and the alias-map rule, each present as a gate.
      expect(step).toContain('type == "array"');
      expect(step).toContain('map(type == "string" and length > 0)');
      expect(step).toContain('--slurpfile map');
    });

    test('B1 — a pinned model id is checked against the map the job actually provisioned', () => {
      const step = routingStep();
      // Not the repo copy: the job reads the map from the BASE ref into
      // $AMICUS_CONFIG_DIR/config.json, and THAT is what the bench resolves
      // from. Checking a different file would pass while the run pins an id no
      // seat carries.
      expect(step).toContain('"$AMICUS_CONFIG_DIR/config.json"');
      // Gateway form — the document's keys are engine ids, so the gateway
      // prefix is ADDED to them (issue #214 bans stripping it off the map).
      expect(step).toContain('$prov + "/" + .');
      // The map-absent branch is the documented 404 fallback, so it warns
      // rather than failing a job for a reason unrelated to the experiment.
      expect(step).toContain('::warning::');
    });

    test('N1 — the pinned-id gate compares by set difference, never inside index()', () => {
      const step = routingStep();
      // ⚠️ THE DEFECT THIS PIN EXISTS FOR, which shipped for one round and would
      // have failed every gated run at this step (at $0, but before the council
      // ever started). jq's `def index($i): indices($i)|.[0];` evaluates its
      // ARGUMENT against index's own input, and `$ids | index(…)` has just made
      // that input the alias ARRAY — so `.` inside the argument was `$ids`,
      // `$prov + "/" + .` was string-plus-array, jq raised and exited 5, and the
      // `if !` branch printed "pins a model id that no alias resolves to" and
      // exited 1 on a perfectly valid document.
      expect(step).not.toContain('index($prov + "/" + .)');
      // And no other spelling that puts the model-id expression inside index().
      expect(step).not.toMatch(/index\(\s*\$prov/);
      // The shipped form: collect the ids, then one array difference. `.` sits
      // in ordinary pipe position, where it really is the model id.
      expect(step).toContain('as $pins');
      expect(step).toContain('($pins - $ids) | length == 0');
      expect(step).toContain('($pins | length > 0)');
      // ⚠️ jq is not installed on this project's development machines, so NO
      // test here executes this filter — this pin is a guard against the exact
      // shape that broke, not a proof that the new one runs. The first CI run
      // on a labelled PR is what exercises it.
    });

    test('N5 — every spelling of blank that SKIPS the step is green, and the key is still required', () => {
      // `''` and a bare `COUNCIL_PROVIDER_ROUTING:` (YAML null) both reach the
      // runner as an empty string, and GitHub's `&& env.X` is falsy for both, so
      // both skip the step and neither may redden this suite.
      const y = yml();
      for (const spelling of ["COUNCIL_PROVIDER_ROUTING: ''", 'COUNCIL_PROVIDER_ROUTING:']) {
        const m = /^\s*COUNCIL_PROVIDER_ROUTING:[ \t]*(?:'(.*)')?[ \t]*$/m.exec(`      ${spelling}`);
        expect(`${spelling} parses as blank: ${m !== null && (m[1] === undefined || m[1] === '')}`)
          .toBe(`${spelling} parses as blank: true`);
      }
      // Deleting the key skips the step too, but the key's presence is what
      // documents the switch — so it stays required, and the env comment says so.
      expect(y).toContain('KEEP THE KEY');
      // Whitespace-only is NOT blank and must not be treated as such: GitHub has
      // no trim, so `' '` is truthy, the step runs, and the first gate refuses
      // it loudly. Silently accepting a typo as the off-switch is the degrade
      // every gate in that step exists to prevent.
      expect(y).toContain('A WHITESPACE-ONLY VALUE IS NOT BLANK');
      expect(routingStep()).toContain("jq -e 'type == \"object\"'");
    });

    test('N3 — the allowlist cites a public URL and admits it is a manual transcription', () => {
      const step = routingStep();
      // The saved page lives in the owner's evidence store, not in this repo, so
      // the gate/test agreement is all automation can prove. Say both.
      expect(step).toContain('https://openrouter.ai/docs/features/provider-routing');
      expect(step).toContain('NO\n          # MACHINE-CHECKABLE SOURCE IN THIS REPO');
    });

    test('C5 — the notice keys the routing BY MODEL ID, so two pins cannot be merged into one', () => {
      const step = routingStep();
      // Gateway-qualified since r3/B2 — the bare key collided across gateways.
      expect(step).toContain('{($prov + "/" + .key): .value.options.provider}');
      // The "obvious" form, banned: `add` over bare provider objects merges
      // them, so the notice would print one model's `only` list against both
      // ids. Recorded as data, not only as a why-comment.
      const two = {
        'qwen/qwen3.8-27b': { options: { provider: { only: ['reka'] } } },
        'z-ai/glm-5.3': { options: { provider: { only: ['novita'] } } },
      };
      const merged = Object.assign({}, ...Object.values(two).map((e) => e.options.provider));
      expect(merged).toEqual({ only: ['novita'] }); // one model's pin, silently lost
      const keyed = Object.assign({}, ...Object.entries(two)
        .map(([id, e]) => ({ [id]: e.options.provider })));
      expect(Object.keys(keyed)).toEqual(['qwen/qwen3.8-27b', 'z-ai/glm-5.3']);
      expect(step).not.toContain('[.provider[].models[].options.provider] | add');
    });

    test('A1 — reachability is pinned by a canary, and the step says so instead of claiming per-run proof', () => {
      const y = yml();
      // Nothing in a run's artifacts names the serving upstream, so neither the
      // notice nor the env comment may imply a run observed its own routing.
      expect(y).toContain('probe-provider-routing-canary');
      expect(routingStep()).toContain('pinned by');
      // And it must name EVERY row the canary runs (re-review N10). The env
      // comment and the notice both cited R12/R14 after R15 landed, so the one
      // row that covers the shipped `only` shape went uncredited in the two
      // places a reader looks to find out what is actually verified.
      const canaryRows = /const ROWS = '([^']+)'/.exec(
        fs.readFileSync(path.join(__dirname, '..', 'probe-provider-routing-canary.integration.test.js'), 'utf-8'))[1];
      for (const row of canaryRows.split(',')) {
        expect(`the env comment names ${row}: ${y.includes(row)}`).toBe(`the env comment names ${row}: true`);
        expect(`the notice names ${row}: ${routingRunCommand().includes(row)}`).toBe(`the notice names ${row}: true`);
      }
      // The canary itself must exist and name the two geometry cases.
      const canary = fs.readFileSync(path.join(__dirname, '..', 'probe-provider-routing-canary.integration.test.js'), 'utf-8');
      expect(canary).toContain("'R12,R14,R15'");
      expect(canary).toContain('probe-provider-routing.js');
    });

    test('A4 — a dead pinned leg is warned about, after the run, without ever failing the job', () => {
      const y = yml();
      const idx = y.indexOf(`- name: ${HEALTH_STEP}`);
      expect(`the health step exists: ${idx > -1}`).toBe('the health step exists: true');
      // AFTER the council step (it reads the run it produced) and after the
      // evidence upload, so it cannot take the cancellation grace window the
      // #229 ruling gave the ledger and the artifact.
      expect(y.indexOf('- name: Run the adjudicated council')).toBeLessThan(idx);
      expect(y.indexOf('- name: Upload evidence artifact')).toBeLessThan(idx);
      const step = healthStep();
      // always(), so a degraded or failed run — the case it exists for — still
      // reports; gated like its neighbours; and only when a pin is in force.
      expect(step).toContain('always()');
      expect(step).toContain("steps.gate.outputs.available == 'true'");
      expect(step).toContain('env.COUNCIL_PROVIDER_ROUTING');
      // Warning-only, never a failure: a dead upstream is a datum about the
      // experiment, not a reason to fail a merge gate.
      expect(step).toContain('::warning::');
      expect(step).not.toContain('::error::');
      expect(step).not.toContain('exit 1');
      // It must read the run's own record — through the env var, like every
      // other value in this job, not a spliced path — and name the lever.
      expect(step).toContain("path.join(process.env.RUN_DIR, 'run.json')");
      expect(step).toContain('degrades');
      expect(step).toContain('consider blanking COUNCIL_PROVIDER_ROUTING');
    });

    /**
     * A4's detector, HARVESTED AND EXECUTED — the same discipline the
     * review-diff and credit-preflight suites use. String pins can show that a
     * step exists and is warning-only; only running the program can show that
     * it recognises a lost seat, tells "lost" from "rescued by the retry", and
     * stays silent about a healthy one. `fs` and `process` are stubbed, so
     * nothing is read from disk and nothing exits.
     */
    describe('A4 — the harvested health program, executed', () => {
      const EXITED = {};
      const program = () => {
        const y = yml();
        // Council #266 r2 / A3: the program moved out of the workspace (a temp
        // dir cannot inherit a nearer package.json) and became `.cjs`.
        const open = y.indexOf('cat > "$HT/routing-health.cjs" <<\'HEALTH\'');
        return y.slice(y.indexOf('\n', open) + 1, y.indexOf('\n          HEALTH\n', open))
          .split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
      };
      const ALIASES = { aliases: { qwen: 'openrouter/qwen/qwen3.8-27b', gpt: 'openrouter/openai/gpt-5.6-terra' } };
      const PIN = '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"only":["reka"]}}}}}}}';
      // The two shapes src/council/run-state.js actually writes, taken from the
      // council #266 round-1 run that lost qwen: a dead leg, and a leg rescued
      // by its once-only retry (which records the death under firstFailure).
      const DEAD = { channel: 'dead-leg', kind: 'degrade', what: 'seat qwen did not review', data: { seat: 'qwen', status: 'error' } };
      const RETRIED = { channel: 'stage1-retry', kind: 'heal', what: 'seat qwen reviewed on retry', data: { seat: 'qwen', firstFailure: { seat: 'qwen', status: 'error' } } };
      // Re-review N2. Three more shapes the source really writes, each of which
      // the first version of the predicate missed or mislabelled — copied from
      // their emitters, not invented:
      //   run-stage2.js :: the seat-unbound note — `{ waveId, seat }`, NO status
      const UNBOUND = { channel: 'seat-unbound', kind: 'degrade', what: 'leg for seat qwen in wave w-s2 never returned', data: { waveId: 'w-s2', seat: 'qwen' } };
      //   run-retry-notes.js :: skippedWaveNote — `data.models`, a LIST, no `seat`
      const DEADWAVE = { channel: 'dead-wave', kind: 'degrade', what: 'Stage-1 wave w-s1 (qwen, glm) produced NO legs', data: { waveId: 'w-s1', models: ['qwen', 'glm'] } };
      //   run-stage2.js :: the judge-died note — a judge leg has no retry at all
      const JUDGE = { channel: 'stage2-judge', kind: 'degrade', what: 'judge J2 did not adjudicate', data: { judge: 'J2', seat: 'qwen', waveId: 'w-s2', status: 'error' } };

      const run = (o = {}) => {
        const out = { logs: [], exits: [] };
        const files = {};
        if (o.run !== null) { files[path.join('RD', 'run.json')] = JSON.stringify(o.run || { degrades: [] }); }
        if (o.map !== null) { files[path.join('CFG', 'config.json')] = JSON.stringify(o.map || ALIASES); }
        // r3/B1: attribution is keyed on the marker the routing step leaves
        // behind, not on the env value. Present unless a case says otherwise.
        if (o.marker !== false) { files[path.join('RD', '.routing-pin-written')] = 'deadbeef'; }
        const ctx = vm.createContext({
          require: (id) => ({ fs: {
            readFileSync: (p) => {
              if (!Object.prototype.hasOwnProperty.call(files, p)) { throw new Error(`ENOENT ${p}`); }
              return files[p];
            },
            existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
          }, path }[id]),
          console: { log: (m) => out.logs.push(m) },
          process: {
            env: { RUN_DIR: 'RD', AMICUS_CONFIG_DIR: 'CFG', COUNCIL_PROVIDER_ROUTING: o.pin || PIN },
            exit: (code) => { out.exits.push(code); throw EXITED; },
          },
        });
        try { new vm.Script(program()).runInContext(ctx); } catch (err) { if (err !== EXITED) { throw err; } }
        return out;
      };

      test('a LOST pinned seat is named, with the pin, and the lever to pull', () => {
        const { logs } = run({ run: { degrades: [DEAD] } });
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatch(/^::warning::/);
        expect(logs[0]).toContain("seat 'qwen' (openrouter/qwen/qwen3.8-27b) was LOST");
        expect(logs[0]).toContain('{"only":["reka"]}');
        expect(logs[0]).toContain('consider blanking COUNCIL_PROVIDER_ROUTING');
      });

      test('a seat its RETRY rescued is reported differently — it did not cost the round a seat', () => {
        const { logs } = run({ run: { degrades: [RETRIED] } });
        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain('needed its retry');
        expect(logs[0]).not.toContain('was LOST');
      });

      test('N2 — a seat-unbound loss is caught although it carries no status field', () => {
        const { logs } = run({ run: { degrades: [UNBOUND] } });
        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain('was LOST from');
        expect(logs[0]).toContain('seat-unbound');
      });

      test('N2 — a dead WAVE is caught although it names its seats in data.models, not data.seat', () => {
        const { logs } = run({ run: { degrades: [DEADWAVE] } });
        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain('was LOST from');
        // …and it is still the pinned seat's business only.
        expect(run({ run: { degrades: [{ channel: 'dead-wave', data: { models: ['glm'] } }] } }).logs).toEqual([]);
      });

      test('N2 — a Stage-2 judge death is not called a retry, because judges have none', () => {
        const { logs } = run({ run: { degrades: [JUDGE] } });
        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain('could not adjudicate in');
        expect(logs[0]).not.toContain('needed its retry');
        expect(logs[0]).not.toContain('was LOST from');
      });

      test('N2 — a loss outranks a rescue when one seat produced both records', () => {
        const { logs } = run({ run: { degrades: [RETRIED, DEAD] } });
        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain('was LOST from');
        // Both records still travel in the reason, so nothing is hidden.
        expect(logs[0]).toContain('stage1-retry:');
        expect(logs[0]).toContain('dead-leg:');
      });

      test('a healthy round says nothing at all', () => {
        expect(run({ run: { degrades: [] } }).logs).toEqual([]);
        // Another seat's death is not this pin's business.
        expect(run({ run: { degrades: [{ channel: 'dead-leg', data: { seat: 'glm', status: 'error' } }] } }).logs).toEqual([]);
      });

      test('B1 — no marker means no pin was in force, so nothing is attributed to one', () => {
        // The run that this exists for: COUNCIL_PROVIDER_ROUTING is set, a seat
        // died, and the pre-run upstream check SKIPPED the write — so the council
        // ran completely unpinned and the pin must not be named as a cause.
        const { logs, exits } = run({ run: { degrades: [DEAD] }, marker: false });
        expect(exits).toEqual([0]);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatch(/^::notice::/);
        expect(logs[0]).toContain('no pin was in force this run');
        expect(logs.join(' ')).not.toContain('was LOST from');
      });

      test('a cancelled run (no run.json) is a notice, not a warning, and stops there', () => {
        const { logs, exits } = run({ run: null });
        expect(exits).toEqual([0]);
        expect(logs).toEqual(['::notice::#202 Lever 2 — no run.json, so there is no pinned-leg health to report']);
      });

      test('no provisioned map — the pin cannot be tied to a seat, and that is itself reported', () => {
        const { logs } = run({ run: { degrades: [DEAD] }, map: null });
        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain('matched no alias');
      });
    });

    test('A1 — no PR bytes can reach the run directory, and the step proves it did not happen', () => {
      const y = yml();
      const cmd = routingRunCommand();
      // The fact the answer rests on: this job checks out nothing, so there is
      // no path by which a PR-authored opencode.json reaches $RUN_DIR/_scratch.
      expect(y).not.toContain('actions/checkout');
      // The belt, which runs on BLANK runs too — that is why the step's own
      // `if:` no longer carries the env condition.
      expect(routingStep()).toContain("if: steps.gate.outputs.available == 'true'");
      expect(routingStep()).not.toMatch(/if:.*env\.COUNCIL_PROVIDER_ROUTING/);
      expect(cmd).toContain('find "$RUN_DIR" -name opencode.json');
      // Before: nothing may exist. After: exactly the file this step wrote.
      expect(cmd).toContain('STRAY=$(find "$RUN_DIR" -name opencode.json');
      expect(cmd).toContain('WROTE=$(find "$RUN_DIR" -name opencode.json');
      expect(cmd).toContain('if [ "$WROTE" != "$RUN_DIR/opencode.json" ]; then');
      expect(cmd.indexOf('STRAY=$(find')).toBeLessThan(cmd.indexOf('if [ -z "$COUNCIL_PROVIDER_ROUTING" ]'));
      // Both refuse loudly rather than launching over a config nobody vouched for.
      expect(cmd).toMatch(/STRAY[\s\S]*?::error::[\s\S]*?exit 1/);
    });

    test('A7 — the run directory is 0700 even when the step did not create it', () => {
      const cmd = routingRunCommand();
      expect(cmd).toContain('(umask 077; mkdir -p "$RUN_DIR")');
      // The umask guard alone is a no-op on an existing directory, and so is
      // run-state.js's own `mkdirSync(..., { mode: 0o700 })` — neither chmods.
      expect(cmd).toContain('chmod 700 "$RUN_DIR"');
      expect(cmd.indexOf('mkdir -p "$RUN_DIR"')).toBeLessThan(cmd.indexOf('chmod 700 "$RUN_DIR"'));
    });

    test('A6 — the JSON-object gate is pinned on the executable line, not on prose', () => {
      // Council #266 r2 / A6: the old pin was `toContain('jq -e .')`, which the
      // comment quoting the removed spelling satisfied all by itself — so
      // rewording a comment reddened the suite and changing the gate did not.
      const cmd = routingRunCommand();
      expect(cmd).toMatch(/^\s*if ! jq -e 'type == "object"' >\/dev\/null <<< "\$COUNCIL_PROVIDER_ROUTING"; then$/m);
      // And the pin must be blind to comments: the executable text alone.
      expect(cmd).not.toMatch(/^\s*#/m);
      expect(cmd).toContain('must be a JSON object');
    });

    test('A4 — the alias-map gate names WHICH of the four things went wrong', () => {
      const cmd = routingRunCommand();
      // One condition reported all four as "pins a model id that no alias
      // resolves to", so a corrupt map sent its reader to edit a correct value.
      expect(cmd).toContain('if [ ! -f "$MAP" ]; then');
      expect(cmd).toContain('the documented 404 fallback');
      expect(cmd).toContain('is not parseable JSON, so the pinned ids');
      expect(cmd).toContain("declares no non-empty 'aliases' object");
      expect(cmd).toContain('pins a model id that no alias in this run');
      // Two of the four are faults in the MAP, and say so rather than blaming
      // the routing value; and both print what was pinned and what is seated.
      expect(cmd).toContain('a fault in the MAP');
      expect(cmd).toContain('The map seats: ${KNOWN}');
    });

    test('N7 — the health program is invoked with no stray argument', () => {
      // Re-review N7: the invocation carried a literal `\n` (backslash + n, not
      // a line continuation — there was no end-of-line between them), so bash
      // read it as an escaped `n` and the runner executed
      // `node …/routing-health.cjs n || echo …`. Harmless at runtime (the
      // program never reads argv) but a textbook shellcheck SC1001, and this
      // repo's actionlint+shellcheck baseline is zero findings across all six
      // workflows with no suppressions — a gate no development machine here can
      // run, which is exactly why it gets a pin instead of a promise.
      const lines = healthStep().split('\n').filter((l) => l.includes('node "$HT/routing-health.cjs"'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\s*node "\$HT\/routing-health\.cjs" \|\| echo "::warning::routing health check could not run: /);
      // No escaped character anywhere on the line, and no continuation either:
      // one physical line, one command, one fallback.
      expect(lines[0].split('node "$HT/routing-health.cjs"')[1]).not.toContain('\\');
    });

    test('N9 — the notice does not claim to have verified upstreams a document never named', () => {
      const cmd = routingRunCommand();
      // A sort-only or ignore-only document names no only/order slugs, so the
      // pre-run check consults nothing — and "every named upstream was
      // verified" is then true but empty.
      expect(cmd).toContain('VERIFIED=$(jq -r');
      expect(cmd).toContain('${VERIFIED}');
      expect(cmd).toContain('((.only // []) + (.order // []))[]');
      expect(cmd).toContain('Every upstream this document allows was verified listed and serving');
      expect(cmd).toContain('No upstream is named by this document (no only/order/ignore), so there was nothing to verify.');
      // The vacuous unconditional form must be gone from the notice itself.
      expect(cmd).not.toMatch(/\$\{ATTRIB\}\. Every named upstream/);
    });

    test('C1 — the notice says self-attributing only when exactly one upstream may serve', () => {
      const cmd = routingRunCommand();
      // The ruling on a contested finding: order-only documents stay ALLOWED
      // (they are valid experiments), but the run must not call them
      // attributable. Both wordings live in one jq if/then/else.
      expect(cmd).toContain('((.only // []) | length) == 1');
      expect(cmd).toContain('then "self-attributing');
      expect(cmd).toContain('else "NOT self-attributing');
      expect(cmd).toContain('${ATTRIB}');
      // And the gates must NOT have been tightened to require `only`.
      expect(cmd).not.toContain('only is required');
      expect(() => assertRoutingDocument('{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"order":["reka","novita"]}}}}}}}'))
        .not.toThrow();
    });

    test('A5/C2 — a keyless pre-run upstream check gates the write, fail-closed', () => {
      const cmd = routingRunCommand();
      expect(cmd).toContain('RT=$(mktemp -d)');
      expect(cmd).toContain('routing-preflight.cjs');
      // Fail-closed: anything but a positive verdict skips the write.
      expect(cmd).toContain('|| echo skip)" != "ok" ]; then');
      expect(cmd).toContain('experiment SKIPPED this run');
      expect(cmd.indexOf('verdict.txt')).toBeLessThan(cmd.indexOf('> "$RUN_DIR/opencode.json"'));
      // …and never fails the job.
      const afterPreflight = cmd.slice(cmd.indexOf('RT=$(mktemp -d)'));
      expect(afterPreflight).toContain('exit 0');
      // Keyless by construction: no key is exported to it, and the program
      // sends no Authorization header.
      expect(cmd).not.toContain('OPENROUTER_API_KEY');
      const src = routingStep();
      expect(src).toContain('NO Authorization header');
      expect(src).not.toMatch(/Authorization:\s*Bearer/);
    });

    /**
     * A4's second half — EVERY GATE FILTER, EXECUTED. Council #266 r2 recorded
     * that no test ran any of this step's jq, and the N1 blocker (a scoping
     * error that would have failed every gated run) is what that gap cost. jq
     * is not installed on this project's Windows development machines, so these
     * skip with a named reason there and RUN on the Linux/macOS CI runners,
     * where jq is preinstalled — the same machines that execute the workflow.
     *
     * The lines are harvested from the workflow and run verbatim: each gate is
     * its own `if !`/`elif !` line, stripped of the shell keywords and executed
     * under bash with the fixture in the environment. Nothing is transcribed.
     */
    describe('A4 — the harvested jq gates, executed', () => {
      const jqAvailable = (() => {
        try { return spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0; } catch { return false; }
      })();
      const maybe = jqAvailable ? describe : describe.skip;
      const gates = () => routingRunCommand().split('\n')
        .filter((l) => /^\s*(el)?if ! jq -e /.test(l))
        .map((l) => l.trim().replace(/^(el)?if ! /, '').replace(/; then$/, ''));

      /**
       * D6 (council #266 r3) — the step's jq is not only its `if !` gates.
       * `PINNED`, `ROUTING`, `ATTRIB`, `VERIFIED`, `PINS`, `KNOWN`, `DISPATCHED`
       * and `UNGOVERNED` are command substitutions that were string-pinned and
       * never executed — the exact class the N1 blocker belonged to, where a
       * scoping error surfaces only on a real gated CI run.
       */
      const assignments = () => routingRunCommand().split('\n')
        .filter((l) => /^\s*[A-Z_]+=\$\(jq /.test(l))
        .map((l) => {
          const t = l.trim();
          return { name: t.slice(0, t.indexOf('=')), cmd: t.slice(t.indexOf('=$(') + 3, t.lastIndexOf(')')) };
        });

      test('D6 — the harvest found every jq assignment, not only the gates', () => {
        expect(assignments().map((a) => a.name).sort()).toEqual(
          ['ATTRIB', 'DISPATCHED', 'KNOWN', 'PINNED', 'PINS', 'ROUTING', 'UNGOVERNED', 'VERIFIED']);
        for (const { cmd } of assignments()) { expect(cmd).toMatch(/^jq /); }
      });

      // Runs EVERYWHERE, jq or not: the harvest itself is the part most likely
      // to rot (a reformatted gate, a renamed variable), and a machine with no
      // jq can still prove the lines were found and are shaped as expected.
      test('the harvest found every gate', () => {
        // Ten `jq -e` gates: seven read the DOCUMENT (object, top-level keys,
        // provider level, model entry, key allowlist, key TYPES — added by r3/D7
        // — and list shape) and three read the provisioned MAP (parseable, has
        // aliases, and the set difference that decides whether every pinned id is
        // seated; that last one reads both, so it counts in both figures).
        expect(gates().length).toBe(10);
        expect(gates().filter((g) => g.includes('$COUNCIL_PROVIDER_ROUTING'))).toHaveLength(8);
        expect(gates().filter((g) => g.includes('"$MAP"'))).toHaveLength(3);
        for (const g of gates()) { expect(g).not.toMatch(/^(el)?if |; then$/); }
      });

      maybe(`jq present: ${jqAvailable}`, () => {
        let dir; let mapPath;
        beforeAll(() => {
          dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-jq-gates-'));
          mapPath = path.join(dir, 'config.json');
          fs.writeFileSync(mapPath, JSON.stringify({
            aliases: { qwen: 'openrouter/qwen/qwen3.8-27b', glm: 'openrouter/z-ai/glm-5.3' },
          }));
        });
        afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

        /** @returns {number[]} one exit status per harvested gate line */
        const runGates = (value, mapFile) => gates().map((cmd) => spawnSync('bash', ['-c', cmd], {
          encoding: 'utf8',
          env: { ...process.env, COUNCIL_PROVIDER_ROUTING: value, MAP: mapFile === undefined ? mapPath : mapFile },
        }).status);

        test('the shipped fixture passes every gate', () => {
          const statuses = runGates(FIXTURE);
          expect(`the fixture passes all 10 gates: ${JSON.stringify(statuses)}`)
            .toBe(`the fixture passes all 10 gates: ${JSON.stringify(statuses.map(() => 0))}`);
        });

        test('each invalid class is refused by at least one gate', () => {
          const cases = {
            'not JSON': 'not json at all',
            'a scalar': '0',
            'an array': '[]',
            'an extra top-level key': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"only":["reka"]}}}}}},"agent":{}}',
            'a provider-level baseURL': '{"provider":{"openrouter":{"options":{"baseURL":"http://elsewhere"},"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"only":["reka"]}}}}}}}',
            'a model-entry prompt': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"prompt":"x","options":{"provider":{"only":["reka"]}}}}}}}',
            'an inert empty block': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{}}}}}}}',
            'a misspelled key': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"onlyy":["reka"]}}}}}}}',
            'an empty only list': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"only":[]}}}}}}}',
            'a blank slug': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"only":[""]}}}}}}}',
            'a non-string slug': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"only":[1]}}}}}}}',
            'a sort object where a documented string belongs': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"sort":"cheapest"}}}}}}}',
            'a max_price array': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"max_price":[1]}}}}}}}',
            'a string allow_fallbacks': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"only":["reka"],"allow_fallbacks":"false"}}}}}}}',
            'an undocumented data_collection value': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"data_collection":"maybe"}}}}}}}',
            'an empty quantizations list': '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"quantizations":[]}}}}}}}',
            'an unseated model id': '{"provider":{"openrouter":{"models":{"nobody/unseated-1":{"options":{"provider":{"only":["reka"]}}}}}}}',
          };
          for (const [name, value] of Object.entries(cases)) {
            const statuses = runGates(value);
            expect(`${name} is refused: ${statuses.some((s) => s !== 0)}`).toBe(`${name} is refused: true`);
          }
        });

        test('N1 regression — the alias gate passes the valid document instead of erroring', () => {
          // The blocker this executable test exists for: the old filter raised
          // inside `index()` and exited 5 on EVERY document, so the gate refused
          // the shipped fixture. Its status must be 0 here, not merely non-zero
          // for bad input.
          const aliasGate = gates().filter((g) => g.includes('--slurpfile'));
          expect(aliasGate).toHaveLength(1);
          const ok = spawnSync('bash', ['-c', aliasGate[0]], {
            encoding: 'utf8',
            env: { ...process.env, COUNCIL_PROVIDER_ROUTING: FIXTURE, MAP: mapPath },
          });
          expect(`alias gate on a valid document: exit ${ok.status} stderr ${(ok.stderr || '').trim()}`)
            .toBe('alias gate on a valid document: exit 0 stderr ');
        });

        /**
         * D6 — the step's OTHER jq, executed. The gates above are `if !` lines;
         * `PINNED`, `ROUTING`, `ATTRIB`, `VERIFIED`, `DISPATCHED` and
         * `UNGOVERNED` are command substitutions that were string-pinned and
         * never run — the exact class the N1 blocker belonged to, where a
         * scoping error surfaces only on a real gated CI run.
         */
        test('every jq assignment in the step runs and produces output', () => {
          for (const { name, cmd } of assignments()) {
            const r = spawnSync('bash', ['-c', cmd], {
              encoding: 'utf8',
              env: {
                ...process.env,
                COUNCIL_PROVIDER_ROUTING: FIXTURE,
                MAP: mapPath,
                MODELS: 'glm,qwen,gpt,deepseek',
                CHAIR: 'gemini-pro',
              },
            });
            expect(`${name} exit ${r.status} stderr ${(r.stderr || '').trim()}`).toBe(`${name} exit 0 stderr `);
            // Every one of them is interpolated into a message, so an empty
            // result is a silent hole in that message — except UNGOVERNED,
            // whose emptiness IS its "nothing to report" signal.
            if (name !== 'UNGOVERNED') { expect(`${name} non-empty`).toBe(`${(r.stdout || '').trim() ? name : ''} non-empty`); }
          }
        });

        test('the notice expressions say the right thing about the fixture', () => {
          const run = (name, value) => {
            const { cmd } = assignments().find((a) => a.name === name);
            return spawnSync('bash', ['-c', cmd], {
              encoding: 'utf8',
              env: { ...process.env, COUNCIL_PROVIDER_ROUTING: value, MAP: mapPath, MODELS: 'glm,qwen,gpt,deepseek', CHAIR: 'gemini-pro' },
            }).stdout.trim();
          };
          // B2: gateway-qualified, both surfaces.
          expect(run('PINNED', FIXTURE)).toBe('openrouter/qwen/qwen3.8-27b');
          expect(JSON.parse(run('ROUTING', FIXTURE)))
            .toEqual({ 'openrouter/qwen/qwen3.8-27b': { only: ['reka'] } });
          // C1: attribution follows the document.
          expect(run('ATTRIB', FIXTURE)).toMatch(/^self-attributing/);
          const orderOnly = '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"order":["reka","novita"]}}}}}}}';
          expect(run('ATTRIB', orderOnly)).toMatch(/^NOT self-attributing/);
          // D3: VERIFIED distinguishes all three cases.
          expect(run('VERIFIED', FIXTURE)).toContain('Every upstream this document allows was verified');
          const ignoreOnly = '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"ignore":["deepinfra"]}}}}}}}';
          expect(run('VERIFIED', ignoreOnly)).toContain('only excludes some');
          const sortOnly = '{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"sort":"latency"}}}}}}}';
          expect(run('VERIFIED', sortOnly)).toContain('no only/order/ignore');
          // B2 again, on the shape that collided: two gateways, one model id.
          const twoGateways = JSON.stringify({ provider: {
            openrouter: { models: { 'qwen/qwen3.8-27b': { options: { provider: { only: ['reka'] } } } } },
            other: { models: { 'qwen/qwen3.8-27b': { options: { provider: { only: ['novita'] } } } } },
          } });
          expect(Object.keys(JSON.parse(run('ROUTING', twoGateways))).sort())
            .toEqual(['openrouter/qwen/qwen3.8-27b', 'other/qwen/qwen3.8-27b']);
          // D5: the pin is seated here, so nothing is ungoverned; re-point the
          // bench and the same expression names it.
          expect(run('UNGOVERNED', FIXTURE)).toBe('');
          const { cmd } = assignments().find((a) => a.name === 'UNGOVERNED');
          const elsewhere = spawnSync('bash', ['-c', cmd], {
            encoding: 'utf8',
            env: { ...process.env, COUNCIL_PROVIDER_ROUTING: FIXTURE, MAP: mapPath, MODELS: 'glm', CHAIR: 'glm' },
          });
          expect(elsewhere.stdout.trim()).toBe('openrouter/qwen/qwen3.8-27b');
        });

        test('a two-model document with order-only routing also passes every gate', () => {
          const value = JSON.stringify({ provider: { openrouter: { models: {
            'qwen/qwen3.8-27b': { options: { provider: { order: ['reka', 'novita'], allow_fallbacks: false } } },
            'z-ai/glm-5.3': { options: { provider: { only: ['novita'] } } },
          } } } });
          const statuses = runGates(value);
          expect(`order-only, two models, all 10 gates: ${JSON.stringify(statuses)}`)
            .toBe(`order-only, two models, all 10 gates: ${JSON.stringify(statuses.map(() => 0))}`);
        });
      });

      if (!jqAvailable) {
        test('SKIPPED on this machine: jq is not on PATH, so the gate filters are read, not executed', () => {
          // Recorded as a passing test rather than silence, so a reader of a
          // local run knows the filters went unexecuted here and that the CI
          // runners (ubuntu-latest, jq preinstalled) do execute them.
          expect(jqAvailable).toBe(false);
        });
      }
    });

    /**
     * A5/C2's program — HARVESTED AND EXECUTED against a local endpoints
     * fixture server. The four outcomes the ruling names: serving, not listed,
     * listed but down, and the fetch itself failing. Keyless by construction —
     * the program is pointed at 127.0.0.1 through ROUTING_ENDPOINTS_BASE and no
     * Authorization header exists anywhere in it.
     */
    describe('A5/C2 — the harvested upstream pre-run check, executed', () => {
      const EPS = (endpoints) => JSON.stringify({ data: { endpoints } });
      const SERVING = EPS([{ tag: 'reka/fp8', status: 0, uptime_last_30m: 100 }, { tag: 'novita', status: 0, uptime_last_30m: 99 }]);
      const DOWN = EPS([{ tag: 'reka/fp8', status: -2, uptime_last_30m: 0 }]);
      const ABSENT = EPS([{ tag: 'novita', status: 0, uptime_last_30m: 99 }]);
      let dir; let file; let server; let port; let answer;

      beforeAll(async () => {
        const y = yml();
        const open = y.indexOf('cat > "$RT/routing-preflight.cjs" <<\'PREFLIGHT\'');
        const body = y.slice(y.indexOf('\n', open) + 1, y.indexOf('\n          PREFLIGHT\n', open))
          .split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-routing-preflight-'));
        file = path.join(dir, 'routing-preflight.cjs');
        fs.writeFileSync(file, body);
        server = http.createServer((req, res) => {
          if (answer === null) { res.writeHead(503); res.end('unavailable'); return; }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(answer);
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
      });
      afterAll(async () => {
        if (server) { await new Promise((resolve) => server.close(resolve)); }
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
      });

      /** Spawn the harvested program (async — spawnSync would deadlock the fixture server). */
      const run = (value) => new Promise((resolve) => {
        const out = path.join(dir, `verdict-${Math.random().toString(36).slice(2)}.txt`);
        const child = spawn(process.execPath, [file], {
          env: {
            ...process.env,
            COUNCIL_PROVIDER_ROUTING: value === undefined ? FIXTURE : value,
            ROUTING_PREFLIGHT_OUT: out,
            ROUTING_ENDPOINTS_BASE: `http://127.0.0.1:${port}/api/v1/models`,
          },
        });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.on('close', (code) => {
          let verdict = 'MISSING';
          try { verdict = fs.readFileSync(out, 'utf8'); } catch { /* fail-closed reads as skip */ }
          resolve({ code, stdout, verdict, warnings: stdout.split('\n').filter((l) => l.startsWith('::warning::')) });
        });
      });

      test('a serving upstream: the pin is allowed through, silently', async () => {
        answer = SERVING;
        const r = await run();
        expect(r.verdict).toBe('ok');
        expect(r.warnings).toEqual([]);
        expect(r.code).toBe(0);
      });

      test('an upstream that is listed but not serving: skipped, with the status quoted', async () => {
        answer = DOWN;
        const r = await run();
        expect(r.verdict).toBe('skip');
        expect(r.warnings).toHaveLength(1);
        expect(r.warnings[0]).toContain('but not serving');
        expect(r.warnings[0]).toContain('status=-2');
        expect(r.warnings[0]).toContain('experiment is skipped this run');
        expect(r.code).toBe(0);
      });

      test('an upstream OpenRouter does not list for that model: skipped', async () => {
        answer = ABSENT;
        const r = await run();
        expect(r.verdict).toBe('skip');
        expect(r.warnings[0]).toContain('is not among the 1 upstreams');
        expect(r.code).toBe(0);
      });

      test('the fetch itself failing: skipped — fail-CLOSED, never fail-open', async () => {
        answer = null; // the fixture server answers 503
        const r = await run();
        expect(r.verdict).toBe('skip');
        expect(r.warnings[0]).toContain('UNVERIFIABLE');
        expect(r.code).toBe(0);
      });

      test('an unparseable value: skipped, and the parse is inside the guard', async () => {
        answer = SERVING;
        const r = await run('not json');
        expect(r.verdict).toBe('skip');
        expect(r.warnings[0]).toContain('pre-run check failed');
        expect(r.code).toBe(0);
      });

      test('a document naming no only/order slugs needs no verification', async () => {
        answer = null; // would fail if it were consulted at all
        const r = await run('{"provider":{"openrouter":{"models":{"qwen/qwen3.8-27b":{"options":{"provider":{"sort":"latency"}}}}}}}');
        expect(r.verdict).toBe('ok');
        expect(r.warnings).toEqual([]);
      });

      test('the program sends no Authorization header and hardcodes no key', () => {
        const src = fs.readFileSync(file, 'utf8');
        // Executable lines only: the comment above the fetch says "NO
        // Authorization header", which is exactly the sentence that should be
        // there and exactly the string a naive grep would trip over.
        const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
        expect(code).not.toMatch(/Authorization/i);
        expect(code).not.toMatch(/Bearer|sk-/);
        expect(code).toContain('https://openrouter.ai/api/v1/models');
        // And the fetch takes exactly one argument object, with no headers.
        expect(code).toContain('fetch(url, { signal: AbortSignal.timeout(10000) })');
      });
    });

    // ---- council #266 round 3 ------------------------------------------------

    test('B1 — attribution is keyed on a marker the write leaves, not on the env value', () => {
      const cmd = routingRunCommand();
      const health = healthStep();
      // A non-blank value means a pin was ASKED for. The pre-run check skips the
      // write whenever an upstream is missing, down or unverifiable, and on
      // those runs the council is completely unpinned — yet the health step
      // still blamed the pin for any seat that died.
      expect(cmd).toContain('> "$RUN_DIR/.routing-pin-written"');
      // Written only after the document is on disk, so it cannot exist on a
      // skipped run.
      expect(cmd.indexOf('> "$RUN_DIR/opencode.json"'))
        .toBeLessThan(cmd.indexOf('> "$RUN_DIR/.routing-pin-written"'));
      expect(cmd.indexOf('verdict.txt')).toBeLessThan(cmd.indexOf('> "$RUN_DIR/.routing-pin-written"'));
      // It carries the document's sha, so an archived run ties to exact bytes.
      expect(cmd).toContain('sha256sum "$RUN_DIR/opencode.json"');
      // And the health program reads it before anything else.
      expect(health).toContain('.routing-pin-written');
      expect(health).toContain('no pin was in force this run');
    });

    test('A2 — the pre-run check refuses an ignore policy that leaves no serving upstream', () => {
      const step = routingStep();
      expect(step).toContain('after applying ignore');
      expect(step).toContain('NO serving upstream remains for');
      expect(step).toContain('the pinned model would be unservable');
    });

    test('B3 — an endpoint whose status is unknown is NOT treated as serving', () => {
      const step = routingStep();
      // Fail-closed, matching the stated posture: `status` is present on all 112
      // endpoints of the saved capture, so an absent or non-numeric one means
      // the shape moved. `uptime_last_30m` stays asymmetric on purpose — 14 of
      // those 112 carry null while healthy, so null there is unknown, not down.
      expect(step).toContain('const serving = (e) => e && e.status === 0');
      expect(step).not.toContain('e.status === undefined || e.status === null || e.status === 0');
      expect(step).toContain('UNKNOWN IS NOT SERVING');
    });

    test('B2 — every surface keys routing by gateway/model, so two gateways cannot collide', () => {
      const cmd = routingRunCommand();
      // The bare `[.provider[].models | keys[]]` form dropped the gateway and
      // collided last-wins when two gateways pin the same model id.
      expect(cmd).not.toContain("jq -r '[.provider[].models | keys[]] | join");
      expect(cmd).not.toContain('[.provider[].models | to_entries[] | {(.key): .value.options.provider}] | add');
      expect(cmd).toContain('$prov + "/" + .] | join(", ")');
      expect(cmd).toContain('{($prov + "/" + .key): .value.options.provider}');
      // Demonstrated on the shape that breaks: two gateways, one model id.
      const two = { 'gw-a': { 'm/1': { only: ['x'] } }, 'gw-b': { 'm/1': { only: ['y'] } } };
      const bare = Object.assign({}, ...Object.values(two).map((models) => (
        Object.fromEntries(Object.entries(models).map(([id, r]) => [id, r])))));
      expect(Object.keys(bare)).toEqual(['m/1']); // one key — the collision
      const keyed = Object.assign({}, ...Object.entries(two).map(([gw, models]) => (
        Object.fromEntries(Object.entries(models).map(([id, r]) => [`${gw}/${id}`, r])))));
      expect(Object.keys(keyed)).toEqual(['gw-a/m/1', 'gw-b/m/1']);
    });

    test('D3 — an ignore-only document names upstreams, and the run says so', () => {
      const step = routingStep();
      const cmd = routingRunCommand();
      // The pre-run check collects ignore slugs too, and a slug that lists
      // nothing is a typo worth saying — without skipping, since ignoring a
      // provider that is not there cannot make the model unservable.
      expect(step).toContain('const deny = [].concat(routing.ignore || []);');
      expect(step).toContain('is ignored by this document but is not an upstream OpenRouter');
      expect(step).toContain('check the slug for a typo');
      // And the notice no longer claims an ignore-only document names nothing.
      expect(cmd).toContain('(.ignore // [])[]');
      expect(cmd).toContain('no only/order/ignore');
      expect(cmd).not.toContain('(no only/order), so there was nothing to verify');
    });

    test('D5 — a pin that governs no dispatched seat is called out, without failing the job', () => {
      const cmd = routingRunCommand();
      // The alias gate proves a pinned id is SEATABLE. This asks whether this
      // run seats it, resolved through the same provisioned map so the two
      // cannot disagree about what an alias means.
      expect(cmd).toContain('UNGOVERNED=$(jq -r');
      expect(cmd).toContain('governs no seat this run');
      expect(cmd).toContain('--arg models "$MODELS"');
      expect(cmd).toContain('--arg chair "$CHAIR"');
      // A warning, not a refusal — and it must sit after the alias gate.
      const at = cmd.indexOf('UNGOVERNED=$(jq -r');
      expect(cmd.slice(at, at + 800)).toContain('::warning::');
      expect(cmd.slice(at, at + 800)).not.toContain('exit 1');
      expect(cmd.indexOf('pins a model id that no alias')).toBeLessThan(at);
    });

    test('D7 — the documented keys are type-checked, not merely named', () => {
      const cmd = routingRunCommand();
      // The allowlist proves a key is documented and says nothing about its
      // value, so `sort: {}` or `max_price: [1]` passed the gate and the notice.
      expect(cmd).toContain('.value | type == "boolean"');
      expect(cmd).toContain('.value == "allow" or .value == "deny"');
      expect(cmd).toContain('IN("price", "throughput", "latency")');
      expect(cmd).toContain('.key == "max_price"');
      expect(cmd).toContain('.key == "quantizations"');
      expect(cmd).toContain('has the wrong type for its documented field');
      // The types are the saved field table's, so the values a gate accepts and
      // the values the docs describe cannot drift apart silently.
      for (const key of ['allow_fallbacks', 'require_parameters', 'zdr', 'enforce_distillable_text',
        'data_collection', 'sort', 'max_price', 'quantizations',
        'preferred_min_throughput', 'preferred_max_latency']) {
        expect(DOCUMENTED_PROVIDER_KEYS).toContain(key);
      }
    });

    test('A3 — "a single upstream with no fallback" is claimed only when that is true', () => {
      const health = healthStep();
      expect(health).toContain('const soleUpstream = Array.isArray(routing.only) && routing.only.length === 1;');
      expect(health).toContain('a single upstream with no fallback, so the pin is a candidate cause');
      expect(health).toContain('routing restricted by the pinned document (more than one upstream remains permitted)');
      // The unconditional form must be gone from the message itself.
      expect(health).toContain('${shape}');
      expect(health).not.toMatch(/\$\{pin\} — a single upstream with no fallback/);
    });

    test('C1 — the two rounds are summarised without merging their retries', () => {
      // "the retry and judge legs completed through reka" read as if BOTH
      // retries completed; round 1's died at 912 s and lost the seat.
      const y = yml();
      expect(y).toContain("Round 1's\n      # retry ALSO died, at 912 s, and that round lost the seat.");
      expect(y).toContain("one round's retry, not both");
      const changelog = fs.readFileSync(path.join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf-8');
      expect(changelog).toContain("round 1's retry died too (912 s) and lost the seat");
      expect(changelog).not.toContain('while the retry and judge legs completed through');
      const readme = fs.readFileSync(path.join(__dirname, '..', '..', 'README.md'), 'utf-8');
      expect(readme).toContain("round 1's retry died too (912 s)");
      expect(readme).toContain('only in round 2 did the retry');
    });

    test('A1/D4 — the canary covers the SHIPPED only-shape, not just the probe document', () => {
      const canary = fs.readFileSync(path.join(__dirname, '..', 'probe-provider-routing-canary.integration.test.js'), 'utf-8');
      expect(canary).toContain("'R12,R14,R15'");
      expect(canary).toContain('R15: \'{"only":["reka"]}\'');
      expect(canary).toContain('routing: 3 of 3 cases carried a preference');
      // The probe must carry that case, on the real CI model id, and the
      // pre-existing rows must be untouched.
      const probe = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'probe-provider-routing.js'), 'utf-8');
      expect(probe).toContain("id: 'R15'");
      expect(probe).toContain('const TREE_ONLY = { provider: { openrouter: { models: { [QWEN_CI]:');
      expect(probe).toContain("only: ['reka']");
      for (const id of ['R12', 'R14']) { expect(probe).toContain(`id: '${id}'`); }
    });

    test('A6 — the probe measures byte-for-byte the document the workflow writes', () => {
      // The probe's header claims exactly this; nothing enforced it, so the two
      // could drift and the measurement would silently stop covering the
      // shipped document (council #266 r1 / A6).
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'probe-council-agents.js'), 'utf-8');
      const matches = src.match(/^\s*const ROUTING_TREE = (\{.*\});\s*$/m);
      expect(`probe-council-agents.js declares one ROUTING_TREE literal: ${matches !== null}`)
        .toBe('probe-council-agents.js declares one ROUTING_TREE literal: true');
      expect(src.match(/const ROUTING_TREE =/g)).toHaveLength(1);
      // Evaluated, not parsed: it is a JS object literal with bare keys. The
      // same vm the credit-preflight heredoc is compiled with.
      const tree = new vm.Script(`(${matches[1]})`).runInNewContext();
      const canonical = (v) => (v === null || typeof v !== 'object' || Array.isArray(v)
        ? JSON.stringify(v)
        : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`);
      // Against the FIXTURE, which is the documented example and what the probe
      // measures — the shipped value is blank, and a blank value would make
      // this pin vacuous exactly when it matters least to be.
      expect(canonical(tree)).toBe(canonical(JSON.parse(FIXTURE)));
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
      expect(step).toContain('priceBenchReservation');
      // Bench and chair resolved APART, so the chair cannot reach the bench figures.
      expect(step).toContain('benchIds: bound.ids');
      expect(step).toContain('chairIds: boundChair.ids');
      expect(step).toContain('resolveBenchIds');
      expect(step).toContain('outputBudget');
      // The SAME file the "Provision the alias map" step above wrote.
      expect(step).toContain('AMICUS_CONFIG_DIR');
      expect(step).toContain("'config.json'");
    });

    test('the outcome comment states the SHIPPED contract, not a superseded one', () => {
      // Council #264 r2 polish. The block still described round 1's rule — refuse
      // only on free tier / limit <= 0 / sub-cent, and "a key with NO monthly
      // limit ... is never a refusal" — twenty lines above the code that does
      // neither. A stale contract in a comment is exactly what turned a correct
      // reading into round 2's B1, and it sits outside a -U10 diff window where
      // a council reviewing the diff would never see it.
      const step = creditStep();
      // The two facts the comment must carry, because they are what changed.
      expect(step).toMatch(/MINIMUM of the key's monthly limit and the ACCOUNT\s*\n?\s*#\s*BALANCE/);
      expect(step).toContain("THE CHEAPEST BENCH SEAT'S RESERVATION");
      // Council #264 r3 (B1): the chair is priced but must never gate the bench,
      // and the wave is the SUM of the seats, not seats x the dearest.
      expect(step).toContain('the CHAIR is not in');
      expect(step).toContain('SUM of the bench');
      // And the two superseded sentences must be gone for good.
      // The ORIGINAL sentence, not a fragment of it: `is never a refusal`
      // stopped matching only because the new chair bullet happens to read
      // "is, never a refusal" — a comma away from a pin that fires on the
      // correct text and misses the wrong one.
      expect(step).not.toContain('reports limit_remaining null and is');
      expect(step).not.toMatch(/Only for a key that can fund NOTHING/);
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

    test('the ceiling guard rejects ZERO as well as a non-number (council #264 r2, folded minor)', () => {
      // `0`, `0.00` and `.0` all match the shape regex, so a caller passing
      // max_cost: "0" reached `--max-cost 0` — which the CLI rejects with exit 1.
      // That is the very class the sub-cent REFUSAL exists to prevent, arriving
      // by the one door the preflight does not control: the caller's input.
      const y = yml();
      const paid = y.slice(y.indexOf('Run the adjudicated council'), y.indexOf('Collect the spend receipt'));
      expect(paid).toContain('*[!0.]*)');
      expect(paid).toMatch(/positive|non-zero|zero/i);
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

      /**
       * The bench and chair of the real CI map. Priced so the four gate figures
       * are all distinct: qwen $0.0128 (cheapest), gpt $0.96 (dearest), the four
       * bench rows $1.02 together, and the chair $0.64 apart.
       */
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
        // 64000 tokens x each bench row's completion price: qwen $0.0128 (the
        // cheapest), gpt $0.96 (the dearest), the four together $1.02 — the SUM,
        // not 4 x the dearest, which over-stated this bench by 3.7x (council
        // #264 r3, C1). The chair (gemini-pro, $0.64) is priced apart.
        const r = await run({ modules: shipped(), env: { MAX_COST: '10.00' } });
        expect(r.reads.join('|')).toContain(path.join('amicus-cfg', 'config.json'));
        expect(r.annotations[0]).toContain('$1.02');
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

      test('HQ1 refuse-by-reservation: money below the CHEAPEST seat exits 1', async () => {
        // $0.005 against qwen's $0.0128 — not one row on this bench can be funded.
        const r = await run({ modules: shipped({
          credit: { checked: true, isFreeTier: false, limitRemaining: 0.005 },
          balance: { checked: true, balanceRemaining: 0.005 },
        }) });
        expect(r.exits).toEqual([1]);
        expect(r.errors[0]).toMatch(/cheapest/i);
        // The money is sub-cent so it renders to four decimals (r3 / C2), which
        // is also what keeps it distinguishable from the cheapest seat's $0.01.
        expect(r.errors[0]).toContain('$0.0050');
        // The cheapest-seat rule fires BEFORE the sub-cent rule, so the reader is
        // told the reservation they cannot meet, not merely that they are broke.
        expect(r.errors[0]).not.toContain('below one cent');
      });

      test('C1: money that funds the cheap seats WARNS instead of refusing the run', async () => {
        // The motivating run's own figure — $0.80 against gpt's $0.96 — which
        // round 2 turned into a full refusal. It funds qwen, glm and deepseek,
        // so a cheaper quorum may still seat; refusing would have been the very
        // "partial round into zero reviews" harm this PR exists to avoid.
        const r = await run({ modules: shipped({
          credit: { checked: true, isFreeTier: false, limitRemaining: 0.8 },
          balance: { checked: true, balanceRemaining: 0.8 },
        }), env: { MAX_COST: '10.00' } });
        expect(r.exits).toEqual([0]);
        expect(r.annotations[0]).toMatch(/^::warning::/);
        expect(r.annotations[0]).toContain('cheaper quorum');
        expect(r.annotations[0]).toContain('$0.96');
      });

      test('B1: a dear CHAIR is reported but never refuses the bench', async () => {
        const r = await run({ modules: shipped({
          credit: { checked: true, isFreeTier: false, limitRemaining: 2 },
          balance: { checked: true, balanceRemaining: 2 },
          catalog: { checked: true, prices: { ...DEFAULT_PRICES,
            'google/gemini-3.1-pro-preview': 0.001 } },  // chair reserves $64
        }), env: { MAX_COST: '10.00' } });
        expect(r.exits).toEqual([0]);
        expect(r.annotations[0]).toMatch(/^::warning::/);
        expect(r.annotations[0]).toContain('chair');
        expect(r.annotations[0]).toContain('$64.00');
      });

      test('HQ1 warn-by-concurrency: every seat is affordable alone, the wave is not', async () => {
        // $1.00 clears the dearest seat ($0.96) but not the bench's $1.02 sum.
        const r = await run({ modules: shipped({
          credit: { checked: true, isFreeTier: false, limitRemaining: 1 },
          balance: { checked: true, balanceRemaining: 1 },
        }), env: { MAX_COST: '1.00' } });
        expect(r.exits).toEqual([0]);
        expect(r.annotations[0]).toMatch(/^::warning::OpenRouter money may not fund the first wave/);
        expect(r.annotations[0]).toContain('concurrently');
        expect(r.annotations[0]).toContain('$1.02');
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
