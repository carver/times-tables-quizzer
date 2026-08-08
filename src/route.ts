// Hash-based routing between the app's three screens, kept in a pure,
// DOM-free module - same split as screen.ts - so the once-per-day
// landing decision is testable without a browser. Deliberately small:
// the ticket calls for "roughly ten lines" of routing, not a routing
// library, since the only thing hash routing needs to buy here is a
// working browser/Android back button.
import { dayKey, type DayKey } from "./engine/engine";

export type Route = "map" | "quiz" | "stats" | "reset";

const HASHES: Record<Route, string> = {
  map: "#/map",
  quiz: "#/quiz",
  stats: "#/stats",
  reset: "#/reset",
};

// The reset screen is deliberately unlinked from anywhere in the app -
// the only way to reach it is to type the hash, and the only place it is
// written down is the README. It exists so the app can be handed to a
// Learner with a clean history, not as a feature they should find.
export const RESET_ROUTE: Route = "reset";

// Any hash that isn't recognized - including the empty hash on first
// load, or a stray/mistyped one - lands on the Progress map rather than
// a blank screen.
export function routeFromHash(hash: string): Route {
  const entry = (Object.entries(HASHES) as [Route, string][]).find(([, value]) => value === hash);
  return entry ? entry[0] : "map";
}

export function hashForRoute(route: Route): string {
  return HASHES[route];
}

export type LandingDecision = {
  route: Route;
  // Set only when this decision lands on the map for a calendar day it
  // hasn't been shown on yet - the caller should persist it as the new
  // lastMapShownDay so later opens the same day go straight to the quiz.
  // Undefined means no persistence update is needed.
  shownOnDay?: DayKey;
};

// Ticket #11's Progress map landing rule: the map is shown on the first
// open of each calendar day, subsequent opens the same day go straight
// to the quiz. Reuses the engine's own dayKey rather than a second
// notion of "day" - same-day detection here means exactly what it means
// for the Streak.
export function decideLanding(lastMapShownDay: DayKey | null, now: number, requested?: Route): LandingDecision {
  // The reset screen is the one route the landing rule must not
  // override. It is reached only by typing its hash (see RESET_ROUTE),
  // so redirecting it to the map or the quiz would make it unreachable
  // on a cold open - which is the only way anyone ever opens it.
  if (requested === RESET_ROUTE) {
    return { route: RESET_ROUTE };
  }

  const today = dayKey(now);
  if (today === lastMapShownDay) {
    return { route: "quiz" };
  }
  return { route: "map", shownOnDay: today };
}
