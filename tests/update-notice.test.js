'use strict';

/**
 * Unit tests for src/utils/update-notice.js (spec 2026-08-03) — the MCP
 * channel's update notice. No network, no real update-notifier: update info
 * comes from AMICUS_MOCK_UPDATE=available (updater.js mock mode) or an
 * injected getUpdateInfo seam; config/self-path classification comes from
 * injected seams throughout.
 */

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.AMICUS_MOCK_UPDATE;
  jest.resetModules();
});

afterAll(() => { process.env = { ...originalEnv }; });

const load = () => require('../src/utils/update-notice');

describe('classifySelfInstall()', () => {
  const fakeFs = (real) => ({ realpathSync: () => real });

  it('classifies an npx-cache copy', () => {
    const { classifySelfInstall } = load();
    expect(classifySelfInstall({
      fs: fakeFs('C:\\Users\\x\\AppData\\Local\\npm-cache\\_npx\\abc123\\node_modules\\amicus\\package.json'),
      pkgPath: 'irrelevant',
    })).toBe('npx');
  });

  it('classifies a global install (node_modules, no _npx)', () => {
    const { classifySelfInstall } = load();
    expect(classifySelfInstall({
      fs: fakeFs('/usr/local/lib/node_modules/amicus/package.json'),
      pkgPath: 'irrelevant',
    })).toBe('global');
  });

  it('classifies a dev clone as other', () => {
    const { classifySelfInstall } = load();
    expect(classifySelfInstall({
      fs: fakeFs('C:\\Users\\x\\code\\amicus\\package.json'),
      pkgPath: 'irrelevant',
    })).toBe('other');
  });

  it('returns other when realpath throws', () => {
    const { classifySelfInstall } = load();
    expect(classifySelfInstall({
      fs: { realpathSync: () => { throw new Error('boom'); } },
      pkgPath: 'irrelevant',
    })).toBe('other');
  });
});

describe('upgradeInstruction()', () => {
  it('npx config pinning amicus@latest -> restart-only line (verified voice)', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => ({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }),
    });
    expect(line).toBe('Restart your MCP client — it launches `amicus@latest` and will pick up the new version.');
  });

  it('npx config pinning bare amicus -> cached-copy hint (unverified voice)', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => ({ command: 'npx', args: ['-y', 'amicus', 'mcp'] }),
    });
    expect(line).toMatch(/^Your MCP config likely launches a cached\/pinned npx copy/);
    expect(line).toContain('npx -y amicus@latest mcp');
  });

  it('npx config pinning a semver -> same cached-copy hint', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => ({ command: 'npx', args: ['-y', 'amicus@4.3.0', 'mcp'] }),
    });
    expect(line).toMatch(/^Your MCP config likely launches a cached\/pinned npx copy/);
  });

  it('path config + global self -> npm i -g line', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => ({ command: 'amicus', args: ['mcp'] }),
      selfFlavor: () => 'global',
    });
    expect(line).toBe('Run `npm install -g amicus`, then restart your MCP client.');
  });

  it('path config + other self (dev clone) -> generic line', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => ({ command: 'amicus', args: ['mcp'] }),
      selfFlavor: () => 'other',
    });
    expect(line).toBe('Upgrade your amicus install, then restart your MCP client.');
  });

  it('unreadable config falls back to self flavor: npx self -> cached-copy hint', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => { throw new Error('no config'); },
      selfFlavor: () => 'npx',
    });
    expect(line).toMatch(/^Your MCP config likely launches a cached\/pinned npx copy/);
  });

  it('null config falls back to self flavor: global self -> npm i -g line', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => null,
      selfFlavor: () => 'global',
    });
    expect(line).toBe('Run `npm install -g amicus`, then restart your MCP client.');
  });
});

