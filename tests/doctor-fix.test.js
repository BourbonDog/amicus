// tests/doctor-fix.test.js
'use strict';

/**
 * #56: `amicus doctor --fix` self-heals fixable checks in place.
 *
 * The only fixable check today is electron (missing / quarantined GUI binary).
 * With --fix the doctor calls repairElectron() and folds the outcome back into
 * the electron check:
 *   - {repaired} -> ok
 *   - {deferred} -> WARN (not error): a deferred download is not a failure.
 *
 * Bare `amicus doctor` MUST be unchanged: it never calls repairElectron (no
 * self-heal side effect). repairElectron is dependency-injected so NOTHING
 * touches the network or extracts a real binary.
 */

const doctor = require('../src/cli-handlers-doctor');
const HINTS = require('../src/utils/remediation-hints');

/** Deps that force the electron check BROKEN (probe returns null). */
function brokenElectronDeps(extra = {}) {
  return {
    // Pure probe says electron is not installed -> the electron check is broken.
    getElectronPath: () => null,
    // #76: pin the electron-mcp check to 'none' so it can neither probe the
    // real machine nor consume this suite's repairElectron mock — these tests
    // exercise the RUNNING-copy check's fix path in isolation.
    scanElectronInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
    ...extra,
  };
}

function findCheck(checks, id) {
  return checks.find((c) => c.id === id);
}

describe('runDoctorChecks --fix electron self-heal (#56)', () => {
  test('bare doctor (no fix) never calls repairElectron and electron stays warn', async () => {
    const repairElectron = jest.fn();
    const checks = await doctor.runDoctorChecks(brokenElectronDeps({ repairElectron }));
    const electron = findCheck(checks, 'electron');

    expect(repairElectron).not.toHaveBeenCalled();
    expect(electron.status).toBe('warn');
  });

  test('--fix invokes repairElectron for a broken electron check', async () => {
    const repairElectron = jest.fn().mockResolvedValue({ repaired: true });
    await doctor.runDoctorChecks(brokenElectronDeps({ fix: true, repairElectron }));

    expect(repairElectron).toHaveBeenCalledTimes(1);
  });

  test('--fix reports ok when repairElectron repairs the binary', async () => {
    const repairElectron = jest.fn().mockResolvedValue({ repaired: true });
    const checks = await doctor.runDoctorChecks(brokenElectronDeps({ fix: true, repairElectron }));
    const electron = findCheck(checks, 'electron');

    expect(electron.status).toBe('ok');
  });

  test('--fix reports failure (not provisioned) when repairElectron returns repaired:false', async () => {
    // The installer-fallback ran but produced no usable exe → honest repaired:false.
    // doctor --fix must NOT claim ok/self-healed (no false success).
    const repairElectron = jest.fn().mockResolvedValue({ repaired: false });
    const checks = await doctor.runDoctorChecks(brokenElectronDeps({ fix: true, repairElectron }));
    const electron = findCheck(checks, 'electron');

    expect(electron.status).not.toBe('ok');
    expect(electron.message).not.toMatch(/self-healed/i);
    expect(electron.message).toMatch(/not provisioned/i);
  });

  test('--fix maps {deferred} to WARN (not error)', async () => {
    const repairElectron = jest.fn().mockResolvedValue({
      deferred: true,
      reason: 'No cached electron zip found; deferring download.',
    });
    const checks = await doctor.runDoctorChecks(brokenElectronDeps({ fix: true, repairElectron }));
    const electron = findCheck(checks, 'electron');

    expect(electron.status).toBe('warn');
    expect(electron.status).not.toBe('error');
    expect(electron.message).toMatch(/defer/i);
  });

  test('--fix uses a short timeout on the repair', async () => {
    const repairElectron = jest.fn().mockResolvedValue({ repaired: true });
    await doctor.runDoctorChecks(brokenElectronDeps({ fix: true, repairElectron }));

    const opts = repairElectron.mock.calls[0][0] || {};
    expect(typeof opts.timeoutMs).toBe('number');
    expect(opts.timeoutMs).toBeGreaterThan(0);
  });

  test('--fix is a no-op for an already-ok electron check', async () => {
    const repairElectron = jest.fn();
    const checks = await doctor.runDoctorChecks({
      getElectronPath: () => '/path/to/electron',
      // #76: pin electron-mcp too — otherwise it scans the real machine and
      // may legitimately consume this suite's repairElectron mock.
      scanElectronInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
      fix: true,
      repairElectron,
    });
    const electron = findCheck(checks, 'electron');

    expect(repairElectron).not.toHaveBeenCalled();
    expect(electron.status).toBe('ok');
  });

  test('a throwing repairElectron degrades to warn, not error', async () => {
    const repairElectron = jest.fn().mockRejectedValue(new Error('boom'));
    const checks = await doctor.runDoctorChecks(brokenElectronDeps({ fix: true, repairElectron }));
    const electron = findCheck(checks, 'electron');

    expect(electron.status).toBe('warn');
  });
});

