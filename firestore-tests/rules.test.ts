// Exercises firestore.rules against the real emulator (there is no
// meaningful way to unit-test a rules file without one; it's its own
// small interpreted language, not TypeScript). Run via `npm run
// test:rules`, which wraps this in `firebase emulators:exec` so the
// emulator is up for the duration of the run and torn down after.
// Never run directly with plain `vitest run`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";

let testEnv: RulesTestEnvironment;

const validProfile = {
  version: 1,
  updatedAt: new Date(),
  activeRange: { size: 5 },
  fact: { a: 2, b: 3 },
  fluency: {},
  boosted: {},
  streak: { count: 0, lastStreakDay: null, lastActivityDay: null, missedDays: 0 },
};

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-times-tables-quizzer",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8181,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("profiles/{profileId} access", () => {
  it("blocks a signed-out client from reading or writing at all", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(db.doc("profiles/abc").get());
    await assertFails(db.doc("profiles/abc").set(validProfile));
  });

  it("lets any signed-in (anonymous) client read/write a document once it knows the exact ID", async () => {
    const db = testEnv.authenticatedContext("some-anon-uid").firestore();
    await assertSucceeds(db.doc("profiles/abc").set(validProfile));
    await assertSucceeds(db.doc("profiles/abc").get());
  });

  it("rejects a write that doesn't look like a real save (shape validation)", async () => {
    const db = testEnv.authenticatedContext("some-anon-uid").firestore();
    await assertFails(db.doc("profiles/abc").set({ junk: "data" }));
    await assertFails(db.doc("profiles/abc").set({ ...validProfile, version: "not-a-number" }));
  });

  it("never allows listing the profiles collection, even when signed in", async () => {
    const db = testEnv.authenticatedContext("some-anon-uid").firestore();
    await assertFails(db.collection("profiles").get());
  });

  it("never allows deleting a profile document", async () => {
    const db = testEnv.authenticatedContext("some-anon-uid").firestore();
    await db.doc("profiles/abc").set(validProfile);
    await assertFails(db.doc("profiles/abc").delete());
  });
});
