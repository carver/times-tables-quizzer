import { beforeEach, describe, expect, it } from "vitest";
import {
  activeProfile,
  addPairedProfile,
  pairedProfiles,
  removePairedProfile,
  setActiveProfile,
  updatePairedProfileLabel,
} from "./profilePairing";

const STORAGE_KEY = "times-tables-quizzer:profiles";

// Same minimal in-memory stand-in persistence.test.ts uses - Vitest's
// node environment has no global localStorage.
class FakeLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new FakeLocalStorage();
});

describe("profile pairing", () => {
  it("starts with no paired Profiles and no active one", () => {
    expect(pairedProfiles()).toEqual([]);
    expect(activeProfile()).toBeNull();
  });

  it("makes a newly-added Profile the active one", () => {
    addPairedProfile({ profileId: "abc", label: "Alex" });

    expect(pairedProfiles()).toEqual([{ profileId: "abc", label: "Alex" }]);
    expect(activeProfile()).toEqual({ profileId: "abc", label: "Alex" });
  });

  it("switches the active Profile without needing to re-add it", () => {
    addPairedProfile({ profileId: "abc", label: "Alex" });
    addPairedProfile({ profileId: "xyz", label: "Sam" });
    expect(activeProfile()?.profileId).toBe("xyz");

    setActiveProfile("abc");

    expect(activeProfile()?.profileId).toBe("abc");
    expect(pairedProfiles()).toHaveLength(2);
  });

  it("re-adding an already-paired Profile switches to it rather than duplicating it", () => {
    addPairedProfile({ profileId: "abc", label: "Alex" });
    addPairedProfile({ profileId: "xyz", label: "Sam" });

    addPairedProfile({ profileId: "abc", label: "Alex" });

    expect(pairedProfiles()).toHaveLength(2);
    expect(activeProfile()?.profileId).toBe("abc");
  });

  it("ignores switching to a Profile this device never paired with", () => {
    addPairedProfile({ profileId: "abc", label: "Alex" });

    setActiveProfile("never-paired");

    expect(activeProfile()?.profileId).toBe("abc");
  });

  it("removing the active Profile falls back to another paired one, if any", () => {
    addPairedProfile({ profileId: "abc", label: "Alex" });
    addPairedProfile({ profileId: "xyz", label: "Sam" });
    setActiveProfile("xyz");

    removePairedProfile("xyz");

    expect(pairedProfiles()).toEqual([{ profileId: "abc", label: "Alex" }]);
    expect(activeProfile()?.profileId).toBe("abc");
  });

  it("removing the only Profile leaves none active", () => {
    addPairedProfile({ profileId: "abc", label: "Alex" });

    removePairedProfile("abc");

    expect(pairedProfiles()).toEqual([]);
    expect(activeProfile()).toBeNull();
  });

  it("corrects a paired Profile's label to match the synced document", () => {
    addPairedProfile({ profileId: "abc", label: "Shared progress" });

    updatePairedProfileLabel("abc", "Alex");

    expect(pairedProfiles()).toEqual([{ profileId: "abc", label: "Alex" }]);
    expect(activeProfile()).toEqual({ profileId: "abc", label: "Alex" });
  });

  it("ignores a label update for a Profile this device never paired with", () => {
    addPairedProfile({ profileId: "abc", label: "Alex" });

    updatePairedProfileLabel("never-paired", "Sam");

    expect(pairedProfiles()).toEqual([{ profileId: "abc", label: "Alex" }]);
  });

  it("discards corrupted storage rather than throwing", () => {
    localStorage.setItem(STORAGE_KEY, "not json");
    expect(activeProfile()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles: "not an array" }));
    expect(activeProfile()).toBeNull();
  });
});
