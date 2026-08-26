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

// A per-Fact, recency-weighted share of correct Attempts (CONTEXT.md).
// Unlike FluencyRecord this deliberately carries no "lastAttemptAt" /
// decay input. Accuracy does not decay with time, so there is nothing
// for a decay function to read. It is display-only: nothing in this
// module may consult it when computing selection weight or the
// progression threshold.
export type AccuracyRecord = {
  // EMA of correctness (1 for a correct Attempt, 0 for wrong), blended
  // with RECENCY_WEIGHT, the same weighting Fluency uses, so there's one
  // mental model for "recency-weighted" rather than two.
  correctShare: number;
  // Lifetime Attempt count for this Fact (correct or not). This is what
  // lets the UI (ticket #12's statistics grids) distinguish "provisional,
  // only 1-2 Attempts" from a trustworthy Accuracy figure.
  attemptCount: number;
};

export type StreakState = {
  count: number;
  // The calendar day (see dayKey) the Streak count last incremented on,
  // and the last day with at least one Attempt (possibly later, if
  // practiced-but-not-recovered days followed). null means "never".
  lastStreakDay: string | null;
  lastActivityDay: string | null;
  // Frozen while lastActivityDay keeps advancing (practicing, even
  // without recovering); only grows on days with zero Attempts.
  missedDays: number;
};

// Timestamps (ms) marking when each Active range size was first reached,
// keyed by `size`. Populated once at creation for the starting size, and
// again on every expansion in submitAttempt. Cheap to capture now,
// unrecoverable later if we don't (ticket #10).
export type RangeHistory = Record<number, number>;

export type EngineState = {
  activeRange: ActiveRange;
  fact: Fact;
  fluency: Record<FactKey, FluencyRecord>;
  accuracy: Record<FactKey, AccuracyRecord>;
  boosted: Record<FactKey, number>;
  // ADR 0003: true while a Fact has been answered wrong more recently
  // than it's been answered right, blocking it from counting as Mastered
  // until redeemed. Deliberately separate from `boosted`: boosts expire
  // after BOOST_ATTEMPTS Attempts across *any* Fact, which would let a
  // wrong Fact quietly re-qualify as Mastered without ever being
  // redrawn (see ADR 0003). Absent/false means no redemption owed;
  // cleared by the Fact's next correct Attempt, never by elapsed time or
  // other Facts' Attempts.
  needsRedemption: Record<FactKey, boolean>;
  rangeHistory: RangeHistory;
  // The highest Active range size the Learner has actually seen a
  // range-expansion takeover dismissed for, not only reached. The two
  // can diverge: a takeover queued but never shown/dismissed (e.g. the
  // app closing at exactly the wrong moment) leaves this behind
  // `activeRange.size`, which is what main.ts's boot-time catch-up
  // (celebrationQueue.ts's missedRangeExpansionTakeovers) checks for.
  // It's never dropped silently just because progress itself was persisted.
  acknowledgedRangeSize: number;
  streak: StreakState;
  // Count of distinct calendar days (dayKey) with at least one Attempt,
  // for ticket #12's statistics header ("days practiced and current Streak,
  // and nothing else"). Deliberately separate from `streak`: a broken
  // Streak resets streak.count to effectively restart counting
  // consecutive days, but days practiced is a lifetime total that must
  // never go down. Incremented in submitAttempt by comparing against
  // streak.lastActivityDay (the pre-update value) rather than
  // maintaining a second day-tracking mechanism.
  practiceDayCount: number;
};

const MS_PER_DAY = 86_400_000;

// A Fact with no Fluency history yet is weighted as if it were this slow,
// so brand-new Facts get practiced before the algorithm has any data to
// otherwise prioritize them by.
export const UNATTEMPTED_WEIGHT_MS = 5_000;

// How much slower (in ms) a Fact's effective response time is treated as
// being, per day it has gone unpracticed: the passive decay from ADR
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

