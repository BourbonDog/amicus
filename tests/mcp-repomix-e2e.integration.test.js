/**
 * MCP Repomix E2E Test
 *
 * Proves that MCP servers discovered from the Claude Code plugin chain
 * are actually available and callable inside a headless sidecar session.
 *
 * Requires: OPENROUTER_API_KEY env var, AND a real on-disk project for repomix to pack.
 * Runtime: ~2-3 minutes (real LLM + real MCP tool call)
 * Run: npm run test:e2e:mcp
 *
 * ⚠️ The packed-project path is a MACHINE PREREQUISITE, not a fixture. It defaults to the
 * pre-fork `~/claude-code-projects/sidecar` layout this test was written against, which does not
 * exist on a normal checkout — so without a guard this suite is a permanent red in
 * `npm run test:integration:live`, drowning out the real signal that rail exists to give
 * (a broken spawn/session/MCP lifecycle, or a dead model alias). Every other suite on this rail
 * guards its own prerequisite (HAS_API_KEY / HAS_ELECTRON / HAS_DISPLAY / HAS_STUB_HELPER);
 * this one now does too, and skips with the reason visible rather than failing.
 *
 * Point it at any real project with `AMICUS_REPOMIX_E2E_PROJECT=<dir>` to actually run it.
 * NOTE: skipping here means the plugin-chain MCP discovery path is NOT being exercised on this
 * machine — a genuine coverage gap, tracked rather than papered over.
 */

const { startSidecar } = require('../src/sidecar/start');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT = process.env.AMICUS_REPOMIX_E2E_PROJECT
  || path.join(os.homedir(), 'claude-code-projects', 'sidecar');
// Guard on the directory repomix is actually asked to pack, NOT on PROJECT itself: startSidecar
// creates `<project>/.claude` as a side effect, so a previous failed run leaves PROJECT existing
// but empty — a guard one level up would pass on the wreckage of the last failure.
const PACK_DIR = path.join(PROJECT, 'src');
const HAS_PROJECT = (() => { try { return fs.statSync(PACK_DIR).isDirectory(); } catch { return false; } })();
const SKIP = !process.env.OPENROUTER_API_KEY || !HAS_PROJECT;
const describeOrSkip = SKIP ? describe.skip : describe;

describeOrSkip('MCP Repomix E2E', () => {
  // 3 minutes — real LLM + real MCP call
  jest.setTimeout(3 * 60 * 1000);

  test('headless sidecar discovers and calls repomix MCP tool', async () => {
    const result = await startSidecar({
      model: process.env.SIDECAR_E2E_MODEL || 'openrouter/google/gemini-2.5-flash',
      prompt: [
        'You have access to the repomix MCP tool.',
        `Use it to pack the directory: ${PACK_DIR}`,
        'Report: (1) the total number of files packed, (2) the first filename listed in the output.',
        'If you cannot access the repomix tool, say exactly: "repomix tool not available"'
      ].join(' '),
      noUi: true,
      headless: true,
      timeout: 2,
      agent: 'build',
      clientType: 'code',
      project: PROJECT,
      includeContext: false,
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('complete');
    expect(result.summary).toBeTruthy();

    const summary = result.summary.toLowerCase();
    expect(summary).not.toContain('repomix tool not available');

    // Evidence of actual repomix output: file count number or known repomix text
    const hasRepomixEvidence = (
      /\d+\s+files?/i.test(result.summary) ||
      /packed/i.test(result.summary) ||
      /repomix/i.test(result.summary) ||
      /\.js/i.test(result.summary)
    );
    expect(hasRepomixEvidence).toBe(true);
  });
});
