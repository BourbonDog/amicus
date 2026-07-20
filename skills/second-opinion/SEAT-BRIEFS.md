# Seat Briefs — Optional Council Elements

Briefing boilerplate for the **optional council elements** offered at Stage 0 of the
`second-opinion` skill (SKILL.md → "Optional council elements"). When an element is toggled
ON, Claude copies the relevant block below into the run's `_tmp-*` briefing files and fills
the `<placeholders>`. Everything here is orchestration prose — the findings contract,
`council validate`, tally, and verdict mechanics are unchanged unless a section says
otherwise.

_The critic and lens methodologies are adapted from the `/critic` (elite-advisor) and
`/debate` (expert-debate-facilitator) agents in John Renaldi's product-kit plugin (MIT)._
_Deliberate deviations from those sources: no minimum-findings quota (quotas force invented
findings, which waste the bench's adjudication capital), and the hard questions +
Ship/Fix/Rethink verdict belong to the chair (synthesis-level judgments stay with the
non-Claude chair, per the council's core rule)._

---

## Standard anti-sycophancy clause (ALL Stage-1 briefings — not an optional element)

Include this block **verbatim in every Stage-1 review briefing**, standard seats included.
This is briefing hygiene, not a toggle:

> Do not soften findings to be agreeable. Lead with your most severe finding. No praise
> cushions before criticism, and never perform enthusiasm you don't hold — if the artifact
> is mediocre, say so and show why. Do not pad: report every real finding and no invented
> ones. An empty severity category is a valid result.

---

## Critic seat brief

Body of `_tmp-briefing-critic.md`. Follow it with the standard structured-output contract
(prose review + trailing findings JSON, identical to every other seat) and the material.
One bench member gets this brief **instead of** the standard review brief; the rest of the
bench runs the normal fanout wave.

> You are this review bench's designated critic. Assume problems exist; your job is to find
> them, not to confirm the artifact is fine. Work through four passes and fold everything
> into one findings list:
>
> 1. **Adversarial pass** — for every claim: what evidence supports it, or is it an
>    assumption presented as fact? For every goal: is it measurable — would the author know
>    if they hit it or missed it? For every decision: what alternatives were considered, or
>    was this just the first idea? For every scope boundary: real constraint, or avoidance
>    of hard work?
> 2. **Edge-case hunt** — walk every journey, requirement, and scenario. What happens on the
>    unexpected input, the failed integration, the malformed data? At zero, at one, at
>    scale? With the confused, frustrated, or adversarial user instead of the happy-path
>    one? Report only unhandled cases — if the artifact addresses an edge case, move on
>    silently.
> 3. **Consistency check** — cross-reference sections against each other: do goals have
>    metrics, and metrics targets? do requirements trace back to stated needs? do the
>    milestones fit the declared scope? does anything contradict a stated non-goal or
>    constraint?
> 4. **Executability test** — could someone act on this artifact without coming back with
>    clarifying questions? Wherever the answer is no, name the specific section and exactly
>    what is missing.
>
> Be specific: name the section, the line, the exact gap — not "the requirements need work"
> but which requirement, and what about it is untestable. Report every real finding and no
> invented ones; do not pad to look thorough. An empty pass is a valid result.

**Orchestration notes (not part of the brief):**
- Launch as a separate concurrent solo run alongside the fanout wave — the exact red-team
  variant pattern in SKILL.md Stage 1.
- Same findings contract, same `council validate` + repair loop, same anonymization into the
  Stage-2 bundle. Judges are never told a critic seat exists.
- Record `role: "critic"` on the seat's `runStats` entry.
- Disclose in `report.md`: the critic model can recognize its own review in the Stage-2
  bundle by its adversarial shape, so self-bias wash-out is weakened for that one seat.

---

## Expert lens briefs

**Panel scoping first (Stage 0, when the element is toggled ON).** Ask the user which
domain the panel should come from, then propose one distinct lens per seat:

- **Business / Venture** — VCs, operators, market strategists (viability, positioning, GTM)
- **Technical** — architects, security specialists, infrastructure engineers (feasibility,
  scalability, build-vs-buy)
- **Specialty technical** — user names the field (ML, biotech, regulatory, hardware, …)
- **Customer / Market** — user researchers, skeptical buyers, channel partners (demand,
  willingness to pay, adoption barriers)
- **Financial** — CFOs, pricing strategists, unit-economics experts
- **Mixed / Custom** — the user defines the lens set

Pick lenses that will produce productive tension (a growth-stage VC + a bootstrapped
operator + a skeptical enterprise buyer beats three near-identical strategists). Confirm the
lens set with the user before launch.

**Per-seat brief opener** (`_tmp-briefing-lens-<slug>.md`, one per seat; follow with the
standard structured-output contract and the material):

> Review this artifact strictly through the lens of a <lens — e.g. "growth-stage VC",
> "security architect", "skeptical enterprise buyer", "CFO focused on unit economics">.
> Raise only findings that perspective is qualified to raise, at the depth a top
> practitioner of it would reach. Stay in-domain: if something matters but is outside your
> lens, leave it to the other reviewers.

**Orchestration notes (not part of the brief):**
- Every seat gets a distinct brief, so there is no shared-prompt wave — launch ALL legs as
  concurrent solo runs.
- The lens↔model assignment is random and lives only in the private label map. Never tell
  any reviewer which lenses the other seats hold, and never mention lenses in the Stage-2
  bundle or judging instructions — judges rank on accuracy and insight only.
- Record `role: "lens:<slug>"` on each `runStats` entry.
- The Stage-2 tally runs `--no-ledger` — lens reviews are not comparable to standard
  reviews, so they must not feed cross-run reliability stats.
- Disclose in `report.md`: anonymity is weakened (each judge can spot its own lens-flavored
  review), street-cred is not comparable across lenses, and the run was not recorded to the
  reliability ledger.

---

## Rebuttal-round templates (debate mode, Stage 2.5)

### Defense brief

`_tmp-rebuttal-<label>.md` — one concurrent solo run per raiser that has at least one
Contested or Disputed finding. First line is the no-tools preamble, verbatim:

> Do NOT use any tools or read any files; everything is in this message; begin immediately
> with the first finding id.
>
> You reviewed an artifact and raised the findings below. Peer reviewers (anonymous)
> disputed them for the stated reasons. For EACH finding, respond with exactly one line
> starting with the finding id and one verb:
>
> `<id>: DEFEND — <your strongest evidence-based defense, one paragraph maximum>`
> `<id>: AMEND — <the corrected claim, full replacement text>`
> `<id>: WITHDRAW`
>
> Withdraw anything you cannot defend with evidence — an unsupported repeat of the original
> claim is weaker than a withdrawal.
>
> [one block per finding: id · claim · severity · the peers' dispute reasons, anonymized]

### Re-vote bundle

`_tmp-revote-bundle.md` — ONE shared bundle, sent as a single fanout wave to every judge
that disputed at least one defended or amended finding. First line is the no-tools preamble,
verbatim:

> Do NOT use any tools or read any files; everything is in this message; begin immediately
> with the first finding id.
>
> You previously adjudicated the findings below and disputed them. The (anonymous) raiser
> has now responded. Re-adjudicate ONLY these findings in light of the response. For each,
> respond with exactly one line:
>
> `<id>: agree | dispute | neutral — <one-line reason>`
>
> Changing your verdict when the defense is convincing is good judging, not weakness; so is
> holding your dispute when it isn't.
>
> [one block per finding: id · claim (amended claims marked AMENDED) · the raiser's
> defense]

**Orchestration notes (not part of the briefs):**
- Exactly ONE rebuttal round, ever. Whatever remains unsettled after the re-vote keeps its
  final tier.
- A missing or unparseable defense line = the original claim stands undefended. A missing
  re-vote line = that judge's original verdict stands.
- WITHDRAWN findings stay in the tally input (they were raised) and are auto-recorded as
  `denied` in Stage 4 — never presented for a user decision. List them in `report.md` under
  "Withdrawn by raiser (debate mode)".

---

## Chair verdict-scale addendum

Append to the chair packet (`_tmp-chair-packet.md`) when the element is toggled ON:

> After your synthesis, add two closing sections:
>
> 1. **HARD QUESTIONS** — three to five questions the artifact's author has probably not
>    asked themselves, chosen so that an unanswerable question reveals a structural gap in
>    the artifact (not gotchas — questions whose answers should exist).
> 2. A final line, alone on the last line, containing ONLY the phrase — no rationale, no
>    dash, no trailing text of any kind — exactly one of:
>
>    `VERDICT: Ship it` | `VERDICT: Fix these first` | `VERDICT: Fundamental rethink`
>
>    Pick one. "Ship it" = solid, nothing blocking. "Fix these first" = specific gaps must
>    be resolved first. "Fundamental rethink" = structural problems that cannot be patched.
>    Name the gaps or the structural problems in the synthesis ABOVE, not on the VERDICT
>    line itself — that line carries the phrase and nothing else.

**Orchestration note:** surface the chair's `VERDICT:` line verbatim at the top of
`report.md` and in the inline chat presentation of the results.
