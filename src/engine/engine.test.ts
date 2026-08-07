import { describe, expect, it } from "vitest";
import { createInitialState, listFacts, submitAttempt } from "./engine";

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

describe("createInitialState", () => {
  it("picks the current Fact from the Active range using the injected random source", () => {
    const state = createInitialState({ size: 2 }, { random: () => 0 });

    expect(state.fact).toEqual({ a: 1, b: 1 });
  });

  it("can pick the last Fact in the range when random is near 1", () => {
    const state = createInitialState({ size: 2 }, { random: () => 0.999 });

    expect(state.fact).toEqual({ a: 2, b: 2 });
  });
});

describe("submitAttempt", () => {
  it("reports correct and celebrates correctness when the submitted answer is the Fact's product", () => {
    const state = createInitialState({ size: 2 }, { random: () => 0 });

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 1 }, { random: () => 0 });

    expect(result.correct).toBe(true);
    expect(result.celebration).toBe("correctness-only");
  });

  it("reports incorrect and celebrates nothing when the submitted answer is not the Fact's product", () => {
    const state = createInitialState({ size: 2 }, { random: () => 0 });

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 42 }, { random: () => 0 });

    expect(result.correct).toBe(false);
    expect(result.celebration).toBe("none");
  });

  it("can select every Fact across the full range over repeated Attempts, not just a subset", () => {
    const range = { size: 3 };
    const allFacts = listFacts(range);
    let state = createInitialState(range, { random: () => 0 });

    const seenFacts = new Set<string>();
    for (const fraction of allFacts.map((_, i) => i / allFacts.length)) {
      const result = submitAttempt(state, { type: "attemptSubmitted", answer: -1 }, { random: () => fraction });
      state = result.state;
      seenFacts.add(`${state.fact.a}x${state.fact.b}`);
    }

    expect(seenFacts.size).toBe(allFacts.length);
  });
});
