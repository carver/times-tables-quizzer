import type { EngineState } from "./engine/engine";

const STORAGE_KEY = "times-tables-quizzer:state";

function isValidEngineState(value: unknown): value is EngineState {
  if (typeof value !== "object" || value === null) return false;
  const { activeRange, fact } = value as Record<string, unknown>;

  return (
    typeof activeRange === "object" &&
    activeRange !== null &&
    typeof (activeRange as Record<string, unknown>).size === "number" &&
    typeof fact === "object" &&
    fact !== null &&
    typeof (fact as Record<string, unknown>).a === "number" &&
    typeof (fact as Record<string, unknown>).b === "number"
  );
}

export function saveState(state: EngineState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadState(): EngineState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidEngineState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
