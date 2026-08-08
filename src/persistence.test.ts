import { beforeEach, describe, expect, it } from "vitest";
import { NEW_STREAK, type EngineState } from "./engine/engine";
import { CURRENT_SAVE_VERSION, loadState, saveState, type AppState } from "./persistence";

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

const fullEngineState: EngineState = {
  activeRange: { size: 5 },
  fact: { a: 2, b: 3 },
  fluency: { "2x3": { averageResponseMs: 900, lastAttemptAt: 1000 } },
  accuracy: { "2x3": { correctShare: 0.8, attemptCount: 4 } },
  boosted: { "4x4": 3 },
  needsRedemption: { "5x5": true },
  rangeHistory: { 5: 500 },
  streak: { ...NEW_STREAK, count: 2 },
  practiceDayCount: 7,
};

const fullAppState: AppState = {
  engine: fullEngineState,
  lastMapShownDay: "2026-08-07",
  muted: true,
  remindersEnabled: true,
};

describe("saveState / loadState round trip", () => {
  it("returns null when nothing has been saved", () => {
    expect(loadState()).toBeNull();
  });

  it("loads back exactly what was saved, including the fields added by ticket #10, #11's lastMapShownDay, #12's practiceDayCount, #13's muted, and remindersEnabled", () => {
    saveState(fullAppState);

    expect(loadState()).toEqual(fullAppState);
  });

  it("round-trips a null lastMapShownDay (never shown yet)", () => {
    saveState({ engine: fullEngineState, lastMapShownDay: null, muted: false, remindersEnabled: false });

    expect(loadState()).toEqual({ engine: fullEngineState, lastMapShownDay: null, muted: false, remindersEnabled: false });
  });

  it("stamps the saved payload with the current version", () => {
    saveState(fullAppState);

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
      engine: {
        ...preTicket10Save,
        accuracy: {},
        needsRedemption: {},
        rangeHistory: {},
        practiceDayCount: 0,
      },
      lastMapShownDay: null,
      muted: false,
      remindersEnabled: false,
    });
  });

  it("preserves the pre-existing core fields exactly while defaulting only the new ones", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preTicket10Save));

    const loaded = loadState();

    expect(loaded?.engine.fluency).toEqual(preTicket10Save.fluency);
    expect(loaded?.engine.streak.count).toBe(5);
  });

  // Simulates a save written before ticket #11 - has ticket #10's fields
  // but predates lastMapShownDay entirely.
  const preTicket11Save = {
    ...preTicket10Save,
    accuracy: {},
    needsRedemption: {},
    rangeHistory: { 3: 100 },
  };

  it("defaults lastMapShownDay to null (never shown) for a save that predates it", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preTicket11Save));

    const loaded = loadState();

    expect(loaded).toEqual({
      engine: { ...preTicket11Save, practiceDayCount: 0 },
      lastMapShownDay: null,
      muted: false,
      remindersEnabled: false,
    });
  });

  // Simulates a save written before ticket #12 - has lastMapShownDay but
  // predates practiceDayCount entirely.
  const preTicket12Save = { ...preTicket11Save, lastMapShownDay: "2026-08-01" };

  it("defaults practiceDayCount to 0 for a save that predates it", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preTicket12Save));

    const loaded = loadState();

    expect(loaded?.engine.practiceDayCount).toBe(0);
  });

  // Simulates a save written before ticket #13 - has practiceDayCount but
  // predates the mute toggle entirely.
  const preTicket13Save = { ...preTicket12Save, practiceDayCount: 4 };

  it("defaults muted to false (unmuted) for a save that predates the toggle - audio defaults on", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preTicket13Save));

    const loaded = loadState();

    expect(loaded?.muted).toBe(false);
  });

  it("round-trips a true muted flag from a save that already has it", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...preTicket13Save, muted: true }));

    const loaded = loadState();

    expect(loaded?.muted).toBe(true);
  });

  // Simulates a save written before the daily-reminder toggle existed -
  // has muted but predates remindersEnabled entirely.
  const preReminderSave = { ...preTicket13Save, muted: false };

  it("defaults remindersEnabled to false for a save that predates the toggle - opt-in only, never sprung on an existing save", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preReminderSave));

    const loaded = loadState();

    expect(loaded?.remindersEnabled).toBe(false);
  });

  it("round-trips a true remindersEnabled flag from a save that already has it", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...preReminderSave, remindersEnabled: true }));

    const loaded = loadState();

    expect(loaded?.remindersEnabled).toBe(true);
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
