# Use separate speed rules for progression and for celebration

Progression (expanding the Active range) and celebration (in-the-moment positive feedback) both react to response speed, but they measure it differently. Progression uses a fixed target speed (~2s, TBD in Q13) applied uniformly across Facts, because it needs to answer an objective question — is this Fact actually automatic recall? — and a threshold that scales with difficulty would let a hard Fact count as "mastered" while still visibly slower than an easy one. Celebration instead compares an Attempt against the Learner's own recent average for that specific Fact, because a fixed threshold would trivially trigger on easy Facts and rarely or never trigger on hard ones, making the reward feel arbitrary rather than earned.

These are deliberately different rules serving different purposes, not an inconsistency — don't unify them into a single "fast enough" metric.
