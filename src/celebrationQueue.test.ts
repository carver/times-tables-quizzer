import { describe, expect, it } from "vitest";
import type { Celebration } from "./engine/engine";
import {
  currentTakeover,
  dismissCurrentTakeover,
  EMPTY_TAKEOVER_QUEUE,
  enqueueTakeovers,
  inlineCelebrations,
  takeoverCelebrations,
} from "./celebrationQueue";

const correctnessOnly: Celebration = { kind: "correctness-only", tag: "inline" };
const personalBest: Celebration = { kind: "personal-best", tag: "inline" };
const rangeExpansion: Celebration = { kind: "range-expansion", tag: "takeover" };
const milestone: Celebration = { kind: "milestone", tag: "takeover" };

describe("inlineCelebrations", () => {
  it("keeps only inline-tagged Celebrations", () => {
    expect(inlineCelebrations([correctnessOnly, rangeExpansion, milestone])).toEqual([correctnessOnly]);
  });

  it("returns everything when all Celebrations are inline", () => {
    expect(inlineCelebrations([correctnessOnly, personalBest])).toEqual([correctnessOnly, personalBest]);
  });

  it("returns an empty array when there are no Celebrations at all", () => {
    expect(inlineCelebrations([])).toEqual([]);
  });
});

describe("takeoverCelebrations", () => {
  it("keeps only takeover-tagged Celebrations", () => {
    expect(takeoverCelebrations([correctnessOnly, rangeExpansion])).toEqual([rangeExpansion]);
  });

  it("orders range-expansion before milestone regardless of input order", () => {
    expect(takeoverCelebrations([milestone, rangeExpansion])).toEqual([rangeExpansion, milestone]);
    expect(takeoverCelebrations([rangeExpansion, milestone])).toEqual([rangeExpansion, milestone]);
  });

  it("does not mutate the array it was given", () => {
    const input = [milestone, rangeExpansion];
    takeoverCelebrations(input);
    expect(input).toEqual([milestone, rangeExpansion]);
  });
});

describe("takeover queue", () => {
  it("starts empty with no current takeover", () => {
    expect(currentTakeover(EMPTY_TAKEOVER_QUEUE)).toBeUndefined();
  });

  it("surfaces a single enqueued takeover as current", () => {
    const queue = enqueueTakeovers(EMPTY_TAKEOVER_QUEUE, [rangeExpansion]);

    expect(currentTakeover(queue)).toEqual(rangeExpansion);
  });

  it("drops the inline Celebrations from what gets enqueued - only takeovers queue", () => {
    const queue = enqueueTakeovers(EMPTY_TAKEOVER_QUEUE, [correctnessOnly, personalBest]);

    expect(queue).toEqual([]);
  });

  // The heart of the ticket: a single Attempt producing both a
  // range-expansion and a Milestone at once must queue both, range
  // expansion first, rather than dropping one in favor of the other.
  it("queues both takeovers from a single Attempt that hits expansion and Milestone together, expansion first", () => {
    const queue = enqueueTakeovers(EMPTY_TAKEOVER_QUEUE, [personalBest, milestone, rangeExpansion]);

    expect(queue).toEqual([rangeExpansion, milestone]);
  });

  it("dismissing the current takeover advances to the next queued one", () => {
    const queued = enqueueTakeovers(EMPTY_TAKEOVER_QUEUE, [rangeExpansion, milestone]);

    const afterFirstDismiss = dismissCurrentTakeover(queued);
    expect(currentTakeover(afterFirstDismiss)).toEqual(milestone);

    const afterSecondDismiss = dismissCurrentTakeover(afterFirstDismiss);
    expect(currentTakeover(afterSecondDismiss)).toBeUndefined();
  });

  it("dismissing an already-empty queue stays empty rather than throwing", () => {
    expect(dismissCurrentTakeover(EMPTY_TAKEOVER_QUEUE)).toEqual([]);
  });

  it("appends a later Attempt's takeovers behind whatever is already queued, not ahead of it", () => {
    const fromFirstAttempt = enqueueTakeovers(EMPTY_TAKEOVER_QUEUE, [milestone]);
    const fromSecondAttempt = enqueueTakeovers(fromFirstAttempt, [rangeExpansion]);

    // The already-queued Milestone keeps its place even though
    // range-expansion would normally outrank it within one Attempt's set.
    expect(fromSecondAttempt).toEqual([milestone, rangeExpansion]);
  });

  it("never drops a takeover across enqueue/dismiss regardless of how many Attempts contributed to the queue", () => {
    let queue = EMPTY_TAKEOVER_QUEUE;
    queue = enqueueTakeovers(queue, [personalBest, rangeExpansion, milestone]); // one Attempt, both takeovers
    queue = enqueueTakeovers(queue, [correctnessOnly]); // a later Attempt with no takeovers of its own

    const shown: Celebration[] = [];
    let current = currentTakeover(queue);
    while (current) {
      shown.push(current);
      queue = dismissCurrentTakeover(queue);
      current = currentTakeover(queue);
    }

    expect(shown).toEqual([rangeExpansion, milestone]);
  });
});
