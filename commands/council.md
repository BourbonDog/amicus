---
description: Run a structured multi-model LLM council review of the given material — wraps the second-opinion skill (independent reviews → anonymous cross-review → non-Claude chair verdict → accept/deny decisions).
argument-hint: '[material, path, or URL] [analysis request + criteria] [optional elements — e.g. "with a critic seat", "debate mode", "expert lenses", "chair verdict scale"]'
disable-model-invocation: true
---

Run a full council review by invoking the `second-opinion` skill shipped in this
plugin (listed as `amicus:second-opinion`). Do not synthesize a verdict yourself —
the skill's chair model does that; you orchestrate.

Treat everything the user typed after the command as the review request:

$ARGUMENTS

Interpret it as three inputs: the **material** (inline text, a file path, or a URL),
the **analysis request**, and the **criteria**. If any of the three is missing or
ambiguous, ask for it before launching any model (the skill's Stage 0 covers this —
don't re-ask for what is already present).

Then follow the second-opinion skill's engine fast path, in pipeline order: Stage 0
intake/prep and run-folder setup, then council selection with a cost estimate
and explicit user confirmation; one `amicus council run` call — the engine runs
validate, cross-review, tally, and chair internally, covering the Stage-1
independent reviews through the Stage-3 chair synthesis with no Claude runtime
in between; Stage 4, the accept/deny decision pass, once the run returns; and
Stage 5, which runs `amicus council verdict` to write the decided `verdict.json`.

The user may also name **optional council elements** in the arguments (critic seat,
expert lenses, debate mode, verdict scale, Claude in the council). All elements
default OFF; the skill's Stage-0 menu is the single opt-in point. If the user named
elements here, carry them into Stage 0 as pre-requested — confirm them back by name
instead of re-asking — and never enable an element the user did not explicitly name.
