# Amicus Site-Page Redesign — Design Spec

**Date:** 2026-06-24
**Target:** `site/index.html` in [BourbonDog/amicus](https://github.com/BourbonDog/amicus), deployed to https://bourbondog.github.io/amicus/
**Tool:** portable-docs plugin (`/doc --type landing`)
**Status:** Approved direction; pending user spec review → implementation plan

---

## 1. Goal

Redesign the visuals of the Amicus marketing site page to feel more polished and premium, using
the **portable-docs** engine to generate the bulk of the page, while **preserving three bespoke
interactive pieces** the engine can't replicate. This is primarily a visual/structural redesign;
copy is kept with light polish only.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Approach | **Hybrid** — portable-docs restyles the prose/feature sections; custom pieces spliced back |
| Visual direction | **Evolve the dark identity** — keep dark + clay, rebuild structure cleanly |
| Theme / accent | `--type landing --theme dark` with `PD_ACCENT=#D97757` (Claude-clay) |
| Preserved custom pieces | (1) Hero visual, (2) animated Council→Fork→Fold demo (`#demo`), (3) multi-model badge row |
| Composition mechanism | **Post-mount injection** (generate full PD page, re-insert custom sections after React mounts) |
| Copy | **Light polish allowed** — keep messaging/structure; tighten wording where the new layout makes old phrasing awkward; flag non-trivial changes |

## 3. Current state (what we're replacing)

- `site/index.html` (~1,374 lines) — hand-built single-page landing site, dark + clay (`#D97757`).
- Deployed automatically by `.github/workflows/deploy-site.yml` on any push to `main` touching
  `site/**` (uploads `./site` as a Pages artifact). No build step — static files served as-is.
- Companion assets in `site/`: `favicon.svg`, `favicon-32.png`, `favicon-192.png`,
  `apple-touch-icon.png`, `social-card.png`, `social-card-render.html`.
- Brand palette: accent `#D97757`; backgrounds `#111113` / `#161618` / `#222225`; model-brand
  colors used in the model section (`#4285F4` Google, `#10a37f` OpenAI, `#738ADB`, `#4ade80`, `#e25555`).
- Title/positioning: "Amicus — Multi-Model LLM Council for Claude Code & Cowork."
- Interactivity is light: **1 inline `<script>` block**, **2 keyframes** (`pulse-run`, `pulse-results`),
  no `<canvas>`. The animated centerpiece is the `#demo` section.

### Current section order

1. Hero — headline / sub / buttons / **hero visual**  *(preserve)*
2. `#demo` — animated **Council → Fork & Work → Fold** (01/02/03)  *(preserve)*
3. Spawn Subagents — "Claude as orchestrator. Any model as a specialist."
4. Your Claude Context / Claude Code & Cowork / One Command
5. Built for How You Work — use-cases: Fact-Check / Debug / Brainstorm / Fresh Eyes
6. Your Tools Follow You
7. Any Model — model support + **brand-badge row**  *(preserve badges)*
8. Everything You Need — features grid
9. Prerequisites / Built on / Install in 30 Seconds + final CTA

## 4. portable-docs engine constraints (verified)

- `--type landing` exists: `{ baseFormat: 'proposal', theme: 'brand', template: 'landing.md' }`.
  We override theme to `dark`. Lint enforces a landing page has `@header` and at least one `@cta`.
- Output is a **single self-contained HTML file**: React + ReactDOM UMD inlined, JSX precompiled,
  one `<style>` block, content rendered client-side via
  `ReactDOM.createRoot(document.getElementById('root')).render(...)`. **The content DOM does not
  exist in the static HTML** — React builds it at runtime.
- **No raw-HTML passthrough marker** (`@html`/`@embed`/`@raw` do not exist). The only
  `dangerouslySetInnerHTML` is internal (Mermaid). → Custom HTML cannot be embedded via markdown;
  it must be fused by post-processing the generated file.
- `landing` uses the **proposal** base → ships a sticky TOC sidebar + reading-progress bar and a
  centered content column. For a marketing page we **suppress the TOC sidebar** and relax the
  column width so the hero/demo can run full-bleed. (Progress bar: keep — it's unobtrusive. Revisit
  during preview.)
- Markers available: `@header @stat @stats @card @cards @chart @timeline @quote @quotes @cta @terminal @logo`.

## 5. Section mapping (source of each section in the new page)

| Section | Source in new build |
|---|---|
| Hero (headline, sub, CTAs) + **hero visual** | **Preserved custom** — top block |
| Animated **Council → Fork & Work → Fold** (`#demo`) | **Preserved custom** |
| Subagents / Context / Code & Cowork | portable-docs `@cards` + prose |
| Use-cases (Fact-Check / Debug / Brainstorm / Fresh Eyes) | portable-docs `@cards` |
| Your Tools Follow You | portable-docs prose / `@cards` |
| Model support — **brand-badge row** | **Preserved custom** badges; surrounding copy via PD |
| Features grid / "Everything You Need" | portable-docs `@stats` / `@cards` |
| Prerequisites | portable-docs prose / `@cards` |
| Install in 30 Seconds | portable-docs `@terminal` |
| Final CTA | portable-docs `@cta` |

## 6. Architecture — post-mount injection

The deployed `site/index.html` is produced in three steps, yielding **one self-contained file**.

**Step A — Extract custom fragments** (one-time, from the current `index.html`):
- `hero.html` — the hero block (headline/sub/buttons + `.hero-visual`).
- `demo.html` — the `#demo` section markup.
- `badges.html` — the multi-model brand-badge row.
- `custom.css` — the CSS rules backing those three fragments (hero, hero-visual, demo,
  `@keyframes pulse-run`/`pulse-results`, badge styles), namespaced to avoid colliding with
  portable-docs design tokens.
- `demo.js` — the demo's inline script logic.
- `head-assets.html` — favicon `<link>`s, `theme-color`, OG/Twitter meta, social-card reference,
  canonical URL — everything from the current `<head>` that portable-docs won't reproduce.

**Step B — Generate the content page** with portable-docs:
```
PD_ACCENT=#D97757 node engine/scripts/build-doc.js \
  --input amicus-landing.md --type landing --theme dark \
  --out build/amicus-content.html --no-open
```
`amicus-landing.md` contains a minimal `@header` (satisfies lint; hidden/replaced by the custom
hero), the restyled content sections (§5), and a `@cta`.

**Step C — Fuse** (a post-process script, `build/inject.js`):
1. Read `amicus-content.html`.
2. **Head merge** — inject `head-assets.html` into `<head>` (favicons, meta, OG, theme-color),
   override `<title>` to the Amicus title.
3. **Style merge** — append `custom.css` to the page `<style>` block; add the TOC-suppression +
   full-bleed CSS overrides.
4. **Injector script** — append a `<script>` after the app bundle that, once `#root` has rendered
   content (via `MutationObserver` on `#root`, fallback `requestAnimationFrame` poll):
   - removes/hides portable-docs' placeholder `@header` hero,
   - inserts `hero.html` then `demo.html` at the top of the content container,
   - inserts `badges.html` at the model-support section anchor,
   - runs `demo.js` to start the animation.
5. Write the result to `site/index.html`.
6. Run portable-docs `validate` (React inlined, no CDN) + a self-contained check (no external
   asset refs except remote images, if any).

**Implementation note / optimization:** the hero + demo are contiguous at the top. If during build
they can be placed as a **static block before `#root`** (with PD content rendering below), that is
simpler and timing-independent than runtime injection — only the mid-page badge row would then need
anchor injection. The implementation plan may adopt this per-piece; post-mount injection is the
baseline that always works.

## 7. Build & deploy workflow

1. **Clone the fork** locally (no local clone exists yet; only upstream `jrenaldi79/sidecar` is
   checked out): `gh repo clone BourbonDog/amicus C:\Users\sendt\code\amicus`.
2. Create a working branch (e.g. `redesign-site`).
3. Copy this spec into the repo (`docs/` or `site/`-adjacent) and commit, so the design is versioned
   with the code.
4. Author `amicus-landing.md` + the build scripts under a `site/_build/` (or similar) working dir.
5. Generate → fuse → preview:
   - portable-docs `/watch amicus-landing.md` for fast PD-content iteration, **and**
   - the browser **preview tools** against the fused `site/index.html` (snapshot, console, network,
     screenshot) to verify the injected custom sections + animation render correctly.
6. Write final output to `site/index.html`; keep the build inputs in the repo.
7. Commit on the branch; open a PR (or push `main`) — `deploy-site.yml` redeploys to
   bourbondog.github.io/amicus on merge to `main`.
8. The previous hand-built page remains in git history (easy rollback).

## 8. Verification / acceptance

- **Visual:** browser-preview screenshot of the fused page at desktop + mobile widths; dark+clay
  theme intact; hero visual, animated demo (pulse animation runs), and badge row all present and styled.
- **Console/network:** no JS errors; no external network requests (self-contained) beyond any
  intentional remote image.
- **portable-docs `validate`** passes (React/ReactDOM inlined, `createRoot` present).
- **Self-contained:** file opens offline with no sibling files (favicons are the documented exception —
  they live in `site/` and are referenced by relative URL, matching the current site).
- **portable-docs `/doctor`** green (sanity check the engine before/after).
- **Copy diff:** every non-trivial wording change from the current page is listed for review.
- **Deploy dry check:** `deploy-site.yml` unchanged; only `site/**` touched so the existing workflow
  redeploys without modification.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Injection timing (React 18 concurrent render) — custom nodes inserted before content mounts | `MutationObserver` on `#root` + `requestAnimationFrame` fallback; prefer static-pre-`#root` block for top sections |
| Proposal layout (TOC rail + centered column) fights a full-bleed landing hero | Suppress TOC; add full-bleed CSS overrides; validate in preview |
| portable-docs head overwrites favicons/OG/social-card | Explicit head-merge step (§6.C.2) restoring all current `<head>` assets |
| Custom CSS clashes with PD design tokens | Namespace custom selectors; load custom CSS after PD `<style>` |
| Lint requires `@header`/`@cta` but we replace the hero | Include a minimal `@header` for lint compliance; hide/remove it in the injector |

## 10. Out of scope

- No change to the deploy workflow, repo CI, favicons, or social-card image (reused as-is).
- No backend/product changes — site page only.
- No new portable-docs engine features (we use existing markers + a project-local fuse script;
  a future `@embed`/raw-HTML marker in portable-docs could make this hybrid first-class, but that's
  a separate effort).
