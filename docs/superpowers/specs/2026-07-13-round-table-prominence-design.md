# Round-Table Section Prominence — Design

_Status: drafted 2026-07-13 (brainstormed with user; scope + 3 decisions locked via AskUserQuestion).
Base: local `main` (site `index.html` last touched by `223468e` "docs(site): add animated
council round-table section"). Git policy: author on a new feature branch off `main`; push/merge
deferred to owner. Note: the stale `redesign-site` branch (last commit 2026-06-25) predates the
round-table feature entirely and is unrelated to this change — not used as a base._

## 1. Problem & intent

`site/index.html` (deployed to https://bourbondog.github.io/amicus/ via `deploy-site.yml` on push
to `main`) buries its best visual — the animated council round-table SVG (`#council` section,
"Any Models. Any Chair. One Round Table.") — as the 4th section on the page, after the hero, the
Quick Start install block, and the "How It Works" 3-card explainer. A visitor has to scroll past
two full sections before seeing it.

Intent: reorganize the page so the round-table graphic is one of the first things a visitor sees,
and give it enough visual weight to read as the page's centerpiece rather than a mid-page aside.

## 2. Locked decisions (from brainstorm)

1. **Both position and size change** — not just a reorder, not just a resize.
2. **New section order:** `Hero → Round Table (#council) → Quick Start (#demo) → How It Works
   (#how) → Spawn Subagents (#swarm) → …` (everything from `#swarm` onward is untouched).
3. **Enlarge via full-width restructure**, not just widening the existing grid column: the
   `#council` section's internal layout changes from a 50/50 `.swarm-wrap` grid (SVG | text) to a
   stacked layout — centered header (tag/h2/lead, unchanged copy) on top, the SVG widened to the
   page's full content width (`--mw: 1200px`, same cap every other section uses — no true
   edge-to-edge/full-bleed elsewhere on this page, so this stays consistent with the existing
   design system), then the description text + 5 feature bullets in a centered block below it,
   capped at a comfortable reading width.

Out of scope / explicitly not changing:
- No copy changes anywhere (headline, lead paragraph, description, feature bullets all identical).
- No changes to the SVG markup or its animations — it's vector, so widening its container scales
  it up for free, no redrawing needed.
- The compact "01 · Council" mini-diagram inside the `#how` section's 3-card grid stays as-is —
  it's a quick mechanism recap (Council/Fork/Fold in 3 steps), not a duplicate of the full
  show-piece, and now serves as a nice "here's the mechanism" follow-up after the full graphic.
- No change to `#swarm`, `#context`, `#works-with`, or any section from `#swarm` onward.

## 3. Implementation plan

All changes are confined to `site/index.html` (a single static file, no build step — this repo's
site is hand-authored HTML, not generated; `site-src/build/` is leftover from the unrelated,
stale `redesign-site` experiment and is not touched).

1. **Move the HTML block.** Cut the entire section from `<!-- COUNCIL ROUND TABLE -->` through its
   closing `</section>` (currently between `#how` and `#swarm`, includes the section's own
   `<hr class="sep">` before and after) and paste it immediately after the hero's closing markup,
   before `<!-- QUICK START -->`. Verify the `hr.sep` dividers still bracket it correctly in the
   new position (one between hero and council, one between council and quick start) so the visual
   rhythm matches the rest of the page.
2. **Restructure the section's internals.** Replace the `.swarm-wrap` (2-col grid: `.council-svg`
   div | `.swarm-desc` div) with a single-column stack:
   - Header block (`.tag`, `h2`, `.lead`) stays exactly as-is — already centered/full-width above
     the grid today, no change needed there.
   - `.council-svg` container's width goes from ~50% (grid column) to full `.w` width (1200px
     cap). Likely needs a small new CSS rule (e.g. remove it from the grid, give it
     `max-width:100%` in its new full-width slot) — reuse the existing `.council-svg` class for
     the border/background/shadow treatment, just change what contains it.
   - `.swarm-desc` (h3 + 2 paragraphs + `.swarm-feats`) moves below the graphic, centered, capped
     at a reading-friendly max-width (e.g. ~700-800px) so the prose doesn't stretch full width.
3. **Responsive check.** Confirm the existing `@media(max-width:960px)` rule (which currently
   collapses `.swarm-wrap` to a single column) doesn't need to do anything special anymore — the
   new layout is already single-column-friendly by design — and that the SVG still scales
   sensibly on mobile widths (it's `width:100%;height:auto`, so it should).
4. **Visual verification.** Load `site/index.html` locally in the browser preview, screenshot the
   new hero→round-table→quick-start flow, and confirm the SVG animations (round-table draw-on,
   review-spoke pulses, chair rotation) still fire correctly in the new spot — they're pure CSS/SMIL
   animations tied to the SVG itself, so relocation shouldn't affect them, but worth confirming.

## 4. Testing / verification

No automated tests cover static marketing HTML in this repo. Verification is visual:
- Screenshot the reorganized page (hero → round table → quick start → how it works) at desktop
  width and confirm the round table reads as the dominant visual immediately after the hero.
- Screenshot at a mobile width (~390px) to confirm the full-width graphic and stacked text don't
  break responsively.
- Spot-check that no other section's content, ids, or anchors (`#council` is referenced by nothing
  else on the page — confirmed via grep) were disturbed by the move.

## 5. Rollout

Author the change on a new branch off `main` (not `redesign-site`). Do not push or merge without
the user's explicit go-ahead — `deploy-site.yml` publishes to the live site on any push to `main`
that touches `site/**`, so a merge to `main` is effectively a production deploy.
