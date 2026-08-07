// tests/utils/known-flags.test.js
'use strict';

/**
 * Unknown flags must be REJECTED, not silently absorbed.
 *
 * FIELD BUG (found while smoke-testing v4.5.2). `amicus start -m deepseek
 * --prompt "…" --headless` printed no error and exited 0 — but `--headless` is
 * not a flag `start` has. parseArgs accepted it as `{headless: true}`, nothing
 * read it, and the command silently took the INTERACTIVE path instead: it
 * ignored `-m`, opened a session against the default model, and left it running.
 *
 * The silent-absorb is the defect. `parseArgs` treats any `--token` as valid, so
 * a typo (`--modl`), a flag from another command (`--fix` on `start`), or an
 * invented one all "work" and then quietly do the wrong thing. Worse, an unknown
 * flag followed by a positional SWALLOWS it as its value.
 *
 * amicus already does the right thing for an unknown COMMAND — error, "Did you
 * mean", usage, exit 1 (bin/amicus.js). This gives flags the same treatment.
 */

const { getKnownFlags, unknownFlags, INTERNAL_FLAGS } = require('../../src/utils/known-flags');
const { parseArgs } = require('../../src/cli');

describe('getKnownFlags', () => {
  const known = getKnownFlags();

  it('derives the bulk from the usage text rather than a hand-maintained list', () => {
    // Sample of flags that only exist in USAGE_COMMAND_BLOCKS.
    for (const f of ['model', 'prompt', 'chair', 'critic', 'lenses', 'max-cost', 'out-dir', 'tag']) {
      expect(known.has(f)).toBe(true);
    }
  });

  it('includes the boolean flags', () => {
    for (const f of ['json', 'follow', 'debate', 'fix', 'no-mcp', 'no-validate-model']) {
      expect(known.has(f)).toBe(true);
    }
  });

  /**
   * These are spawned by the MCP server onto its CLI children and appear in no
   * usage block. Rejecting them would break every MCP-launched run.
   */
  it('includes the internal MCP→CLI passthroughs', () => {
    for (const f of ['task-id', 'run-id', 'council-name', 'cowork-process', 'dropped-members']) {
      expect(known.has(f)).toBe(true);
      expect(INTERNAL_FLAGS.has(f)).toBe(true);
    }
  });

  // v4.7 F8: --tag is documented in the start/fanout/council-run usage blocks
  // (not INTERNAL_FLAGS — it's user-facing), so it must register the same way
  // every other usage-derived flag does. MCP spawns forward it unchanged.
  it("'tag' is a known flag (F8 — forwarded by MCP spawns)", () => {
    expect(getKnownFlags().has('tag')).toBe(true);
  });

  it('includes undocumented-but-working flags so the fix breaks nothing', () => {
    for (const f of ['briefing', 'mode', 'quiet', 'help']) {
      expect(known.has(f)).toBe(true);
    }
  });

  it('does NOT include the flag that started this', () => {
    expect(known.has('headless')).toBe(false);
  });

  /**
   * Six flags appear in NO usage block except `pack:` — --kind, --bench,
   * --no-debate, --version, --description, --from-run. If a future edit
   * compresses that block and drops one, `amicus pack save --kind …` starts
   * failing with an unknown-flag rejection. This is the net.
   */
  it('the pack usage block is the sole source of six flags — compressing it must not drop them', () => {
    const flags = getKnownFlags();
    for (const f of ['kind', 'bench', 'no-debate', 'version', 'description', 'from-run']) {
      expect(flags.has(f)).toBe(true);
    }
  });
});

describe('unknownFlags', () => {
  it('flags --headless, the real-world case', () => {
    expect(unknownFlags(parseArgs(['--model', 'deepseek', '--prompt', 'x', '--headless'])))
      .toEqual(['headless']);
  });

  it('returns empty for a wholly valid command line', () => {
    expect(unknownFlags(parseArgs(['--model', 'gemini', '--prompt', 'hi', '--json'])))
      .toEqual([]);
  });

  it('catches a flag borrowed from another command', () => {
    expect(unknownFlags(parseArgs(['--fixx']))).toEqual(['fixx']);
  });

  it('catches several at once, in the order given', () => {
    expect(unknownFlags(parseArgs(['--alpha', '--model', 'x', '--beta'])))
      .toEqual(['alpha', 'beta']);
  });

  it('accepts --key=value form for a known flag', () => {
    expect(unknownFlags(parseArgs(['--model=gemini']))).toEqual([]);
  });

  it('catches --key=value form for an unknown flag', () => {
    expect(unknownFlags(parseArgs(['--headless=true']))).toEqual(['headless']);
  });

  /**
   * parseArgs turns any unregistered `--no-*` token into a boolean so it cannot
   * swallow a positional. That guard must not also make it VALID.
   */
  it('catches an unregistered --no-* flag', () => {
    expect(unknownFlags(parseArgs(['--no-such-thing']))).toEqual(['no-such-thing']);
  });

  it('accepts registered --no-* flags', () => {
    expect(unknownFlags(parseArgs(['--no-ui', '--no-mcp', '--no-cost-gate']))).toEqual([]);
  });

  it('ignores positionals entirely', () => {
    expect(unknownFlags(parseArgs(['council', 'run', 'brief.md', '--json']))).toEqual([]);
  });

  it('ignores the -o short alias', () => {
    expect(unknownFlags(parseArgs(['-o', 'out.json']))).toEqual([]);
  });

  it('handles an empty argv', () => {
    expect(unknownFlags(parseArgs([]))).toEqual([]);
  });

  it('accepts repeated array-accumulation flags', () => {
    expect(unknownFlags(parseArgs(['--var', 'a=1', '--var', 'b=2', '--exclude-mcp', 'x'])))
      .toEqual([]);
  });
});

/**
 * The whole point: every flag any CLI handler actually reads must be known, or
 * the rejection breaks a working command. This is the regression guard on the
 * allowlist itself.
 */
describe('no working flag is left unknown', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..', '..');
  const camelToKebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

  it('every args.<flag> read in the CLI layer is a known flag', () => {
    const files = [
      ...fs.readdirSync(path.join(ROOT, 'src'))
        .filter(f => /^cli.*\.js$/.test(f))
        .map(f => path.join('src', f)),
      path.join('bin', 'amicus.js'),
    ];
    const read = new Set();
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const m of src.matchAll(/\bargs\.([a-zA-Z][a-zA-Z0-9]*)/g)) { read.add(m[1]); }
      for (const m of src.matchAll(/\bargs\[['"]([a-z][a-z0-9-]*)['"]\]/g)) { read.add(m[1]); }
    }
    read.delete('_');
    read.delete('__explicit');

    const known = getKnownFlags();
    const missing = [...read]
      .map(camelToKebab)
      .filter(f => !known.has(f))
      .sort();
    expect(missing).toEqual([]);
  });
});
