// Pure decision logic behind reconciling a remote Firestore snapshot
// against local state, kept separate from cloudSync.ts's actual
// Firestore calls so it's unit-tested without a real SDK/emulator, the
// same split reminderStore.ts uses for shouldRemind vs its IndexedDB
// calls.
import type { Route } from "./route";

export type SnapshotMeta = {
  hasPendingWrites: boolean;
};

// A snapshot that's just the SDK's own optimistic echo of a write this
// device just made (not yet confirmed by the server) isn't "new data
// from elsewhere". Reconciling against it would be a pointless
// re-render of exactly what's already on screen. Only snapshots that
// have cleared pending-write status represent a change worth reacting to.
export function isRemoteUpdate(meta: SnapshotMeta): boolean {
  return !meta.hasPendingWrites;
}

// A remote update arriving while the Learner is live on the quiz route
// (mid-question, or mid-retyping a correction) must not be applied
// immediately: swapping the engine state out from under them could yank
// the current Fact away mid-answer. Buffer it (skip reconciling) until
// the route changes or the current Attempt resolves; last-write-wins
// (docs/adr/0006) means nothing is lost by waiting. The next real
// change will simply produce another snapshot once the Learner is free
// to receive it.
export function shouldApplyRemoteUpdate(route: Route): boolean {
  return route !== "quiz";
}
