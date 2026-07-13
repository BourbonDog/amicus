# Round-Table Section Prominence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the animated `#council` round-table section in `site/index.html` from the 4th
position on the page to right after the hero, and restructure it from a 50/50 text+graphic grid
to a full-width stack, so it reads as the page's visual centerpiece.

**Architecture:** Single static HTML file (`site/index.html`, no build step). A one-off Node
script performs the exact block relocation via marker-comment string splitting (safer than
transcribing ~390 lines of animated SVG by hand); two small CSS rules restructure the section's
internal layout, scoped to `#council` so the `#swarm` section (which shares the `.swarm-wrap` /
`.swarm-desc` classes) is unaffected. No JS behavior, no copy, and no SVG markup changes.

**Tech Stack:** Plain HTML/CSS, inline SVG (SMIL animations), Node.js (one-off migration script
only, not a runtime dependency), Python `http.server` for local preview (existing
`.claude/launch.json` config `amicus-site`, port 8199).

## Global Constraints

- No copy changes anywhere (headline, lead paragraph, description, feature bullets identical).
- No changes to the SVG markup or its animations.
- Section order becomes: `Hero → #council → #demo (Quick Start) → #how (How It Works) → #swarm →
  …` — everything from `#swarm` onward is untouched.
- The `#how` section's compact "01 · Council" mini-diagram is untouched.
- `.swarm-wrap` / `.swarm-desc` / `.swarm-feats` are shared with `#swarm` (Spawn Subagents) further
  down the page — any layout override for `#council` MUST be scoped with an `#council` prefix, never
  applied to the bare class, or it will also break the `#swarm` section's still-current 50/50 layout.
- Work happens on the `site/round-table-prominence` branch (already created off `main`). Do not
  push or merge — `deploy-site.yml` deploys to production on any push to `main` touching `site/**`.

---

### Task 1: Relocate the `#council` section to right after the hero

**Files:**
- Modify: `site/index.html` (via a one-off script, not hand-edited — the block is ~390 lines of
  animated SVG that must move verbatim, byte-for-byte)
- Create (temporary): `scripts/_migrate-council-section.js` — delete it in the last step of this
  task once the migration is confirmed correct

**Interfaces:**
- Consumes: the three existing HTML comment markers already in `site/index.html` —
  `<!-- COUNCIL ROUND TABLE -->`, `<!-- SWARM / PARALLEL SUBAGENTS -->`, `<!-- QUICK START -->` —
  each occurs exactly once in the file today (verified via grep during design).
- Produces: `site/index.html` with the `#council` section (plus its own trailing
  `<hr class="sep">`, which becomes the separator between it and Quick Start) moved to
  immediately before `<!-- QUICK START -->`, with a fresh `<hr class="sep">` prepended to
  separate it from the hero. Exactly one `<hr class="sep">` remains between `#how` and `#swarm`
  at the old location. Task 2 consumes this reordered file.

- [ ] **Step 1: Confirm the anchor markers are still unique and in the expected order**

Run each of these three commands separately:

```bash
grep -c '<!-- COUNCIL ROUND TABLE -->' "C:\Users\sendt\code\amicus\site\index.html"
grep -c '<!-- SWARM / PARALLEL SUBAGENTS -->' "C:\Users\sendt\code\amicus\site\index.html"
grep -c '<!-- QUICK START -->' "C:\Users\sendt\code\amicus\site\index.html"
```

Expected: each command prints `1` (each marker occurs exactly once). If any count is not `1`,
stop and re-investigate before proceeding — the script below assumes uniqueness.

- [ ] **Step 2: Write the migration script**

Create `C:\Users\sendt\code\amicus\scripts\_migrate-council-section.js`:

