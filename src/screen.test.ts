import { describe, expect, it } from "vitest";
import { createInitialState, type EngineState } from "./engine/engine";
import { createInitialScreen, pressBackspace, pressDigit, pressEnter, type CorrectingScreen } from "./screen";

function deps(overrides: { random?: () => number; now?: () => number } = {}) {
  return { random: overrides.random ?? (() => 0), now: overrides.now ?? (() => 0) };
}

// Fact { a: 1, b: 1 } every time (range size 1), so tests can hardcode the
// correct answer without depending on weighted selection.
function engineWithSingleFact(overrides: { now?: () => number } = {}): EngineState {
  return createInitialState({ size: 1 }, deps({ now: overrides.now }));
}

describe("createInitialScreen", () => {
  it("starts in answering mode with nothing typed and the timer stamped at creation", () => {
    const engine = engineWithSingleFact();
    const screen = createInitialScreen(engine, deps({ now: () => 1000 }));

    expect(screen).toEqual({ mode: "answering", engine, typed: "", factShownAt: 1000 });
  });
});

describe("pressDigit", () => {
  it("appends a digit to what's typed", () => {
    const screen = createInitialScreen(engineWithSingleFact(), deps());

    const next = pressDigit(pressDigit(screen, "1"), "2");

    expect(next.typed).toBe("12");
  });

  it("appends digits while correcting too, not just while answering", () => {
    const engine = engineWithSingleFact();
    const correcting: CorrectingScreen = {
      mode: "correcting",
      engine,
      typed: "",
      wrongFact: { a: 1, b: 1 },
      correctAnswer: 1,
    };

    const next = pressDigit(correcting, "1");

    expect(next).toEqual({ ...correcting, typed: "1" });
  });
});

describe("pressBackspace", () => {
  it("removes exactly one digit from the end", () => {
    const screen = { ...createInitialScreen(engineWithSingleFact(), deps()), typed: "12" };

    const next = pressBackspace(screen);

    expect(next.typed).toBe("1");
  });

  it("is a no-op on an empty typed answer", () => {
    const screen = createInitialScreen(engineWithSingleFact(), deps());

    const next = pressBackspace(screen);

    expect(next.typed).toBe("");
  });
});

describe("pressEnter", () => {
  it("is a no-op when nothing has been typed", () => {
    const screen = createInitialScreen(engineWithSingleFact(), deps());

    const { screen: next, outcome } = pressEnter(screen, deps());

    expect(outcome).toEqual({ kind: "empty" });
    expect(next).toBe(screen);
  });

  it("submits the typed answer as an Attempt, advances to the next Fact, and resets the timer on a correct answer", () => {
    const engine = engineWithSingleFact({ now: () => 0 });
    const screen = { ...createInitialScreen(engine, deps({ now: () => 0 })), typed: "1" };

    const { screen: next, outcome } = pressEnter(screen, deps({ now: () => 900 }));

    expect(outcome).toEqual({ kind: "correct", celebration: "correctness-only" });
    expect(next.mode).toBe("answering");
    expect(next.typed).toBe("");
    expect((next as { factShownAt: number }).factShownAt).toBe(900);
    // The response time fed to the engine should be measured from when
    // the Fact was shown (0) to this Enter press (900), i.e. 900ms.
    expect(next.engine.fluency["1x1"].averageResponseMs).toBe(900);
  });

  it("does not update Fluency, Accuracy, or Streak for a wrong Attempt's own submission beyond the engine's normal wrong-Attempt handling", () => {
    const engine = engineWithSingleFact({ now: () => 0 });
    const screen = { ...createInitialScreen(engine, deps({ now: () => 0 })), typed: "99" };

    const { screen: next, outcome } = pressEnter(screen, deps({ now: () => 500 }));

    expect(outcome).toEqual({ kind: "incorrect" });
    expect(next.mode).toBe("correcting");
    expect(next.engine.fluency["1x1"]).toBeUndefined();
  });

  it("enters correcting mode holding the wrong Fact and its correct answer, not the engine's newly-picked next Fact", () => {
    const engine = engineWithSingleFact({ now: () => 0 });
    const screen = { ...createInitialScreen(engine, deps({ now: () => 0 })), typed: "99" };

    const { screen: next } = pressEnter(screen, deps({ now: () => 500 }));

    expect(next.mode).toBe("correcting");
    const correcting = next as CorrectingScreen;
    expect(correcting.wrongFact).toEqual({ a: 1, b: 1 });
    expect(correcting.correctAnswer).toBe(1);
    expect(correcting.typed).toBe("");
  });

  it("does not call submitAttempt for a matching correction retype - the retype is not an Attempt", () => {
    const engine = engineWithSingleFact({ now: () => 0 });
    const afterWrong = pressEnter({ ...createInitialScreen(engine, deps({ now: () => 0 })), typed: "99" }, deps({ now: () => 500 })).screen;
    expect(afterWrong.mode).toBe("correcting");
    const boostedBefore = afterWrong.engine.boosted["1x1"];

    const correctionScreen = { ...afterWrong, typed: "1" };
    const { screen: next, outcome } = pressEnter(correctionScreen, deps({ now: () => 800 }));

    expect(outcome).toEqual({ kind: "correction-dismissed" });
    // Same engine reference/value as before the retype - nothing in the
    // engine (Fluency, boosted/Streak) moved as a result of dismissing.
    expect(next.engine).toBe(afterWrong.engine);
    expect(next.engine.boosted["1x1"]).toBe(boostedBefore);
    expect(next.engine.streak).toEqual(afterWrong.engine.streak);
  });

  it("starts the next Fact's response timer at the moment the correction is dismissed, not when it was shown", () => {
    const engine = engineWithSingleFact({ now: () => 0 });
    const afterWrong = pressEnter({ ...createInitialScreen(engine, deps({ now: () => 0 })), typed: "99" }, deps({ now: () => 500 })).screen;
    const correctionScreen = { ...afterWrong, typed: "1" };

    const { screen: next } = pressEnter(correctionScreen, deps({ now: () => 12_000 }));

    expect(next.mode).toBe("answering");
    expect((next as { factShownAt: number }).factShownAt).toBe(12_000);
  });

  it("stays in correcting mode and keeps the typed digits when the retype doesn't match yet", () => {
    const engine = engineWithSingleFact({ now: () => 0 });
    const afterWrong = pressEnter({ ...createInitialScreen(engine, deps({ now: () => 0 })), typed: "99" }, deps({ now: () => 500 })).screen;
    const correctionScreen = { ...afterWrong, typed: "9" }; // correct answer is 1, not 9

    const { screen: next, outcome } = pressEnter(correctionScreen, deps({ now: () => 800 }));

    expect(outcome).toEqual({ kind: "correction-mismatch" });
    expect(next).toBe(correctionScreen);
    expect(next.mode).toBe("correcting");
    expect(next.typed).toBe("9");
  });
});
