// The practice screen's UI state machine, kept separate from DOM wiring
// (main.ts) so it's testable without a DOM. It wraps the engine's
// EngineState with the two things the screen needs that the engine
// doesn't track: what the Learner has typed so far, and where they are
// in the aftermath of a wrong Attempt - taking their one Retry, or
// retyping the answer once that's been given up (docs/adr/0007).
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

// The first wrong Attempt just landed. The Fact stays up with its
// answer still hidden, so the Learner gets a second swing at recalling
// it rather than being handed the answer to copy. Like the correction
// retype, this Retry is deliberately not an Attempt (CONTEXT.md):
// nothing in this mode calls submitAttempt.
export type RetryingScreen = {
  mode: "retrying";
  engine: EngineState;
  typed: string;
  wrongFact: Fact;
  correctAnswer: number;
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

export type ScreenState = AnsweringScreen | RetryingScreen | CorrectingScreen;

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

// Restarts the current Fact's response timer, discarding however long
// the Learner has been sitting in front of it so far.
//
// This exists for takeover Celebrations. A correct Attempt advances to
// the next Fact and starts its timer immediately, but if that same
// Attempt also expanded the Active range or hit a Milestone, a takeover
// goes up and swallows all input until it's dismissed - so the Learner
// cannot answer during that window, yet the clock was running through
// it. Left uncorrected, time spent admiring a celebration is billed to
// the next Fact's Fluency: a several-second takeover can push an
// instantly-answered Fact past the target speed, un-Mastering it and
// making a personal best impossible.
//
// A no-op in "retrying" and "correcting" mode, where there is no Attempt
// being timed - neither a Retry nor the correction retype is one
// (CONTEXT.md).
export function restartFactTimer(screen: ScreenState, deps: Dependencies): ScreenState {
  if (screen.mode !== "answering") return screen;
  return { ...screen, factShownAt: deps.now() };
}

// Appends one digit to whatever's currently typed, regardless of mode -
// the keypad and physical keyboard both feed digits through here whether
// the Learner is answering, taking a Retry, or retyping a correction.
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
  | { kind: "correction-mismatch" }
  // The Retry was wrong too, so the answer now gets shown and the
  // Learner moves on to retyping it.
  | { kind: "retry-incorrect" }
  // The Retry was right. Not an Attempt - the Fact was already
  // measured by the wrong one - but worth its own feedback, so it's
  // distinct from a correction being dismissed.
  | { kind: "retry-correct" };

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

  if (screen.mode === "retrying") {
    if (Number(screen.typed) !== screen.correctAnswer) {
      // Out of tries: the answer comes out now, and the Learner retypes
      // it. Still no submitAttempt - the Fact's one measured Attempt was
      // the first Enter, and the Retry only decided how much help
      // to give, not what gets recorded (CONTEXT.md).
      const revealed: CorrectingScreen = { ...screen, mode: "correcting", typed: "" };
      return { screen: revealed, outcome: { kind: "retry-incorrect" } };
    }

    // Recalled it unaided on the second go: nothing more to practice, so
    // the Learner goes straight to the next Fact - and its clock starts
    // here, not back when the wrong Attempt landed.
    return { screen: toAnswering(screen.engine, deps), outcome: { kind: "retry-correct" } };
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

  const next: RetryingScreen = {
    mode: "retrying",
    engine: result.state,
    typed: "",
    wrongFact,
    correctAnswer: wrongFact.a * wrongFact.b,
  };
  return { screen: next, outcome: { kind: "incorrect", celebrations: result.celebrations } };
}