// Extra allowance (ms) added to the progression target for each digit
// beyond the first, so multi-digit answers (e.g. "144") aren't held to
// the same bar as single-digit ones (e.g. "6") purely because they take
// longer to type, not longer to recall. Raised from 300ms after watching
// a nine-year-old actually use the keypad.
const PER_DIGIT_ALLOWANCE_MS = 500;

export function typingAllowanceMs(answer: number): number {
  const digitCount = Math.abs(answer).toString().length;
  return (digitCount - 1) * PER_DIGIT_ALLOWANCE_MS;
}

// The Fact's current Fluency, in ms: its stored average plus decay for
// time elapsed since it was last practiced. This is "Fluency" as
// CONTEXT.md defines it. The decay isn't a separate concept layered on
// top; it's part of what "current Fluency" means. Used both as the base
// for selection weight (before the boost multiplier) and as the personal
// baseline for celebration (ticket #6) / the progression check (ticket #7).
export function currentFluencyMs(record: FluencyRecord | undefined, now: number): number {
  return record ? record.averageResponseMs + DECAY_MS_PER_DAY * ((now - record.lastAttemptAt) / MS_PER_DAY) : UNATTEMPTED_WEIGHT_MS;
}

// How sharply selection favours the Facts the Learner is slowest on.
// Weight is the Fact's Fluency expressed as a multiple of its own target
// (see factTargetMs) raised to this power. At 1 (which is effectively
// what weighting by raw milliseconds did) a range with 23 fluent Facts
// and 2 stubborn ones sent 73% of questions to Facts already fluent,
// because 23 small weights outnumber 2 large ones. Squaring pulls that
// to 50%, and the same-day damper below takes it to 18%. See ADR 0005.
const WEIGHT_EXPONENT = 2;

// Additional damping for a Mastered Fact that has already been practiced
// today. Keeps a session from spending its back half re-asking Facts the
// Learner has already demonstrated today, without ever excluding them:
// a hard "not again until tomorrow" rule collapses the pool to a handful
// of Facts exactly when the range is near 90% Mastered, and drilling the
// same two Facts back to back is the predictable, demoralizing pattern
// the weighted-random design exists to avoid.
const SAME_DAY_MASTERED_DAMPER = 0.25;

// The minimum share of drawn Facts that must be ones the Learner has not
// Mastered yet: the Facts standing between them and the next Active
// range expansion (or, at the top range, between them and mastering the
// whole grid). See ADR 0008.
//
// This is the primary tuning knob for "practice isn't spending enough
// time on what I still need". It is a *floor*, never a cap: when the
// natural weighting already sends more than this share to unmastered
// Facts (right after an expansion, say, when the new row and column are
// all unattempted), nothing is rescaled. 0 disables the floor entirely
// and restores pure ADR 0005 weighting; 1 would draw nothing but
// unmastered Facts, which is deliberately not the default. See the ADR
// on why mastered Facts must stay in the pool.
export const UNMASTERED_SHARE_FLOOR = 0.5;

// The response-time bar this Fact is held to: the fixed automaticity
// target (the same recall bar for every Fact, ADR 0001) plus its own
// typing allowance. Shared by the progression check and by selection
// weighting, so "how far off the pace is this Fact" means one thing.
export function factTargetMs(fact: Fact): number {
  return TARGET_SPEED_MS + typingAllowanceMs(fact.a * fact.b);
}

function practicedOn(record: FluencyRecord | undefined, now: number): boolean {
  return record !== undefined && dayKey(record.lastAttemptAt) === dayKey(now);
}

export function computeWeight(
  fact: Fact,
  state: Pick<EngineState, "fluency" | "boosted" | "needsRedemption">,
  now: number,
): number {
  const key = factKey(fact);
  const record = state.fluency[key];

  // Fluency as a multiple of this Fact's own target: below 1 is at or
  // past the bar, above 1 is behind it. Normalizing here (rather than
  // weighting by raw milliseconds) is what makes the exponent meaningful.
  // It's the same ratio the Fluency grid buckets by.
  const ratio = currentFluencyMs(record, now) / factTargetMs(fact);
  let weight = Math.pow(ratio, WEIGHT_EXPONENT);

  if (practicedOn(record, now) && isMastered(fact, state, now)) {
    weight *= SAME_DAY_MASTERED_DAMPER;
  }

  const remainingBoost = state.boosted[key] ?? 0;
  return remainingBoost > 0 ? weight * BOOST_WEIGHT_MULTIPLIER : weight;
}

