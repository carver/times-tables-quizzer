import { expect, type Page } from "@playwright/test";

export const STORAGE_KEY = "times-tables-quizzer:state";

// Pinned to an old save version on purpose, not persistence.ts's
// CURRENT_SAVE_VERSION: these specs drive the built app as a black box,
// and every seed should go through migrate() the way a real stale save
// does. The seeds below always carry a rangeHistory entry, which is what
// keeps the pre-v6 branch from shrinking their Active range.
export const SAVE_VERSION = 4;

// The engine's local-calendar day key (engine.ts's dayKey). Reimplemented
// here for the same black-box reason, and because a seed built from UTC
// would land on the wrong day for anyone running these west of Greenwich.
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const TODAY = () => dayKey(new Date());
export const YESTERDAY = () => dayKey(new Date(Date.now() - 86_400_000));

type Seed = {
  masteredCount?: number;
  activeRangeSize?: number;
  // Defaults to activeRangeSize, "no takeover currently owed", the
  // common case. Set lower than activeRangeSize to simulate a
  // range-expansion takeover that was never actually dismissed (main.ts's
  // boot-time catch-up, celebrationQueue.ts's missedRangeExpansionTakeovers).
  acknowledgedRangeSize?: number;
  fact?: { a: number; b: number };
  streak?: { count: number; lastStreakDay: string | null; lastActivityDay: string | null; missedDays: number };
  lastMapShownDay?: string | null;
  muted?: boolean;
};

// Writes a save before any page script runs, so the app boots from it.
// `masteredCount` Facts get a fast, freshly-practiced Fluency record,
// which is what makes range expansion reachable in a single Attempt.
export async function seed(page: Page, overrides: Seed = {}): Promise<void> {
  const now = Date.now();
  const size = overrides.activeRangeSize ?? 5;
  const mastered = overrides.masteredCount ?? 0;

  const fluency: Record<string, unknown> = {};
  const accuracy: Record<string, unknown> = {};
  let placed = 0;
  outer: for (let a = 1; a <= size; a++) {
    for (let b = 1; b <= size; b++) {
      if (placed >= mastered) break outer;
      placed++;
      fluency[`${a}x${b}`] = { averageResponseMs: 500, lastAttemptAt: now };
      accuracy[`${a}x${b}`] = { correctShare: 1, attemptCount: 10 };
    }
  }

  const state = {
    activeRange: { size },
    // Defaults to the last Fact in the range, which the loop above never
    // marks Mastered, so the Attempt a spec drives is always a real one.
    fact: overrides.fact ?? { a: size, b: size },
    fluency,
    accuracy,
    boosted: {},
    needsRedemption: {},
    rangeHistory: { [size]: now },
    acknowledgedRangeSize: overrides.acknowledgedRangeSize ?? size,
    practiceDayCount: 3,
    streak: overrides.streak ?? { count: 0, lastStreakDay: null, lastActivityDay: null, missedDays: 0 },
    lastMapShownDay: overrides.lastMapShownDay ?? null,
    muted: overrides.muted ?? false,
    version: SAVE_VERSION,
  };

  // Seeds exactly once per browser context, not on every load. An
  // unguarded init script re-writes the save after any reload the app
  // performs itself, which would silently defeat a spec that reloads to
  // check something was persisted, or erased.
  await page.addInitScript(
    ([key, value]) => {
      if (window.sessionStorage.getItem("e2e-seeded")) return;
      window.sessionStorage.setItem("e2e-seeded", "1");
      window.localStorage.setItem(key as string, value as string);
    },
    [STORAGE_KEY, JSON.stringify(state)] as const,
  );
}

export async function readSave(page: Page): Promise<Record<string, any>> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  if (raw === null) throw new Error("no save present");
  return JSON.parse(raw);
}

// Types the digits of `answer` on the on-screen keypad and presses Enter.
export async function answerWithKeypad(page: Page, answer: number): Promise<void> {
  for (const digit of String(answer)) {
    await page.click(`.key[data-digit="${digit}"]`);
  }
  await page.click(".key-enter");
}

// The product the prompt is currently asking for, read off the screen so
// specs never have to predict which Fact the weighted selection picks.
//
// Reads and parses inside a single retried block (expect(...).toPass())
// rather than an assertion-then-separate-read: a caller that navigates to
// the quiz via a real click (a hashchange event, handled asynchronously;
// main.ts's own boot comment notes this) can otherwise have the DOM
// still mid-transition (blank, or between renders) right as it's read.
// An earlier version asserted "#prompt contains '?'" and then read its
// text in a second, separate call, but a render landing in the gap
// between those two reads meant the assertion could pass against one
// paint and the read could still land on a blank or stale one right
// after, parsing NaN and silently going on to press a "NaN" digit that
// doesn't exist. Retrying the read-and-parse as one atomic unit closes
// that gap: any attempt that doesn't yield two real digits throws and is
// retried, never returned. Fast/local machines rarely hit the original
// gap; a loaded CI runner does.
export async function promptedAnswer(page: Page): Promise<number> {
  let product = NaN;
  await expect(async () => {
    const text = (await page.locator("#prompt").textContent()) ?? "";
    const match = text.match(/\d+/g);
    if (!match || match.length < 2) throw new Error(`prompt not ready yet: ${JSON.stringify(text)}`);
    const [a, b] = match.map(Number);
    product = a * b;
  }).toPass();
  return product;
}
