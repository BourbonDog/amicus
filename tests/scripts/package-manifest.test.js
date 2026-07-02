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

  test('publish.yml publishes to the MCP registry via OIDC, strictly after npm publish', () => {
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf-8');
    expect(yml).toContain('mcp-publisher login github-oidc');
    expect(yml.indexOf('npm publish')).toBeGreaterThan(-1);
    expect(yml.indexOf('npm publish')).toBeLessThan(yml.indexOf('mcp-publisher publish'));
  });
});
