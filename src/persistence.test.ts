import { beforeEach, describe, expect, it } from "vitest";
import { NEW_STREAK, type EngineState } from "./engine/engine";
import { CURRENT_SAVE_VERSION, loadState, saveState } from "./persistence";

const STORAGE_KEY = "times-tables-quizzer:state";

// Vitest's default (node) environment has no global localStorage - this
// is a minimal in-memory stand-in, reset before each test so saves don't
// leak between them.
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

  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new FakeLocalStorage();
});

const fullState: EngineState = {
  activeRange: { size: 5 },
  fact: { a: 2, b: 3 },
  fluency: { "2x3": { averageResponseMs: 900, lastAttemptAt: 1000 } },
  accuracy: { "2x3": { correctShare: 0.8, attemptCount: 4 } },
  boosted: { "4x4": 3 },
  needsRedemption: { "5x5": true },
  rangeHistory: { 5: 500 },
  streak: { ...NEW_STREAK, count: 2 },
};

describe("saveState / loadState round trip", () => {
  it("returns null when nothing has been saved", () => {
    expect(loadState()).toBeNull();
  });

  it("loads back exactly what was saved, including the fields added by ticket #10", () => {
    saveState(fullState);

    expect(loadState()).toEqual(fullState);
  });

  it("stamps the saved payload with the current version", () => {
    saveState(fullState);

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.version).toBe(CURRENT_SAVE_VERSION);
  });
});

describe("migration", () => {
  // Simulates a save written before ticket #10 - no version field and
  // none of the fields this ticket introduces.
  const preTicket10Save = {
    activeRange: { size: 3 },
    fact: { a: 1, b: 2 },
    fluency: { "1x2": { averageResponseMs: 1200, lastAttemptAt: 400 } },
    boosted: {},
    streak: { ...NEW_STREAK, count: 5 },
  };

  it("migrates forward with defaults for missing fields, rather than discarding the save", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preTicket10Save));

    const loaded = loadState();

    expect(loaded).toEqual({
      ...preTicket10Save,
      accuracy: {},
      needsRedemption: {},
      rangeHistory: {},
    });
  });

  it("preserves the pre-existing core fields exactly while defaulting only the new ones", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preTicket10Save));

    const loaded = loadState();

    expect(loaded?.fluency).toEqual(preTicket10Save.fluency);
    expect(loaded?.streak.count).toBe(5);
  });

  it("discards a save missing core (pre-ticket-#10) fields rather than half-migrating it", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fact: { a: 1, b: 2 } }));

    expect(loadState()).toBeNull();
  });

  it("discards unparseable JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not json");

    expect(loadState()).toBeNull();
  });

  it("discards a save that isn't an object at all", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("just a string"));

    expect(loadState()).toBeNull();
  });
});
