# Times Tables Quizzer

A practice app that drills a single learner on multiplication facts, aiming to build fluency (accuracy + speed) over time.

## Language

**Learner**:
The one person using the app — currently a specific 9-year-old practicing multiplication facts. A single fixed persona, not a multi-profile or account system.
_Avoid_: User, student, player

**Fact**:
A single multiplication combination (e.g., "7 × 8") — the atomic unit the Learner is quizzed on and progress is tracked against.
_Avoid_: Problem, question

**Attempt**:
One instance of the Learner being shown a Fact and responding. Produces a correctness result and a response time.
_Avoid_: Try, guess, answer (as a noun for the event)

**Active range**:
The current subset of Facts (e.g. 1–5 × 1–5) the Learner is being quizzed on. Expands to the next size once enough of the range is Mastered.
_Avoid_: Level, tier, stage

**Fluency**:
A per-Fact, recency-weighted average of correct Attempts' response times, which passively decays the longer the Fact goes unpracticed. Compared against a fixed target speed to decide progression, and used as the Learner's personal baseline for celebration. A wrong Attempt doesn't feed Fluency but immediately forces the Fact back into heavy rotation regardless of it.
_Avoid_: Score, mastery, speed

**Mastered**:
A Fact whose Fluency is currently under the target speed. The Active range expands once enough of its Facts are Mastered.
_Avoid_: Learned, known

**Streak**:
A count of consecutive days with at least one Attempt. A day with zero Attempts breaks it, but on return each Attempt has a `1 / (missed days + 1)` chance of recovering it — adding 1 for the return day only, never backfilling the missed days. "Missed days" counts only days with zero Attempts; practicing without yet recovering doesn't worsen the odds. Rolling stops once recovery succeeds, or after the first Attempt on an unbroken day.
_Avoid_: Combo, chain

**Milestone**:
A Streak count that's a multiple of 7, triggering an escalated celebration beyond the normal per-Attempt one.
_Avoid_: Badge, achievement

**Typing allowance**:
A fixed amount of extra time added to a response-time comparison target for each digit beyond the first in the correct answer, so a Fact with a multi-digit product (e.g. "144") isn't held to the same bar as a single-digit one (e.g. "6") purely for taking longer to type. Applied to both the celebration baseline and the progression target — never to the stored Fluency average itself.
_Avoid_: Padding, buffer
