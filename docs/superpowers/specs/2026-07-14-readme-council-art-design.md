# README Council Art — Design

_Status: drafted 2026-07-14 (brainstormed with user; scope + 3 decisions locked via AskUserQuestion,
frozen-frame composition approved after reviewing a rendered preview). Base: local `main`
(`38ee12d`, the round-table-prominence branch already merged and live). Git policy: author on a
new branch off `main`; push/merge deferred to owner._

## 1. Problem & intent

The live site's `#council` round-table SVG (the animated graphic just relocated in the previous
piece of work) is the most distinctive visual Amicus has, but it only exists on the marketing
site. The user wants the same art to also appear in `README.md`'s "What is Amicus" section, so it
reads as strongly there as it does on the site.

The round table's whole composition is built around a 24-second SMIL animation cycling through two
"laps" (different model lineup, different chair) — there is no single instant where everything is
visible at once, and a README image is inherently static. Every existing README image
(`hero.png`, `architecture.png`, `what-is-amicus.png`) already follows a paired-asset convention:
a static, non-animated `.svg` source in `docs/`, rendered to a matching `.png` that's what's
actually embedded in the README.

## 2. Locked decisions (from brainstorm + reviewed preview)

1. **Static, not animated.** Follow the existing docs/ convention: a static `.svg` source +
   rendered `.png`, not a live embed of the animated SVG.
2. **Additive placement.** Add the new image to the "What is Amicus" section as a *second* image,
   after the existing bullet list. `docs/what-is-amicus.png` and its section content are
   untouched — this is not a replacement.
3. **Frozen composition — verified against the source's exact SMIL timing** (not eyeballed): the
   moment equivalent to t = 3.0s in the 24-second loop. At that instant, per the keyTimes/values in
   `site/index.html`'s `#council` block:
   - Table: fully drawn (one-time draw-on animations complete by t≈1.3s).
   - Lap A's 5 review-spoke paths: `stroke-dashoffset` at 0 (fully drawn) and `opacity` at 1 — the
     only window where both are simultaneously true is t ∈ [2.64s, 3.6s].
   - Lap A's 5 seats (Gemini 3 Pro, Llama 4, Grok 4, Claude Opus, GPT-5-as-chair): fully faded in,
     showing **real names** (the anon-1..5 label swap doesn't start until t≈4.02s).
   - The "material under review" document icon: faded in and visible.
   - Caption: "01 · independent review" (the only one of the 3 captions active in this window).
   - Everything else — the anonymous cross-review pentagram, the chair's gold pulses, the verdict
     box, the entire Lap B lineup (DeepSeek/Mistral/Qwen/Gemini-as-chair), the anon-N labels — is
     provably not yet visible at this instant (either `opacity=0` or `stroke-dashoffset=100`), so
     omitting them from the static version reproduces the real animation state, not an invented one.
   - A candidate built from this exact recipe was rendered and reviewed by the user (approved,
     no changes requested) — this is the same content already sitting at `docs/council.svg`.

Out of scope: no changes to `site/index.html` (read-only reference for this work), no changes to
any other README section, no new build tooling beyond what's needed to rasterize one SVG.

## 3. Implementation plan

1. **`docs/council.svg`** — already authored and approved (present on disk, reviewed via a
   rendered preview). Confirm it's committed as part of this work; no content changes needed.
2. **`docs/council.png`** — rasterize `docs/council.svg` to a PNG, matching the pixel dimensions
   used by this repo's other doc images (check `hero.png`/`architecture.png` for the established
   width convention). Font fidelity is the one open technical question: the SVG's
   `font-family="IBM Plex Mono,monospace"` / (Outfit isn't used inside this particular SVG — it's
   all IBM Plex Mono) text relies on that font being resolvable at render time. Try, in order,
   stopping at the first that renders correctly:
   - `sharp` (already a devDependency, used by `scripts/generate-icon.js` for the same
     SVG→PNG job) — accept the system monospace fallback if IBM Plex Mono isn't installed locally,
     since the SVG already declares `,monospace` as a fallback and the design is legible either way.
   - If the fallback looks visibly wrong (mismatched proportions breaking the seat-label layout),
     re-render via an actual browser tab (which loads Google Fonts) once that tooling is working,
     cropped to the SVG's bounding box.
3. **README edit** — in `README.md`'s "What is Amicus" section (currently ends at the
   `what-is-amicus.png` image around line 54), add a second image line immediately after it,
   referencing `./docs/council.png`, with alt text describing what it shows (the council ritual —
   five models reviewing, one chairing).
4. **Verification** — since this is two static asset files plus one README line, verification is:
   confirm the rendered PNG is legible and matches the approved preview's composition, confirm the
   README renders the new image without breaking the existing Markdown/HTML structure around it
   (the section is inside a `<div align="center">`-free plain Markdown area — check nothing needs
   special wrapping to match sibling images' presentation).

## 4. Rollout

Author on a new branch off `main`. Do not push or merge without the user's explicit go-ahead —
same production-deploy consideration as the round-table-prominence work, since `README.md` isn't
part of the deployed site but `docs/council.png`/`docs/council.svg` are still repo files reachable
by the same push.
