import type { EngineState } from "./engine/engine";

const STORAGE_KEY = "times-tables-quizzer:state";

// Bumped whenever EngineState's persisted shape changes. `migrate` below
// is what the *next* bump has somewhere to hook into: fill in a default
// for whatever field is new, rather than discarding the whole save.
// There's no save data worth preserving as of this version - the fields
// ticket #10 adds (Accuracy, redemption, range history) have no prior
// values to recover, so "migrate by defaulting the new fields to empty"
// and "wipe" look the same for this particular bump, but the mechanism
// itself is what's meant to last.
export const CURRENT_SAVE_VERSION = 1;

type PersistedState = EngineState & { version: number };

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
// mismatch. Currently the only source of "missing fields" is saves
// written before ticket #10 (no `accuracy`, `needsRedemption`,
// `rangeHistory`, or `version` at all), but the shape of this function -
// keep the core fields, default the new ones - is what a future version
// bump extends rather than replaces.
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
    version: CURRENT_SAVE_VERSION,
  };
}

export function saveState(state: EngineState): void {
  const persisted: PersistedState = { ...state, version: CURRENT_SAVE_VERSION };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

export function loadState(): EngineState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const migrated = migrate(parsed);
    if (migrated === null) return null;

    // `version` only exists to drive migrate() above - EngineState itself
    // carries no version field, so it's stripped back off here.
    const { version: _version, ...state } = migrated;
    return state;
  } catch {
    return null;
  }
}
