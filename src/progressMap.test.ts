import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_RANGE_SIZE } from "./engine/engine";
import { stateWithMasteredCount } from "./engine/testHelpers";
import { advanceHighWaterMark, computeProgressMapStatus, type ProgressHighWaterMark } from "./progressMap";

describe("advanceHighWaterMark", () => {
  it("starts a fresh mark at the given masteredCount when there is no previous one", () => {
    const mark = advanceHighWaterMark(null, 5, 10);

    expect(mark).toEqual({ activeRangeSize: 5, masteredCount: 10 });
  });

  it("keeps the higher of the previous and new masteredCount for the same size", () => {
    const previous: ProgressHighWaterMark = { activeRangeSize: 5, masteredCount: 15 };

    expect(advanceHighWaterMark(previous, 5, 10)).toEqual({ activeRangeSize: 5, masteredCount: 15 });
    expect(advanceHighWaterMark(previous, 5, 20)).toEqual({ activeRangeSize: 5, masteredCount: 20 });
  });

  it("resets to the new masteredCount when the Active range size changes, a new frontier", () => {
    const previous: ProgressHighWaterMark = { activeRangeSize: 5, masteredCount: 23 };

    // Expansion to 6x6 drops the mastered share instantly (CONTEXT.md).
    // The new size's mark must not inherit the old size's high point.
    expect(advanceHighWaterMark(previous, 6, 3)).toEqual({ activeRangeSize: 6, masteredCount: 3 });
  });
});

describe("computeProgressMapStatus", () => {
  it("shows a count remaining, not a percentage, below MAX_ACTIVE_RANGE_SIZE", () => {
    const state = stateWithMasteredCount({ size: 5 }, 20); // 25 facts, 90% needs 23

    const { readout } = computeProgressMapStatus(state, 0, null);

    expect(readout).toEqual({ kind: "remaining", count: 3 });
  });

  it("shows zero remaining once the Mastered threshold is already met", () => {
    const state = stateWithMasteredCount({ size: 5 }, 25);

    const { readout } = computeProgressMapStatus(state, 0, null);

    expect(readout).toEqual({ kind: "remaining", count: 0 });
  });

  it("switches to a maintenance readout of Mastered-out-of-144 at MAX_ACTIVE_RANGE_SIZE", () => {
    const state = stateWithMasteredCount({ size: MAX_ACTIVE_RANGE_SIZE }, 142);

    const { readout } = computeProgressMapStatus(state, 0, null);

    expect(readout).toEqual({ kind: "maintenance", masteredCount: 142, totalCount: 144 });
  });

  it("is monotonic within a session: a later drop in masteredCount doesn't lower the remaining-count readout", () => {
    const strong = stateWithMasteredCount({ size: 5 }, 23); // hits the 90% bar, count = 0
    const first = computeProgressMapStatus(strong, 0, null);
    expect(first.readout).toEqual({ kind: "remaining", count: 0 });

    // Fluency decay or a wrong Attempt drags masteredCount back down,
    // losing ground for real, but the displayed count must not retreat.
    const weaker = stateWithMasteredCount({ size: 5 }, 18);
    const second = computeProgressMapStatus(weaker, 1, first.highWaterMark);

    expect(second.readout).toEqual({ kind: "remaining", count: 0 });
  });

  it("lets the remaining count keep improving as masteredCount genuinely climbs within a session", () => {
    const start = stateWithMasteredCount({ size: 5 }, 15);
    const first = computeProgressMapStatus(start, 0, null);
    expect(first.readout).toEqual({ kind: "remaining", count: 8 }); // needs 23, has 15

    const better = stateWithMasteredCount({ size: 5 }, 20);
    const second = computeProgressMapStatus(better, 1, first.highWaterMark);

    expect(second.readout).toEqual({ kind: "remaining", count: 3 });
  });

  it("lets the readout genuinely drop right after an expansion, since the new size is a fresh frontier", () => {
    // Session high-water mark built up against the 5x5 range, fully Mastered.
    const masteredFive = stateWithMasteredCount({ size: 5 }, 25);
    const beforeExpansion = computeProgressMapStatus(masteredFive, 0, null);
    expect(beforeExpansion.readout).toEqual({ kind: "remaining", count: 0 });

    // The Active range just expanded to 6x6 (adding a row and column drops
    // the mastered share instantly, per CONTEXT.md). The new size's high
    // point starts fresh rather than inheriting the old size's zero.
    const freshSix = stateWithMasteredCount({ size: 6 }, 5); // 36 facts, needs 33
    const afterExpansion = computeProgressMapStatus(freshSix, 1, beforeExpansion.highWaterMark);

    expect(afterExpansion.readout).toEqual({ kind: "remaining", count: 28 });
  });

  it("does NOT clamp the maintenance readout to a session high-water mark, since drift there is the point", () => {
    const strong = stateWithMasteredCount({ size: MAX_ACTIVE_RANGE_SIZE }, 142);
    const first = computeProgressMapStatus(strong, 0, null);
    expect(first.readout).toEqual({ kind: "maintenance", masteredCount: 142, totalCount: 144 });

    // Overnight decay drops Mastered Facts. This must show truthfully,
    // not hold at 142, since the maintenance readout's whole job is to
    // say "come back tomorrow."
    const decayed = stateWithMasteredCount({ size: MAX_ACTIVE_RANGE_SIZE }, 138);
    const second = computeProgressMapStatus(decayed, 1, first.highWaterMark);

    expect(second.readout).toEqual({ kind: "maintenance", masteredCount: 138, totalCount: 144 });
  });
});
