import { describe, expect, it } from "vitest";
import { dayKey } from "./engine/engine";
import { shouldRemind } from "./reminderStore";

const DAY_MS = 86_400_000;
const DAY0 = new Date(2026, 0, 1).getTime();

describe("shouldRemind", () => {
  it("reminds when no Attempt has ever been recorded", () => {
    expect(shouldRemind(null, DAY0)).toBe(true);
  });

  it("does not remind when today's practice has already happened", () => {
    expect(shouldRemind(dayKey(DAY0), DAY0)).toBe(false);
  });

  it("reminds again once a new calendar day has started", () => {
    expect(shouldRemind(dayKey(DAY0), DAY0 + DAY_MS)).toBe(true);
  });
});
