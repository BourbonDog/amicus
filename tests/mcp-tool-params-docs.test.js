'use strict';
/**
 * F-1 — pin MCP tool PARAMETERS, not just tool names.
 *
 * Filed 2026-08-08 out of the v4.7 docs recon (BACKLOG § "v4.7 docs PR — filed,
 * not shipped"), deliberately excluded there as test infrastructure rather than
 * a doc gap. Shipped v4.9 W12.
 *
 * The hole it closes: `tests/docs-command-coverage.test.js` derives the TOOL
 * NAMES from `src/mcp-tools.js` and asserts each is named in README.md and
 * docs/usage.md, but nothing anywhere pinned a tool's INPUT SCHEMA. That is how
 * v4.7's `tag`/`search` params and the widened `amicus_list.status` could have
 * shipped undocumented against a fully green suite.
 *
 * REMEASURED 2026-08-26 before writing this file (the filing's number was
 * 19 of 105, taken pre-W5): 16 tools, **106** (tool, key) pairs, of which
 * **19** named a key that appeared NOWHERE in docs/usage.md. The 105→106 growth
 * is `amicus_council_run.intent` — `git log -S 'intent: z.enum' src/mcp-tools.js`
 * → `ec71d4a8` "feat(v4.9 W5): intent plumbing" — and W5 documented it as it
 * landed (usage.md's `--intent <review|task>` row names the MCP param too). The
 * undocumented set is therefore the SAME 19 the filing measured, by arithmetic
 * rather than by assumption: exactly one key entered, it entered documented, and
 * the count did not move — so no member of the old 19 can have been documented
 * without another taking its place, and there was no other. The 19:
 * amicus_start's contextSince/includeContext/
 * coworkProcess/parentSession/windowPosition, amicus_wait's timeoutMs,
 * amicus_read's offset, amicus_fanout's includeContext/coworkProcess/
 * parentSession, amicus_council_tally's adjudications/rankings/runStats,
 * amicus_verdict's seatLoss/degrades, and amicus_council_run's briefingFile/
 * timeoutMinutes/claudeReviewFile/noCostGate.
 *
 * ⚠️ THAT 19 IS THE FILING'S LENS, NOT THIS PIN'S — a bare substring scan over
 * the WHOLE of docs/usage.md, reported here only so the number is comparable to
 * the one it supersedes. It counts `status` and `mode` as documented because
 * those are ordinary English words that occur somewhere in a 900-line file, and
 * `taskId` because the CLI sections use it — none of which told an MCP caller
 * anything. Under this file's own (stricter) lens — backtick-quoted AND scoped
 * to the `## MCP Server` section — **50 of the 60 distinct keys** were
 * undocumented before this change; 58 are documented after it, 2 allowlisted.
 *
 * THE RULE (v4.9 W12 ruling): every user-settable key gets an honest one-liner
 * in docs/usage.md's `## MCP Server` section. The allowlist is for
 * HARNESS-INJECTED keys ONLY — parameters the calling agent fills in from facts
 * only it can see, which a human user could not meaningfully set — and each
 * entry carries its WHY here, in code, where a future rev has to read it before
 * widening the list.
 */
const fs = require('fs');
const path = require('path');
const { getTools } = require('../src/mcp-tools');
const { mustSection } = require('./helpers/docs-extract');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8').replace(/\r\n/g, '\n');

/**
 * Harness-injected parameters — the ONLY admissible reason to be undocumented.
 *
 * Per-key rulings made 2026-08-26 over the five candidates the W12 plan named
 * (amicus_start's contextSince · includeContext · coworkProcess ·
 * parentSession · windowPosition). Three were ruled USER-SETTABLE and are
 * documented in usage.md instead of living here:
 *   - `contextSince` — the MCP twin of the `--context-since` CLI flag, which
 *     usage.md's Context Sharing section already tells users to tune.
 *   - `includeContext` — the MCP twin of `--no-context`, and the one knob
 *     amicus_guide tells a caller to think about per briefing.
 *   - `windowPosition` — pure user preference (which screen edge the Amicus
 *     window lands on); nothing about it is knowable only to the harness.
 * The two below are the genuine harness-injected pair. Both are also on
 * amicus_fanout, by the same reasoning.
 */
const HARNESS_INJECTED = {
  coworkProcess:
    'The Cowork VM process name, which the CALLING agent reads off its own working '
    + 'directory (/sessions/<name>/). A user cannot know it from outside the VM, and a '
    + 'guessed value silently loads no parent context rather than erroring.',
  parentSession:
    "The calling Claude Code session's own UUID. The agent has it; the user does not. "
    + 'It exists to disambiguate concurrent sessions in one project — a value to be '
    + 'forwarded, never chosen.',
};

const TOOLS = getTools();
const usage = read('docs/usage.md');
const mcpSection = mustSection(usage, /## MCP Server[\s\S]*?(?=\n## )/, 'docs/usage.md MCP Server section');

/**
 * The documented set: every backtick-quoted bare identifier in the MCP section.
 * Backticks (not a bare substring scan) deliberately — `mode`, `status`,
 * `search` and `model` are ordinary English words that a prose-only match would
 * find in any paragraph, which is exactly the false green this pin exists to
 * refuse.
 */
const DOCUMENTED = new Set(
  [...mcpSection.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map(m => m[1])
);

describe('F-1 — every MCP tool parameter is documented in usage.md (or allowlisted with a why)', () => {
  it.each(TOOLS.map(t => [t.name, Object.keys(t.inputSchema || {})]))(
    '%s: every inputSchema key is documented or harness-injected', (name, keys) => {
      const undocumented = keys.filter(k => !DOCUMENTED.has(k) && !(k in HARNESS_INJECTED));
      expect({ tool: name, undocumented }).toEqual({ tool: name, undocumented: [] });
    });

  it('the allowlist is not empty of reasons — every entry carries a real WHY', () => {
    for (const [key, why] of Object.entries(HARNESS_INJECTED)) {
      expect(typeof why).toBe('string');
      // A one-word "internal" is not a why. 60 chars is the floor at which an
      // entry has to name the fact the harness holds and the user does not.
      expect(why.length).toBeGreaterThan(60);
      expect(key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });

  it('no allowlist entry is dead — each names a key some live tool actually declares', () => {
    const live = new Set(TOOLS.flatMap(t => Object.keys(t.inputSchema || {})));
    for (const key of Object.keys(HARNESS_INJECTED)) {
      expect({ key, live: live.has(key) }).toEqual({ key, live: true });
    }
  });

  it('no allowlist entry is redundant — an allowlisted key must NOT also be documented', () => {
    // Anti-rot in the other direction: if a later rev documents one of these
    // (i.e. rules it user-settable after all), the exemption must be deleted
    // rather than left standing as a silent escape hatch for its successors.
    for (const key of Object.keys(HARNESS_INJECTED)) {
      expect({ key, documented: DOCUMENTED.has(key) }).toEqual({ key, documented: false });
    }
  });

  it('the MCP section documents parameters at all (guards against the section being gutted)', () => {
    // The pin above is vacuously satisfiable by an empty tool surface; this is
    // the floor. 40 is comfortably under the 58 distinct documented keys
    // measured 2026-08-26 and comfortably over anything the section carried
    // before F-1 landed.
    const keysOfTools = new Set(TOOLS.flatMap(t => Object.keys(t.inputSchema || {})));
    const documentedKeys = [...keysOfTools].filter(k => DOCUMENTED.has(k));
    expect(documentedKeys.length).toBeGreaterThan(40);
  });
});
