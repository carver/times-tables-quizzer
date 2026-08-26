import { describe, expect, it } from "vitest";
import { isRemoteUpdate, shouldApplyRemoteUpdate } from "./syncDecisions";

describe("isRemoteUpdate", () => {
  it("is false for a snapshot that's just this device's own unconfirmed write echoing back", () => {
    expect(isRemoteUpdate({ hasPendingWrites: true })).toBe(false);
  });

  it("is true once a snapshot has cleared pending-write status", () => {
    expect(isRemoteUpdate({ hasPendingWrites: false })).toBe(true);
  });
});

describe("shouldApplyRemoteUpdate", () => {
  it("buffers (does not apply) while the Learner is live on the quiz route", () => {
    expect(shouldApplyRemoteUpdate("quiz")).toBe(false);
  });

  it("applies immediately on every other route, where there is nothing live to disrupt", () => {
    expect(shouldApplyRemoteUpdate("map")).toBe(true);
    expect(shouldApplyRemoteUpdate("stats")).toBe(true);
    expect(shouldApplyRemoteUpdate("reset")).toBe(true);
  });
});
