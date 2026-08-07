// Hash-based routing between the app's three screens, kept in a pure,
// DOM-free module - same split as screen.ts - so the once-per-day
// landing decision is testable without a browser. Deliberately small:
// the ticket calls for "roughly ten lines" of routing, not a routing
// library, since the only thing hash routing needs to buy here is a
// working browser/Android back button.
import { dayKey, type DayKey } from "./engine/engine";

export type Route = "map" | "quiz" | "stats";

const HASHES: Record<Route, string> = {
  map: "#/map",
  quiz: "#/quiz",
  stats: "#/stats",
};

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
export function decideLanding(lastMapShownDay: DayKey | null, now: number): LandingDecision {
  const today = dayKey(now);
  if (today === lastMapShownDay) {
    return { route: "quiz" };
  }
  return { route: "map", shownOnDay: today };
}
