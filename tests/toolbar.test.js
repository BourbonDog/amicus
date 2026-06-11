/**
 * Tests for electron/toolbar.js
 *
 * Verifies dynamic branding based on client type.
 */

const { buildToolbarHTML, TOOLBAR_H, getBrandName } = require('../electron/toolbar');

describe('toolbar', () => {
  describe('getBrandName', () => {
    it('should return "Amicus" for code-local client', () => {
      expect(getBrandName('code-local')).toBe('Amicus');
    });

    it('should return "Amicus" for code-web client', () => {
      expect(getBrandName('code-web')).toBe('Amicus');
    });

    it('should return "Amicus" for cowork client too', () => {
      expect(getBrandName('cowork')).toBe('Amicus');
    });

    it('should default to "Amicus" when no client specified', () => {
      expect(getBrandName()).toBe('Amicus');
      expect(getBrandName(undefined)).toBe('Amicus');
    });
  });

  describe('buildToolbarHTML', () => {
    it('should show "Amicus" by default', () => {
      const html = buildToolbarHTML({ mode: 'sidecar' });
      expect(html).toContain('Amicus');
      expect(html).not.toContain('Openwork Amicus');
    });

    it('should show plain "Amicus" for cowork client', () => {
      const html = buildToolbarHTML({ mode: 'sidecar', client: 'cowork' });
      expect(html).toContain('>Amicus<');
      expect(html).not.toContain('Openwork');
    });

    it('should show "Amicus" for code-local client', () => {
      const html = buildToolbarHTML({ mode: 'sidecar', client: 'code-local' });
      expect(html).toContain('Amicus');
    });

    it('should show correct branding in setup mode for cowork', () => {
      const html = buildToolbarHTML({ mode: 'setup', client: 'cowork' });
      expect(html).toContain('>Amicus<');
      expect(html).not.toContain('Openwork');
    });

    it('should show correct branding in setup mode for code-local', () => {
      const html = buildToolbarHTML({ mode: 'setup', client: 'code-local' });
      expect(html).toContain('Amicus');
    });
  });

  describe('TOOLBAR_H', () => {
    it('should be 40', () => {
      expect(TOOLBAR_H).toBe(40);
    });
  });
});
