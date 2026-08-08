// Pure computation behind the statistics screen's two grids (ticket
// #12), kept DOM-free like screen.ts / progressMap.ts / route.ts so the
// ratio arithmetic and the exactly-1.0 Mastered boundary are testable
// without a browser. Rendering (which colors, which DOM) lives in
// main.ts; this module only decides which bucket or off-ramp state a
// Fact falls into.
import {
  currentFluencyMs,
  factKey,
  factTargetMs,
  type AccuracyRecord,
  type EngineState,
  type Fact,
  type FluencyRecord,
} from "./engine/engine";

// Both grids share one 0 (worst) - 4 (best) bucket scale (ADR 0004: "the
// rule is uniform across both grids... darker means you're better at
// it" - one encoding, not two) so rendering code can look up a ramp
// color by the same index regardless of which grid it's drawing.
export type RampBucket = 0 | 1 | 2 | 3 | 4;

// CONTEXT.md's Accuracy buckets (ticket #12), deliberately uneven: 100 /
// 90-99 / 75-90 / 50-75 / <50, spread where the data actually lives
// since Accuracy clusters near 100%. `correctShare === 1` is an exact
// equality check on purpose: the EMA (RECENCY_WEIGHT < 1, see engine.ts)
// can only ever equal exactly 1 by never once having blended in a wrong
// observation, so this really does mean "never once missed," not
// "currently rounds to 100%" - once a single wrong Attempt lands, the
// share can approach 1 again but can never return to it exactly.
export function accuracyBucket(correctShare: number): RampBucket {
  if (correctShare === 1) return 4;
  if (correctShare >= 0.9) return 3;
  if (correctShare >= 0.75) return 2;
  if (correctShare >= 0.5) return 1;
  return 0;
}

// A Fact's own target: the fixed progression bar (ADR 0001) plus its
// personal typing allowance (CONTEXT.md) - the same target isMastered
// compares against, so fluencyRatio's 1.0 boundary lines up exactly with
// the Mastered line (ticket #12's central requirement).
// currentFluencyMs / target - the DECAYED value, so the Fluency grid can
// never disagree with isMastered or the Progress map about what "fast"
// means (ticket #12: "so the grid and the Progress map indicator can
// never disagree").
export function fluencyRatio(fact: Fact, fluency: FluencyRecord | undefined, now: number): number {
  return currentFluencyMs(fluency, now) / factTargetMs(fact);
}

// Ticket #12's Fluency buckets: <0.6, 0.6-0.8, 0.8-1.0 || 1.0-1.5, >1.5.
// The break sits at exactly 1.0 via the `< 1.0` / else-`< 1.5` split, so
// a Fact whose ratio is precisely 1.0 lands on the "not yet Mastered"
// side of the boundary - the same side isMastered's strict `< target`
// (i.e. ratio strictly less than 1.0) puts it on.
export function fluencyBucket(ratio: number): RampBucket {
  if (ratio < 0.6) return 4;
  if (ratio < 0.8) return 3;
  if (ratio < 1.0) return 2;
  if (ratio < 1.5) return 1;
  return 0;
}

// The three off-ramp states from ADR 0004, plus the on-ramp "value"
// case. `provisional` marks the dashed-ring case (1-2 Attempts) as a
// property of a normal bucketed cell rather than a fifth mutually
// exclusive state - it still gets a real color, just an uncertain one.
export type CellState =
  | { kind: "locked" }
  | { kind: "unattempted" }
  | { kind: "neverCorrect" }
  | { kind: "value"; bucket: RampBucket; provisional: boolean };

// "Only 1-2 Attempts total" (ticket #12) is provisional regardless of
// which grid is asking - both grids read the same attemptCount off the
// shared AccuracyRecord (see its comment in engine.ts: that field exists
// so the UI can "distinguish provisional... from a trustworthy Accuracy
// figure").
const PROVISIONAL_MAX_ATTEMPTS = 2;