// The weights a draw actually runs on: every candidate's computeWeight,
// with the not-yet-Mastered ones scaled up together if they'd otherwise
// account for less than UNMASTERED_SHARE_FLOOR of the total (ADR 0008).
//
// Scaling the group as a whole, rather than picking a Fact from a
// reserved pool, is what keeps every other selection rule intact: the
// slowest unmastered Fact is still the likeliest of them, boosts and the
// same-day damper still apply, and mastered Facts keep the long tail
// that ADR 0005 deliberately refused to cut off. It also costs no extra
// draw from the random source, so a caller's single `random()` still
// maps to a single Fact.
export function selectionWeights(
  facts: Fact[],
  state: Pick<EngineState, "fluency" | "boosted" | "needsRedemption">,
  now: number,
): number[] {
  const weights = facts.map((fact) => computeWeight(fact, state, now));
  const unmastered = facts.map((fact) => !isMastered(fact, state, now));

  const unmasteredWeight = weights.reduce((sum, weight, i) => (unmastered[i] ? sum + weight : sum), 0);
  const masteredWeight = weights.reduce((sum, weight, i) => (unmastered[i] ? sum : sum + weight), 0);

  // Nothing to lift (every candidate is already Mastered), nothing to
  // lift *against* (they all still need mastering, so they hold 100% of
  // the weight anyway), or the natural weighting already clears the
  // floor. The last case is the common one straight after an expansion.
  const total = unmasteredWeight + masteredWeight;
  if (unmasteredWeight === 0 || masteredWeight === 0 || total === 0) return weights;
  if (unmasteredWeight / total >= UNMASTERED_SHARE_FLOOR) return weights;
  if (UNMASTERED_SHARE_FLOOR >= 1) return weights.map((weight, i) => (unmastered[i] ? weight : 0));

  // Scale the unmastered group so it holds exactly the floor's share:
  // solving u' / (u' + m) = F for u' gives u' = m * F / (1 - F).
  const scale = ((masteredWeight * UNMASTERED_SHARE_FLOOR) / (1 - UNMASTERED_SHARE_FLOOR)) / unmasteredWeight;
  return weights.map((weight, i) => (unmastered[i] ? weight * scale : weight));
}

// The fixed automaticity bar for progression (ADR 0001), the same for
// every Fact, unlike the celebration baseline which is personal per Fact.
// Raised from 2000ms: the clock starts when the prompt renders, so it is
// paying for reading the Fact, recalling it, tapping the digits, and
// pressing Enter, and 2s proved a tight bar for a nine-year-old.
export const TARGET_SPEED_MS = 2_500;

// A response time this long isn't a slow answer, it's a Learner who
// walked away mid-question and came back. The fact prompt has no
// timeout of its own, so responseTimeMs is otherwise unbounded. Clamping
// it keeps a single abandoned-and-resumed question from corrupting
// Fluency's average or falsely winning "personal best".
export const MAX_RESPONSE_MS = 30_000;

// Share of the Active range that must be Mastered before it expands.
export const MASTERY_THRESHOLD = 0.9;

// The full 1-12 x 1-12 grid is the largest Active range; progression stops there.
export const MAX_ACTIVE_RANGE_SIZE = 12;

// ADR 0003: Mastered requires both the speed bar (ADR 0001, unchanged)
// and redemption: a Fact the Learner has just gotten wrong doesn't
// count, however fast its stored Fluency looks, until it's been answered
// correctly again.
export function isMastered(fact: Fact, state: Pick<EngineState, "fluency" | "needsRedemption">, now: number): boolean {
  if (state.needsRedemption[factKey(fact)]) return false;

  return currentFluencyMs(state.fluency[factKey(fact)], now) < factTargetMs(fact);
}

