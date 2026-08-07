// Pure computation behind the Progress map's progress-to-expansion
// indicator (CONTEXT.md's Progress map entry), kept DOM-free like
// screen.ts and route.ts so the monotonic high-water-mark behavior is
// testable without a browser.
import { isMastered, listFacts, MASTERY_THRESHOLD, MAX_ACTIVE_RANGE_SIZE, type EngineState } from "./engine/engine";

export type ProgressReadout =
  // "N to go" - a count remaining, not a percentage, positioned on the
  // current frontier row/column.
  | { kind: "remaining"; count: number }
  // The Active range has reached MAX_ACTIVE_RANGE_SIZE: nothing left to
  // unlock, so the indicator becomes a maintenance readout of
  // currently-Mastered Facts out of the full 144.
  | { kind: "maintenance"; masteredCount: number; totalCount: number };

// The session high-water mark backing the "remaining" readout's
// monotonic guarantee: it shows the best masteredCount seen so far this
// session for the *current* Active range size, never a lower one, even
// though the true masteredCount genuinely can drop (Fluency decay, a
// wrong Attempt, or - most dramatically - right after an expansion,
// where a bigger range's mastered share starts far lower). Keyed by
// Active range size so a fresh size - a genuinely new frontier - starts
// its own high-water mark instead of inheriting the old size's, which is
// exactly how that post-expansion drop is allowed to actually show.
export type ProgressHighWaterMark = {
  activeRangeSize: number;
  masteredCount: number;
};

export function advanceHighWaterMark(
  previous: ProgressHighWaterMark | null,
  activeRangeSize: number,
  masteredCount: number,
): ProgressHighWaterMark {
  if (previous === null || previous.activeRangeSize !== activeRangeSize) {
    return { activeRangeSize, masteredCount };
  }
  return { activeRangeSize, masteredCount: Math.max(previous.masteredCount, masteredCount) };
}

export type ProgressMapStatus = {
  readout: ProgressReadout;
  // The high-water mark to carry into the next call - callers must store
  // and pass this back in rather than recomputing it themselves, so the
  // readout and the mark it was clamped against never drift apart.
  highWaterMark: ProgressHighWaterMark;
};

// Computes both the current progress-to-expansion readout and the
// updated high-water mark in one call, from the same masteredCount, so
// the two can never disagree about what "so far" means.
//
// The maintenance readout is deliberately NOT clamped by the high-water
// mark: ticket #11 is explicit that the drift which would be confusing
// during progression ("142 of 144" dipping to "138 of 144" overnight) is
// the entire point once the grid is full - it's what says come back
// tomorrow.
export function computeProgressMapStatus(
  state: Pick<EngineState, "activeRange" | "fluency" | "needsRedemption">,
  now: number,
  previousHighWaterMark: ProgressHighWaterMark | null,
): ProgressMapStatus {
  const facts = listFacts(state.activeRange);
  const masteredCount = facts.filter((fact) => isMastered(fact, state, now)).length;
  const highWaterMark = advanceHighWaterMark(previousHighWaterMark, state.activeRange.size, masteredCount);

  if (state.activeRange.size >= MAX_ACTIVE_RANGE_SIZE) {
    return {
      readout: { kind: "maintenance", masteredCount, totalCount: facts.length },
      highWaterMark,
    };
  }

  const neededCount = Math.ceil(MASTERY_THRESHOLD * facts.length);
  return {
    readout: { kind: "remaining", count: Math.max(0, neededCount - highWaterMark.masteredCount) },
    highWaterMark,
  };
}
