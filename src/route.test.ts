import { describe, expect, it } from "vitest";
import { dayKey } from "./engine/engine";
import { decideLanding, hashForRoute, joinProfileIdFromHash, routeFromHash } from "./route";

const DAY_MS = 86_400_000;
const DAY0 = new Date(2026, 0, 1).getTime();
const day = (n: number) => DAY0 + n * DAY_MS;

describe("routeFromHash", () => {
  it("recognizes the map, quiz, and stats hashes", () => {
    expect(routeFromHash("#/map")).toBe("map");
    expect(routeFromHash("#/quiz")).toBe("quiz");
    expect(routeFromHash("#/stats")).toBe("stats");
  });

  it("falls back to the map for an empty hash", () => {
    expect(routeFromHash("")).toBe("map");
  });

  it("falls back to the map for an unrecognized hash, rather than stranding the Learner on a blank screen", () => {
    expect(routeFromHash("#/nonsense")).toBe("map");
  });
});

describe("hashForRoute", () => {
  it("round-trips with routeFromHash for every route", () => {
    for (const route of ["map", "quiz", "stats"] as const) {
      expect(routeFromHash(hashForRoute(route))).toBe(route);
    }
  });
});

describe("joinProfileIdFromHash", () => {
  it("extracts the Profile ID from a pairing link", () => {
    expect(joinProfileIdFromHash("#/join/abc123")).toBe("abc123");
  });

  it("decodes a URL-encoded Profile ID", () => {
    expect(joinProfileIdFromHash("#/join/abc%20123")).toBe("abc 123");
  });

  it("is null for every ordinary route hash", () => {
    expect(joinProfileIdFromHash("#/map")).toBeNull();
    expect(joinProfileIdFromHash("#/quiz")).toBeNull();
    expect(joinProfileIdFromHash("")).toBeNull();
  });

  it("routeFromHash still falls back to map for a join hash it doesn't recognize as its own", () => {
    expect(routeFromHash("#/join/abc123")).toBe("map");
  });
});

describe("decideLanding", () => {
  it("lands on the map on the very first open ever (lastMapShownDay null)", () => {
    const decision = decideLanding(null, day(0));

    expect(decision.route).toBe("map");
    expect(decision.shownOnDay).toBe("2026-01-01");
  });

  it("lands on the map on the first open of a new calendar day", () => {
    const decision = decideLanding("2026-01-01", day(1));

    expect(decision.route).toBe("map");
    expect(decision.shownOnDay).toBe("2026-01-02");
  });

  it("goes straight to the quiz on a later open the same calendar day with nothing requested", () => {
    // "Nothing requested" is what a genuinely fresh open looks like (no
    // hash at all). The once-a-day default only applies then.
    const decision = decideLanding("2026-01-01", day(0) + 5000);

    expect(decision).toEqual({ route: "quiz" });
  });

  it("does not set shownOnDay when landing on the quiz, since there is nothing new to persist", () => {
    const decision = decideLanding("2026-01-01", day(0) + 5000);

    expect(decision.shownOnDay).toBeUndefined();
  });

  it("honors an explicitly requested route on a later open the same calendar day", () => {
    // A browser refresh preserves the current hash exactly. Reloading
    // while already on the map (or stats) must not fling the Learner into
    // the quiz just because the map happens to have been shown earlier
    // today.
    expect(decideLanding("2026-01-01", day(0) + 5000, "map").route).toBe("map");
    expect(decideLanding("2026-01-01", day(0) + 5000, "stats").route).toBe("stats");
    expect(decideLanding("2026-01-01", day(0) + 5000, "quiz").route).toBe("quiz");
  });

  it("still forces the map on a new calendar day even if another route was explicitly requested", () => {
    // The once-a-day "welcome back" moment takes priority over an old
    // hash from before the day rolled over.
    const decision = decideLanding("2026-01-01", day(1), "stats");

    expect(decision.route).toBe("map");
    expect(decision.shownOnDay).toBe("2026-01-02");
  });
});

describe("the reset route", () => {
  it("round-trips through its hash like any other route", () => {
    expect(routeFromHash("#/reset")).toBe("reset");
    expect(hashForRoute("reset")).toBe("#/reset");
  });

  it("survives the landing rule instead of being redirected away", () => {
    // Every other route gets overridden on load by the map-or-quiz
    // landing decision. The reset screen is reachable only by typing its
    // hash, so redirecting it would make it unreachable on a cold open,
    // which is the only way anyone ever opens it.
    expect(decideLanding(null, day(0), "reset").route).toBe("reset");
    expect(decideLanding(dayKey(day(0)), day(0), "reset").route).toBe("reset");
  });

  it("still forces every other requested route to the map on a genuinely new day", () => {
    expect(decideLanding(null, day(0), "stats").route).toBe("map");
    expect(decideLanding(dayKey(day(-1)), day(0), "stats").route).toBe("map");
  });
});
