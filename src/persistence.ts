import type { DayKey, EngineState } from "./engine/engine";

const STORAGE_KEY = "times-tables-quizzer:state";

// Bumped whenever the persisted shape changes. `migrate` below is what
// the *next* bump has somewhere to hook into: fill in a default for
// whatever field is new, rather than discarding the whole save.
// Version 2 (ticket #11) adds `lastMapShownDay` - the once-per-day
// Progress map landing rule's only piece of state - alongside the
// EngineState fields, so it rides the same save/migrate path instead of
// a second, ad-hoc localStorage read.
export const CURRENT_SAVE_VERSION = 2;

// What the rest of the app actually works with: the engine's state plus
// the one piece of routing state (CONTEXT.md's Progress map landing
// rule) that isn't part of the engine's own domain.
export type AppState = {
  engine: EngineState;
  lastMapShownDay: DayKey | null;
};

type PersistedState = EngineState & { lastMapShownDay: DayKey | null; version: number };

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
// ticket #10 (no `accuracy`, `needsRedemption`, `rangeHistory`) and
// saves written before ticket #11 (no `lastMapShownDay`) - but the
// shape of this function - keep the core fields, default the new ones -
// is what a future version bump extends rather than replaces.
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
    // No prior save has ever shown the Progress map, so an absent/malformed
    // value defaults to "never" - the same as a save that predates this
    // field entirely.
    lastMapShownDay: typeof value.lastMapShownDay === "string" ? (value.lastMapShownDay as DayKey) : null,
    version: CURRENT_SAVE_VERSION,
  };
}

export function saveState(state: AppState): void {
  const persisted: PersistedState = { ...state.engine, lastMapShownDay: state.lastMapShownDay, version: CURRENT_SAVE_VERSION };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
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
    const { version: _version, lastMapShownDay, ...engine } = migrated;
    return { engine, lastMapShownDay };
  } catch {
    return null;
  }
}
