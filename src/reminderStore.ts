// The one piece of state the daily-reminder service worker needs that
// window.localStorage can't give it: whether the Learner has already
// practiced today. Service workers run in a separate global scope with
// no access to the page's localStorage, but both contexts can reach the
// same origin's IndexedDB, so this mirrors just that one DayKey there,
// rather than duplicating the whole save file. main.ts writes it after
// every Attempt; sw.ts reads it from the periodicsync handler, where
// there may be no open page to ask.
import { dayKey, type DayKey } from "./engine/engine";

const DB_NAME = "times-tables-quizzer-reminders";
const STORE_NAME = "state";
const LAST_ACTIVITY_KEY = "lastActivityDay";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error as unknown);
  });
}

export async function setLastActivityDay(day: DayKey): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(day, LAST_ACTIVITY_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error as unknown);
  });
  db.close();
}

export async function getLastActivityDay(): Promise<DayKey | null> {
  const db = await openDb();
  const value = await new Promise<DayKey | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(LAST_ACTIVITY_KEY);
    request.onsuccess = () => resolve((request.result as DayKey | undefined) ?? null);
    request.onerror = () => reject(request.error as unknown);
  });
  db.close();
  return value;
}

// The reminder's entire decision rule: remind unless today's practice has
// already happened. Kept pure and separate from the IndexedDB plumbing
// above so it's testable without a browser. Mirrors CONTEXT.md's split
// between engine logic and I/O, one level up from the engine itself.
export function shouldRemind(lastActivityDay: DayKey | null, now: number): boolean {
  return lastActivityDay !== dayKey(now);
}