describe('handleDoctor wires --fix through (#56)', () => {
  function capture(fn) {
    const out = [];
    const orig = process.stdout.write;
    process.stdout.write = (s) => { out.push(s); return true; };
    return Promise.resolve(fn())
      .then((code) => { process.stdout.write = orig; return { code, out: out.join('') }; })
      .catch((e) => { process.stdout.write = orig; throw e; });
  }

  test('handleDoctor forwards fix:true into the injected runChecks', async () => {
    let received;
    const runChecks = (opts) => { received = opts; return []; };
    await capture(() => doctor.handleDoctor({ _: ['doctor'], fix: true }, runChecks));
    expect(received).toBeTruthy();
    expect(received.fix).toBe(true);
  });

  test('bare handleDoctor does not pass fix', async () => {
    let received;
    const runChecks = (opts) => { received = opts || {}; return []; };
    await capture(() => doctor.handleDoctor({ _: ['doctor'] }, runChecks));
    expect(received.fix).toBeFalsy();
  });
});

describe('reinstall hints converge on doctor --fix (#56)', () => {
  test('remediation-hints exposes a doctorFix hint pointing at amicus doctor --fix', () => {
    expect(typeof HINTS.doctorFix).toBe('string');
    expect(HINTS.doctorFix).toMatch(/amicus doctor --fix/);
    // doctorFix must NOT re-introduce the loop-inducing reinstall command.
    expect(HINTS.doctorFix).not.toMatch(/npm install -g amicus/);
  });

  test('the doctor electron check hint points at doctor --fix', async () => {
    const checks = await doctor.runDoctorChecks(brokenElectronDeps());
    const electron = checks.find((c) => c.id === 'electron');
    expect(electron.hint).toBe(HINTS.doctorFix);
  });

  test('electron-ensure failure reason points at doctor --fix', async () => {
    const { ensureElectron, _resetEnsureElectron } = require('../src/sidecar/electron-ensure');
    _resetEnsureElectron();
    const res = await ensureElectron({
      deps: {
        isElectronUsable: () => false,
        repairElectron: async () => ({ deferred: true }),
      },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/amicus doctor --fix/);
  });

  test('postinstall deferred notice points at doctor --fix', async () => {
    const postinstall = require('../scripts/postinstall');
    const warnings = [];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
    try {
      await postinstall.provisionElectron({ repairElectron: async () => ({ deferred: true }) });
    } finally {
      warnSpy.mockRestore();
    }
    expect(warnings.join('\n')).toMatch(/amicus doctor --fix/);
  });
});

describe('cli wires the --fix flag (#56)', () => {
  test('parseArgs treats --fix as a boolean flag', () => {
    const { parseArgs } = require('../src/cli');
    const args = parseArgs(['doctor', '--fix']);
    expect(args.fix).toBe(true);
    expect(args._).toEqual(['doctor']);
  });

  test('doctor usage block documents --fix', () => {
    const { getUsage } = require('../src/cli');
    expect(getUsage('doctor')).toMatch(/--fix/);
  });
});
