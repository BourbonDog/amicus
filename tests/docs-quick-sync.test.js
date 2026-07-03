'use strict';
/**
 * Phase 13 / Task 13.1 — docs quick-sync locking tests (B47, B49, B52, DISTRIBUTION rider).
 * Each `it` pins load-bearing content added/corrected in docs during this task, verified
 * against the binary/source per the task report. Token/regex pins, not brittle verbatim
 * sentences, per the Phase-8 docs-test pattern (see plugin-quickstart-docs.test.js).
 */
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('B47 — Fold handoff operational paragraph', () => {
  const readme = read('README.md');
  const usage = read('docs/usage.md');

  it('README explains the fold artifact: [SIDECAR_FOLD] marker + summary.md', () => {
    expect(readme).toMatch(/\[SIDECAR_FOLD\]/);
    expect(readme).toMatch(/summary\.md/);
  });

  it('README explains pickup via amicus read / amicus_read and the untrusted-output fence', () => {
    const parallelWindow = readme.slice(readme.indexOf('## The parallel window'), readme.indexOf('## Commands'));
    expect(parallelWindow).toMatch(/\[SIDECAR_FOLD\]/);
    expect(parallelWindow).toMatch(/amicus read/);
    expect(parallelWindow).toMatch(/amicus_read/);
    expect(parallelWindow).toMatch(/untrusted_sidecar_output|untrusted-output fence|fenced/i);
  });

  it('usage.md carries the matching fold-handoff explanation', () => {
    expect(usage).toMatch(/\[SIDECAR_FOLD\]/);
    expect(usage).toMatch(/summary\.md/);
    expect(usage).toMatch(/untrusted_sidecar_output|untrusted-output fence|fenced/i);
  });
});

describe('B49.1 — fanout --council sync', () => {
  const usage = read('docs/usage.md');

  it('usage.md documents --council and softens --models to conditionally-required', () => {
    const fanoutSection = usage.slice(usage.indexOf('## `amicus fanout`'), usage.indexOf('## Other Commands'));
    expect(fanoutSection).toMatch(/--council\s*<name>/);
    expect(fanoutSection).toMatch(/mutually exclusive/i);
    // No longer flatly "required" with no escape hatch.
    expect(fanoutSection).toMatch(/required unless `--council`|unless `--council`|required, unless --council/i);
  });
});

describe('B49.2 — list --status accepted values sync', () => {
  const readme = read('README.md');
  const usage = read('docs/usage.md');
  // Real terminal set confirmed from resolveTerminalState (session-finalize.js) +
  // mcp-server.js crash/idle-eviction paths: running, complete, error, timed-out,
  // aborted, crashed, idle-timeout.
  const REQUIRED_STATUSES = ['running', 'complete', 'error', 'timed-out', 'aborted', 'crashed', 'idle-timeout'];

  it('usage.md "Other Commands" --status comment lists the full real status set', () => {
    const otherCommands = usage.slice(usage.indexOf('## Other Commands'), usage.indexOf('## MCP Server'));
    // The comment may wrap onto a continuation line inside the fenced block, so
    // grab from "--status running" through the next blank line rather than a
    // single split('\n') line.
    const start = otherCommands.indexOf('--status running');
    expect(start).toBeGreaterThan(-1);
    const statusBlock = otherCommands.slice(start, otherCommands.indexOf('\n\n', start));
    for (const s of REQUIRED_STATUSES) {
      expect(statusBlock).toContain(s);
    }
  });

  it('README documents the full real status set for amicus list --status somewhere in the Commands block', () => {
    // Task 17.3 restructure: `### Other commands` (with the `amicus list
    // --status` comment) moved to docs/usage.md; README's compact `##
    // Commands` section now states the full status set inline instead.
    const commandsSection = readme.slice(readme.indexOf('## Commands'), readme.indexOf('## Models'));
    for (const s of REQUIRED_STATUSES) {
      expect(commandsSection).toContain(s);
    }
  });

  it('usage.md "Session statuses" line (MCP Server section) includes timed-out', () => {
    const mcpSection = usage.slice(usage.indexOf('## MCP Server'), usage.indexOf('## OpenCode Agent Types'));
    const statusLine = mcpSection.split('\n').find(l => l.includes('Session statuses:'));
    expect(statusLine).toBeTruthy();
    expect(statusLine).toContain('timed-out');
  });
});

