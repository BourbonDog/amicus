'use strict';

const { runDoctorChecks, handleDoctor } = require('../src/cli-handlers-doctor');

async function localCheck(deps) {
  const checks = await runDoctorChecks(deps);
  return checks.find((c) => c.id === 'local-providers');
}

/** Mirrors tests/doctor-handler.test.js's capture() -- handleDoctor renders to
 * real stdout via process.stdout.write, so tests must trap it or the human-
 * readable report leaks into the Jest run's own console output. */
function capture(fn) {
  const out = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  return Promise.resolve(fn()).then((code) => { process.stdout.write = orig; return { code, out: out.join('') }; })
    .catch((e) => { process.stdout.write = orig; throw e; });
}

describe('doctor: local-providers check', () => {
  test('none configured → ok "none configured"', async () => {
    const probe = jest.fn();
    const c = await localCheck({ getLocalProviders: () => ({}), probeLocalProvider: probe });
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/none configured/i);
    // Nothing configured → bounded probe must never fire (nothing to probe).
    expect(probe).not.toHaveBeenCalled();
  });

  test('reachable → ok with model count + baseURL', async () => {
    const c = await localCheck({
      getLocalProviders: () => ({ ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' } }),
      probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: ['ollama/a', 'ollama/b'] }),
    });
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/ollama.*2.*http:\/\/127\.0\.0\.1:11434\/v1/);
  });

  test('unreachable → WARN (never error — must not flip CI exit code)', async () => {
    const c = await localCheck({
      getLocalProviders: () => ({ lmstudio: { id: 'lmstudio', baseURL: 'http://127.0.0.1:1234/v1', flavor: 'lmstudio' } }),
      probeLocalProvider: jest.fn().mockResolvedValue({ status: 'unreachable', models: [] }),
    });
    expect(c.status).toBe('warn');
    expect(c.hint).toMatch(/LM Studio/i);
  });

  test('probes with a bounded 2s timeout — doctor must never introduce an unbounded wait', async () => {
    const probe = jest.fn().mockResolvedValue({ status: 'ok', models: [] });
    await localCheck({
      getLocalProviders: () => ({ ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' } }),
      probeLocalProvider: probe,
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0][1]).toMatchObject({ timeoutMs: 2000 });
  });

  test('mixed reachable + unreachable across multiple providers → warn, message covers both, probed once each', async () => {
    const probe = jest.fn()
      .mockImplementation((entry) => (
        entry.id === 'ollama'
          ? Promise.resolve({ status: 'ok', models: ['ollama/a'] })
          : Promise.resolve({ status: 'unreachable', models: [] })
      ));
    const c = await localCheck({
      getLocalProviders: () => ({
        ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' },
        vllm: { id: 'vllm', baseURL: 'http://127.0.0.1:8000/v1', flavor: 'vllm' },
      }),
      probeLocalProvider: probe,
    });
    // Any provider down → overall WARN, never error.
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/ollama/);
    expect(c.message).toMatch(/vllm/);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  test('unreachable, non-lmstudio flavor → generic "start the local server" hint (no false LM Studio mention)', async () => {
    const c = await localCheck({
      getLocalProviders: () => ({ ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' } }),
      probeLocalProvider: jest.fn().mockResolvedValue({ status: 'unreachable', models: [] }),
    });
    expect(c.status).toBe('warn');
    expect(c.hint).not.toMatch(/LM Studio/i);
    expect(c.hint).toMatch(/ollama serve/i);
  });

  test('prototype-chain discipline: a provider literally named "constructor" is probed and reported correctly', async () => {
    const map = {};
    map.constructor = { id: 'constructor', baseURL: 'http://127.0.0.1:9999/v1', flavor: 'generic' };
    const c = await localCheck({
      getLocalProviders: () => map,
      probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: ['constructor/x'] }),
    });
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/constructor: 1 models @ http:\/\/127\.0\.0\.1:9999\/v1/);
  });

  test('an unreachable local provider alone does not flip amicus doctor\'s exit code', async () => {
    const onlyLocalProvidersWarn = async () => ([
      { id: 'local-providers', name: 'Local providers', status: 'warn', message: 'lmstudio: unreachable @ http://127.0.0.1:1234/v1', hint: 'Start the LM Studio server (Developer → Start Server), or `ollama serve`.' },
    ]);
    const { code } = await capture(() => handleDoctor({ _: [] }, onlyLocalProvidersWarn));
    expect(code).toBe(0);
  });
});
