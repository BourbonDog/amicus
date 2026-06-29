# Amicus Design-System Adoption — Clay/Gold, Unified

**Status:** Finalized (brainstormed + approved 2026-06-29). Ready for writing-plans.
**Branch:** `design/clay-gold-adoption` (off `main` @ v1.4.0 / `d4660ed`).
**Authors:** Christian Wagner + Claude (superpowers:brainstorming).

## Context

Christian built a complete "Amicus Design System" in Claude Design (claude.ai/design) and
wants the existing product to adopt it. The export is a deliberate **Spectrum** rebrand
(electric violet `#8B5CF6` + lime `#A3E635` on plum-black). A side-by-side review established:

- The **logo geometry, fonts (Outfit + IBM Plex Mono), and headline are identical** to the
  shipped v1.4.0 site; only the **accent palette + neutrals** differ.
- The shipped product brand is the clay→gold **"rail-yard"** identity (v1.4.0, 2026-06-28),
  deliberately Claude-family-adjacent (clay `#d97757` / gold `#e8b24a`).

**Decision (locked):** Adopt the design system's *structure* — its token architecture, refined
component set, and per-surface treatments — but **re-tint** it from Spectrum-violet back to the
shipped **clay→gold** brand, on a **neutral-black** ramp, and **unify** all three product
surfaces (Electron app, council HTML report, marketing site) onto **one shared token layer**.
Today each surface redefines colors independently; there is no shared token source.

**Source material:** `C:\Users\sendt\OneDrive\AIProjects\SecondBrain\designmove\Amicus Design System.zip`
(the Claude Design export). Provides the 5 token CSS files, a JSX component library, a JSX app UI
kit (SetupWizard / SidecarStage / CouncilReport), a site UI kit, foundation specimen cards, and
assets (Outfit + IBM Plex Mono TTFs, logo/favicon/provider SVGs). The kits were *recreated from
the real product source*, so they faithfully mirror the actual surfaces.

## Locked decisions (from brainstorm)

1. **Adopt, don't rebrand** — keep the clay/gold rail-yard brand; the design system is re-tinted to it.
2. **Scope = everything + unify site** — app + council report + site, all on one shared token layer.
3. **Neutral ramp = neutral-black** (`#0a0a0a` family, matching the live site), not the app's
   warm-brown (`#2D2B2A`) nor the kit's plum (`#0C0A14`).
4. **Structure = one spec, one phased plan** (Foundation → App → Report → Site).
5. **Plain-JS preserved** — the Electron UI stays JS-template-string-rendered; the JSX kit is a
   *visual spec*, not dropped in.

## Non-goals

- No React/framework rewrite of the Electron UI.
- No new npm release as part of this work (visual-only; ship later by choice).
- No restyling of the embedded OpenCode web UI (only Amicus-controlled chrome: wizard, toolbar, fold).
- Provider brand colors stay fixed (incl. `--pv-anthropic #D97757`).
- The marketing site's *visual* appearance does not change — only its token source.

## Architecture: the shared token layer

### Source of truth
Introduce a single token source in the repo (Phase 1) holding the re-tinted token set. Two of the
three consumers build CSS in JavaScript (the Electron CSS builder `buildWizardCSS`, and
`src/council/report-html.js`), so the source is surfaced as a small **loader** that emits a
`:root{…}` CSS string (plus the `@font-face` block) for both to inject. The static site mirrors the
same values in its own `:root`, kept honest by a **drift-guard test**.

Proposed location: `src/design/` (re-tinted token `.css` files + a `tokens.js` loader that
concatenates/returns the CSS string). Exact module shape pinned in the plan.

### Re-tint map (exact)

**Brand accent — electric violet → clay:**

