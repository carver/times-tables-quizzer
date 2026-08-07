import { describe, expect, it } from "vitest";
import { decideLanding, hashForRoute, routeFromHash } from "./route";

const DAY_MS = 86_400_000;
const DAY0 = new Date(2026, 0, 1).getTime();
const day = (n: number) => DAY0 + n * DAY_MS;

describe("routeFromHash", () => {
  it("recognizes each of the three screens' hashes", () => {
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

  it("goes straight to the quiz on a later open the same calendar day", () => {
    const decision = decideLanding("2026-01-01", day(0) + 5000);

    expect(decision).toEqual({ route: "quiz" });
  });

  it("does not set shownOnDay when landing on the quiz - nothing new to persist", () => {
    const decision = decideLanding("2026-01-01", day(0) + 5000);

    expect(decision.shownOnDay).toBeUndefined();
  });
});
