// Exercises src/cloudSync.ts's actual functions (not just raw Firestore
// calls, which rules.test.ts already covers) against the real emulator -
// catches wiring bugs (wrong ports, wrong SDK calls) that testing the
// rules file alone wouldn't. Run via `npm run test:rules` alongside
// rules.test.ts; never with plain `vitest run`.
import { beforeAll, describe, expect, it } from "vitest";
import { fetchProfile, subscribeToProfile, writeProfile } from "../src/cloudSync";

// A real writeProfile call always carries the whole synced shape
// (persistence.ts never writes a partial subset) - firestore.rules'
// isValidProfileDoc requires it, so test payloads mirror that rather
// than the arbitrary subset each test happens to care about.
const fullState = {
  activeRange: { size: 5 },
  fact: { a: 1, b: 1 },
  fluency: {},
  boosted: {},
  streak: { count: 0 },
};

beforeAll(async () => {
  // Wait out the emulator's own startup - emulators:exec already blocks
  // until they report ready, but the Firestore emulator's very first
  // connection can still lag slightly behind that.
  await new Promise((resolve) => setTimeout(resolve, 500));
});

// A handful of retries with a short pause, not a single immediate read -
// observed occasionally under this specific Node/vitest + emulator
// combination (real browsers and the e2e suite driving the actual app
// never show this) for a fetch to land before a same-client write it's
// racing against has finished propagating into the emulator's own
// queryable state, even though writeProfile's promise already resolved.
// Polling here is a test-robustness concession to that, not evidence
// the app itself needs a retry - main.ts never calls fetchProfile
// without going through a real user action moments after a write.
async function fetchProfileWithRetry(profileId: string, attempts = 20): Promise<ReturnType<typeof fetchProfile>> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await fetchProfile(profileId);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return fetchProfile(profileId);
}

describe("cloudSync against the local emulator", () => {
  it("round-trips a profile: write, then fetch reads it back", async () => {
    const profileId = `smoke-${crypto.randomUUID()}`;
    const state = { ...fullState, fact: { a: 3, b: 4 }, streak: { count: 2 } };

    const wrote = await writeProfile(profileId, state);
    expect(wrote).toBe(true);

    const fetched = await fetchProfileWithRetry(profileId);
    expect(fetched?.fact).toEqual({ a: 3, b: 4 });
    expect(fetched?.streak).toEqual({ count: 2 });
  });

  it("fetchProfile resolves null for a Profile ID that was never written", async () => {
    const fetched = await fetchProfile(`never-written-${crypto.randomUUID()}`);
    expect(fetched).toBeNull();
  });

  it("subscribeToProfile delivers a live update when the document changes", async () => {
    const profileId = `smoke-${crypto.randomUUID()}`;
    const updates: unknown[] = [];

    const unsubscribe = subscribeToProfile(profileId, (data) => {
      if (data) updates.push(data.fact);
    });

    await writeProfile(profileId, { ...fullState, fact: { a: 7, b: 8 } });

    await new Promise((resolve) => setTimeout(resolve, 500));
    unsubscribe();

    expect(updates).toContainEqual({ a: 7, b: 8 });
  });
});
