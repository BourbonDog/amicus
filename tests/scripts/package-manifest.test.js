/** Launch-identity regression guards: the npm tarball must carry the council, and the
 * package must point at the Amicus repo, not the upstream fork source. */
const pkg = require('../../package.json');

describe('package.json launch identity', () => {
  test('files includes skills/ so the council ships in the tarball', () => {
    expect(pkg.files).toContain('skills/');
  });
  test('repository/bugs/homepage point at BourbonDog/amicus; author is Christian Wagner', () => {
    expect(pkg.repository.url).toBe('git+https://github.com/BourbonDog/amicus.git');
    expect(pkg.bugs).toBe('https://github.com/BourbonDog/amicus/issues');
    expect(pkg.homepage).toBe('https://bourbondog.github.io/amicus/');
    expect(pkg.author).toBe('Christian Wagner');
  });
  test('keywords carry the council positioning', () => {
    for (const k of ['council', 'second-opinion', 'fanout']) {
      expect(pkg.keywords).toContain(k);
    }
  });
});

describe('MCP Registry metadata (Phase 9c)', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..', '..');
  const serverJson = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'server.json'), 'utf-8'));

  test('package.json mcpName matches server.json name exactly (case-sensitive registry namespace)', () => {
    expect(pkg.mcpName).toBe('io.github.BourbonDog/amicus');
    expect(serverJson().name).toBe(pkg.mcpName);
  });

  test('server.json versions stay in lockstep with package.json', () => {
    const s = serverJson();
    expect(s.version).toBe(pkg.version);
    expect(s.packages[0].version).toBe(pkg.version);
  });

  test('server.json models the `npx amicus mcp` stdio launch', () => {
    const p = serverJson().packages[0];
    expect(p).toMatchObject({ registryType: 'npm', identifier: 'amicus', transport: { type: 'stdio' } });
    expect(p.packageArguments[0]).toMatchObject({ type: 'positional', value: 'mcp' });
  });

  test('server.json description fits the registry 100-char cap (422 on v1.9.0, 2026-07-03)', () => {
    const desc = serverJson().description;
    expect(desc.length).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(desc, 'utf8')).toBeLessThanOrEqual(100);
  });

  test('publish.yml publishes to the MCP registry via OIDC, strictly after npm publish', () => {
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf-8');
    expect(yml).toContain('mcp-publisher login github-oidc');
    expect(yml.indexOf('npm publish')).toBeGreaterThan(-1);
    expect(yml.indexOf('npm publish')).toBeLessThan(yml.indexOf('mcp-publisher publish'));
  });
});

/**
 * v4.4.1 REL-1. The live rail is the only configuration in the repo that spawns
 * several REAL OpenCode servers at once, so in parallel it flakes on fanout-e2e
 * (legs erroring in ~1.2 s under port/process contention — which reads exactly
 * like a dead model alias and is not one). `--runInBand` closes that window; a
 * worker cap would only narrow it, because the contention is over ports and
 * processes rather than CPU.
 *
 * Both halves are pinned because either one alone can silently undo the fix: drop
 * the flag from the script, or inline `npx jest ...` into the workflow so the job
 * stops going through the script that owns the flag.
 */
describe('live integration rail runs serially (v4.4.1 REL-1)', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const LIVE_WF = path2.join(__dirname, '..', '..', '.github', 'workflows', 'integration-live.yml');

  test('test:integration:live carries --runInBand', () => {
    expect(pkg.scripts['test:integration:live']).toContain('--runInBand');
  });

  test('the paid rail is the ONLY script that serializes — the keyless/unit rails stay parallel', () => {
    const serialized = Object.entries(pkg.scripts)
      .filter(([, cmd]) => String(cmd).includes('--runInBand'))
      .map(([name]) => name);
    expect(serialized).toEqual(['test:integration:live']);
  });

  test('integration-live.yml runs the npm script, never a bare jest invocation', () => {
    const yml = fs2.readFileSync(LIVE_WF, 'utf-8');
    expect(yml).toContain('run: npm run test:integration:live');
    // A bare `jest`/`npx jest` run step would bypass the script and drop the flag.
    expect(yml).not.toMatch(/run:\s*(npx\s+)?jest\b/);
  });
});
