# One unaided Retry before the answer is shown

A wrong Attempt used to put the correct answer on screen immediately, with the Learner retyping it to continue. That reveal is instant help, and it arrives before the Learner has had a chance to reach for the answer themselves: the moment "4 × 4 = 16" is on screen, the keystrokes that follow are copying, not recall. The Learner often *did* know it and mistyped, or was one beat away from getting there, and neither case gets to happen.

A wrong Attempt now buys one **Retry** first: the same Fact stays up with its answer still hidden and a "try again" prompt, and only a second miss reveals the answer and asks for the retype. So the sequence is *think again → get told*, rather than *get told*.

The Retry is deliberately not an Attempt. The Fact has already been measured (one wrong Attempt, recorded at the first Enter, with all its usual consequences: the selection-weight boost, the redemption requirement of ADR 0003), and a second swing at a Fact the Learner has just been told they got wrong measures something different from a cold recall. They now know the first answer was wrong, which narrows the field for free. Letting a correct Retry raise Accuracy would also make the metric depend on how many goes the app happened to give, which is an implementation detail, not something about the Learner. So a Retry moves nothing in the engine, exactly like the retype it may lead to (see `CONTEXT.md`'s Attempt and Retry entries). Its only job is deciding how much help the Learner gets next.

There is also no clock on the Retry. The response timer stops at the wrong Attempt and doesn't restart until the Learner is back on a fresh Fact, so thinking time here is free. Thinking time is the entire point of the change, and the idle check that normally guards a running clock is stood down for the same reason.

Considered and rejected:

- **Counting the Retry as a real Attempt.** The most obvious reading of "give them another go", but it double-counts one encounter with a Fact: a Learner who slips and immediately self-corrects would look, in the stats, like someone who practiced twice. Fluency would also be measured across a window that includes reading "not quite", which is not recall speed.
- **Counting only a wrong Retry** (a correct one free, a second miss recorded). Punishes the Learner twice for one lapse and pushes the Fact's weight up harder than a single mistake warrants, with no matching upside for getting it right.
- **More than one Retry.** With the answer withheld and no clock running, an unbounded (or merely longer) loop of "try again" turns into guessing, especially with a 12 × 12 range where a determined Learner can walk the small products. One Retry is the smallest thing that buys a genuine second thought; a second adds nothing to recall it doesn't also add to brute force.
- **A forced pause before accepting the Retry.** "Give them time to think" could mean disabling the keypad for a beat. Rejected as paternalistic and, in a drill whose whole target is a ~2.5s answer, actively annoying: the Learner who already knows it should be allowed to just type it.
