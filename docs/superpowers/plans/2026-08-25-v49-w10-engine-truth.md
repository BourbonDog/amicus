# v4.9 W10 — #133 Pieces 2–3: quote the real engine error, detect runtime skew — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a leg dies silent, the message carries the engine's own error line instead of a
guess; when the serving engine's version skews from the installed one, the runtime says so —
the two remaining #133 pieces, per the product principle (self-heal or self-diagnose, always
transparently).

**Architecture:** Piece 2 is a new pure-ish resolver (`src/utils/engine-log.js`) + enrichment
at the two backstop firing sites where `sessionId` is in scope, appended AFTER the
`NO_OUTPUT_BACKSTOP:` prefix (`models-probe.js` classifies on the prefix — byte-stable).
Piece 3 captures the `Session.version` the SDK already returns (currently discarded) and
compares it against the running install's own on-disk engine version — no global-install
baseline (the doctor check's baseline is structurally silent on this machine, measured).

**Tech Stack:** Node 22, Jest, no new deps. `headless.js` and `opencode-client.js` are
grandfathered (no size gate); the new module is gated.

**Spec:** phasing memo §3 (#133 pieces, design measured) + recon measurements (2026-08-25):
the single-file `~/.local/share/opencode/log/opencode.log` premise is STALE — the current
engine writes per-process timestamped logs (`2026-08-25T185532.log`), and BOTH schemes coexist
on real machines; two line formats (logfmt `session.id=ses_… error=…` at 1.17.x; columnar
`ERROR <iso> … id=ses_…` at 1.2.x); the `ses_<id>` substring matches in both.

## Global Constraints

- The `NO_OUTPUT_BACKSTOP:` prefix is byte-stable (append-only enrichment).
- Clean fallback: no log dir / no file / no `ses_` match / no ERROR line ⇒ the message is
  byte-identical to today's — pinned.
- Log reads are bounded: read at most the LAST 256 KiB of each candidate file (the legacy
  single file is 2.4 MB on the reference machine); at most the 3 newest files by mtime.
- No secrets in tests: fixture logs are synthetic.
- No git mutations; focused suites, `--maxWorkers=2`; sizes/citations clean.

---

### Task A: Piece 2 — the engine-log resolver + message enrichment

**Files:** Create `src/utils/engine-log.js`, `tests/engine-log.test.js`; Modify
`src/headless.js` (the two firing sites + the stale `:167` single-file path comment),
`tests/no-output-backstop-wiring.test.js` or the suite covering the backstop message (find
it: grep NO_OUTPUT_BACKSTOP tests/).
**Interfaces (produced):**
`engineErrorForSession(sessionId, {dataDir?, fs?, now?}) → string | null` — a one-line,
newline-free excerpt of the newest ERROR-level engine-log line mentioning `ses_<sessionId>`,
or null (every miss path).
- [ ] Resolver rules (TDD each): dir = `$XDG_DATA_HOME/opencode/log` else
  `~/.local/share/opencode/log` (the `auth-json.js` order — read that file's precedent and
  cite it); candidates = `opencode.log` plus `*.log`, newest ≤3 by mtime; per file read the
  LAST ≤256 KiB; match lines containing `ses_<id>`; filter ERROR (`level=ERROR` logfmt OR
  `^ERROR` columnar); prefer the NEWEST match across files; extract the `error=` value when
  present (logfmt) else the line's trailing message; collapse to ≤200 chars, strip newlines.
  Fixtures: one logfmt file, one columnar file, both formats in one dir, no-match, no-dir.
- [ ] Enrichment: at BOTH firing sites in `headless.js :: runHeadless` (the pre-send race and
  the poll loop — grep `noOutputBackstopReason`), when the backstop fires and `sessionId` is
  set, append ` — engine log: <excerpt>` to the reason IFF the resolver returns non-null.
  Guard the resolver call in try/catch (a log-reading failure must never break a leg's
  death report). Pin: with a fixture log, the leg's `error`/`reason` carries the excerpt
  after the byte-stable prefix; without, byte-identical to today (control).
- [ ] Sweep the stale comment: `headless.js:167`'s single-file path claim (grep the literal
  `opencode/log/opencode.log` repo-wide; fix live prose, leave dated records).
- [ ] Named mutant `LOGBLIND` (resolver always returns null) — red set recorded in-file.

### Task B: Piece 3 — runtime version-skew detection

**Files:** Modify `src/opencode-client.js` (`createSession` captures `result.data.version`),
plus the minimal seam to compare against the running install's engine version (measure:
`engine-install-scan.js :: defaultReadEngineVersion` reads an install dir's
`opencode-ai/package.json` — find how the RUNNING install's engine dir is known to
opencode-client/engine-ensure and reuse it; do NOT use the global-install baseline);
Create/extend the client suite (find: grep createSession tests/).
- [ ] Capture: `createSession` returns the id today and discards `result.data.version` —
  keep the return shape backward-compatible (measure every caller first; if callers
  destructure a string id, add the version via a side channel: a module-level
  `lastSessionVersion` getter or an optional out-param — pick the smallest honest seam and
  record why).
- [ ] Compare + announce: on the FIRST session whose server version differs from the
  installed engine version, warn ONCE per process through the existing logger (find the
  house pattern for one-time warnings; else a module flag):
  `engine version skew: server ${a} ≠ installed ${b} — MCP and CLI may be running different
  engines; see amicus doctor` — transparent self-diagnosis, no behavior change otherwise.
- [ ] Enrichment tie-in: when Piece 2's backstop enrichment fires AND skew was detected,
  append `(engine skew: server ${a} ≠ installed ${b})` — the #133 outage's actual shape
  (every MCP leg dying behind a version skew) becomes self-describing at the failure site.
- [ ] Pins: no-skew silent (byte-identical messages), skew warns once (not per session),
  version-less server response (older SDK) silent, and the #133 composite (backstop +
  skew) message shape. Named mutant `SKEWBLIND` (comparison never fires) — red set.
- [ ] Record the #133 fix-4 disposition in BACKLOG's v4.9 records: the version handshake IS
  the startup schema check's honest core; a full response-schema validation was considered
  and not built (state why in one sentence).

### Task C (lead): wave gates
- [ ] Full `npm test` tail -10, lint, sizes, citations, docs check; three-axis sweep;
  commit; push `v49-w10-engine`; PR from main with the council-review label.
