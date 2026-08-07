export type Fact = {
  a: number;
  b: number;
};

export type ActiveRange = {
  size: number;
};

export function listFacts(range: ActiveRange): Fact[] {
  const facts: Fact[] = [];
  for (let a = 1; a <= range.size; a++) {
    for (let b = 1; b <= range.size; b++) {
      facts.push({ a, b });
    }
  }
  return facts;
}

export type EngineState = {
  activeRange: ActiveRange;
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

export type Dependencies = {
  random: () => number;
};

function pickFact(range: ActiveRange, deps: Dependencies): Fact {
  const facts = listFacts(range);
  const index = Math.floor(deps.random() * facts.length);
  return facts[index];
}

export function createInitialState(range: ActiveRange, deps: Dependencies): EngineState {
  return { activeRange: range, fact: pickFact(range, deps) };
}

export function submitAttempt(
  state: EngineState,
  event: AttemptSubmitted,
  deps: Dependencies,
): SubmitAttemptResult {
  const correct = state.fact.a * state.fact.b === event.answer;

  return {
    state: { ...state, fact: pickFact(state.activeRange, deps) },
    correct,
    celebration: correct ? "correctness-only" : "none",
  };
}