describe('B49.3 — fanout --session-id support documented', () => {
  const readme = read('README.md');
  const usage = read('docs/usage.md');

  it('README fanout section documents --session-id support', () => {
    // Task 17.3 restructure: the per-command `### ` subsections (including
    // `### \`amicus fanout\``) moved to docs/usage.md, the canonical CLI
    // reference; README's compact Commands section now summarizes
    // --session-id support inline instead of a dedicated fanout subsection.
    const commandsSection = readme.slice(readme.indexOf('## Commands'), readme.indexOf('## Models'));
    expect(commandsSection).toMatch(/--session-id/);
  });

  it('usage.md fanout section documents --session-id support', () => {
    const fanoutSection = usage.slice(usage.indexOf('## `amicus fanout`'), usage.indexOf('## Other Commands'));
    expect(fanoutSection).toMatch(/--session-id/);
  });
});

describe('B49.4 — amicus status <id> examples', () => {
  const readme = read('README.md');

  it('README shows a human-readable amicus status example with real field labels', () => {
    expect(readme).toMatch(/amicus status <id>/);
    // Field labels verified against formatRunHuman() in cli-handlers-status.js
    expect(readme).toMatch(/Task:\s+\S/);
    expect(readme).toMatch(/Status:\s+\S/);
    expect(readme).toMatch(/Elapsed:\s+\S/);
  });

  it('README shows a --json amicus status example with real field names', () => {
    // Field names verified by running `node bin/amicus.js status <id> --json`
    // against a synthetic session dir (see task report).
    expect(readme).toMatch(/"taskId":/);
    expect(readme).toMatch(/"elapsed":/);
    expect(readme).toMatch(/"phase":/);
  });
});

describe('B49.5 — start --setup does not relax --prompt requirement', () => {
  // Task 17.3 restructure: the full `amicus start` option table (this row
  // included) moved from README to docs/usage.md, the canonical CLI
  // reference — README now only keeps a compact Commands table + pointer.
  const usage = read('docs/usage.md');

  it('usage.md --setup row clarifies --prompt is still required', () => {
    const optionsBlock = usage.slice(usage.indexOf('| `--session-dir'), usage.indexOf('> Agents:'));
    const setupLine = optionsBlock.split('\n').find(l => l.includes('`--setup`'));
    expect(setupLine).toBeTruthy();
    expect(setupLine).toMatch(/--prompt|still requires|does not/i);
  });
});

describe('B52 — OpenRouter 402 troubleshooting row', () => {
  const readme = read('README.md');
  const usage = read('docs/usage.md');

  it('README troubleshooting table has a 402 row naming OpenRouter credit + recovery', () => {
    const troubleshooting = readme.slice(readme.indexOf('## Troubleshooting'), readme.indexOf('**Debug logging:**'));
    expect(troubleshooting).toMatch(/402/);
    expect(troubleshooting).toMatch(/openrouter\.ai\/credits/);
    expect(troubleshooting).toMatch(/:free|free council/i);
  });

  it('README does not claim amicus key validates credit balance', () => {
    // The gap: `amicus key` only calls validateApiKey (auth check), never
    // checkOpenRouterCredit — confirmed in src/cli-handlers.js handleKey().
    const troubleshooting = readme.slice(readme.indexOf('## Troubleshooting'), readme.indexOf('**Debug logging:**'));
    expect(troubleshooting).toMatch(/doesn't check|does not check|no.*balance check|never checks/i);
  });

  it('docs/troubleshooting.md (extended) carries a matching 402 section', () => {
    const trouble = read('docs/troubleshooting.md');
    const section = trouble.slice(
      trouble.indexOf('## OpenRouter 402'),
      trouble.indexOf('## Session Not Found')
    );
    expect(section).toMatch(/402/);
    expect(section).toMatch(/openrouter\.ai\/credits/);
    expect(section).toMatch(/amicus doctor/);
    expect(section).toMatch(/:free|free council|councils\.free/i);
  });
});

describe('DISTRIBUTION.md rider — stale v0.1 registry path', () => {
  const dist = read('docs/DISTRIBUTION.md');

  it('no more /v0.1/ registry paths anywhere in the doc', () => {
    expect(dist).not.toMatch(/\/v0\.1\/servers/);
  });

  it('the namespace-availability check now cites the /v0/ path', () => {
    expect(dist).toMatch(/registry\.modelcontextprotocol\.io\/v0\/servers\?search=/);
  });
});