export function nextActiveRange(
  state: Pick<EngineState, "activeRange" | "fluency" | "needsRedemption">,
  now: number,
): ActiveRange {
  const facts = listFacts(state.activeRange);
  const masteredCount = facts.filter((fact) => isMastered(fact, state, now)).length;
  const isRangeMastered = masteredCount / facts.length >= MASTERY_THRESHOLD;

  if (isRangeMastered && state.activeRange.size < MAX_ACTIVE_RANGE_SIZE) {
    return { size: state.activeRange.size + 1 };
  }
  return state.activeRange;
}

// Every Streak count that's a multiple of this triggers a Milestone.
export const MILESTONE_INTERVAL = 7;

export type DayKey = string;

// The Learner's local calendar day, not UTC. A "day" for Streak
// purposes means the day as the Learner (a specific person in one place,
// not a server) experiences it. Using UTC would let an evening practice
// session get miscounted as the next day, or vice versa, depending on
// the Learner's timezone offset.
export function dayKey(ms: number): DayKey {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(laterDayKey: DayKey, earlierDayKey: DayKey): number {
  const toLocalMidnight = (key: DayKey) => {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day).getTime();
  };
  return Math.round((toLocalMidnight(laterDayKey) - toLocalMidnight(earlierDayKey)) / MS_PER_DAY);
}

export type AdvanceStreakResult = {
  streak: StreakState;
  hitMilestone: boolean;
};

// How many calendar days have had zero Attempts since `lastActivityDay`,
// given a new day boundary has just been crossed. Days with any Attempt
// (even one that failed to recover the Streak) never count, per the
// freeze-while-practicing rule. Only true zero-Attempt gaps do.
function accrueMissedDays(streak: StreakState, today: DayKey): number {
  if (streak.lastActivityDay === null || streak.lastActivityDay === today) {
    return streak.missedDays;
  }
  return streak.missedDays + (daysBetween(today, streak.lastActivityDay) - 1);
}

// Runs on every Attempt (correct or not; Streak only cares about
// practice happening, per CONTEXT.md). `roll` is a [0, 1) draw from the
// injected random source, kept as an explicit parameter (rather than
// pulled from Dependencies internally) so recovery odds are exercised
// deterministically in tests without threading a whole Dependencies
// object through this pure function.
export function advanceStreak(streak: StreakState, now: number, roll: number): AdvanceStreakResult {
  const today = dayKey(now);

  if (streak.lastStreakDay === today) {
    // Already credited today, so no more rolls needed (ADR 0002: "Rolling
    // stops once recovery succeeds, or after the first Attempt on an
    // unbroken day").
    return { streak, hitMilestone: false };
  }

  const missedDays = accrueMissedDays(streak, today);
  const recovered = roll < 1 / (missedDays + 1);

  if (recovered) {
    const count = streak.count + 1;
    return {
      streak: { count, lastStreakDay: today, lastActivityDay: today, missedDays: 0 },
      hitMilestone: count % MILESTONE_INTERVAL === 0,
    };
  }

  return { streak: { ...streak, lastActivityDay: today, missedDays }, hitMilestone: false };
}

export type AttemptSubmitted = {
  type: "attemptSubmitted";
  answer: number;
  responseTimeMs: number;
};

export type CelebrationKind = "correctness-only" | "personal-best" | "milestone" | "range-expansion";

// CONTEXT.md's Celebration entry: inline plays over the practice screen
// without interrupting; takeover fills the screen and waits to be
// dismissed. The tag is a fixed property of the kind (not a per-Attempt
// choice); see CELEBRATION_TAGS.
export type CelebrationTag = "inline" | "takeover";

export type Celebration = {
  kind: CelebrationKind;
  tag: CelebrationTag;
  // The Active range size this expansion reached. Only meaningful (and
  // always present) for kind "range-expansion". Threaded through rather
  // than read live off `activeRange.size` at display time, since a
  // boot-time catch-up (celebrationQueue.ts's missedRangeExpansionTakeovers)
  // can replay several past expansions in order, each needing its own
  // size for the takeover's grid. By the time they're shown,
  // `activeRange.size` has already moved past all of them.
  rangeSize?: number;
};