```js
// One-off migration script — moves the #council section to right after the
// hero. Delete this file after running it and confirming the result.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'site', 'index.html');
let html = fs.readFileSync(file, 'utf8');

const COUNCIL_START = '<!-- COUNCIL ROUND TABLE -->';
const SWARM_MARKER = '<!-- SWARM / PARALLEL SUBAGENTS -->';
const QUICK_START_MARKER = '<!-- QUICK START -->';

const councilStartIdx = html.indexOf(COUNCIL_START);
const swarmIdx = html.indexOf(SWARM_MARKER);
const quickStartIdx = html.indexOf(QUICK_START_MARKER);

if (councilStartIdx === -1 || swarmIdx === -1 || quickStartIdx === -1) {
  throw new Error('One or more anchor markers not found — aborting.');
}
if (!(quickStartIdx < councilStartIdx && councilStartIdx < swarmIdx)) {
  throw new Error('Anchors are not in the expected order — aborting.');
}
if (html.indexOf(COUNCIL_START, councilStartIdx + 1) !== -1) {
  throw new Error('COUNCIL_START marker is not unique — aborting.');
}
if (html.indexOf(SWARM_MARKER, swarmIdx + 1) !== -1) {
  throw new Error('SWARM_MARKER marker is not unique — aborting.');
}
if (html.indexOf(QUICK_START_MARKER, quickStartIdx + 1) !== -1) {
  throw new Error('QUICK_START_MARKER marker is not unique — aborting.');
}

// The block to move: from COUNCIL_START through (not including) SWARM_MARKER.
// This includes the section's own trailing <hr class="sep"> — that hr becomes
// the separator between #council and Quick Start at the new location.
const councilBlock = html.slice(councilStartIdx, swarmIdx);

// Remove the block from its old position. The <hr class="sep"> that
// currently precedes COUNCIL_START stays where it is, becoming the sole
// separator between #how and #swarm.
const withoutCouncil = html.slice(0, councilStartIdx) + html.slice(swarmIdx);

// Re-locate Quick Start in the trimmed string (its index shifted).
const newQuickStartIdx = withoutCouncil.indexOf(QUICK_START_MARKER);
if (newQuickStartIdx === -1) {
  throw new Error('Quick Start marker lost after removal — aborting.');
}

// Insert the block right before Quick Start, with a fresh <hr class="sep">
// separating it from the hero above.
const insertion = '<hr class="sep">\n\n' + councilBlock;
const result =
  withoutCouncil.slice(0, newQuickStartIdx) +
  insertion +
  withoutCouncil.slice(newQuickStartIdx);

fs.writeFileSync(file, result, 'utf8');
console.log(
  `Moved #council section: ${councilBlock.length} chars relocated. ` +
  `New file length: ${result.length} (was ${html.length}).`
);
```

- [ ] **Step 3: Run the migration script**

Run: `cd "C:\Users\sendt\code\amicus" && node scripts/_migrate-council-section.js`

Expected: a single line like `Moved #council section: 14XXX chars relocated. New file length:
407XXX (was 407XXX).` — the new length must equal the old length plus exactly 18 (the length of
the inserted `'<hr class="sep">\n\n'` string — the moved block carries its own trailing hr with
it, so nothing else is added or removed). If the printed lengths don't differ by exactly 18, or
the script throws, stop and re-investigate; do not proceed to Step 4.

- [ ] **Step 4: Verify the new section order**

Run: `grep -n '<section id="council">\|<section class="demo-section" id="demo">\|<section id="how">\|<section id="swarm"' "C:\Users\sendt\code\amicus\site\index.html"`

Expected: four matches, in this order top-to-bottom: `id="council"`, `id="demo"`, `id="how"`,
`id="swarm"` (line numbers ascending in that order). If the order is different, the script logic
has a bug — do not proceed; re-check the script against this expected output.

- [ ] **Step 5: Verify exactly one `<hr class="sep">` sits between `#how` and `#swarm`, and one
      each side of the relocated `#council`**

Run: `grep -n 'class="sep"\|<section id=\|<section class="demo-section"' "C:\Users\sendt\code\amicus\site\index.html"`

Expected: reading the output top to bottom, the pattern around the hero/council/demo/how/swarm
region is: `hr` → `section id="council"` → `hr` → `section id="demo"` → … → `section id="how"` →
`hr` → `section id="swarm"`. No two `hr` lines appear back-to-back anywhere in this region.

- [ ] **Step 6: Delete the temporary migration script**

Run: `cd "C:\Users\sendt\code\amicus" && rm scripts/_migrate-council-section.js`

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\sendt\code\amicus"
git add site/index.html
git commit -m "feat(site): move #council round-table section to right after hero"
```

---

### Task 2: Restructure `#council` from a 50/50 grid to a full-width stack

**Files:**
- Modify: `site/index.html` — the `<style>` block only (two edits: one modified rule, one new
  pair of rules), around what was originally lines 194-197 (`/* COUNCIL ROUND TABLE */` block;
  exact line numbers shifted after Task 1's insertion earlier in the file, so match by content,
  not line number)

**Interfaces:**
- Consumes: the reordered `site/index.html` produced by Task 1. The `#council` section's inner
  HTML structure (the `.swarm-wrap` div containing `.council-svg` and `.swarm-desc`) is
  unchanged by this task — only the CSS controlling it changes.
- Produces: `#council`'s `.swarm-wrap` renders as a single full-width column instead of a 2-col
  grid. Task 3 (visual verification) consumes this.

- [ ] **Step 1: Locate the current CSS block**

Run: `grep -n '/\* COUNCIL ROUND TABLE \*/' -A3 "C:\Users\sendt\code\amicus\site\index.html"`

Expected output (padding value may already show the pre-edit value below — confirm it matches
before editing):

```
.council-svg{border:1px solid var(--border);border-radius:14px;background:var(--s1);padding:1.5rem 1rem .9rem;box-shadow:0 30px 80px -30px rgba(0,0,0,.7),0 0 60px -18px rgba(217,119,87,.12)}
.council-svg svg{width:100%;height:auto;display:block}
```

- [ ] **Step 2: Widen the `.council-svg` padding for its new full-width context**

Using the Edit tool on `site/index.html`, replace:

```
.council-svg{border:1px solid var(--border);border-radius:14px;background:var(--s1);padding:1.5rem 1rem .9rem;box-shadow:0 30px 80px -30px rgba(0,0,0,.7),0 0 60px -18px rgba(217,119,87,.12)}
```

