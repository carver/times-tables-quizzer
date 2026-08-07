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

export type FactKey = string;

export function factKey(fact: Fact): FactKey {
  return `${fact.a}x${fact.b}`;
}

export type FluencyRecord = {
  averageResponseMs: number;
  lastAttemptAt: number;
};

export type EngineState = {
  activeRange: ActiveRange;
  fact: Fact;
  fluency: Record<FactKey, FluencyRecord>;
  boosted: Record<FactKey, number>;
};

const MS_PER_DAY = 86_400_000;

// A Fact with no Fluency history yet is weighted as if it were this slow,
// so brand-new Facts get practiced before the algorithm has any data to
// otherwise prioritize them by.
export const UNATTEMPTED_WEIGHT_MS = 5_000;

// How much slower (in ms) a Fact's effective response time is treated as
// being, per day it has gone unpracticed - the passive decay from ADR
// 0001 / CONTEXT.md's Fluency definition.
const DECAY_MS_PER_DAY = 50;

// While boosted, a Fact's selection weight is multiplied by this factor
// so it resurfaces soon after a wrong Attempt, without guaranteeing the
// very next question.
const BOOST_WEIGHT_MULTIPLIER = 4;

// How many subsequent Attempts (across any Fact) a boost stays active for
// before fading, even if the boosted Fact is never redrawn.
const BOOST_ATTEMPTS = 5;

// EMA weight given to the newest response time: moderate recency
// weighting, smoothing out one-off slow/fast answers without letting a
// single Attempt dominate the average.
const RECENCY_WEIGHT = 0.3;

// Extra allowance (ms) added to a response-time comparison target for
// each digit beyond the first, so multi-digit answers (e.g. "144") aren't
// held to the same bar as single-digit ones (e.g. "6") purely because
// they take longer to type, not longer to recall.
const PER_DIGIT_ALLOWANCE_MS = 300;

export function typingAllowanceMs(answer: number): number {
  const digitCount = Math.abs(answer).toString().length;
  return (digitCount - 1) * PER_DIGIT_ALLOWANCE_MS;
}

// The Fact's current Fluency, in ms: its stored average plus decay for
// time elapsed since it was last practiced. This is "Fluency" as
// CONTEXT.md defines it - the decay isn't a separate concept layered on
// top, it's part of what "current Fluency" means. Used both as the base
// for selection weight (before the boost multiplier) and as the personal
// baseline for celebration (ticket #6) / the progression check (ticket #7).
export function currentFluencyMs(record: FluencyRecord | undefined, now: number): number {
  return record ? record.averageResponseMs + DECAY_MS_PER_DAY * ((now - record.lastAttemptAt) / MS_PER_DAY) : UNATTEMPTED_WEIGHT_MS;
}

export function computeWeight(fact: Fact, state: Pick<EngineState, "fluency" | "boosted">, now: number): number {
  const key = factKey(fact);
  const baseWeight = currentFluencyMs(state.fluency[key], now);

  const remainingBoost = state.boosted[key] ?? 0;
  return remainingBoost > 0 ? baseWeight * BOOST_WEIGHT_MULTIPLIER : baseWeight;
}

// The fixed automaticity bar for progression (ADR 0001) - the same for
// every Fact, unlike the celebration baseline which is personal per Fact.
export const TARGET_SPEED_MS = 2_000;

// Share of the Active range that must be Mastered before it expands.
export const MASTERY_THRESHOLD = 0.9;

// The full 1-12 x 1-12 grid is the largest Active range; progression stops there.
export const MAX_ACTIVE_RANGE_SIZE = 12;

export function isMastered(fact: Fact, state: Pick<EngineState, "fluency">, now: number): boolean {
  const target = TARGET_SPEED_MS + typingAllowanceMs(fact.a * fact.b);
  return currentFluencyMs(state.fluency[factKey(fact)], now) < target;
}

export function nextActiveRange(state: Pick<EngineState, "activeRange" | "fluency">, now: number): ActiveRange {
  const facts = listFacts(state.activeRange);
  const masteredCount = facts.filter((fact) => isMastered(fact, state, now)).length;
  const isRangeMastered = masteredCount / facts.length >= MASTERY_THRESHOLD;

  if (isRangeMastered && state.activeRange.size < MAX_ACTIVE_RANGE_SIZE) {
    return { size: state.activeRange.size + 1 };
  }
  return state.activeRange;
}

export type AttemptSubmitted = {
  type: "attemptSubmitted";
  answer: number;
  responseTimeMs: number;
};

export type Celebration = "correctness-only" | "personal-best" | "none";

export type SubmitAttemptResult = {
  state: EngineState;
  correct: boolean;
  celebration: Celebration;
};

export type Dependencies = {
  random: () => number;
  now: () => number;
};

function pickFact(state: Pick<EngineState, "activeRange" | "fluency" | "boosted">, deps: Dependencies): Fact {
  const facts = listFacts(state.activeRange);
  const now = deps.now();
  const weights = facts.map((fact) => computeWeight(fact, state, now));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let remainingWeight = deps.random() * totalWeight;
  for (let i = 0; i < facts.length; i++) {
    remainingWeight -= weights[i];
    if (remainingWeight < 0) return facts[i];
  }
  return facts[facts.length - 1];
}

export function createInitialState(range: ActiveRange, deps: Dependencies): EngineState {
  const base = { activeRange: range, fluency: {}, boosted: {} };
  return { ...base, fact: pickFact(base, deps) };
}

function decrementBoosts(boosted: Record<FactKey, number>, exceptKey: FactKey): Record<FactKey, number> {
  const next: Record<FactKey, number> = {};
  for (const [key, remaining] of Object.entries(boosted)) {
    if (key === exceptKey) continue;
    if (remaining > 1) next[key] = remaining - 1;
  }
  return next;
}

export function submitAttempt(
  state: EngineState,
  event: AttemptSubmitted,
  deps: Dependencies,
): SubmitAttemptResult {
  const correct = state.fact.a * state.fact.b === event.answer;
  const key = factKey(state.fact);
  const now = deps.now();

  const boosted = decrementBoosts(state.boosted, key);
  const fluency = { ...state.fluency };
  let celebration: Celebration = "none";

  if (correct) {
    const previous = fluency[key];
    const baselineMs = currentFluencyMs(previous, now);
    const beatsBaseline = previous !== undefined && event.responseTimeMs < baselineMs + typingAllowanceMs(event.answer);
    celebration = beatsBaseline ? "personal-best" : "correctness-only";

    fluency[key] = {
      averageResponseMs: previous
        ? RECENCY_WEIGHT * event.responseTimeMs + (1 - RECENCY_WEIGHT) * previous.averageResponseMs
        : event.responseTimeMs,
      lastAttemptAt: now,
    };
  } else {
    boosted[key] = BOOST_ATTEMPTS;
    // A wrong Attempt doesn't change the average (CONTEXT.md: "a wrong
    // Attempt doesn't feed Fluency"), but it's still practice - so the
    // decay clock, which tracks time since last *practiced* rather than
    // last *correct*, should reset if a record already exists.
    if (fluency[key]) {
      fluency[key] = { ...fluency[key], lastAttemptAt: now };
    }
  }

  const activeRange = nextActiveRange({ activeRange: state.activeRange, fluency }, now);
  const nextState: EngineState = { ...state, activeRange, fluency, boosted };

  return {
    state: { ...nextState, fact: pickFact(nextState, deps) },
    correct,
    celebration,
  };
}
