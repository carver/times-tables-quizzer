import { describe, expect, it } from "vitest";
import { createInitialState, dayKey, type EngineState } from "./engine/engine";
import {
  createInitialScreen,
  pressBackspace,
  pressDigit,
  pressEnter,
  restartFactTimer,
  type CorrectingScreen,
  type RetryingScreen,
  type ScreenState,
} from "./screen";

function deps(overrides: { random?: () => number; now?: () => number } = {}) {
  return { random: overrides.random ?? (() => 0), now: overrides.now ?? (() => 0) };
}

// Matches engine.test.ts's DAY_MS/day helpers - needed here only for the
// one test that has to land a Streak Milestone on a specific calendar
// day (dayKey itself is the engine's, imported above, not reimplemented).
const DAY_MS = 86_400_000;
const DAY0 = new Date(2026, 0, 1).getTime();
const day = (n: number) => DAY0 + n * DAY_MS;

// Fact { a: 1, b: 1 } every time (range size 1), so tests can hardcode the
// correct answer without depending on weighted selection.
function engineWithSingleFact(overrides: { now?: () => number } = {}): EngineState {
  return createInitialState({ size: 1 }, deps({ now: overrides.now }));
}

// The correction (answer shown, retype to continue) is now two wrong
// tries deep, not one: the first wrong Attempt only earns a Retry
// with the answer still hidden. Everything asserting on that retype
// walks the whole path through this.
function correctingAfterTwoWrongs(engine: EngineState, at = { first: 500, second: 4_000 }): CorrectingScreen {
  const retrying = pressEnter(
    { ...createInitialScreen(engine, deps({ now: () => 0 })), typed: "99" },
    deps({ now: () => at.first }),
  ).screen;
  const { screen } = pressEnter({ ...retrying, typed: "98" }, deps({ now: () => at.second }));
  return screen as CorrectingScreen;
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
    // size 2 (not 1, unlike engineWithSingleFact) so this single Attempt
    // doesn't also Master 100% of the range and pull in an incidental
    // range-expansion celebration - random: () => 0 still deterministically
    // picks { a: 1, b: 1 } first, so the hardcoded "1" answer still applies.
    const engine = createInitialState({ size: 2 }, deps({ now: () => 0 }));
    const screen = { ...createInitialScreen(engine, deps({ now: () => 0 })), typed: "1" };

    const { screen: next, outcome } = pressEnter(screen, deps({ now: () => 900 }));

    expect(outcome).toEqual({ kind: "correct", celebrations: [{ kind: "correctness-only", tag: "inline" }] });
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

    expect(outcome).toEqual({ kind: "incorrect", celebrations: [] });
    expect(next.mode).toBe("retrying");
    expect(next.engine.fluency["1x1"]).toBeUndefined();
  });

  it("surfaces a Milestone celebration on the incorrect outcome when the wrong Attempt still completes it", () => {
    // Streak count 6, guaranteed recovery on the very next consecutive
    // day (missedDays=0) - the 7th day is a Milestone regardless of
    // whether this Attempt itself was answered correctly.
    const engine: EngineState = {
      ...engineWithSingleFact({ now: () => day(5) }),
      streak: { count: 6, lastStreakDay: dayKey(day(5)), lastActivityDay: dayKey(day(5)), missedDays: 0 },
    };
    const screen = { ...createInitialScreen(engine, deps({ now: () => day(5) })), typed: "99" };

    const { outcome } = pressEnter(screen, deps({ now: () => day(6) }));

    expect(outcome).toEqual({ kind: "incorrect", celebrations: [{ kind: "milestone", tag: "takeover" }] });
  });

  it("enters retrying mode on the same Fact after the first wrong Attempt, rather than straight to the answer", () => {
    const engine = engineWithSingleFact({ now: () => 0 });
    const screen = { ...createInitialScreen(engine, deps({ now: () => 0 })), typed: "99" };

    const { screen: next } = pressEnter(screen, deps({ now: () => 500 }));

    expect(next.mode).toBe("retrying");
    const retrying = next as RetryingScreen;
    expect(retrying.wrongFact).toEqual({ a: 1, b: 1 });
    expect(retrying.correctAnswer).toBe(1);
    expect(retrying.typed).toBe("");
  });

  it("moves straight on to the next Fact when the Retry is right, without counting it as an Attempt", () => {
    const engine = engineWithSingleFact({ now: () => 0 });
    const retrying = pressEnter({ ...createInitialScreen(engine, deps({ now: () => 0 })), typed: "99" }, deps({ now: () => 500 })).screen;

    const { screen: next, outcome } = pressEnter({ ...retrying, typed: "1" }, deps({ now: () => 4_000 }));

    expect(outcome).toEqual({ kind: "retry-correct" });
    expect(next.mode).toBe("answering");
    expect(next.typed).toBe("");
    // The Retry is practice: Fluency stays untouched (the Fact has
    // no correct Attempt yet) and the engine is the same value the wrong
    // Attempt left behind.
    expect(next.engine).toBe(retrying.engine);
    expect(next.engine.fluency["1x1"]).toBeUndefined();
    // The next Fact's clock starts when the Learner finishes here, not
    // back when the wrong Attempt landed.
    expect((next as { factShownAt: number }).factShownAt).toBe(4_000);
  });

  it("reveals the answer only after a wrong Retry, without submitting the Retry as an Attempt", () => {
    const engine = engineWithSingleFact({ now: () => 0 });
    const retrying = pressEnter({ ...createInitialScreen(engine, deps({ now: () => 0 })), typed: "99" }, deps({ now: () => 500 })).screen;
    expect(retrying.mode).toBe("retrying");

    const { screen: next, outcome } = pressEnter({ ...retrying, typed: "98" }, deps({ now: () => 4_000 }));

    expect(outcome).toEqual({ kind: "retry-incorrect" });
    expect(next.mode).toBe("correcting");
    const correcting = next as CorrectingScreen;
    expect(correcting.wrongFact).toEqual({ a: 1, b: 1 });
    expect(correcting.correctAnswer).toBe(1);
    // Cleared, so the Retry's digits aren't sitting there to be
    // mistaken for progress on the retype.
    expect(correcting.typed).toBe("");
    // The Retry is practice, not measurement (CONTEXT.md) - the
    // engine saw exactly one wrong Attempt, back at the first Enter.
    expect(next.engine).toBe(retrying.engine);
  });

  it("does not call submitAttempt for a matching correction retype - the retype is not an Attempt", () => {
    const afterTwoWrongs = correctingAfterTwoWrongs(engineWithSingleFact({ now: () => 0 }));
    const boostedBefore = afterTwoWrongs.engine.boosted["1x1"];

    const correctionScreen = { ...afterTwoWrongs, typed: "1" };
    const { screen: next, outcome } = pressEnter(correctionScreen, deps({ now: () => 8_000 }));

    expect(outcome).toEqual({ kind: "correction-dismissed" });
    // Same engine reference/value as before the retype - nothing in the
    // engine (Fluency, boosted/Streak) moved as a result of dismissing.
    expect(next.engine).toBe(afterTwoWrongs.engine);
    expect(next.engine.boosted["1x1"]).toBe(boostedBefore);
    expect(next.engine.streak).toEqual(afterTwoWrongs.engine.streak);
  });

  it("starts the next Fact's response timer at the moment the correction is dismissed, not when it was shown", () => {
    const correctionScreen = { ...correctingAfterTwoWrongs(engineWithSingleFact({ now: () => 0 })), typed: "1" };

    const { screen: next } = pressEnter(correctionScreen, deps({ now: () => 12_000 }));

    expect(next.mode).toBe("answering");
    expect((next as { factShownAt: number }).factShownAt).toBe(12_000);
  });

  it("stays in correcting mode and keeps the typed digits when the retype doesn't match yet", () => {
    const afterTwoWrongs = correctingAfterTwoWrongs(engineWithSingleFact({ now: () => 0 }));
    const correctionScreen = { ...afterTwoWrongs, typed: "9" }; // correct answer is 1, not 9

    const { screen: next, outcome } = pressEnter(correctionScreen, deps({ now: () => 8_000 }));

    expect(outcome).toEqual({ kind: "correction-mismatch" });
    expect(next).toBe(correctionScreen);
    expect(next.mode).toBe("correcting");
    expect(next.typed).toBe("9");
  });
});

