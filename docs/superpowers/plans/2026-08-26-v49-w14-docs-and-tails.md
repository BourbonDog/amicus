# v4.9 W14 — docs, CHANGELOG, and the accumulated tails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The release-facing docs for v4.9.0 (task mode, engine truth, bench signals) and the
truth-pass that pays every tail filed across the six merged PRs — so the release cut starts
from a tree that does not lie anywhere we know about.

**Architecture:** Two disjoint-file-set tasks run in parallel in the main checkout.
Task A owns CHANGELOG.md, ROADMAP.md, docs/council.md, docs/usage.md, README.md.
Task B owns BACKLOG.md, the test-header prose corrections, and skills/second-opinion.
Neither touches the other's files; the lead merges reports, gates, commits.

**Tech Stack:** prose + markdown; jest only to re-derive counts and keep doc pins green.

**Spec:** the session ledger (scratchpad/v49-design-decisions.md) tails inventory; the
CHANGELOG substrate at scratchpad/v490-changelog-draft.md; dispositions on PRs 205/206/207.

## Global Constraints

- Every number quoted anywhere is re-derived against THIS tree at writing time.
- Three-axis sweep after every prose edit (phrase / symbol / bare file.js:NNN).
- `#NNN` never written in electron/** (hex-colour guard); "issue NNN" instead.
- No git mutations by agents; the lead stages and commits.

### Task A: release-facing docs
- [ ] CHANGELOG.md `[4.9.0]` from the draft — every claim verified against the merged tree.
- [ ] ROADMAP.md gains BOTH the missing v4.8 section and the v4.9 section (##-minor,
      sentence-case, v4.9 theme "The council does new work").
- [ ] docs/council.md task-mode section; README task-mode mention.
- [ ] The remediation-hints "as of 4.8.x" sweep class.

### Task B: tails and truth
- [ ] The #205 W11 prose corrections (false propagation claim; inconsistent counts; the mk
      fold's measured-dead divergence disclosure) + three BACKLOG filings.
- [ ] The #206 C1–C4 filings and the #207 A1–A4+B1 filings into BACKLOG's v4.9 records.
- [ ] BACKLOG rot already flagged by agents (the :1922 and :1185 entries).
- [ ] skills/second-opinion task orchestration (R10 first-class).

### Task C (lead): gates, commit, push to main.
