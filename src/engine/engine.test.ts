import { describe, expect, it } from "vitest";
import { createInitialState, submitAttempt } from "./engine";

describe("createInitialState", () => {
  it("exposes the given Fact as the current Fact", () => {
    const state = createInitialState({ a: 7, b: 8 });

    expect(state.fact).toEqual({ a: 7, b: 8 });
  });
});

describe("submitAttempt", () => {
  it("reports correct and celebrates correctness when the submitted answer is the Fact's product", () => {
    const state = createInitialState({ a: 7, b: 8 });

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 56 });

    expect(result.correct).toBe(true);
    expect(result.celebration).toBe("correctness-only");
  });

  it("reports incorrect and celebrates nothing when the submitted answer is not the Fact's product", () => {
    const state = createInitialState({ a: 7, b: 8 });

    const result = submitAttempt(state, { type: "attemptSubmitted", answer: 42 });

    expect(result.correct).toBe(false);
    expect(result.celebration).toBe("none");
  });
});
