// tests/sidecar/unzip.test.js
'use strict';

/**
 * Per-platform native-unzip COMMAND SELECTION (src/sidecar/unzip.js ::
 * nativeUnzipPlan). This is planning only — nothing here spawns a process;
 * `./electron-native-plan :: runNativePlan` is what walks this plan and spawns
 * each command in order, and its own tests cover that walk.
 *
 * HISTORY: through v4.14.1 this file also covered `robustExtract()` (bounding
 * the now-removed `extract-zip` dependency and falling back to this same
 * plan). Removed with it (N-06) — see CHANGELOG.md [Unreleased].
 */

const path = require('path');

const { nativeUnzipPlan } = require('../../src/sidecar/unzip');

describe('nativeUnzipPlan (per-platform command selection)', () => {
  it('Windows tries bsdtar first (ABSOLUTE System32 path, not bare "tar"), then Expand-Archive', () => {
    const plan = nativeUnzipPlan('Z.zip', 'D:\\out', 'win32');
    expect(plan.map((s) => s.name)).toEqual(['tar', 'Expand-Archive']);
    // MUST be the absolute System32 bsdtar, else a bare "tar" resolves to GNU tar
    // (git-bash on PATH) which reads "C:\..." as a remote host and can't unzip.
    expect(plan[0].cmd).toMatch(/system32[\\/]tar\.exe$/i);
    expect(path.win32.isAbsolute(plan[0].cmd)).toBe(true);
    expect(plan[0].args).toEqual(['-xf', 'Z.zip', '-C', 'D:\\out']);
    expect(plan[1].cmd.toLowerCase()).toContain('powershell');
    expect(plan[1].args.join(' ')).toContain('Expand-Archive');
  });

  it('macOS tries ditto first, then unzip', () => {
    const plan = nativeUnzipPlan('z.zip', '/out', 'darwin');
    expect(plan.map((s) => s.name)).toEqual(['ditto', 'unzip']);
    expect(plan[0].cmd).toBe('ditto');
    expect(plan[1].cmd).toBe('unzip');
  });

  it('Linux tries unzip first, then tar', () => {
    const plan = nativeUnzipPlan('z.zip', '/out', 'linux');
    expect(plan.map((s) => s.name)).toEqual(['unzip', 'tar']);
  });

  it('single-quote-escapes the PowerShell Expand-Archive path args (injection-safe)', () => {
    const plan = nativeUnzipPlan("C:\\o'ut\\z.zip", "C:\\d'ir", 'win32');
    const cmdStr = plan[1].args[plan[1].args.length - 1];
    // PowerShell escapes a literal single quote by doubling it inside a '...' literal.
    expect(cmdStr).toContain("'C:\\o''ut\\z.zip'");
    expect(cmdStr).toContain("'C:\\d''ir'");
  });
});
