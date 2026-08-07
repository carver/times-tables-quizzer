import { describe, expect, it } from "vitest";
import {
  advanceStreak,
  computeWeight,
  createInitialState,
  isMastered,
  listFacts,
  NEW_STREAK,
  nextActiveRange,
  submitAttempt,
  TARGET_SPEED_MS,
  typingAllowanceMs,
  UNATTEMPTED_WEIGHT_MS,
  type EngineState,
} from "./engine";
import { stateWithMasteredCount } from "./testHelpers";

const DAY_MS = 86_400_000;

function deps(overrides: { random?: () => number; now?: () => number } = {}) {
  return { random: overrides.random ?? (() => 0), now: overrides.now ?? (() => 0) };
}

// Local-time construction, matching dayKey's use of local calendar-day
// getters - this keeps the hardcoded "2026-01-01"-style assertions below
// correct regardless of which timezone the test runs in.
const DAY0 = new Date(2026, 0, 1).getTime();
const day = (n: number) => DAY0 + n * DAY_MS;

describe("advanceStreak", () => {
  it("starts a Streak of 1 on the very first-ever Attempt, regardless of the roll", () => {
    const { streak, hitMilestone } = advanceStreak(NEW_STREAK, day(0), 0.999);

    expect(streak.count).toBe(1);
    expect(streak.lastStreakDay).toBe("2026-01-01");
    expect(hitMilestone).toBe(false);
  });

  it("does not re-roll or double-increment on a second Attempt the same day", () => {
    const afterFirst = advanceStreak(NEW_STREAK, day(0), 0.5).streak;

    const { streak } = advanceStreak(afterFirst, day(0), 0); // roll=0 would trivially succeed if it rolled at all

    expect(streak.count).toBe(1);
  });

  it("auto-continues on the very next consecutive day, no roll needed in practice (p=1)", () => {
    const afterDay0 = advanceStreak(NEW_STREAK, day(0), 0.5).streak;

    const { streak } = advanceStreak(afterDay0, day(1), 0.999); // even a near-1 roll succeeds when missedDays=0

    expect(streak.count).toBe(2);
    expect(streak.lastStreakDay).toBe("2026-01-02");
  });

  it("rolls 1/(missed+1) odds after a gap, succeeding under the threshold", () => {
    const afterDay0 = advanceStreak(NEW_STREAK, day(0), 0.5).streak;
    // Jump straight to day 2 - day 1 had zero Attempts, so missedDays = 1, p = 1/2.

    const { streak } = advanceStreak(afterDay0, day(2), 0.49);

    expect(streak.count).toBe(2);
    expect(streak.lastStreakDay).toBe("2026-01-03");
    expect(streak.missedDays).toBe(0); // resets on recovery
  });

  it("fails the recovery roll at or above the threshold, leaving the count unchanged", () => {
    const afterDay0 = advanceStreak(NEW_STREAK, day(0), 0.5).streak;

    const { streak, hitMilestone } = advanceStreak(afterDay0, day(2), 0.51);

    expect(streak.count).toBe(1);
    expect(hitMilestone).toBe(false);
  });

  it("freezes missedDays while practicing without recovering, instead of letting it grow", () => {
    const afterDay0 = advanceStreak(NEW_STREAK, day(0), 0.5).streak;
    // Day 1 is missed (zero Attempts). Day 2: practice, fail to recover (missedDays=1, p=1/2).
    const afterFailedDay2 = advanceStreak(afterDay0, day(2), 0.9).streak;
    expect(afterFailedDay2.missedDays).toBe(1);

    // Day 3: practice again, still fail - missedDays must still read 1 (p=1/2),
    // NOT 2, even though a full day has passed with no success.
    const afterFailedDay3 = advanceStreak(afterFailedDay2, day(3), 0.49);

    expect(afterFailedDay3.streak.count).toBe(2); // 0.49 < 1/2, recovers
  });

  it("never caps retries - recovery is still possible after many practiced-but-failed days", () => {
    let streak = advanceStreak(NEW_STREAK, day(0), 0.5).streak; // count=1, then day 1 missed
    for (let d = 2; d <= 20; d++) {
      streak = advanceStreak(streak, day(d), 0.9).streak; // always fail (p=1/2, 0.9 loses)
    }
    expect(streak.count).toBe(1);
    expect(streak.missedDays).toBe(1); // still frozen at 1, not 19

    const { streak: recovered } = advanceStreak(streak, day(21), 0.1); // 0.1 < 1/2

    expect(recovered.count).toBe(2);
  });

  it("triggers a Milestone every 7th Streak count, and not otherwise", () => {
    let streak = NEW_STREAK;
    let lastHit = false;
    for (let d = 0; d < 7; d++) {
      const result = advanceStreak(streak, day(d), 0.5);
      streak = result.streak;
      lastHit = result.hitMilestone;
    }
    expect(streak.count).toBe(7);
    expect(lastHit).toBe(true);

    const { hitMilestone: eighth } = advanceStreak(streak, day(7), 0.5);
    expect(eighth).toBe(false);
  });
});