describe("restartFactTimer", () => {
  it("re-stamps the answering Fact's timer, discarding time the Learner couldn't answer in", () => {
    // The takeover case: a correct Attempt advances to the next Fact and
    // starts its clock, but a takeover then swallows all input until it's
    // dismissed. Without this, the celebration's duration is billed to
    // the next Fact's response time.
    const screen = createInitialScreen(engineWithSingleFact(), deps({ now: () => 1_000 }));
    expect(screen.factShownAt).toBe(1_000);

    const resumed = restartFactTimer(screen, deps({ now: () => 9_000 }));

    expect(resumed).toEqual({ ...screen, factShownAt: 9_000 });
  });

  it("charges only the post-restart time to the Attempt", () => {
    let clock = 1_000;
    const d = deps({ now: () => clock });
    let screen: ScreenState = createInitialScreen(engineWithSingleFact(), d);

    clock = 6_000; // five seconds spent on a takeover, unable to answer
    screen = restartFactTimer(screen, d);

    clock = 6_400; // answered 400ms after it was actually dismissed
    screen = pressDigit(screen, "1");
    const { screen: after } = pressEnter(screen, d);

    expect((after as { engine: EngineState }).engine.fluency["1x1"].averageResponseMs).toBe(400);
  });

  it("leaves a correction retype alone, which is not a timed Attempt", () => {
    const screen = correctingAfterTwoWrongs(engineWithSingleFact());

    expect(restartFactTimer(screen, deps({ now: () => 5_000 }))).toBe(screen);
  });

  it("leaves a Retry alone too - it is practice on an already-measured Fact, not a timed Attempt", () => {
    let screen: ScreenState = createInitialScreen(engineWithSingleFact(), deps());
    screen = pressDigit(screen, "9");
    screen = pressEnter(screen, deps()).screen;
    expect(screen.mode).toBe("retrying");

    expect(restartFactTimer(screen, deps({ now: () => 5_000 }))).toBe(screen);
  });
});
