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
    expect(pkg.homepage).toBe('https://github.com/BourbonDog/amicus#readme');
    expect(pkg.author).toBe('Christian Wagner');
  });
  test('keywords carry the council positioning', () => {
    for (const k of ['council', 'second-opinion', 'fanout']) {
      expect(pkg.keywords).toContain(k);
    }
  });
});