describe("listFacts", () => {
  it("enumerates every a x b combination within the range", () => {
    const facts = listFacts({ size: 2 });

    expect(facts).toEqual([
      { a: 1, b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 1 },
      { a: 2, b: 2 },
    ]);
  });

  it("enumerates the full 1-5 x 1-5 starting Active range", () => {
    const facts = listFacts({ size: 5 });

    expect(facts).toHaveLength(25);
    expect(facts).toContainEqual({ a: 5, b: 5 });
  });
});

describe("typingAllowanceMs", () => {
  it("gives no allowance for a 1-digit answer", () => {
    expect(typingAllowanceMs(6)).toBe(0);
  });

  it("gives more allowance for each extra digit", () => {
    expect(typingAllowanceMs(56)).toBe(300);
    expect(typingAllowanceMs(144)).toBe(600);
  });
});

describe("isMastered", () => {
  it("is not Mastered when never attempted", () => {
    const fact = { a: 3, b: 4 };
    expect(isMastered(fact, { fluency: {}, needsRedemption: {} }, 0)).toBe(false);
  });

  it("is Mastered when current Fluency is under the target speed", () => {
    const fact = { a: 1, b: 1 }; // 1-digit product, no typing allowance
    const state = { fluency: { "1x1": { averageResponseMs: TARGET_SPEED_MS - 1, lastAttemptAt: 0 } }, needsRedemption: {} };
    expect(isMastered(fact, state, 0)).toBe(true);
  });

  it("is not Mastered when current Fluency is at or over the target speed", () => {
    const fact = { a: 1, b: 1 };
    const state = { fluency: { "1x1": { averageResponseMs: TARGET_SPEED_MS, lastAttemptAt: 0 } }, needsRedemption: {} };
    expect(isMastered(fact, state, 0)).toBe(false);
  });

  it("applies the per-digit typing allowance to the target for multi-digit products", () => {
    const fact = { a: 7, b: 8 }; // product 56, 2 digits => +300ms allowance
    const state = { fluency: { "7x8": { averageResponseMs: TARGET_SPEED_MS + 200, lastAttemptAt: 0 } }, needsRedemption: {} };
    expect(isMastered(fact, state, 0)).toBe(true);
  });

  // ADR 0003
  it("is not Mastered when it needs redemption, even with Fluency well under the target speed", () => {
    const fact = { a: 1, b: 1 };
    const state = {
      fluency: { "1x1": { averageResponseMs: TARGET_SPEED_MS - 1, lastAttemptAt: 0 } },
      needsRedemption: { "1x1": true },
    };
    expect(isMastered(fact, state, 0)).toBe(false);
  });
});