| token | from (Spectrum) | to (clay/gold) |
|---|---|---|
| `--violet-500` (accent) | `#8B5CF6` | **`#d97757`** |
| `--violet-400` (light / hover-text) | `#A78BFA` | `#e8a07c` |
| `--violet-600` (pressed / fill-hover) | `#7C3AED` | `#c45c3f` |
| `--violet-soft` | `rgba(139,92,246,.12)` | `rgba(217,119,87,.10)` — match site `--asoft` |
| `--violet-glow` | `rgba(139,92,246,.06)` | `rgba(217,119,87,.05)` — match site `--aglow` |
| `--violet-line` | `rgba(139,92,246,.28)` | `rgba(217,119,87,.28)` (app/diagram-only; site has no equivalent) |

**Counter-accent — lime → gold:**

| token | from | to |
|---|---|---|
| `--lime-400` (accent-2) | `#A3E635` | **`#e8b24a`** |
| `--lime-500` | `#84CC16` | `#d49a2e` |
| `--lime-soft` | `rgba(163,230,53,.12)` | `rgba(232,178,74,.12)` |
| `--lime-line` | `rgba(163,230,53,.28)` | `rgba(232,178,74,.28)` |

**Neutrals — collapse plum (product) + void (marketing) onto ONE neutral-black ramp.** The live
site's `:root` is **canonical** (so Phase 4 stays zero-change); these are its actual values, read
from `site/index.html` @ v1.4.0:

| role | value | source |
|---|---|---|
| `--bg` | `#0a0a0a` | site |
| `--surface-1` (card / input / inset) | `#111113` | site `--s1` |
| `--surface-2` (raised / hover) | `#161618` | site `--s2` |
| `--surface-3` (inset row) | `#1c1c1f` | site `--s3` |
| `--border` | `#222225` | site |
| `--border-strong` (hover / focus) | `#2c2c30` | site `--border2` |
| `--text-1` | `#f5f5f3` | site |
| `--text-2` | `#a1a1a0` | site |
| `--text-3` | `#666` | site |
| `--accent-soft` (selected wash) | `rgba(217,119,87,.10)` | site `--asoft` |
| `--accent-glow` (radial glow) | `rgba(217,119,87,.05)` | site `--aglow` |
| `--surface-sel` (selected row) | `#1e1613` *(provisional)* | app-additive |
| `--text-4` (disabled) | `#3a3a3e` *(provisional)* | app-additive |

> The site defines no "selected row" or "disabled" step; those are added for the app/wizard and do
> not affect the site render. The app's prior warm-brown neutrals (`#2D2B2A` …) are fully replaced
> by this ramp.

**Unchanged (kept from the design system):**
- Status: `--ok #6BBF6B`, `--ok-bright #4ade80`, `--warn #FBBF24`, `--danger #E05252`, `--running #4ade80`.
- Provider brand colors (fixed): anthropic `#D97757`, google `#4285F4`, openai `#10A37F`,
  deepseek `#4D6BFE`, meta `#0081FB`, xai `#ECE9F5`, openrouter `#6566F1`.
- Council tier light-ground palette + ink (confirmed sage / contested wheat / disputed mauve /
  singleton gray, each with its ink color).
- Severity: blocker / major / minor / nit.

> Note: with accent = clay `#d97757` and provider anthropic = `#D97757`, the brand accent and the
> Anthropic chip are now the **same clay**. Intentional — it reinforces the Claude-family identity
> and matches the design system's own note that clay survives as the Anthropic provider color.

**Typography:** adopt Outfit (display/UI) + IBM Plex Mono (mono, eyebrows) and the design system's
type scale. Bundle the webfonts into the Electron app (it currently falls back to system-ui/SF Mono);
the site already loads them.

**Spacing + effects** (radii / borders / shadows / motion / texture): adopt as-is (color-free).

### Drift guard
A test asserts the site `:root` values and the shared token source agree for the clay/gold/neutral
set, so the "unify" can't silently rot. Mechanism pinned in the plan.

## Phases (units)

