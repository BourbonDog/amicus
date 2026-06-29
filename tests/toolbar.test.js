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

describe('toolbar token adoption', () => {
  const { TOKENS } = require('../src/design/tokens');

  it('injects the shared token CSS (:root with clay accent)', () => {
    const html = buildToolbarHTML({ mode: 'sidecar' });
    expect(html).toContain(':root');
    expect(html).toContain(TOKENS.accent); // #d97757
  });

  it('injects ABSOLUTE file:// font URLs so the bundled fonts resolve (data: URL context)', () => {
    const html = buildToolbarHTML({ mode: 'sidecar' });
    expect(html).toMatch(/url\('file:\/\/[^']*Outfit-400\.ttf'\)/);
    expect(html).not.toContain("url('./fonts/");
  });

  it('drops the old warm-brown neutrals', () => {
    const html = buildToolbarHTML({ mode: 'sidecar' });
    expect(html).not.toContain('#2D2B2A');
    expect(html).not.toContain('#3D3A38');
    expect(html).not.toContain('#A09B96');
    expect(html).not.toContain('#7A756F');
    expect(html).not.toContain('#4D4A48');
    expect(html).not.toContain('#D4D0CC');
  });

  it('styles chrome from token vars, not literal clay hex in CSS rules', () => {
    const html = buildToolbarHTML({ mode: 'sidecar' });
    expect(html).toContain('background: var(--surface-1)');
    expect(html).toContain('border-top: 1px solid var(--border)');
    expect(html).toContain('color: var(--accent)');
    expect(html).toContain('font-family: var(--font-mono)');
  });

  it('drives the logo stroke from a CSS rule, hex-free markup (BLOCKER FIX #3)', () => {
    const html = buildToolbarHTML({ mode: 'sidecar' });
    expect(html).toMatch(/\.logo path\s*\{[^}]*stroke:\s*var\(--accent\)/);
    expect(html).not.toContain('stroke="#D97757"');
    expect(html).not.toContain('stroke="var(--accent)"');
  });

  it('keeps the brand + task id + Fold button markup', () => {
    const html = buildToolbarHTML({ mode: 'sidecar', taskId: '01J9F2K3', foldShortcut: 'Cmd+Shift+F' });
    expect(html).toContain('>Amicus<');
    expect(html).toContain('task: 01J9F2K3');
    expect(html).toContain('Fold (Cmd+Shift+F)');
  });
});
