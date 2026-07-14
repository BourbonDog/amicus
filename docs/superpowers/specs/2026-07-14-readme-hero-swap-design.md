# README Hero Image Swap — Design

_Status: drafted 2026-07-14 (brainstormed with user; 2 decisions locked via AskUserQuestion; a
follow-up revision of the same-day README council-art work — see
`2026-07-14-readme-council-art-design.md`). Base: local `main` (`157eeea`, the readme-council-art
work already merged and pushed). Git policy: author on a new branch off `main`; push/merge
deferred to owner._

## 1. Problem & intent

Immediately after shipping the council art into README's "What is Amicus" section, the user
changed their mind: the council picture should be the **first** visible image in the README —
replacing the current hero image (`docs/hero.png`, showing the fork/fold parallel-window demo)
right under the tagline "A multi-model LLM Council for Claude — with a parallel AI window
underneath," not sitting further down as a second image.

## 2. Locked decisions (from brainstorm)

1. **No duplicate.** Remove the council image + its lead-in sentence from "What is Amicus" (added
   in the prior piece of work) — it now lives only at the top as the hero. "What is Amicus" reverts
   to just its existing `what-is-amicus.png` diagram, unchanged otherwise.
2. **`docs/hero.png` / `docs/hero.svg` stay on disk, just unreferenced** — not deleted (fully
   recoverable from git history if ever wanted; no other file in the repo references them, verified
   via grep — only historical plan/spec docs from June 2026 mention them, and `social-card.svg` is
   a separate, unrelated asset).
3. **Tagline text unchanged.** The old hero image visually matched both halves of the tagline
   (Council + parallel window); the council picture only depicts the Council half. Left as-is per
   the user's explicit choice — consistent with the README already calling the Council skill "the
   hero" in its own bullet list.

Out of scope: no new art, no aspect-ratio/composition changes to `docs/council.png` (same file
already rendered and approved in the prior work), no changes to `site/index.html` or any other
README section.

## 3. Implementation plan

Two `README.md` edits, no new asset files:

1. Replace the hero image line:
   `![Amicus: an LLM Council and a parallel AI window for Claude](./docs/hero.png)`
   with a `./docs/council.png` reference and new alt text describing the council ritual (matching
   the alt text already written for it in the prior commit, since the image content is identical).
2. Remove the lead-in sentence + image line added to "What is Amicus" in the prior work
   (`The council skill in one picture...` + the `./docs/council.png` markdown image), restoring
   that section to end at `what-is-amicus.png` exactly as it was before that addition.

## 4. Verification

Read the resulting README top section and "What is Amicus" section back to confirm: exactly one
reference to `docs/council.png` in the whole file (the new hero slot), zero references to
`docs/hero.png` remaining, and "What is Amicus" ending cleanly at `what-is-amicus.png` with no
orphaned sentence fragments from the removed addition.

## 5. Rollout

Author on a new branch off `main`. Do not push or merge without the user's explicit go-ahead.