### Phase 1 — Token foundation
- Port the 5 token files into `src/design/`, re-tinted per the map; add `@font-face` and bundle the
  Outfit / IBM Plex Mono TTFs (from the export's `assets/fonts/`).
- Add the loader that the app + report inject.
- Add the drift-guard test.
- **Verify:** unit tests on the loader output (contains clay/gold, no violet/lime/plum); fonts resolve.
- **Files:** new `src/design/*`, font assets; no surface changes yet.

### Phase 2 — Electron app
- Rewrite `electron/setup-ui-styles.js` (`buildWizardCSS`), `electron/toolbar.js`, `electron/fold.js`
  from hardcoded hex onto the token CSS (injected via the loader).
- Adopt the kit's component treatments (stepper, provider rows, ModelCard, RoutePill, StatusDot,
  TierBadge, Badge, WindowFrame chrome) — translated from the JSX kit into the existing plain-JS HTML
  builders, matching the markup/structure the kit defines.
- Wire the bundled webfonts into the Electron window(s).
- **Verify:** existing setup-ui / toolbar / fold tests stay green (update color/text assertions as
  needed); live CDP check of the wizard (all 4 steps + free-council + alias editor), toolbar, fold overlay.
- **Files:** `electron/setup-ui-styles.js`, `setup-ui*.js`, `toolbar.js`, `fold.js`, font wiring in `main.js`.

### Phase 3 — Council report
- Re-tint `src/council/report-html.js`: replace the inline `<style>` palette + `TIER_COLOR` with the
  shared light-ground tier palette + ink, and switch type to Outfit / Plex. Stays light-mode (white ground).
- **Verify:** report unit/golden tests updated; headless render of the WS-3 av-receiver golden
  `verdict.json` → visual check of tiers + legibility.
- **Files:** `src/council/report-html.js`.

### Phase 4 — Site
- Repoint `site/index.html`'s `:root` at the shared token values (clay/gold/neutral-black) — which
  already equal the live values, so **zero visual change**; the win is single-source-of-truth + the
  drift guard now binds.
- **Verify:** headless render diff against the live v1.4.0 page (pixel-equivalent); drift-guard passes.
- **Files:** `site/index.html`.

## Testing & verification
- Full jest suite + `lint` + `check:secrets` + `check:sizes` + `generate-docs:check` green before merge.
- Electron: CDP instrumentation (project's established GUI-test recipe) for wizard / toolbar / fold.
- Report + site: headless Chrome render (project's SVG/PNG render recipe) — not preview-screenshots
  or ImageMagick (both flaky on this machine).
- The drift-guard test is the standing regression for token unity.

## Logistics
- Built in a git worktree off `main` (hooks fire per `setup-hooks.js`); branch `design/clay-gold-adoption`.
- Subagent-driven execution per task (two-stage review), final whole-branch review, then PR to
  BourbonDog/amicus (`gh ... --repo BourbonDog/amicus`).
- No version bump. `site/**` landing on `main` auto-fires `deploy-site.yml`, so the site phase will
  redeploy on merge (identical pixels).

## Risks / open questions
- **Font-bundle size:** bundling Outfit + IBM Plex Mono TTFs grows the Electron package; acceptable
  (the site already ships them). Could subset later.
- **Report tier legibility:** the light-ground tier colors must keep WCAG-AA ink contrast; the design
  system specifies the ink colors — verify on render.
- **Accent / Anthropic clay collision:** intentional; flag only if it confuses council diagrams where
  an Anthropic chip sits beside accent UI.
- **Site drift-guard mechanism:** exact comparison approach pinned in the plan.

## Acceptance criteria
1. A single shared token source defines clay/gold + neutral-black; no surface redefines them independently.
2. The Electron wizard, toolbar, and fold render on the tokens, with the kit's components and the
   bundled webfonts (CDP-verified).
3. The council HTML report renders on the refined light-ground tier palette (golden-render-verified, legible).
4. `site/index.html` consumes the shared tokens with zero visual change (render-diff-verified) and the
   drift guard binds.
5. Full suite + all gates green; whole-branch review clean.
