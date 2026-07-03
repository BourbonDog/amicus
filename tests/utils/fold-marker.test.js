'use strict';

const {
  FOLD_MARKER_PREFIX,
  generateFoldNonce,
  buildFoldMarker,
  trailingFoldMarkerRegex,
  extractNonceFromText,
} = require('../../src/utils/fold-marker');

describe('fold-marker utility (15b.3 — per-run nonce)', () => {
  describe('generateFoldNonce', () => {
    it('generates 16 lowercase hex chars', () => {
      const nonce = generateFoldNonce();
      expect(nonce).toMatch(/^[0-9a-f]{16}$/);
    });

    it('generates unique nonces across calls', () => {
      const nonces = new Set(Array.from({ length: 50 }, () => generateFoldNonce()));
      expect(nonces.size).toBe(50);
    });
  });

  describe('buildFoldMarker', () => {
    it('builds [SIDECAR_FOLD:<nonce>]', () => {
      expect(buildFoldMarker('abc123')).toBe('[SIDECAR_FOLD:abc123]');
    });

    it('contains the legacy prefix as a substring (grep-ability preserved)', () => {
      expect(buildFoldMarker('deadbeef')).toContain(FOLD_MARKER_PREFIX);
      expect(buildFoldMarker('deadbeef')).toContain('[SIDECAR_FOLD');
    });

    it('does NOT equal the bare legacy marker for any nonce', () => {
      expect(buildFoldMarker('deadbeef')).not.toBe('[SIDECAR_FOLD]');
    });
  });

  describe('trailingFoldMarkerRegex', () => {
    it('matches the marker as the final non-empty line', () => {
      const re = trailingFoldMarkerRegex('n0nce');
      expect(re.test('done\n[SIDECAR_FOLD:n0nce]')).toBe(true);
      expect(re.test('done\n[SIDECAR_FOLD:n0nce]\n\n')).toBe(true);
    });

    it('does NOT match a different nonce', () => {
      const re = trailingFoldMarkerRegex('correct-nonce');
      expect(re.test('done\n[SIDECAR_FOLD:wrong-nonce]')).toBe(false);
    });

    it('does NOT match the bare legacy marker', () => {
      const re = trailingFoldMarkerRegex('n0nce');
      expect(re.test('done\n[SIDECAR_FOLD]')).toBe(false);
    });

    it('does NOT match when followed by more content', () => {
      const re = trailingFoldMarkerRegex('n0nce');
      expect(re.test('[SIDECAR_FOLD:n0nce]\nmore work')).toBe(false);
    });

    it('escapes regex-special characters in the nonce', () => {
      const re = trailingFoldMarkerRegex('a.b*c');
      expect(re.test('done\n[SIDECAR_FOLD:a.b*c]')).toBe(true);
      expect(re.test('done\n[SIDECAR_FOLDXaXbXc]')).toBe(false);
    });
  });

  describe('extractNonceFromText', () => {
    it('extracts the nonce from prompt text carrying the marker instruction', () => {
      const text = 'When done, output your summary followed by [SIDECAR_FOLD:cafef00d12345678]';
      expect(extractNonceFromText(text)).toBe('cafef00d12345678');
    });

    it('returns null when no marker is present', () => {
      expect(extractNonceFromText('no marker here')).toBeNull();
    });

    it('returns null for empty/absent input', () => {
      expect(extractNonceFromText('')).toBeNull();
      expect(extractNonceFromText(null)).toBeNull();
      expect(extractNonceFromText(undefined)).toBeNull();
    });

    it('returns null for the bare legacy marker (no nonce to extract)', () => {
      expect(extractNonceFromText('ends with [SIDECAR_FOLD]')).toBeNull();
    });
  });
});
