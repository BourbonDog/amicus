const { validateTag } = require('../../src/utils/validators');

/**
 * v4.7 F8 (D13): validateTag REJECTS invalid input (unlike sanitizeCouncilName,
 * which cleans) — a stored tag is a user-chosen search key, so silent
 * truncation or charset-stripping would make --search/--group-by tag miss it.
 */
describe('validateTag', () => {
  it('accepts a simple valid tag', () => {
    const r = validateTag('sprint-42');
    expect(r.ok).toBe(true);
    expect(r.tag).toBe('sprint-42');
  });

  it('accepts a 64-char tag (upper boundary)', () => {
    const tag = 'a'.repeat(64);
    const r = validateTag(tag);
    expect(r.ok).toBe(true);
    expect(r.tag).toBe(tag);
  });

  it('rejects a 65-char tag (over the boundary)', () => {
    const r = validateTag('a'.repeat(65));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid --tag/);
  });

  it('rejects an empty string', () => {
    const r = validateTag('');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid --tag/);
  });

  // The valueless-flag shape: a bare `--tag` with no value parses to boolean
  // true (cli.js), never a string. The validator must reject non-strings
  // before running the pattern, or `true` would blow up TAG_PATTERN.test().
  it('rejects boolean true (valueless --tag)', () => {
    const r = validateTag(true);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid --tag/);
  });

  it('rejects a tag containing a space', () => {
    const r = validateTag('bad tag');
    expect(r.ok).toBe(false);
  });

  it('rejects a tag containing a dot', () => {
    const r = validateTag('bad.tag');
    expect(r.ok).toBe(false);
  });

  it('rejects a tag containing an emoji', () => {
    const r = validateTag('tag🎉');
    expect(r.ok).toBe(false);
  });
});
