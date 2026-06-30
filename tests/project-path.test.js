/**
 * Tests for canonicalProjectPath (src/utils/project-path.js)
 *
 * The canonical form must be STABLE across the incidental ways the same logical
 * directory can be written, so a path used to CREATE a session and a path used
 * to LOOK IT UP / build a route always match:
 *   - slash direction (Windows backslash vs forward slash)
 *   - drive-letter case (C:\ vs c:\)
 *   - trailing slash
 */

const { canonicalProjectPath } = require('../src/utils/project-path');

describe('canonicalProjectPath', () => {
  describe('canonical form', () => {
    it('uses forward slashes, upper-case drive letter, no trailing slash', () => {
      expect(canonicalProjectPath('c:\\Users\\sendt\\code\\amicus\\'))
        .toBe('C:/Users/sendt/code/amicus');
    });
  });

  describe('slash-direction invariance', () => {
    it('canonicalizes backslash and forward-slash forms identically', () => {
      const back = canonicalProjectPath('C:\\Users\\sendt\\code\\amicus');
      const fwd = canonicalProjectPath('C:/Users/sendt/code/amicus');
      expect(back).toBe(fwd);
    });

    it('collapses mixed and duplicate separators', () => {
      const mixed = canonicalProjectPath('C:\\Users/sendt\\\\code//amicus');
      const clean = canonicalProjectPath('C:/Users/sendt/code/amicus');
      expect(mixed).toBe(clean);
    });
  });

  describe('drive-letter-case invariance', () => {
    it('canonicalizes c:\\ and C:\\ identically', () => {
      const lower = canonicalProjectPath('c:\\Users\\sendt\\code\\amicus');
      const upper = canonicalProjectPath('C:\\Users\\sendt\\code\\amicus');
      expect(lower).toBe(upper);
      expect(lower).toBe('C:/Users/sendt/code/amicus');
    });
  });

  describe('trailing-slash invariance', () => {
    it('canonicalizes trailing-slash and no-trailing-slash identically', () => {
      const withSlash = canonicalProjectPath('C:/Users/sendt/code/amicus/');
      const without = canonicalProjectPath('C:/Users/sendt/code/amicus');
      expect(withSlash).toBe(without);
    });

    it('canonicalizes a trailing backslash identically', () => {
      const withBack = canonicalProjectPath('C:\\Users\\sendt\\code\\amicus\\');
      const without = canonicalProjectPath('C:/Users/sendt/code/amicus');
      expect(withBack).toBe(without);
    });
  });

  describe('combined variants all converge', () => {
    it('treats every incidental spelling of one directory as one string', () => {
      const variants = [
        'C:\\Users\\sendt\\code\\amicus',
        'c:\\Users\\sendt\\code\\amicus',
        'C:/Users/sendt/code/amicus',
        'c:/Users/sendt/code/amicus/',
        'C:\\Users/sendt\\code/amicus\\',
        'c:\\Users\\sendt\\code\\amicus\\\\'
      ].map(canonicalProjectPath);
      const unique = new Set(variants);
      expect(unique.size).toBe(1);
      expect([...unique][0]).toBe('C:/Users/sendt/code/amicus');
    });
  });

  describe('edge cases', () => {
    it('returns POSIX paths unchanged (no drive letter)', () => {
      expect(canonicalProjectPath('/home/user/code/amicus'))
        .toBe('/home/user/code/amicus');
    });

    it('strips a trailing slash on a POSIX path', () => {
      expect(canonicalProjectPath('/home/user/code/amicus/'))
        .toBe('/home/user/code/amicus');
    });

    it('preserves the root drive (does not strip its slash)', () => {
      expect(canonicalProjectPath('c:\\')).toBe('C:/');
      expect(canonicalProjectPath('C:/')).toBe('C:/');
    });

    it('preserves POSIX root', () => {
      expect(canonicalProjectPath('/')).toBe('/');
    });

    it('returns falsy input unchanged', () => {
      expect(canonicalProjectPath('')).toBe('');
      expect(canonicalProjectPath(undefined)).toBe(undefined);
      expect(canonicalProjectPath(null)).toBe(null);
    });

    it('is idempotent (canonical of canonical is unchanged)', () => {
      const once = canonicalProjectPath('c:\\Users\\sendt\\code\\amicus\\');
      expect(canonicalProjectPath(once)).toBe(once);
    });
  });
});