// milestone and range-expansion mark rare, weeks-in-the-making moments
// and get the interrupting takeover treatment; correctness-only and
// personal-best happen constantly during normal play and stay inline so
// they never block the next Attempt.
const CELEBRATION_TAGS: Record<CelebrationKind, CelebrationTag> = {
  "correctness-only": "inline",
  "personal-best": "inline",
  milestone: "takeover",
  "range-expansion": "takeover",
};

export function celebration(kind: CelebrationKind, rangeSize?: number): Celebration {
  return { kind, tag: CELEBRATION_TAGS[kind], rangeSize };
}

// A single Attempt can plausibly be a personal best, expand the Active
// range, AND hit a Milestone simultaneously, the best moment the app
// will ever produce. `celebrations` is a set (as an array; each kind can
// appear at most once per Attempt) so none of those get silently
// dropped in favor of another, the way `milestone` used to overwrite
// `personal-best` before this ticket.
export type SubmitAttemptResult = {
  state: EngineState;
  correct: boolean;
  celebrations: Celebration[];
};

export type Dependencies = {
  random: () => number;
  now: () => number;
};

// Draws one Fact at random, weighted by selectionWeights, so the floor
// on still-to-master Facts (ADR 0008) is measured over the candidates
// that can be drawn, after the exclusion below, not over the whole
// Active range.
//
// Hard-excludes `previousKey` (the Fact just answered, if any) from the
// draw whenever another Fact is available, so the same problem can never
// appear twice in a row. Weighting alone doesn't guarantee this: a Fact
// that's just been answered wrong is boosted (BOOST_WEIGHT_MULTIPLIER)
// and, if the Learner is genuinely stuck on it, gets re-boosted to the
// same full weight on every subsequent wrong Attempt on it, a real
// feedback loop that can otherwise dominate the draw for many Attempts
// in a row. Falls back to including it when it's the only Fact in the
// Active range (size 1), rather than looping forever with an empty
// candidate list.
function pickFact(
  state: Pick<EngineState, "activeRange" | "fluency" | "boosted" | "needsRedemption">,
  deps: Dependencies,
  previousKey?: FactKey,
): Fact {
  const allFacts = listFacts(state.activeRange);
  const facts =
    previousKey !== undefined && allFacts.length > 1 ? allFacts.filter((fact) => factKey(fact) !== previousKey) : allFacts;
  const now = deps.now();
  const weights = selectionWeights(facts, state, now);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let remainingWeight = deps.random() * totalWeight;
  for (let i = 0; i < facts.length; i++) {
    remainingWeight -= weights[i];
    if (remainingWeight < 0) return facts[i];
  }
  return facts[facts.length - 1];
}

export const NEW_STREAK: StreakState = { count: 0, lastStreakDay: null, lastActivityDay: null, missedDays: 0 };