function isInRange(fact: Fact, activeRangeSize: number): boolean {
  return fact.a <= activeRangeSize && fact.b <= activeRangeSize;
}

// Shared skeleton behind classifyAccuracyCell, classifyFluencyCell, and
// factTooltipText: whether a Fact is outside the Active range, has never
// been attempted, or has been attempted but never once answered
// correctly means the same thing regardless of which grid (or the
// tooltip) is asking - only the bucket value for a trustworthy/
// provisional Fact differs per grid, which is why this stops short of
// computing one.
function classifyShared(
  fact: Fact,
  state: Pick<EngineState, "activeRange" | "accuracy">,
): { kind: "locked" | "unattempted" | "neverCorrect" } | { kind: "value"; provisional: boolean; accuracy: AccuracyRecord } {
  if (!isInRange(fact, state.activeRange.size)) return { kind: "locked" };

  const accuracy = state.accuracy[factKey(fact)];
  if (accuracy === undefined) return { kind: "unattempted" };

  // Checked before bucketing on purpose (ADR 0004): "attempted but never
  // once correct" is the page's most actionable signal and must render
  // as amber on BOTH grids, never get folded into whatever bucket a
  // (possibly stale/decayed, possibly nonexistent) Fluency ratio would
  // otherwise land it in.
  if (accuracy.correctShare === 0) return { kind: "neverCorrect" };

  return { kind: "value", provisional: accuracy.attemptCount <= PROVISIONAL_MAX_ATTEMPTS, accuracy };
}

export function classifyAccuracyCell(fact: Fact, state: Pick<EngineState, "activeRange" | "accuracy">): CellState {
  const shared = classifyShared(fact, state);
  if (shared.kind !== "value") return shared;
  return { kind: "value", bucket: accuracyBucket(shared.accuracy.correctShare), provisional: shared.provisional };
}

export function classifyFluencyCell(
  fact: Fact,
  state: Pick<EngineState, "activeRange" | "accuracy" | "fluency">,
  now: number,
): CellState {
  const shared = classifyShared(fact, state);
  if (shared.kind !== "value") return shared;
  const ratio = fluencyRatio(fact, state.fluency[factKey(fact)], now);
  return { kind: "value", bucket: fluencyBucket(ratio), provisional: shared.provisional };
}

// The tap/hover tooltip's text (ADR 0004: "Per-Fact numbers live in a
// tap/hover tooltip, not in the cells"). Deliberately reports only what
// the engine actually tracks - a recency-weighted Accuracy share and a
// lifetime Attempt count, never a literal "N of last 5" - since
// AccuracyRecord has no per-Attempt history to report that honestly
// (see its comment in engine.ts). Shared by both grids: the Fact,
// correctness, and typical response time are the same fact regardless
// of which grid the tap landed on.
export function factTooltipText(
  fact: Fact,
  state: Pick<EngineState, "activeRange" | "accuracy" | "fluency">,
  now: number,
): string {
  const product = fact.a * fact.b;
  const heading = `${fact.a} × ${fact.b} = ${product}`;
  const shared = classifyShared(fact, state);

  switch (shared.kind) {
    case "locked":
      return `${heading} — not yet unlocked`;
    case "unattempted":
      return `${heading} — not attempted yet`;
    case "neverCorrect": {
      const accuracy = state.accuracy[factKey(fact)]!;
      const attempts = accuracy.attemptCount === 1 ? "1 attempt" : `${accuracy.attemptCount} attempts`;
      return `${heading} — ${attempts}, none correct yet`;
    }
    case "value": {
      const attempts = shared.accuracy.attemptCount === 1 ? "1 attempt" : `${shared.accuracy.attemptCount} attempts`;
      const percent = Math.round(shared.accuracy.correctShare * 100);
      const seconds = (currentFluencyMs(state.fluency[factKey(fact)], now) / 1000).toFixed(1);
      return `${heading} — ${percent}% correct (${attempts}), about ${seconds}s`;
    }
  }
}
