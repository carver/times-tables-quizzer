import { describe, expect, it } from "vitest";
import {
  factTargetMs,
  TARGET_SPEED_MS,
  typingAllowanceMs,
  type AccuracyRecord,
  type EngineState,
  type FluencyRecord,
} from "./engine/engine";
import {
  accuracyBucket,
  classifyAccuracyCell,
  classifyFluencyCell,
  factTooltipText,
  fluencyBucket,
  fluencyRatio,
} from "./stats";

const FACT = { a: 7, b: 8 }; // product 56: two digits, so one typing allowance on its target

function stateWith(overrides: {
  activeRangeSize?: number;
  accuracy?: Record<string, AccuracyRecord>;
  fluency?: Record<string, FluencyRecord>;
}): Pick<EngineState, "activeRange" | "accuracy" | "fluency"> {
  return {
    activeRange: { size: overrides.activeRangeSize ?? 12 },
    accuracy: overrides.accuracy ?? {},
    fluency: overrides.fluency ?? {},
  };
}

describe("accuracyBucket", () => {
  it("buckets 100% (exact equality) as the top bucket", () => {
    expect(accuracyBucket(1)).toBe(4);
  });

  it("buckets 90-99% as bucket 3, with 0.9 itself included", () => {
    expect(accuracyBucket(0.99)).toBe(3);
    expect(accuracyBucket(0.9)).toBe(3);
  });

  it("buckets just under 0.9 as bucket 2 (75-90%)", () => {
    expect(accuracyBucket(0.899999)).toBe(2);
    expect(accuracyBucket(0.75)).toBe(2);
  });

  it("buckets just under 0.75 as bucket 1 (50-75%)", () => {
    expect(accuracyBucket(0.749999)).toBe(1);
    expect(accuracyBucket(0.5)).toBe(1);
  });

  it("buckets under 50% as bucket 0", () => {
    expect(accuracyBucket(0.499999)).toBe(0);
    expect(accuracyBucket(0)).toBe(0);
  });
});

describe("factTargetMs / fluencyRatio", () => {
  it("adds the Fact's own typing allowance to the fixed target speed", () => {
    expect(factTargetMs(FACT)).toBe(TARGET_SPEED_MS + typingAllowanceMs(56));
  });

  it("uses the decayed currentFluencyMs, not the raw stored average", () => {
    const target = factTargetMs(FACT);
    const DAY_MS = 86_400_000;
    // Stored average sits well under target, but the record is 10 days
    // stale. Decay (50ms/day, engine.ts) should push the ratio up from
    // what the raw average alone would give.
    const fluency: FluencyRecord = { averageResponseMs: target * 0.5, lastAttemptAt: 0 };
    const now = 10 * DAY_MS;

    const ratio = fluencyRatio(FACT, fluency, now);

    expect(ratio).toBeCloseTo((target * 0.5 + 50 * 10) / target, 10);
    expect(ratio).toBeGreaterThan(0.5); // decay actually moved it off the raw-average ratio
  });

  it("treats an unattempted Fact as UNATTEMPTED_WEIGHT_MS, same as the engine's own selection weight", () => {
    const ratio = fluencyRatio(FACT, undefined, 0);
    expect(ratio).toBeCloseTo(5000 / factTargetMs(FACT), 10);
  });
});

describe("fluencyBucket", () => {
  it("buckets under 0.6 as the fastest bucket", () => {
    expect(fluencyBucket(0.599999)).toBe(4);
  });

  it("buckets 0.6-0.8 as bucket 3, with 0.6 itself included", () => {
    expect(fluencyBucket(0.6)).toBe(3);
    expect(fluencyBucket(0.799999)).toBe(3);
  });

  it("buckets 0.8 up to (not including) 1.0 as bucket 2, the fastest Mastered-eligible bucket", () => {
    expect(fluencyBucket(0.8)).toBe(2);
    expect(fluencyBucket(0.999999)).toBe(2);
  });

  it("puts a ratio of EXACTLY 1.0 on the not-yet-Mastered side of the boundary (bucket 1, not bucket 2)", () => {
    expect(fluencyBucket(1.0)).toBe(1);
  });

  it("buckets 1.0-1.5 as bucket 1, and >=1.5 as the slowest bucket 0", () => {
    expect(fluencyBucket(1.499999)).toBe(1);
    expect(fluencyBucket(1.5)).toBe(0);
  });
});

