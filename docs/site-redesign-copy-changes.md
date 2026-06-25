# Site Redesign — Copy Change Log

This redesign rebuilt `site/index.html` with portable-docs while preserving three
custom interactive pieces. This log records every **non-trivial copy change** relative
to the previous hand-built page. Per the spec, this was a visual/structural redesign
with **light copy polish only**.

## Preserved verbatim (no copy change)

The following were extracted from the original page and re-injected unchanged — their
copy is identical to the previous site:

- **Hero** — headline, subhead, CTAs.
- **Animated demo** — the "Council. Or Fork. You Choose the Depth." steps
  (01 · Council / 02 · Fork & Work / 03 · Fold) and the Orchestrator swarm diagram.
- **Model badge row** — provider names/brand badges.

## Portable-docs content sections (light polish)

These sections were re-authored as portable-docs components, porting the original copy
with light polish where the new component layout required it:

1. **§3 "Your Tools Follow You"** — the original was a full-width vignette with no
   standalone copy block. Added three feature cards (Auto-Discovery, Full Tool Access,
   Zero Extra Setup) so the section reads as coherent numbered content. Prose lightly
   expanded from the original `vig-body` paragraph. *No claims changed.*

2. **§4 "Any Model"** — the original model-provider grid (brand SVGs) can't be expressed
   as a portable-docs marker, so the provider roster is now a plain-text sentence plus
   two feature cards (Direct API Keys / OpenRouter) mapped directly from the original
   `.api-note` cells. The live badge row is injected here at build time. *No claims changed.*

3. **§5 "Everything You Need"** — added a `@stats` block synthesized from the page's
   existing feature copy. The four stats (model calls per council, models via OpenRouter,
   extra config needed, skills auto-installed) are factual per the current page.
   - **Minor copy nit:** the "model calls per council" stat renders **`5–8`**; the source
     page text reads **`~5–8`** (tilde dropped). Cosmetic; flag for a follow-up if exact
     fidelity is wanted.

4. **§6 "Prerequisites & What It Costs"** — collapsed the original 2-cell grid into two
   feature cards. Wording is a faithful condensation; *no substance changed.*

5. **Section numbering** — sections are numbered 1–7 (portable-docs landing/proposal
   format requires `## N.` prefixes); "Install in 30 Seconds" became its own numbered
   section. Structural only.

## Lint / build

- `lint.js`: 0 errors, 0 warnings.
- All card icons drawn from the validated icon set (no `unknown-icon` warnings).
- A minimal `@header` exists only to satisfy the landing lint; it is removed at build time
  and replaced by the injected custom hero (no user-visible copy).
