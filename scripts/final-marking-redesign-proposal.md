# Final Marking — Problem Summary & Redesign Proposal

## The short version

Final marking keeps landing on roughly the same mark regardless of the
essay's real quality. We tested four prompt wording fixes and a model
upgrade — none solved it. Testing finally revealed *why*: the problem isn't
the prompt, and it isn't really the model either. It's the stage's whole
design. This doc lays out the evidence and a proposed direction.

## The problem, in plain terms

Ask an AI to pick one of five bands for an essay, and it has a habit of
avoiding the two ends of the scale — it hedges toward the middle, even when
the essay is genuinely very weak or very strong. This is a known, documented
pattern in AI grading research, not something specific to this app.

We confirmed it directly, with real GCSE essays marked by a real secondary
school teacher:

| Essay | Real mark | AI mark |
|---|---|---|
| A | 3 | 5 |
| B | 8 | 5 |
| C | 10 | 8 |
| D | 3 | 5 |
| E | 9 | 5 |
| F | 7 | 6 |
| G | 3 | 5 |
| H | 2 | 5 |
| I | 4 | 5 |
| J | 2 | 3 |

Weak essays get pulled **up**. Strong essays get pulled **down**. Almost
everything lands near the same number in the middle, regardless of which
direction the true mark actually sits.

## What we ruled out, and how

We didn't guess at a fix — we tested each one in isolation, on real essays,
comparing against real teacher marks each time:

1. **A real bug, fixed**: essays were getting credit for "using a reference"
   even when they hadn't quoted anything at all. Fixed and confirmed working
   — but fixing it never moved the actual mark, because the bug only
   affected what evidence got *labelled* as, not the number the model
   separately decided on.
2. **Asked the model to check its own reasoning against its own mark.**
   Its explanations got more specific and consistent, but the final mark
   didn't change.
3. **Removed the instruction to "be neither harsh nor lenient."** That
   phrase effectively told the model to aim for the middle. Removing it
   alone didn't move the mark either.
4. **Added a rule for genuinely close calls** ("don't default up or down out
   of habit, decide on actual resemblance"). Still no change.
5. **Swapped the model** powering this stage from a cheaper, faster one to
   the same stronger model an earlier stage already uses successfully. This
   helped *somewhat* on one essay — but testing it properly across the full
   range of real essays (the table above) showed the core problem was still
   there, just centred on a slightly different number.

## The real finding

Once final marking ran on the *exact same model* as the earlier, simpler
marking stage, we could finally compare them fairly. The earlier stage —
which reads the actual essay directly — still clearly outperformed final
marking, even on the identical model.

That rules out "wrong model" as the main cause. It points at *how* final
marking is built: it never sees the real essay, only a short list of
pre-selected quotes, and it's deliberately told nothing about any earlier
judgement. It has to reconstruct a verdict from fragments, blind, every
single time.

**One honest correction worth keeping**: the earlier, simpler stage isn't
immune to this either — it shows some of the same middle-clustering too,
just less severely. So this isn't "one stage is broken and one is fine." It
looks more like a tendency the underlying model has everywhere it's asked to
make this kind of judgement call — and the current final-marking design
happens to give that tendency more room to get worse, because it's working
from less information than a direct read of the essay would give it.

## What we think is actually worth trying

Not another wording tweak, and not another model swap on the current
design. Two real moves, both grounded in what we've found:

**1. Simplify.** Move back toward something closer to a single, well-built
holistic judgement — reading the real essay directly, the way the earlier
stage already does more successfully — rather than continuing to patch a
third stage that's working from less information and getting worse results
because of it.

**2. Apply a real fix for the tendency itself, not just the symptom.**
Central tendency bias has a known, validated mitigation: mark the same
response several times with some genuine variation between attempts, then
take the middle result rather than trusting a single pass. This is already
built and working elsewhere in this project's own marking system — it's not
a new idea, just not yet applied to this specific stage.

## What's already built regardless of this decision

Independent of whether a bigger redesign happens, these are done, tested,
and working correctly on real essays today:

- The false-reference-credit fix (a real, confirmed bug, now fixed).
- A check that flags when the awarded mark exceeds what the model's own
  evidence actually supports.
- A check that flags when a whole required skill has zero evidence behind
  it at all.
- A tool that automatically compares AI marks against real teacher marks,
  so any future change can be tested the same rigorous way these were.

These don't fix the core problem on their own, but they're real safety nets
regardless of what happens next, and they cost nothing to keep.

## What this needs before going further

This is a genuine design question about how the marking pipeline is built,
not a small bug fix — worth a real conversation rather than quietly
rebuilding it alone. Worth bringing, alongside this doc:

- The full real-essay comparison table above, as the actual evidence.
- The specific finding that matching the models exposed the real cause.
- Whether a redesign in this direction is something worth building together,
  and where exemplar data or other input might help it further.