describe("classifyAccuracyCell / classifyFluencyCell", () => {
  it("classifies a Fact outside the Active range as locked, regardless of any (impossible in practice) history", () => {
    const state = stateWith({ activeRangeSize: 5, accuracy: { "7x8": { correctShare: 1, attemptCount: 10 } } });

    expect(classifyAccuracyCell(FACT, state)).toEqual({ kind: "locked" });
    expect(classifyFluencyCell(FACT, state, 0)).toEqual({ kind: "locked" });
  });

  it("classifies a Fact with no AccuracyRecord as unattempted on both grids", () => {
    const state = stateWith({});

    expect(classifyAccuracyCell(FACT, state)).toEqual({ kind: "unattempted" });
    expect(classifyFluencyCell(FACT, state, 0)).toEqual({ kind: "unattempted" });
  });

  it("classifies a Fact attempted but never once correct as neverCorrect on BOTH grids, not bucketed by Fluency", () => {
    const state = stateWith({ accuracy: { "7x8": { correctShare: 0, attemptCount: 2 } } });

    expect(classifyAccuracyCell(FACT, state)).toEqual({ kind: "neverCorrect" });
    // No correct Attempt ever landed, so there's no fluency record either
    // (engine.ts only writes fluency on a correct Attempt). The Fluency
    // grid must not try to bucket that absence, it shows the same amber.
    expect(classifyFluencyCell(FACT, state, 0)).toEqual({ kind: "neverCorrect" });
  });

  it("marks a Fact with 1-2 Attempts as provisional, carrying a real bucket alongside the dashed-ring flag", () => {
    const state = stateWith({
      accuracy: { "7x8": { correctShare: 1, attemptCount: 1 } },
      fluency: { "7x8": { averageResponseMs: 500, lastAttemptAt: 0 } },
    });

    expect(classifyAccuracyCell(FACT, state)).toEqual({ kind: "value", bucket: 4, provisional: true });
    expect(classifyFluencyCell(FACT, state, 0)).toEqual({ kind: "value", bucket: 4, provisional: true });
  });

  it("does not mark a Fact with 3+ Attempts as provisional", () => {
    const state = stateWith({
      accuracy: { "7x8": { correctShare: 1, attemptCount: 3 } },
      fluency: { "7x8": { averageResponseMs: 500, lastAttemptAt: 0 } },
    });

    expect(classifyAccuracyCell(FACT, state)).toEqual({ kind: "value", bucket: 4, provisional: false });
    expect(classifyFluencyCell(FACT, state, 0)).toEqual({ kind: "value", bucket: 4, provisional: false });
  });

  it("lands a Fact sitting at exactly ratio 1.0 in Fluency bucket 1, matching the target-speed boundary", () => {
    const target = factTargetMs(FACT);
    const state = stateWith({
      accuracy: { "7x8": { correctShare: 1, attemptCount: 5 } },
      fluency: { "7x8": { averageResponseMs: target, lastAttemptAt: 0 } },
    });

    expect(classifyFluencyCell(FACT, state, 0)).toEqual({ kind: "value", bucket: 1, provisional: false });
  });
});

describe("factTooltipText", () => {
  it("reports a locked Fact as not yet unlocked", () => {
    const state = stateWith({ activeRangeSize: 5 });
    expect(factTooltipText(FACT, state, 0)).toBe("7 × 8 = 56 — not yet unlocked");
  });

  it("reports an unattempted Fact plainly", () => {
    const state = stateWith({});
    expect(factTooltipText(FACT, state, 0)).toBe("7 × 8 = 56 — not attempted yet");
  });

  it("reports a never-correct Fact's Attempt count without a time (none exists)", () => {
    const state = stateWith({ accuracy: { "7x8": { correctShare: 0, attemptCount: 2 } } });
    expect(factTooltipText(FACT, state, 0)).toBe("7 × 8 = 56 — 2 attempts, none correct yet");
  });

  it("singularizes a single never-correct Attempt", () => {
    const state = stateWith({ accuracy: { "7x8": { correctShare: 0, attemptCount: 1 } } });
    expect(factTooltipText(FACT, state, 0)).toBe("7 × 8 = 56 — 1 attempt, none correct yet");
  });

  it("reports percent correct, Attempt count, and current Fluency in seconds for a bucketed Fact", () => {
    const state = stateWith({
      accuracy: { "7x8": { correctShare: 0.92, attemptCount: 12 } },
      fluency: { "7x8": { averageResponseMs: 2300, lastAttemptAt: 0 } },
    });

    expect(factTooltipText(FACT, state, 0)).toBe("7 × 8 = 56 — 92% correct (12 attempts), about 2.3s");
  });
});