export function createInitialState(range: ActiveRange, deps: Dependencies): EngineState {
  const base = {
    activeRange: range,
    fluency: {},
    accuracy: {},
    boosted: {},
    needsRedemption: {},
    // The starting size counts as "reached" the moment there's a state
    // to have a history at all, same as every later expansion.
    rangeHistory: { [range.size]: deps.now() },
    // The starting size was never earned, so it needs no celebration.
    // Same reasoning as rangeHistory just above.
    acknowledgedRangeSize: range.size,
    streak: NEW_STREAK,
    // No Attempt has happened yet. The first submitAttempt call is what
    // brings this to 1 (same "nothing counts until an Attempt actually
    // happens" rule NEW_STREAK follows).
    practiceDayCount: 0,
  };
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

// EMA-blends Accuracy the same way Fluency blends response times
// (RECENCY_WEIGHT), but over correctness (1/0) instead of milliseconds,
// and with no decay term: Accuracy does not fade with elapsed time.
function updateAccuracy(previous: AccuracyRecord | undefined, correct: boolean): AccuracyRecord {
  const observation = correct ? 1 : 0;
  return {
    correctShare: previous ? RECENCY_WEIGHT * observation + (1 - RECENCY_WEIGHT) * previous.correctShare : observation,
    attemptCount: (previous?.attemptCount ?? 0) + 1,
  };
}

function clearRedemption(needsRedemption: Record<FactKey, boolean>, key: FactKey): Record<FactKey, boolean> {
  if (!needsRedemption[key]) return needsRedemption;
  const next = { ...needsRedemption };
  delete next[key];
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
  const responseTimeMs = Math.min(event.responseTimeMs, MAX_RESPONSE_MS);

  const boosted = decrementBoosts(state.boosted, key);
  const fluency = { ...state.fluency };
  const accuracy = { ...state.accuracy, [key]: updateAccuracy(state.accuracy[key], correct) };
  let needsRedemption = state.needsRedemption;
  const celebrations: Celebration[] = [];

  if (correct) {
    const previous = fluency[key];
    const baselineMs = currentFluencyMs(previous, now);
    // No typing allowance here, deliberately. This compares a Fact
    // against its own past times, so the typing is identical on both
    // sides and cancels. Adding the allowance was pure slack, handing
    // out "personal best" for answers *slower* than the Learner's own
    // average by the whole allowance. The allowance belongs on the
    // progression target, where it compares different Facts to a shared
    // bar and the digit count genuinely differs.
    const beatsBaseline = previous !== undefined && responseTimeMs < baselineMs;
    celebrations.push(celebration(beatsBaseline ? "personal-best" : "correctness-only"));

    fluency[key] = {
      averageResponseMs: previous
        ? RECENCY_WEIGHT * responseTimeMs + (1 - RECENCY_WEIGHT) * previous.averageResponseMs
        : responseTimeMs,
      lastAttemptAt: now,
    };

    // ADR 0003: this Fact has now been answered correctly since its most
    // recent wrong Attempt (if any), so it no longer owes redemption.
    needsRedemption = clearRedemption(state.needsRedemption, key);
  } else {
    boosted[key] = BOOST_ATTEMPTS;
    // ADR 0003: blocks this Fact from counting as Mastered until it's
    // answered correctly again, independent of `boosted`, which expires
    // on a fixed Attempt count instead of on evidence.
    needsRedemption = { ...state.needsRedemption, [key]: true };
    // A wrong Attempt doesn't change the average (CONTEXT.md: "a wrong
    // Attempt doesn't feed Fluency"), but it's still practice, so the
    // decay clock, which tracks time since last *practiced* rather than
    // last *correct*, should reset if a record already exists.
    if (fluency[key]) {
      fluency[key] = { ...fluency[key], lastAttemptAt: now };
    }
  }

  const activeRange = nextActiveRange({ activeRange: state.activeRange, fluency, needsRedemption }, now);
  const expanded = activeRange.size !== state.activeRange.size;
  const rangeHistory = expanded ? { ...state.rangeHistory, [activeRange.size]: now } : state.rangeHistory;
  if (expanded) celebrations.push(celebration("range-expansion", activeRange.size));

  // Compared against the PRE-update streak (not the `streak` advanceStreak
  // returns below) since lastActivityDay advances to `today` on every
  // Attempt regardless of whether the Streak itself recovers. This is
  // "first Attempt of a not-yet-seen calendar day," not "Streak credited
  // today" (ticket #12's days-practiced count must keep climbing even on
  // days that fail to recover a broken Streak).
  const isNewPracticeDay = state.streak.lastActivityDay !== dayKey(now);
  const practiceDayCount = state.practiceDayCount + (isNewPracticeDay ? 1 : 0);

  const { streak, hitMilestone } = advanceStreak(state.streak, now, deps.random());
  if (hitMilestone) celebrations.push(celebration("milestone"));

  const nextState: EngineState = {
    ...state,
    activeRange,
    fluency,
    accuracy,
    boosted,
    needsRedemption,
    rangeHistory,
    streak,
    practiceDayCount,
  };

  return {
    state: { ...nextState, fact: pickFact(nextState, deps, key) },
    correct,
    celebrations,
  };
}
