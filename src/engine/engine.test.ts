import { describe, expect, it } from "vitest";
import {
  computeWeight,
  createInitialState,
  listFacts,
  submitAttempt,
  typingAllowanceMs,
  UNATTEMPTED_WEIGHT_MS,
  type EngineState,
} from "./engine";

const DAY_MS = 86_400_000;

function deps(overrides: { random?: () => number; now?: () => number } = {}) {
  return { random: overrides.random ?? (() => 0), now: overrides.now ?? (() => 0) };
}

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
});

describe("submitAttempt", () => {
  it("reports correct and celebrates correctness when the submitted answer is the Fact's product", () => {
    const state = createInitialState({ size: 2 }, deps());

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 }, deps());

    expect(result.correct).toBe(true);
    expect(result.celebration).toBe("correctness-only");
  });

  it("reports incorrect and celebrates nothing when the submitted answer is not the Fact's product", () => {
    const state = createInitialState({ size: 2 }, deps());

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 42, responseTimeMs: 800 }, deps());

    expect(result.correct).toBe(false);
    expect(result.celebration).toBe("none");
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
    const state = createInitialState({ size: 1 }, deps());

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 100 }, deps());

    expect(result.celebration).toBe("correctness-only");
  });

  it("celebrates personal-best when beating the Fluency baseline (plus typing allowance)", () => {
    let state = createInitialState({ size: 1 }, deps());
    state = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 1000 }, deps()).state;

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 500 }, deps());

    expect(result.celebration).toBe("personal-best");
  });

  it("celebrates correctness-only, not personal-best, when not beating the baseline", () => {
    let state = createInitialState({ size: 1 }, deps());
    state = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 1000 }, deps()).state;

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1, responseTimeMs: 1500 }, deps());

    expect(result.celebration).toBe("correctness-only");
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

    expect(result.celebration).toBe("personal-best");
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

    expect(result.celebration).toBe("personal-best");
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
        "1x2": { averageResponseMs: 1500, lastAttemptAt: 0 }, // slow
        "2x1": { averageResponseMs: 500, lastAttemptAt: 0 },
        "2x2": { averageResponseMs: 500, lastAttemptAt: 0 },
      },
      boosted: {},
    };
    // total weight = 500 + 1500 + 500 + 500 = 3000; the slow Fact "1x2" occupies
    // the cumulative range [500, 2000) out of 3000.
    const result = submitAttempt(
      state,
      { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 },
      deps({ random: () => 1000 / 3000 }),
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
        "2x2": { averageResponseMs: 500, lastAttemptAt: 0 },
      },
      boosted: { "1x2": 3 },
    };
    // "1x2" is boosted 4x -> weight 2000; total weight = 500*3 + 2000 = 3500.
    // "1x2" occupies the cumulative range [500, 2500) out of 3500.
    const result = submitAttempt(
      state,
      { type: "attemptSubmitted", answer: 1, responseTimeMs: 800 },
      deps({ random: () => 1000 / 3500 }),
    );

    expect(result.state.fact).toEqual({ a: 1, b: 2 });
  });
});
