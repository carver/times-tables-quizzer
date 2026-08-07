// The practice screen's UI state machine, kept separate from DOM wiring
// (main.ts) so it's testable without a DOM. It wraps the engine's
// EngineState with the two things the screen needs that the engine
// doesn't track: what the Learner has typed so far, and whether they're
// mid-correction after a wrong Attempt.
//
// Ticket #9 is UI-only - this module calls the engine's existing
// `submitAttempt` but never changes its behavior or types.
import { submitAttempt, type Celebration, type Dependencies, type EngineState, type Fact } from "./engine/engine";

// The Learner is answering the current Fact (state.engine.fact).
export type AnsweringScreen = {
  mode: "answering";
  engine: EngineState;
  typed: string;
  // When the current Fact was shown - the response-timer start for the
  // *next* Enter press. Deliberately not reset by rendering; see
  // pressEnter below for where it actually gets stamped.
  factShownAt: number;
};

// A wrong Attempt just landed. `wrongFact` is the Fact that was
// answered incorrectly (captured before the engine advanced to a new
// current Fact) and `correctAnswer` is what the Learner must retype
// before continuing. This retype is deliberately not an Attempt
// (CONTEXT.md): nothing in this mode calls submitAttempt.
export type CorrectingScreen = {
  mode: "correcting";
  engine: EngineState;
  typed: string;
  wrongFact: Fact;
  correctAnswer: number;
};

export type ScreenState = AnsweringScreen | CorrectingScreen;

export function createInitialScreen(engine: EngineState, deps: Dependencies): AnsweringScreen {
  return toAnswering(engine, deps);
}

// Both a correct Attempt and a dismissed correction land the Learner
// back in "answering" on `engine`'s current Fact, with the response
// timer starting fresh right now - the only difference is which `engine`
// value they carry forward (a freshly-advanced one for the former, the
// unchanged one from before the retype for the latter).
function toAnswering(engine: EngineState, deps: Dependencies): AnsweringScreen {
  return { mode: "answering", engine, typed: "", factShownAt: deps.now() };
}

// Appends one digit to whatever's currently typed, regardless of mode -
// the keypad and physical keyboard both feed digits through here whether
// the Learner is answering or retyping a correction.
export function pressDigit(screen: ScreenState, digit: string): ScreenState {
  return { ...screen, typed: screen.typed + digit };
}

export function pressBackspace(screen: ScreenState): ScreenState {
  return { ...screen, typed: screen.typed.slice(0, -1) };
}

export type EnterOutcome =
  // Enter with nothing typed is a no-op - there's nothing to submit.
  | { kind: "empty" }
  | { kind: "correct"; celebrations: Celebration[] }
  // A wrong Attempt can still carry a Celebration (e.g. a Milestone -
  // Streak advances on every Attempt regardless of correctness), so this
  // carries the engine's set through same as "correct" does.
  | { kind: "incorrect"; celebrations: Celebration[] }
  | { kind: "correction-dismissed" }
  // Retyped digits don't match yet; stays in "correcting" so the Learner
  // can backspace and fix it rather than starting over.
  | { kind: "correction-mismatch" };

export type EnterResult = {
  screen: ScreenState;
  outcome: EnterOutcome;
};

// Enter is the only way to submit - no auto-submit on digit count, per
// the ticket: matching the answer's digit count would leak how many
// digits it has, and would make a mistyped middle digit unrecoverable.
export function pressEnter(screen: ScreenState, deps: Dependencies): EnterResult {
  if (screen.typed === "") {
    return { screen, outcome: { kind: "empty" } };
  }

  if (screen.mode === "correcting") {
    if (Number(screen.typed) !== screen.correctAnswer) {
      return { screen, outcome: { kind: "correction-mismatch" } };
    }

    // Dismissing the correction is what starts the next Fact's response
    // timer - not the render that already happened when the wrong
    // Attempt's result came back. The Learner's own action ends the
    // pause, rather than a timer that's always wrong for someone reading
    // vs. not reading the correct answer.
    return { screen: toAnswering(screen.engine, deps), outcome: { kind: "correction-dismissed" } };
  }

  const answer = Number(screen.typed);
  const responseTimeMs = deps.now() - screen.factShownAt;
  const wrongFact = screen.engine.fact;
  const result = submitAttempt(screen.engine, { type: "attemptSubmitted", answer, responseTimeMs }, deps);

  if (result.correct) {
    return { screen: toAnswering(result.state, deps), outcome: { kind: "correct", celebrations: result.celebrations } };
  }

  const next: CorrectingScreen = {
    mode: "correcting",
    engine: result.state,
    typed: "",
    wrongFact,
    correctAnswer: wrongFact.a * wrongFact.b,
  };
  return { screen: next, outcome: { kind: "incorrect", celebrations: result.celebrations } };
}
