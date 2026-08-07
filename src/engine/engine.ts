export type Fact = {
  a: number;
  b: number;
};

export type EngineState = {
  fact: Fact;
};

export type AttemptSubmitted = {
  type: "attemptSubmitted";
  answer: number;
};

export type Celebration = "correctness-only" | "none";

export type SubmitAttemptResult = {
  state: EngineState;
  correct: boolean;
  celebration: Celebration;
};

export function createInitialState(fact: Fact): EngineState {
  return { fact };
}

export function submitAttempt(state: EngineState, event: AttemptSubmitted): SubmitAttemptResult {
  const correct = state.fact.a * state.fact.b === event.answer;

  return {
    state,
    correct,
    celebration: correct ? "correctness-only" : "none",
  };
}