with:

```
.council-svg{border:1px solid var(--border);border-radius:14px;background:var(--s1);padding:2rem 2.5rem 1.6rem;box-shadow:0 30px 80px -30px rgba(0,0,0,.7),0 0 60px -18px rgba(217,119,87,.12)}
```

(Only the `padding` value changes: `1.5rem 1rem .9rem` → `2rem 2.5rem 1.6rem`.)

- [ ] **Step 3: Add the `#council`-scoped layout override**

Using the Edit tool on `site/index.html`, replace:

```
.council-svg svg{width:100%;height:auto;display:block}
```

with:

```
.council-svg svg{width:100%;height:auto;display:block}
#council .swarm-wrap{grid-template-columns:1fr;gap:2.5rem;margin-top:3.5rem}
#council .swarm-desc{max-width:760px;margin:0 auto}
```

This must be scoped with the `#council` prefix — the bare `.swarm-wrap` / `.swarm-desc` classes
are also used by `#swarm` (Spawn Subagents) further down the page, which must keep its current
50/50 grid layout unchanged.

- [ ] **Step 4: Verify the CSS edits landed correctly and didn't touch `#swarm`**

Run: `grep -n '#council \.swarm-wrap\|#council \.swarm-desc\|padding:2rem 2.5rem 1.6rem' "C:\Users\sendt\code\amicus\site\index.html"`

Expected: three matches, one per pattern, all within the `<style>` block (line numbers well
under 300 — the `<style>` block is near the top of the file).

Run: `grep -n '\.swarm-wrap{display:grid;grid-template-columns:1fr 1fr' "C:\Users\sendt\code\amicus\site\index.html"`

Expected: one match — the original base `.swarm-wrap` rule (still `1fr 1fr`, still governing
`#swarm`) must be unchanged.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\sendt\code\amicus"
git add site/index.html
git commit -m "style(site): full-width stack layout for #council section"
```

---

### Task 3: Visual verification

**Files:** none (no code changes expected unless verification surfaces a problem, in which case
loop back to Task 1 or 2's edits before re-running this task)

**Interfaces:**
- Consumes: the fully migrated `site/index.html` from Tasks 1-2.
- Produces: confirmation the page is correct, or a concrete list of follow-up fixes.

- [ ] **Step 1: Start the local static server**

Use the `mcp__Claude_Browser__preview_start` tool with `{"name": "amicus-site"}` (existing
`.claude/launch.json` config: `python -m http.server 8199 --directory site`).

Expected: a `tabId` and `serverId` are returned; the Browser pane opens.

- [ ] **Step 2: Load the page and confirm section order visually**

Navigate the returned tab to `http://localhost:8199/`. Take a screenshot. Confirm: hero at top,
then the "Any Models. Any Chair. One Round Table." heading and the round-table SVG appear as the
very next section (no Quick Start install block or "How It Works" cards in between), and the SVG
now spans close to the full content width rather than half of it.

- [ ] **Step 3: Confirm the SVG animations still fire in the new position**

Wait ~2 seconds after page load, take a second screenshot of the round-table section. Confirm the
table outline, review-spoke lines, and phase caption text ("01 · independent review", etc.) are
visibly drawn/animated compared to the first screenshot — i.e., the SMIL `<animate>` elements are
still running (relocation via string splice shouldn't affect this, since the SVG markup itself
was not touched, but confirm rather than assume).

- [ ] **Step 4: Confirm Quick Start and How It Works still work, just later**

Scroll down and screenshot the Quick Start install block and the "How It Works" 3-card section
(including its still-present "01 · Council" mini-diagram). Confirm both render normally and
their content is unchanged from before the move.

- [ ] **Step 5: Confirm nothing below `#swarm` moved or broke**

Use `mcp__Claude_Browser__get_page_text` on the full page and confirm all section headings from
"Spawn Subagents. Claude Orchestrates." onward still appear in their original relative order
(Context → Works With → Cases → Models → Features → Prerequisites → Built On → final install
CTA).

- [ ] **Step 6: Mobile-width check**

Use `mcp__Claude_Browser__resize_window` with `{"preset": "mobile"}`. Screenshot the
hero→round-table transition. Confirm the SVG scales down and stays readable (no horizontal
overflow/scrollbar), and the description text below it reads as a single readable column.

- [ ] **Step 7: Stop the preview server**

Use `mcp__Claude_Browser__preview_stop` with the `serverId` from Step 1.

- [ ] **Step 8: If any check in Steps 2-6 failed, fix and re-run this task**

If a problem is found, go back to Task 1 (structural issue) or Task 2 (visual/CSS issue), fix,
commit the fix, and repeat Task 3 from Step 1. Do not report the work as done until Steps 2-6 all
pass.

---

## Rollout (not a task — reference only)

This plan ends with the change committed on the `site/round-table-prominence` branch. Do not push
to `origin` or merge to `main` — that is a production deploy via `deploy-site.yml`. Hand back to
the user for a final look and their explicit go-ahead before either.
