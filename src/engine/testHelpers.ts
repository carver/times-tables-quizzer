// Shared test-only helpers for building engine states with a precise
// Mastered count, without callers needing to pick actual Facts or care
// which ones ended up Mastered. Used by engine.test.ts (nextActiveRange)
// and progressMap.test.ts, which both need to dial in a masteredCount
// against a given Active range.
import { listFacts, TARGET_SPEED_MS, type ActiveRange, type EngineState } from "./engine";

export function stateWithMasteredCount(
  range: ActiveRange,
  masteredCount: number,
): Pick<EngineState, "activeRange" | "fluency" | "needsRedemption"> {
  const facts = listFacts(range);
  const fluency: EngineState["fluency"] = {};
  facts.forEach((fact, i) => {
    fluency[`${fact.a}x${fact.b}`] = {
      averageResponseMs: i < masteredCount ? 100 : TARGET_SPEED_MS + 10_000,
      lastAttemptAt: 0,
    };
  });
  return { activeRange: range, fluency, needsRedemption: {} };
}
