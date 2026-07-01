/**
 * Content Preload - OpenCode BrowserView (minimal, no privileged bridge)
 *
 * The OpenCode Web UI is remote-ish content: it should NOT be able to reach the
 * privileged sidecar IPC (fold/open-settings/perform-update/...). This preload
 * therefore exposes NOTHING via contextBridge — it only injects the cosmetic
 * branding CSS. The toolbar window keeps preload.js; the content view uses this.
 *
 * (M9 defense-in-depth: the toolbar and the content view no longer share the
 * bridge-exposing preload.)
 */

/**
 * Inject CSS to hide OpenCode branding and match the window background color to
 * prevent a white flash on load. Cosmetic only — must never throw.
 */
function injectBrandingCss() {
  try {
    const style = document.createElement('style');
    style.textContent = [
      'html, body { background-color: var(--bg, #0a0a0a) !important; }',
      '#root > div > header { display: none !important; }',
      'svg[viewBox="0 0 234 42"] { display: none !important; }',
    ].join('\n');
    document.documentElement.appendChild(style);
  } catch {
    // cosmetic — a failed injection must not break the preload
  }
}

// documentElement is still null while the preload evaluates; defer until the
// DOM exists so the injection cannot null-deref.
if (document.documentElement) {
  injectBrandingCss();
} else {
  document.addEventListener('DOMContentLoaded', injectBrandingCss);
}