describe("nextActiveRange", () => {
  it("does not expand when fewer than 90% of the range is Mastered", () => {
    const state = stateWithMasteredCount({ size: 5 }, 22); // 22/25 = 88%

    expect(nextActiveRange(state, 0)).toEqual({ size: 5 });
  });

  it("expands to the next grid size once at least 90% of the range is Mastered", () => {
    const state = stateWithMasteredCount({ size: 5 }, 23); // 23/25 = 92%

    expect(nextActiveRange(state, 0)).toEqual({ size: 6 });
  });

  it("never expands past the full 1-12 x 1-12 grid", () => {
    const state = stateWithMasteredCount({ size: 12 }, 144); // 100% Mastered

    expect(nextActiveRange(state, 0)).toEqual({ size: 12 });
  });

  // ADR 0003
  it("does not count a Fact that needs redemption toward the Mastered threshold, even if fast", () => {
    const fast = stateWithMasteredCount({ size: 5 }, 23); // 23/25 = 92%, would expand on speed alone
    const state = { ...fast, needsRedemption: { "1x1": true } }; // one of the "fast" Facts owes redemption

    expect(nextActiveRange(state, 0)).toEqual({ size: 5 });
  });
});

describe("computeWeight", () => {
  it("weights a never-attempted Fact at the unattempted sentinel", () => {
    const fact = { a: 3, b: 4 };
    const state = { fluency: {}, boosted: {} };

    expect(computeWeight(fact, state, 0)).toBe(UNATTEMPTED_WEIGHT_MS);
  });

  it("weights an attempted Fact at its stored average when queried at the same instant", () => {
    const fact = { a: 3, b: 4 };
    const state = { fluency: { "3x4": { averageResponseMs: 1200, lastAttemptAt: 0 } }, boosted: {} };

    expect(computeWeight(fact, state, 0)).toBe(1200);
  });

  it("decays the weight upward the longer a Fact has gone unpracticed, independent of new Attempts", () => {
    const fact = { a: 3, b: 4 };
    const state = { fluency: { "3x4": { averageResponseMs: 1000, lastAttemptAt: 0 } }, boosted: {} };

    expect(computeWeight(fact, state, 2 * DAY_MS)).toBe(1100);
  });

  it("multiplies the weight while the Fact is boosted", () => {
    const fact = { a: 3, b: 4 };
    const state = { fluency: { "3x4": { averageResponseMs: 1000, lastAttemptAt: 0 } }, boosted: { "3x4": 3 } };

    expect(computeWeight(fact, state, 0)).toBe(4000);
  });
});

describe("createInitialState", () => {
  it("picks the current Fact from the Active range using the injected random source", () => {
    const state = createInitialState({ size: 2 }, deps({ random: () => 0 }));

    expect(state.fact).toEqual({ a: 1, b: 1 });
  });

  it("can pick the last Fact in the range when random is near 1", () => {
    const state = createInitialState({ size: 2 }, deps({ random: () => 0.999 }));

    expect(state.fact).toEqual({ a: 2, b: 2 });
  });

  it("seeds Range history with the starting size reached at creation time", () => {
    const state = createInitialState({ size: 5 }, deps({ now: () => 12_345 }));

    expect(state.rangeHistory).toEqual({ 5: 12_345 });
  });
});