describe('buildUpdateNotice()', () => {
  it('renders version pair, instruction, and changelog link', () => {
    const { buildUpdateNotice } = load();
    const text = buildUpdateNotice({ current: '4.3.0', latest: '4.6.0', hasUpdate: true }, 'INSTRUCTION.');
    expect(text).toBe('Update available: amicus v4.3.0 → v4.6.0. INSTRUCTION. '
      + 'Changelog: https://github.com/BourbonDog/amicus/blob/main/CHANGELOG.md');
  });
});

describe('maybeAppendUpdateNotice()', () => {
  const freshResult = () => ({ content: [{ type: 'text', text: 'payload' }] });
  const infoSeam = () => ({ current: '4.3.0', latest: '9.9.9', hasUpdate: true });

  it('appends one notice block and latches: second call is a no-op', () => {
    const { maybeAppendUpdateNotice } = load();
    const first = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    expect(first.content).toHaveLength(2);
    expect(first.content[1].type).toBe('text');
    expect(first.content[1].text).toMatch(/^Update available: amicus v4\.3\.0 → v9\.9\.9\./);
    const second = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    expect(second.content).toHaveLength(1);
  });

  it('skips isError results and leaves the latch armed', () => {
    const { maybeAppendUpdateNotice } = load();
    const err = { content: [{ type: 'text', text: 'Error: x' }], isError: true };
    expect(maybeAppendUpdateNotice(err, { getUpdateInfo: infoSeam }).content).toHaveLength(1);
    // latch still armed: a later success gets the notice
    const ok = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    expect(ok.content).toHaveLength(2);
  });

  it('no update known -> no-op, latch stays armed', () => {
    const { maybeAppendUpdateNotice } = load();
    const r1 = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: () => null });
    expect(r1.content).toHaveLength(1);
    const r2 = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    expect(r2.content).toHaveLength(2);
  });

  it('never throws: a throwing getUpdateInfo returns the original result', () => {
    const { maybeAppendUpdateNotice } = load();
    const r = freshResult();
    expect(maybeAppendUpdateNotice(r, { getUpdateInfo: () => { throw new Error('boom'); } })).toBe(r);
    expect(r.content).toHaveLength(1);
  });

  it('tolerates malformed results (null / missing content)', () => {
    const { maybeAppendUpdateNotice } = load();
    expect(maybeAppendUpdateNotice(null, { getUpdateInfo: infoSeam })).toBeNull();
    const bare = {};
    expect(maybeAppendUpdateNotice(bare, { getUpdateInfo: infoSeam })).toBe(bare);
  });

  it('_resetLatchForTests re-arms the latch', () => {
    const { maybeAppendUpdateNotice, _resetLatchForTests } = load();
    maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    _resetLatchForTests();
    const again = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    expect(again.content).toHaveLength(2);
  });
});

describe('guideUpdateLine()', () => {
  it('returns the guide line when an update is known', () => {
    const { guideUpdateLine } = load();
    const line = guideUpdateLine({
      getUpdateInfo: () => ({ current: '4.3.0', latest: '9.9.9', hasUpdate: true }),
      readConfig: () => ({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }),
    });
    expect(line).toBe('**Update available: v9.9.9** — Restart your MCP client — it launches `amicus@latest` and will pick up the new version.');
  });

  it('returns null when no update is known', () => {
    const { guideUpdateLine } = load();
    expect(guideUpdateLine({ getUpdateInfo: () => null })).toBeNull();
  });

  it('returns null instead of throwing on a broken seam', () => {
    const { guideUpdateLine } = load();
    expect(guideUpdateLine({ getUpdateInfo: () => { throw new Error('boom'); } })).toBeNull();
  });

  it('works through the real updater under AMICUS_MOCK_UPDATE=available', () => {
    process.env.AMICUS_MOCK_UPDATE = 'available';
    const { guideUpdateLine } = load();
    const line = guideUpdateLine({ readConfig: () => null, selfFlavor: () => 'global' });
    expect(line).toContain('**Update available: v99.0.0**');
    expect(line).toContain('npm install -g amicus');
  });
});

// Run: npx jest tests/update-notice.test.js
