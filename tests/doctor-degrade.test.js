'use strict';
const { collectDoctorDegrades } = require('../src/utils/doctor-degrade');

const row = (over = {}) => ({ id: 'engine-mcp', name: 'OpenCode engine (MCP launch path)',
  status: 'ok', message: 'fine', hint: null, ...over });

test('an error row becomes a doctor-check-failed degrade carrying the row facts', () => {
  const recs = collectDoctorDegrades([
    row({ status: 'error', message: 'engine missing from the npx-cache copy the MCP launches: C:\\x',
      hint: 'npm install -g amicus' }),
  ]);
  expect(recs).toHaveLength(1);
  const r = recs[0];
  expect(r.kind).toBe('degrade');
  expect(r.channel).toBe('doctor-check-failed');
  expect(r.what).toBe("the 'OpenCode engine (MCP launch path)' check failed");
  expect(r.why).toBe('engine missing from the npx-cache copy the MCP launches: C:\\x');
  expect(r.effect).toBe('amicus may not work correctly until this is fixed; doctor exits 1');
  expect(r.remedy).toBe('npm install -g amicus');
  expect(r.data).toEqual({ checkId: 'engine-mcp' });
});

test('a hint-less error row omits remedy rather than filling it', () => {
  const recs = collectDoctorDegrades([row({ status: 'error', message: 'boom', hint: null })]);
  expect(recs[0].remedy).toBeUndefined();
});

test('ok and warn rows produce NO record — the exit-derivation equivalence', () => {
  expect(collectDoctorDegrades([row(), row({ status: 'warn', message: 'stale' })])).toEqual([]);
});

test('a fixed row becomes a doctor-fix heal', () => {
  const recs = collectDoctorDegrades([
    row({ status: 'ok', message: 'installed (self-healed)', fixed: true,
      fixDetail: 'provisioned the Electron binary in place' }),
  ]);
  expect(recs).toHaveLength(1);
  const r = recs[0];
  expect(r.kind).toBe('heal');
  expect(r.channel).toBe('doctor-fix');
  expect(r.what).toBe("the 'OpenCode engine (MCP launch path)' check was repaired in place");
  expect(r.why).toBe('doctor --fix provisioned the Electron binary in place');
  expect(r.effect).toBe('no further action needed; the repair already ran');
  expect(r.data).toEqual({ checkId: 'engine-mcp' });
});

test('a fixed row with no detail still heals with the generic why', () => {
  const recs = collectDoctorDegrades([row({ status: 'ok', fixed: true })]);
  expect(recs[0].why).toBe("doctor --fix applied the check's self-heal");
});

test('a row can carry BOTH: fixed but still error → one degrade AND one heal', () => {
  // e.g. engine-mcp repaired one copy but another stayed broken (self-heal incomplete).
  const recs = collectDoctorDegrades([
    row({ status: 'error', message: 'self-heal incomplete: C:\\y', fixed: true, fixDetail: 'copied the engine into 1 npx-cache copy' }),
  ]);
  expect(recs.map(r => r.kind).sort()).toEqual(['degrade', 'heal']);
});

test('malformed rows never throw — the collector guards like the sink', () => {
  expect(() => collectDoctorDegrades([{ status: 'error' }, null, row()])).not.toThrow();
  const recs = collectDoctorDegrades([{ status: 'error' }]);
  expect(recs).toHaveLength(1);
  expect(recs[0].channel).toBe('doctor-check-failed');
  expect(recs[0].why).toBe('the check produced no message');
});
