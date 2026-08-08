import type { DayKey, EngineState } from "./engine/engine";

const STORAGE_KEY = "times-tables-quizzer:state";

// Bumped whenever the persisted shape changes. `migrate` below is what
// the *next* bump has somewhere to hook into: fill in a default for
// whatever field is new, rather than discarding the whole save.
// Version 2 (ticket #11) adds `lastMapShownDay` - the once-per-day
// Progress map landing rule's only piece of state - alongside the
// EngineState fields, so it rides the same save/migrate path instead of
// a second, ad-hoc localStorage read.
// Version 3 (ticket #12) adds `practiceDayCount` - the statistics
// header's "days practiced" figure. A save from before this version has
// no way to know its true lifetime count, so it defaults to 0 same as a
// brand-new save; the count undercounts once for whoever upgrades mid-
// history, which is an acceptable one-time cost for a figure nothing
// upstream of this ticket ever needed to track.
// Version 4 (ticket #13) adds `muted` - the Progress map's mute toggle
// (the issue: "audio defaults on, with a mute toggle that persists in the
// save file"). A save from before this version has never had the toggle
// touched, so it defaults to false (unmuted) - the same default a
// brand-new save gets.
// Version 5 adds `remindersEnabled` - whether the Learner opted into the
// daily-reminder notification. Defaults to false (opt-in, never sprung on
// an existing save) same as a brand-new save.
export const CURRENT_SAVE_VERSION = 5;

// What the rest of the app actually works with: the engine's state plus
// the pieces of app-level (not engine-domain) state that ride the same
// save file - the Progress map landing rule's day marker (ticket #11),
// the audio mute toggle (ticket #13), and the daily-reminder opt-in.
export type AppState = {
  engine: EngineState;
  lastMapShownDay: DayKey | null;
  muted: boolean;
  remindersEnabled: boolean;
};

type PersistedState = EngineState & {
  lastMapShownDay: DayKey | null;
  muted: boolean;
  remindersEnabled: boolean;
  version: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The fields present since before save versioning existed - if any of
// these is missing or malformed, the save is corrupt/unusable rather
// than merely from an older schema, and gets discarded (loadState
// returns null, same as no save at all).
function hasCoreEngineShape(value: Record<string, unknown>): boolean {
  const { activeRange, fact, fluency, boosted, streak } = value;

  return (
    isRecord(activeRange) &&
    typeof activeRange.size === "number" &&
    isRecord(fact) &&
    typeof fact.a === "number" &&
    typeof fact.b === "number" &&
    isRecord(fluency) &&
    isRecord(boosted) &&
    isRecord(streak) &&
    typeof streak.count === "number"
  );
}

// Fills in defaults for fields that didn't exist when a save was
// written, rather than discarding the whole save over a partial schema
// mismatch. Sources of "missing fields" so far: saves written before
// ticket #10 (no `accuracy`, `needsRedemption`, `rangeHistory`), saves
// written before ticket #11 (no `lastMapShownDay`), saves written before
// ticket #12 (no `practiceDayCount`), and saves written before ticket #13
// (no `muted`) - but the shape of this function - keep the core fields,
// default the new ones - is what a future version bump extends rather
// than replaces.
function migrate(value: Record<string, unknown>): PersistedState | null {
  if (!hasCoreEngineShape(value)) return null;

  return {
    activeRange: value.activeRange as EngineState["activeRange"],
    fact: value.fact as EngineState["fact"],
    fluency: value.fluency as EngineState["fluency"],
    boosted: value.boosted as EngineState["boosted"],
    streak: value.streak as EngineState["streak"],
    accuracy: isRecord(value.accuracy) ? (value.accuracy as EngineState["accuracy"]) : {},
    needsRedemption: isRecord(value.needsRedemption) ? (value.needsRedemption as EngineState["needsRedemption"]) : {},
    rangeHistory: isRecord(value.rangeHistory) ? (value.rangeHistory as EngineState["rangeHistory"]) : {},
    // Absent/malformed defaults to 0, same as a save that predates this
    // field entirely (see CURRENT_SAVE_VERSION's version-3 comment above).
    practiceDayCount: typeof value.practiceDayCount === "number" ? value.practiceDayCount : 0,
    // No prior save has ever shown the Progress map, so an absent/malformed
    // value defaults to "never" - the same as a save that predates this
    // field entirely.
    lastMapShownDay: typeof value.lastMapShownDay === "string" ? (value.lastMapShownDay as DayKey) : null,
    // Audio defaults on (the issue's explicit commitment) - an
    // absent/malformed value means either a save that predates the toggle
    // or a corrupted flag, and both should fall back to unmuted rather
    // than the fail-silent-and-confusing alternative.
    muted: typeof value.muted === "boolean" ? value.muted : false,
    // Opt-in only - absent/malformed means either a pre-reminder save or a
    // corrupted flag, and both should fall back to "not asking for
    // notifications" rather than silently turning them on.
    remindersEnabled: typeof value.remindersEnabled === "boolean" ? value.remindersEnabled : false,
    version: CURRENT_SAVE_VERSION,
  };
}

export function saveState(state: AppState): void {
  const persisted: PersistedState = {
    ...state.engine,
    lastMapShownDay: state.lastMapShownDay,
    muted: state.muted,
    remindersEnabled: state.remindersEnabled,
    version: CURRENT_SAVE_VERSION,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

// Erases every trace of the Learner's progress. Reached only from the
// unlinked reset screen (route.ts's RESET_ROUTE), which exists so the
// app can be handed over with a clean history. Removing the key outright
// - rather than writing a fresh state - means the next load takes the
// genuine first-ever-open path, Progress map and all.
export function clearState(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function loadState(): AppState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const migrated = migrate(parsed);
    if (migrated === null) return null;

    // `version` only exists to drive migrate() above - EngineState itself
    // carries no version field, so it's stripped back off here.
    const { version: _version, lastMapShownDay, muted, remindersEnabled, ...engine } = migrated;
    return { engine, lastMapShownDay, muted, remindersEnabled };
  } catch {
    return null;
  }
}

// Validates/normalizes a raw Firestore Profile document (docs/adr/0006)
// into an EngineState, reusing `migrate()` rather than a second parallel
// validator - a synced Profile document is exactly the same shape a
// localStorage save is, just without the three device-local fields
// (`lastMapShownDay`, `muted`, `remindersEnabled` - see the ADR for why
// those never sync). Those three still get *defaulted* by migrate() as
// "missing, predates this field" - harmless, since only the EngineState
// part is kept here.
export function parseEngineState(data: Record<string, unknown>): EngineState | null {
  const migrated = migrate(data);
  if (migrated === null) return null;

  const { version: _version, lastMapShownDay: _lastMapShownDay, muted: _muted, remindersEnabled: _remindersEnabled, ...engine } =
    migrated;
  return engine;
}
