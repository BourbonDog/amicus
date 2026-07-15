// tests/routing-config.test.js
const os = require('os'); const path = require('path'); const fs = require('fs');
const CFG = path.join(os.tmpdir(), `amicus-routing-${process.pid}`);
beforeEach(() => { process.env.AMICUS_CONFIG_DIR = CFG; fs.mkdirSync(CFG, { recursive: true }); });
afterEach(() => { delete process.env.AMICUS_CONFIG_DIR; fs.rmSync(CFG, { recursive: true, force: true }); });
const write = (o) => fs.writeFileSync(path.join(CFG, 'config.json'), JSON.stringify(o));

test('defaults: prefer direct, no notifications', () => {
  const { getRoutingConfig } = require('../src/utils/config');
  expect(getRoutingConfig()).toEqual({ prefer: 'direct', migration_notified: {} });
});
test('resolveGatewayMode: per-call explicit wins', () => {
  const { resolveGatewayMode } = require('../src/utils/config');
  write({ routing: { prefer: 'openrouter' } });
  expect(resolveGatewayMode('direct')).toBe('direct');
});
test('resolveGatewayMode: prefer direct -> auto (direct-first) when no per-call', () => {
  const { resolveGatewayMode } = require('../src/utils/config');
  write({ routing: { prefer: 'direct' } });
  expect(resolveGatewayMode(undefined)).toBe('auto');
});
test('resolveGatewayMode: prefer openrouter -> openrouter when no per-call', () => {
  const { resolveGatewayMode } = require('../src/utils/config');
  write({ routing: { prefer: 'openrouter' } });
  expect(resolveGatewayMode('auto')).toBe('openrouter');
});
