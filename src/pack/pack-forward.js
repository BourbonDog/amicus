// src/pack/pack-forward.js
'use strict';

/**
 * @module pack/pack-forward
 * Wave-1 review fix wave (I1/I2/I3): validates a pack-forwarded `maxCost`/
 * `template` (pack-resolve.js's `applyPackToMcpInput(...).forward` — see that
 * module's own docblock; only ever `maxCost`/`template`, both optional)
 * BEFORE any spawn or state write, on every MCP path that forwards them
 * (amicus_fanout; amicus_start's spawn-fallback AND in-process paths).
 * Extracted out of mcp-server.js (grandfathered/size-exempt) because this is
 * genuine new logic — pack-content validation and template rendering, not
 * wiring — and needs direct unit tests a source-text grep can't provide.
 *
 * Two independent defects, one call:
 *  - I2 (maxCost): `checkBudget` (sidecar/budget.js) only enforces
 *    `typeof === 'number' && > 0`; a hand-edited pack with a string/zero/
 *    negative maxCost silently runs UNCAPPED on the in-process path (the
 *    type check just falls through, so no ceiling is ever applied), while a
 *    spawned CLI child re-validates its own --max-cost and refuses it
 *    (BAD_ARGS) — but only AFTER the tool already returned success and (on
 *    amicus_fanout) already wrote a 'running' wave record. Caught here,
 *    pre-spend, on every path, instead.
 *  - I1 (template): the built-in `review` template needs {{artifact}}/
 *    {{artifact_path}}, which fanout/start can never supply (neither passes
 *    an --artifact-equivalent through pack forwarding). A naive blind forward
 *    lets the CHILD's render fail via process.exit AFTER the tool already
 *    returned success — on amicus_fanout the pre-seeded wave record has no
 *    `pid`, so crash-detection (which only probes pid-bearing records) never
 *    notices, and the wave is stuck 'running' forever. Fixed by dry-running
 *    applyTemplate here, in-process, with EXACTLY the inputs the child will
 *    use (no artifact, no --var — a pack's forwarded template carries only
 *    its name). applyTemplate is a pure function of those inputs ({{date}}
 *    is day-granular), so a success here guarantees the child's own later
 *    (real) re-render succeeds identically — the child still does its own
 *    render, so template provenance (`promptMeta.template`) is still
 *    recorded exactly as Wave 1 built it.
 *
 * `renderedPrompt` now has a consumer on EVERY path (W1-M4, closed for
 * amicus_fanout in v4.7 PR7 and for amicus_start in v4.9 W12 — no caller is
 * left that only wants the pre-spend validation):
 *  - amicus_start's in-process path never spawns a child, so nothing else
 *    would render it: it reuses the text as the actual prompt.
 *  - both SPAWN paths (amicus_fanout's wave, amicus_start's spawn fallback)
 *    write it to the session's on-disk `briefing.md` instead of the raw
 *    prompt, so work whose spawned child aborts before its own render
 *    (src/sidecar/fanout.js) stays findable by the text the user actually
 *    sees. amicus_start additionally seeds `metadata.briefing` from it —
 *    that field, not briefing.md, is a start row's `--search` corpus
 *    (src/sidecar/list-search.js :: rowMatchesSearch).
 * On both spawn paths the child itself still gets the RAW prompt (via a
 * sibling `briefing-input.md`), so its own later render remains the
 * provenance source for `promptMeta.template`.
 */

const { ERROR_CODES } = require('../utils/error-doc');

/**
 * @param {{forward: {maxCost?: number, template?: string}, packRef: string,
 *   prompt: string, project: string}} opts `forward` is pack-resolve.js's
 *   `applyPackToMcpInput(...).forward`; `packRef` names the pack in error
 *   text — pass the RESOLVED pack's name (`packRecord.name`), not necessarily
 *   the caller's raw `--pack`/`pack` ref (which may be a path).
 * @returns {{maxCost?: number, templateName?: string, renderedPrompt?: string,
 *   notices: string[]} | {error: {code, message, hint}}}
 */
function prepareForward({ forward, packRef, prompt, project }) {
  const notices = [];
  const result = { notices };

  if (forward.maxCost !== undefined) {
    const mc = forward.maxCost;
    // Same validity rule cli-handlers-run.js applies to a typed --max-cost
    // (handleStart/handleFanout): only a positive finite JS number passes. A
    // pack is JSON, so a hand-edited "maxCost": "2.00" (string) is exactly
    // the kind of mistake this must catch — it would otherwise reach
    // checkBudget's `typeof === 'number'` check, fail it silently, and run
    // with no ceiling at all.
    if (typeof mc !== 'number' || !Number.isFinite(mc) || mc <= 0) {
      return {
        error: {
          code: ERROR_CODES.PACK_INVALID,
          message: `Error: pack '${packRef}' sets an invalid max-cost (${JSON.stringify(mc)}) — must be a positive number`,
          hint: null,
        },
      };
    }
    result.maxCost = mc;
  }

  if (forward.template !== undefined) {
    // Same call shape the child process makes (cli-handlers-run.js's
    // handleStart :40-43 / handleFanout :164-167): no artifactFile, no
    // varList — a pack's forwarded template carries only its name, never
    // --artifact/--var (pack-resolve.js only ever forwards `template`).
    const { applyTemplate } = require('../template/apply');
    const t = applyTemplate({ templateRef: forward.template, prompt, project });
    if (t.error) { return { error: t.error }; }
    result.templateName = forward.template;
    result.renderedPrompt = t.prompt;
    notices.push(...t.notices);
  }

  return result;
}

module.exports = { prepareForward };
