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
One instance of the Learner being shown a Fact and responding. Produces a correctness result and a response time. Retyping the correct answer after getting a Fact wrong is *not* an Attempt — it's practice, not measurement, and it never feeds Fluency, Accuracy, or the Streak.
_Avoid_: Try, guess, answer (as a noun for the event)

**Active range**:
The current subset of Facts (e.g. 1–5 × 1–5) the Learner is being quizzed on. Expands to the next size once enough of the range is Mastered.
_Avoid_: Level, tier, stage

**Fluency**:
A per-Fact, recency-weighted average of correct Attempts' response times, which passively decays the longer the Fact goes unpracticed. Compared against a fixed target speed to decide progression, and used as the Learner's personal baseline for celebration. A wrong Attempt doesn't feed Fluency but immediately forces the Fact back into heavy rotation regardless of it.
_Avoid_: Score, mastery, speed

**Accuracy**:
A per-Fact, recency-weighted share of Attempts that were correct. Unlike Fluency, it does *not* decay with time — forgetting shows up as slowness first, and a Learner who takes a holiday hasn't become less accurate. Reported to the Learner; it deliberately doesn't feed Fact selection or the progression threshold.
_Avoid_: Correctness rate, success rate, score

**Mastered**:
A Fact whose Fluency is currently under the target speed *and* which has been answered correctly since its most recent wrong Attempt. The Active range expands once enough of its Facts are Mastered.
_Avoid_: Learned, known

**Celebration**:
The positive feedback produced by an Attempt. An Attempt yields a *set* of Celebrations, not one — the same Attempt can be a personal best, expand the Active range, and hit a Milestone. Each is either **inline** (plays over the practice screen without interrupting) or a **takeover** (fills the screen and waits for the Learner to dismiss it).
_Avoid_: Reward, feedback, animation

**Progress map**:
The Learner's view of the whole 12 × 12 grid of Facts, with the conquered corner filled and the rest still to come — the app's home screen. Shows where the Active range currently reaches and how close it is to expanding.
_Avoid_: Dashboard, home, level select

**Streak**:
A count of consecutive days with at least one Attempt. A day with zero Attempts breaks it, but on return each Attempt has a `1 / (missed days + 1)` chance of recovering it — adding 1 for the return day only, never backfilling the missed days. "Missed days" counts only days with zero Attempts; practicing without yet recovering doesn't worsen the odds. Rolling stops once recovery succeeds, or after the first Attempt on an unbroken day.
_Avoid_: Combo, chain

**Milestone**:
A Streak count that's a multiple of 7, triggering an escalated celebration beyond the normal per-Attempt one.
_Avoid_: Badge, achievement

**Typing allowance**:
A fixed amount of extra time added to the progression target for each digit beyond the first in the correct answer, so a Fact with a multi-digit product (e.g. "144") isn't held to the same bar as a single-digit one (e.g. "6") purely for taking longer to type. Applies only where Facts with different digit counts are measured against a shared bar — never to the stored Fluency average, and never to the personal-best comparison, where a Fact is measured against its own history and the typing is identical on both sides.
_Avoid_: Padding, buffer
