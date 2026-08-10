// Pure, DOM-free module behind ticket #13's presentation of an Attempt's
// Celebration set (CONTEXT.md's Celebration entry: "An Attempt yields a
// *set* of Celebrations, not one"). Kept separate from main.ts's DOM
// wiring - same split as screen.ts / route.ts / progressMap.ts / stats.ts
// - so the inline-vs-takeover split, the queue order, and the
// "nothing gets dropped" property are all testable without a browser or
// an AudioContext.
//
// This module owns two concerns main.ts used to conflate into a single
// "primaryCelebration" (the placeholder ticket #10 left behind, and the
// core thing this ticket replaces):
//   1. Inline Celebrations all play at once - there's nothing to queue.
//   2. Takeover Celebrations queue and play one at a time, in a fixed
//      order, waiting for an explicit dismissal each time. A single
//      Attempt can produce both a range-expansion AND a Milestone
//      takeover simultaneously (CONTEXT.md), and the issue is explicit
//      that two takeovers back to back is correct, not a bug to smooth
//      over - so nothing here ever collapses the set down to one.
import { celebration, type Celebration, type CelebrationKind } from "./engine/engine";

// Range expansion always plays before a Milestone when a single Attempt
// produces both (the issue body: "takeovers queue and play in sequence,
// range expansion first, then Milestone") - fixed here, independent of
// whatever order the engine happened to push them onto its `celebrations`
// array in, so this module - not submitAttempt's incidental push order -
// is the one source of truth for takeover sequencing.
const TAKEOVER_ORDER: CelebrationKind[] = ["range-expansion", "milestone"];

function takeoverRank(kind: CelebrationKind): number {
  const rank = TAKEOVER_ORDER.indexOf(kind);
  // Every takeover-tagged kind is listed above; a kind missing from the
  // list would be a bug in this module, not reachable from real engine
  // output, but sorts last rather than throwing if it ever happens.
  return rank === -1 ? TAKEOVER_ORDER.length : rank;
}

// Inline Celebrations from a single Attempt, in no particular order -
// CONTEXT.md's "plays over the practice screen without interrupting"
// means simultaneous, not sequenced, so there's no ordering to impose.
export function inlineCelebrations(celebrations: Celebration[]): Celebration[] {
  return celebrations.filter((c) => c.tag === "inline");
}

// The takeover-tagged subset of a single Attempt's Celebrations, sorted
// into queue order. Exported mainly so tests can check ordering directly
// without going through the queue state below.
export function takeoverCelebrations(celebrations: Celebration[]): Celebration[] {
  return celebrations
    .filter((c) => c.tag === "takeover")
    .slice()
    .sort((a, b) => takeoverRank(a.kind) - takeoverRank(b.kind));
}

// A FIFO of takeover Celebrations waiting to be shown, oldest (current)
// first. Modeled as a plain array rather than a class so it stays a
// trivial value to hold in main.ts's module-level state and to assert on
// in tests - the operations below are the only sanctioned way to change
// it, same spirit as screen.ts's ScreenState transitions.
export type TakeoverQueue = Celebration[];

export const EMPTY_TAKEOVER_QUEUE: TakeoverQueue = [];

// The takeover currently due to be shown, if any. main.ts renders this
// one and blocks quiz input until it's dismissed - never more than one
// on screen at a time, however many are queued behind it.
export function currentTakeover(queue: TakeoverQueue): Celebration | undefined {
  return queue[0];
}

// Appends a new Attempt's takeover-tagged Celebrations to the back of the
// queue, ordered range-expansion-then-milestone among themselves. Already
// queued items keep their place at the front - a queue is never
// reordered by what arrives later, only appended to - so nothing already
// waiting can be pushed behind a later Attempt's takeovers.
export function enqueueTakeovers(queue: TakeoverQueue, celebrations: Celebration[]): TakeoverQueue {
  return [...queue, ...takeoverCelebrations(celebrations)];
}

// Removes the currently-shown takeover once the Learner has tapped to
// dismiss it, advancing the next one (if any) into the current slot. This
// is the only way the queue shrinks - there is deliberately no auto-
// dismiss / timer path anywhere in this module (the issue: "auto-dismiss
// means the best moment in the app can be missed by looking away").
export function dismissCurrentTakeover(queue: TakeoverQueue): TakeoverQueue {
  return queue.slice(1);
}

// A boot-time catch-up: `activeRange.size` can be ahead of
// `acknowledgedRangeSize` (engine.ts) if a takeover was raised but never
// actually dismissed - a real, confirmed failure mode, not hypothetical
// (a touch tap's trailing `click` landing back on the takeover itself
// and dismissing it before it was ever seen; see main.ts's keypad
// listener). Rather than the progress just quietly being there next
// time with no celebration for it, one takeover per missed size is
// queued, in the order they were actually reached, each carrying its
// own size so the takeover can show the grid as it looked at that exact
// moment rather than the Learner's current, further-along progress.
export function missedRangeExpansionTakeovers(acknowledgedSize: number, currentSize: number): Celebration[] {
  const missed: Celebration[] = [];
  for (let size = acknowledgedSize + 1; size <= currentSize; size++) {
    missed.push(celebration("range-expansion", size));
  }
  return missed;
}