describe("submitAttempt", () => {
  it("reports correct and celebrates correctness when the submitted answer is the Fact's product", () => {
    const state = createInitialState({ size: 2 }, deps());

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 }, deps());

    expect(result.correct).toBe(true);
    expect(result.celebrations).toEqual([{ kind: "correctness-only", tag: "inline" }]);
  });

  it("reports incorrect and celebrates nothing when the submitted answer is not the Fact's product", () => {
    const state = createInitialState({ size: 2 }, deps());

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 42, responseTimeMs: 800 }, deps());

    expect(result.correct).toBe(false);
    expect(result.celebrations).toEqual([]);
  });

  it("can select every Fact across the full range when weights are equal, not just a subset", () => {
    // All-unattempted Facts share the same UNATTEMPTED_WEIGHT_MS weight, so
    // sweeping the random source evenly should reach every Fact exactly once -
    // this exercises the same weighted-selection math ticket #6/#7 rely on,
    // just with a uniform special case.
    const range = { size: 3 };
    const allFacts = listFacts(range);

    const seenFacts = new Set<string>();
    for (const fraction of allFacts.map((_, i) => i / allFacts.length)) {
      const state = createInitialState(range, deps({ random: () => fraction }));
      seenFacts.add(`${state.fact.a}x${state.fact.b}`);
    }

    expect(seenFacts.size).toBe(allFacts.length);
  });

  it("seeds Fluency with the response time on a Fact's first correct Attempt", () => {
    const state = createInitialState({ size: 1 }, deps());

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 1500 }, deps());

    expect(result.state.fluency["1x1"]).toEqual({ averageResponseMs: 1500, lastAttemptAt: 0 });
  });

  it("blends subsequent correct Attempts into Fluency as a recency-weighted average", () => {
    let state = createInitialState({ size: 1 }, deps());
    state = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 1000 }, deps()).state;

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 2000 }, deps());

    // 0.3 * 2000 + 0.7 * 1000 = 1300
    expect(result.state.fluency["1x1"].averageResponseMs).toBe(1300);
  });

  it("does not update Fluency on a wrong Attempt, and boosts the Fact instead", () => {
    const state = createInitialState({ size: 1 }, deps());

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 99, responseTimeMs: 1000 }, deps());

    expect(result.state.fluency["1x1"]).toBeUndefined();
    expect(result.state.boosted["1x1"]).toBeGreaterThan(0);
  });

  it("celebrates correctness-only, not personal-best, on a Fact's first-ever Attempt", () => {
    // size 2 (not 1) so this single Attempt doesn't also Master 100% of
    // the range and pull in an incidental range-expansion celebration -
    // this test is only about the correctness-only/personal-best split.
    const state = createInitialState({ size: 2 }, deps());

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 100 }, deps());

    expect(result.celebrations).toEqual([{ kind: "correctness-only", tag: "inline" }]);
  });

  it("celebrates personal-best when beating the Fluency baseline (plus typing allowance)", () => {
    let state = createInitialState({ size: 1 }, deps());
    state = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 1000 }, deps()).state;

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 500 }, deps());

    expect(result.celebrations).toEqual([{ kind: "personal-best", tag: "inline" }]);
  });

  it("celebrates correctness-only, not personal-best, when not beating the baseline", () => {
    let state = createInitialState({ size: 1 }, deps());
    state = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 1000 }, deps()).state;

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 1500 }, deps());

    expect(result.celebrations).toEqual([{ kind: "correctness-only", tag: "inline" }]);
  });

  it("compares against the decayed baseline, not the stale stored average", () => {
    // Baseline set at t=0 with a 1000ms average. Two days later, decay has
    // pushed the *current* Fluency to 1000 + 2*50 = 1100ms, so an identical
    // 1000ms response is now a personal best - it wasn't one against the
    // raw, undecayed average.
    let state = createInitialState({ size: 1 }, deps({ now: () => 0 }));
    state = submitAttempt(
      state,
      { type: "attemptSubmitted", answer: 1, responseTimeMs: 1000 },
      deps({ now: () => 0 }),
    ).state;

    const result = submitAttempt(
      state,
      { type: "attemptSubmitted", answer: 1, responseTimeMs: 1000 },
      deps({ now: () => 2 * DAY_MS }),
    );

    expect(result.celebrations).toEqual([{ kind: "personal-best", tag: "inline" }]);
  });

  it("applies the per-digit typing allowance to the personal-best comparison", () => {
    // Fact { a: 7, b: 8 } => answer 56, a 2-digit answer => 300ms allowance.
    // Pin the Fact after each step (range size 8 has many Facts, and
    // weighted selection would otherwise move on to a different one).
    const fact = { a: 7, b: 8 };
    let state: EngineState = { ...createInitialState({ size: 8 }, deps()), fact };
    state = { ...submitAttempt(state, { type: "attemptSubmitted", answer: 56, responseTimeMs: 1000 }, deps()).state, fact };

    // 1250ms is slower than the 1000ms baseline, but within the 300ms allowance.
    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 56, responseTimeMs: 1250 }, deps());

    expect(result.celebrations).toEqual([{ kind: "personal-best", tag: "inline" }]);
  });

  it("still counts a wrong Attempt as practice for decay purposes, without changing the average", () => {
    let state = createInitialState({ size: 1 }, deps({ now: () => 0 }));
    state = submitAttempt(
      state,
      { type: "attemptSubmitted", answer: 1, responseTimeMs: 1000 },
      deps({ now: () => 0 }),
    ).state;

    const result = submitAttempt(
      state,
      { type: "attemptSubmitted", answer: 99, responseTimeMs: 1000 },
      deps({ now: () => 5000 }),
    );

    expect(result.state.fluency["1x1"]).toEqual({ averageResponseMs: 1000, lastAttemptAt: 5000 });
  });

  it("clears a Fact's boost once it's answered correctly again", () => {
    let state: EngineState = { ...createInitialState({ size: 1 }, deps()), boosted: { "1x1": 3 } };

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 }, deps());

    expect(result.state.boosted["1x1"]).toBeUndefined();
  });

  it("weights selection toward the slower of two Facts rather than picking uniformly or strictly lowest-first", () => {
    const state: EngineState = {
      activeRange: { size: 2 },
      fact: { a: 1, b: 1 },
      fluency: {
        "1x1": { averageResponseMs: 500, lastAttemptAt: 0 }, // fast
        "1x2": { averageResponseMs: 2500, lastAttemptAt: 0 }, // slow, and un-Mastered so the range doesn't expand
        "2x1": { averageResponseMs: 500, lastAttemptAt: 0 },
        "2x2": { averageResponseMs: 500, lastAttemptAt: 0 },
      },
      accuracy: {},
      boosted: {},
      needsRedemption: {},
      rangeHistory: { 2: 0 },
      streak: NEW_STREAK,
      practiceDayCount: 0,
    };
    // total weight = 500 + 2500 + 500 + 500 = 4000; the slow Fact "1x2" occupies
    // the cumulative range [500, 3000) out of 4000.
    const result = submitAttempt(
      state,
      { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 },
      deps({ random: () => 1000 / 4000 }),
    );

    expect(result.state.fact).toEqual({ a: 1, b: 2 });
  });

  it("weights a recently-missed (boosted) Fact more heavily than an unboosted one of equal Fluency", () => {
    const state: EngineState = {
      activeRange: { size: 2 },
      fact: { a: 1, b: 1 },
      fluency: {
        "1x1": { averageResponseMs: 500, lastAttemptAt: 0 },
        "1x2": { averageResponseMs: 500, lastAttemptAt: 0 },
        "2x1": { averageResponseMs: 500, lastAttemptAt: 0 },
        "2x2": { averageResponseMs: 2500, lastAttemptAt: 0 }, // un-Mastered so the range doesn't expand
      },
      accuracy: {},
      boosted: { "1x2": 3 },
      needsRedemption: {},
      rangeHistory: { 2: 0 },
      streak: NEW_STREAK,
      practiceDayCount: 0,
    };
    // "1x2" is boosted 4x -> weight 2000; total weight = 500 + 2000 + 500 + 2500 = 5500.
    // "1x2" occupies the cumulative range [500, 2500) out of 5500.
    const result = submitAttempt(
      state,
      { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 },
      deps({ random: () => 1000 / 5500 }),
    );

    expect(result.state.fact).toEqual({ a: 1, b: 2 });
  });

  it("expands the Active range mid-flow and makes newly-unlocked Facts selectable", () => {
    // size 1 => a single Fact { a: 1, b: 1 }. One fast, correct Attempt
    // Masters 100% of the range, so the very next state should expand to
    // size 2 and be able to select one of the newly-added Facts.
    const state = createInitialState({ size: 1 }, deps());

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 100 }, deps());

    expect(result.state.activeRange).toEqual({ size: 2 });

    const newlyUnlockedFact = submitAttempt(
      result.state,
      { type: "attemptSubmitted", answer: -1, responseTimeMs: 100 },
      deps({ random: () => 0.99 }),
    ).state.fact;
    expect(newlyUnlockedFact).toEqual({ a: 2, b: 2 });
  });

  it("includes a Milestone celebration even when the completing Attempt was answered incorrectly", () => {
    const state: EngineState = {
      ...createInitialState({ size: 1 }, deps({ now: () => day(5) })),
      streak: { count: 6, lastStreakDay: "2026-01-06", lastActivityDay: "2026-01-06", missedDays: 0 },
    };

    const result = submitAttempt(
      state,
      { type: "attemptSubmitted", answer: -1, responseTimeMs: 100 }, // wrong on purpose
      deps({ now: () => day(6) }), // the very next consecutive day -> missedDays=0, p=1, guaranteed recovery
    );

    expect(result.correct).toBe(false);
    expect(result.state.streak.count).toBe(7);
    expect(result.celebrations).toEqual([{ kind: "milestone", tag: "takeover" }]);
  });

  describe("Accuracy", () => {
    it("seeds Accuracy at 100% and an Attempt count of 1 on a Fact's first correct Attempt", () => {
      const state = createInitialState({ size: 1 }, deps());

      const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 }, deps());

      expect(result.state.accuracy["1x1"]).toEqual({ correctShare: 1, attemptCount: 1 });
    });

    it("seeds Accuracy at 0% on a Fact's first wrong Attempt, still counting it as an Attempt", () => {
      const state = createInitialState({ size: 1 }, deps());

      const result = submitAttempt(state, { type: "attemptSubmitted", answer: -1, responseTimeMs: 800 }, deps());

      expect(result.state.accuracy["1x1"]).toEqual({ correctShare: 0, attemptCount: 1 });
    });

    it("blends Accuracy as a recency-weighted average, mirroring Fluency's EMA weighting", () => {
      let state = createInitialState({ size: 1 }, deps());
      state = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 }, deps()).state; // correct

      const result = submitAttempt(state, { type: "attemptSubmitted", answer: -1, responseTimeMs: 800 }, deps()); // wrong

      // 0.3 * 0 + 0.7 * 1 = 0.7
      expect(result.state.accuracy["1x1"].correctShare).toBeCloseTo(0.7);
      expect(result.state.accuracy["1x1"].attemptCount).toBe(2);
    });

    it("keeps a lifetime Attempt count that only ever grows, across both correct and wrong Attempts", () => {
      let state = createInitialState({ size: 1 }, deps());
      state = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 }, deps()).state;
      state = submitAttempt(state, { type: "attemptSubmitted", answer: -1, responseTimeMs: 800 }, deps()).state;

      const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 }, deps());

      expect(result.state.accuracy["1x1"].attemptCount).toBe(3);
    });

    it("does not decay Accuracy with elapsed time, unlike Fluency", () => {
      let state = createInitialState({ size: 1 }, deps({ now: () => 0 }));
      state = submitAttempt(
        state,
        { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 },
        deps({ now: () => 0 }),
      ).state;
      const freshAccuracy = state.accuracy["1x1"];

      // A long, Fact-untouched gap passes - only *this* Fact's Accuracy is
      // being checked, and nothing here re-derives it from elapsed time the
      // way currentFluencyMs does for Fluency.
      const result = submitAttempt(
        { ...state, fact: { a: 1, b: 1 } },
        { type: "attemptSubmitted", answer: -1, responseTimeMs: 800 },
        deps({ now: () => 365 * DAY_MS }),
      );

      // The pre-Attempt record (captured well before the gap) is unchanged
      // by the passage of time - only this new wrong Attempt blends it down.
      expect(freshAccuracy).toEqual({ correctShare: 1, attemptCount: 1 });
      expect(result.state.accuracy["1x1"].correctShare).toBeCloseTo(0.7);
    });

    it("does not feed Fact selection weight or the progression threshold, even when catastrophically low", () => {
      const withGoodAccuracy: EngineState = {
        ...createInitialState({ size: 1 }, deps()),
        fluency: { "1x1": { averageResponseMs: 500, lastAttemptAt: 0 } },
        accuracy: { "1x1": { correctShare: 1, attemptCount: 10 } },
      };
      const withTerribleAccuracy: EngineState = {
        ...withGoodAccuracy,
        accuracy: { "1x1": { correctShare: 0, attemptCount: 10 } },
      };

      expect(computeWeight({ a: 1, b: 1 }, withGoodAccuracy, 0)).toBe(computeWeight({ a: 1, b: 1 }, withTerribleAccuracy, 0));
      expect(isMastered({ a: 1, b: 1 }, withGoodAccuracy, 0)).toBe(isMastered({ a: 1, b: 1 }, withTerribleAccuracy, 0));
      expect(nextActiveRange(withGoodAccuracy, 0)).toEqual(nextActiveRange(withTerribleAccuracy, 0));
    });
  });

  describe("redemption (ADR 0003)", () => {
    it("marks a Fact as needing redemption on a wrong Attempt", () => {
      const state = createInitialState({ size: 1 }, deps());

      const result = submitAttempt(state, { type: "attemptSubmitted", answer: -1, responseTimeMs: 800 }, deps());

      expect(result.state.needsRedemption["1x1"]).toBe(true);
    });

    it("clears redemption once the Fact is answered correctly again", () => {
      let state = createInitialState({ size: 1 }, deps());
      state = submitAttempt(state, { type: "attemptSubmitted", answer: -1, responseTimeMs: 800 }, deps()).state;
      expect(state.needsRedemption["1x1"]).toBe(true);

      const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 }, deps());

      expect(result.state.needsRedemption["1x1"]).toBeUndefined();
    });

    it("does not clear redemption via the boost counter fading out - only a correct Attempt on the Fact clears it", () => {
      // ADR 0003's trap: boosts fade after BOOST_ATTEMPTS Attempts across
      // ANY Fact, so cycling other Facts must not silently clear
      // redemption on the untouched wrong Fact.
      const range = { size: 2 };
      let state: EngineState = { ...createInitialState(range, deps()), fact: { a: 1, b: 2 } };
      state = submitAttempt(state, { type: "attemptSubmitted", answer: -1, responseTimeMs: 800 }, deps()).state; // wrong on 1x2
      expect(state.needsRedemption["1x2"]).toBe(true);

      // Burn through more Attempts than BOOST_ATTEMPTS on a *different* Fact
      // so 1x2's boost fully decays, without ever answering 1x2 correctly.
      for (let i = 0; i < 10; i++) {
        state = { ...state, fact: { a: 1, b: 1 } };
        state = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 }, deps()).state;
      }

      expect(state.boosted["1x2"]).toBeUndefined(); // the boost has faded...
      expect(state.needsRedemption["1x2"]).toBe(true); // ...but redemption has not

      const stillNotMastered: EngineState = {
        ...state,
        fluency: { ...state.fluency, "1x2": { averageResponseMs: 100, lastAttemptAt: 0 } }, // very fast
      };
      expect(isMastered({ a: 1, b: 2 }, stillNotMastered, 0)).toBe(false);
    });
  });

  describe("range history and expansion celebration", () => {
    it("records reachedAt for the newly-reached size when the Active range expands", () => {
      // size 1 => a single Fact; one fast correct Attempt Masters 100%.
      const state = createInitialState({ size: 1 }, deps({ now: () => 0 }));

      const result = submitAttempt(
        state,
        { type: "attemptSubmitted", answer: 1, responseTimeMs: 100 },
        deps({ now: () => 42_000 }),
      );

      expect(result.state.activeRange).toEqual({ size: 2 });
      expect(result.state.rangeHistory[2]).toBe(42_000);
    });

    it("includes range-expansion as a takeover celebration when the Active range expands", () => {
      const state = createInitialState({ size: 1 }, deps());

      const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 100 }, deps());

      expect(result.celebrations).toContainEqual({ kind: "range-expansion", tag: "takeover" });
    });

    it("does not add a range-expansion celebration or history entry when the range does not expand", () => {
      const state = createInitialState({ size: 5 }, deps({ now: () => 0 })); // far from 90% Mastered

      const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 100 }, deps());

      expect(result.state.activeRange).toEqual({ size: 5 });
      expect(result.celebrations).not.toContainEqual(expect.objectContaining({ kind: "range-expansion" }));
      expect(result.state.rangeHistory).toEqual(state.rangeHistory);
    });

    it("preserves history for earlier sizes when a later expansion is recorded", () => {
      let state = createInitialState({ size: 1 }, deps({ now: () => 0 }));
      state = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 100 }, deps({ now: () => 1000 })).state;
      expect(state.activeRange).toEqual({ size: 2 });

      state = { ...state, fact: { a: 1, b: 2 } };
      state = submitAttempt(state, { type: "attemptSubmitted", answer: 2, responseTimeMs: 100 }, deps({ now: () => 2000 })).state;
      state = { ...state, fact: { a: 2, b: 1 } };
      state = submitAttempt(state, { type: "attemptSubmitted", answer: 2, responseTimeMs: 100 }, deps({ now: () => 3000 })).state;
      state = { ...state, fact: { a: 2, b: 2 } };
      const result = submitAttempt(state, { type: "attemptSubmitted", answer: 4, responseTimeMs: 100 }, deps({ now: () => 4000 }));

      expect(result.state.activeRange).toEqual({ size: 3 });
      expect(result.state.rangeHistory).toEqual({ 1: 0, 2: 1000, 3: 4000 });
    });
  });

  describe("multiple simultaneous celebrations", () => {
    it("produces personal-best, range-expansion, and milestone together from a single Attempt", () => {
      // size 1 => a single Fact { a: 1, b: 1 }. Seed a Fluency baseline slow
      // enough that a 100ms response beats it (personal-best) but close
      // enough to the target that the *blended* average still lands under
      // TARGET_SPEED_MS (mastery, hence expansion - a 5000ms baseline would
      // pass the personal-best check but EMA-blend to well over the
      // mastery target from a single fast Attempt). A Streak already at 6
      // makes this the 7th day (Milestone) with guaranteed recovery
      // (missedDays=0).
      const state: EngineState = {
        ...createInitialState({ size: 1 }, deps({ now: () => day(5) })),
        fluency: { "1x1": { averageResponseMs: 2500, lastAttemptAt: day(5) } },
        streak: { count: 6, lastStreakDay: "2026-01-06", lastActivityDay: "2026-01-06", missedDays: 0 },
      };

      const result = submitAttempt(
        state,
        { type: "attemptSubmitted", answer: 1, responseTimeMs: 100 },
        deps({ now: () => day(6) }),
      );

      expect(result.correct).toBe(true);
      expect(result.state.activeRange).toEqual({ size: 2 });
      expect(result.state.streak.count).toBe(7);
      expect(result.celebrations).toEqual(
        expect.arrayContaining([
          { kind: "personal-best", tag: "inline" },
          { kind: "range-expansion", tag: "takeover" },
          { kind: "milestone", tag: "takeover" },
        ]),
      );
      expect(result.celebrations).toHaveLength(3);
    });
  });

  describe("practiceDayCount", () => {
    it("counts the very first-ever Attempt as day 1", () => {
      const state = createInitialState({ size: 1 }, deps({ now: () => day(0) }));

      const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 }, deps({ now: () => day(0) }));

      expect(result.state.practiceDayCount).toBe(1);
    });

    it("does not double-count a second Attempt the same calendar day", () => {
      const first = submitAttempt(
        createInitialState({ size: 1 }, deps({ now: () => day(0) })),
        { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 },
        deps({ now: () => day(0) }),
      ).state;

      const second = submitAttempt(
        first,
        { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 },
        deps({ now: () => day(0) }),
      );

      expect(second.state.practiceDayCount).toBe(1);
    });

    it("counts a new calendar day even when the Streak fails to recover it", () => {
      // A Streak broken several days ago with a low recovery chance -
      // `random` always returns 1, guaranteeing the roll misses regardless
      // of missedDays, so lastStreakDay never advances to today. Days
      // practiced must still climb: it tracks practice, not Streak credit
      // (CONTEXT.md's Streak is a different concept from "showed up").
      const state: EngineState = {
        ...createInitialState({ size: 1 }, deps({ now: () => day(0) })),
        practiceDayCount: 3,
        streak: { count: 2, lastStreakDay: "2026-01-01", lastActivityDay: "2026-01-01", missedDays: 0 },
      };

      const result = submitAttempt(
        state,
        { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 },
        deps({ now: () => day(10), random: () => 1 }),
      );

      expect(result.state.streak.lastStreakDay).toBe("2026-01-01"); // recovery did NOT happen
      expect(result.state.practiceDayCount).toBe(4); // but the day still counts as practiced
    });
  });
});
