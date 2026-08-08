import { test, expect, type Page } from "@playwright/test";
import { answerWithKeypad, promptedAnswer, readSave, seed, TODAY, YESTERDAY } from "./helpers";

// Every spec asserts the page produced no uncaught errors. Wiring bugs in
// main.ts (a missing element id, a bad dataset key) surface as a thrown
// exception and an inert screen rather than a failed assertion, so
// without this a spec can pass against an app that is visibly broken.
function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test.describe("landing and navigation", () => {
  test("a first-ever open lands on the Progress map, and Practice leads to the quiz", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");

    await expect(page).toHaveURL(/#\/map$/);
    await expect(page.locator("#screen-map")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#progress-grid .grid-cell")).toHaveCount(144);

    await page.click("#practice-link");
    await expect(page).toHaveURL(/#\/quiz$/);
    await expect(page.locator("#screen-quiz")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#keypad .key")).toHaveCount(12);

    expect(errors).toEqual([]);
  });

  test("returning the same day skips the map and goes straight to the quiz", async ({ page }) => {
    const errors = trackPageErrors(page);
    await seed(page, { lastMapShownDay: TODAY() });
    await page.goto("/");

    await expect(page).toHaveURL(/#\/quiz$/);
    await expect(page.locator("#screen-quiz")).toHaveAttribute("data-active", "true");

    expect(errors).toEqual([]);
  });

  test("the quiz screen carries a home affordance but no stats link and no mute toggle", async ({ page }) => {
    // Both omissions are deliberate (tickets #11 and #13): nothing
    // competes with practicing, and a mute control inside the
    // fast-tapping thumb zone gets hit by accident.
    await seed(page, { lastMapShownDay: TODAY() });
    await page.goto("/");

    await expect(page.locator("#screen-quiz #map-link")).toBeVisible();
    await expect(page.locator("#screen-quiz .stats-link")).toHaveCount(0);
    await expect(page.locator("#screen-quiz #mute-toggle")).toHaveCount(0);
    await expect(page.locator("#screen-map #mute-toggle")).toHaveCount(1);
  });

  test("the browser back button returns from the quiz to the map", async ({ page }) => {
    await page.goto("/");
    await page.click("#practice-link");
    await expect(page).toHaveURL(/#\/quiz$/);

    await page.goBack();
    await expect(page).toHaveURL(/#\/map$/);
    await expect(page.locator("#screen-map")).toHaveAttribute("data-active", "true");
  });
});

test.describe("answering", () => {
  test("a correct answer typed on the keypad advances to another Fact", async ({ page }) => {
    const errors = trackPageErrors(page);
    await seed(page, { lastMapShownDay: TODAY() });
    await page.goto("/");

    await answerWithKeypad(page, await promptedAnswer(page));
    await expect(page.locator("#overlay")).toHaveAttribute("data-visible", "true");
    await expect(page.locator("#prompt")).toContainText("?");

    expect(errors).toEqual([]);
  });

  test("backspace removes a digit rather than clearing the whole entry", async ({ page }) => {
    await seed(page, { lastMapShownDay: TODAY() });
    await page.goto("/");

    await page.click('.key[data-digit="1"]');
    await page.click('.key[data-digit="2"]');
    await page.click("#key-backspace");
    await expect(page.locator("#typed-answer")).toHaveText("1");
  });

  test("a wrong answer shows the correct one and requires retyping it, without recording an Attempt", async ({
    page,
  }) => {
    // The retype is practice, not measurement (CONTEXT.md's Attempt
    // entry). This asserts the engine-visible consequence: dismissing the
    // correction must not move Fluency, Accuracy, or the Streak.
    await seed(page, { lastMapShownDay: TODAY(), fact: { a: 4, b: 4 } });
    await page.goto("/");

    const correct = await promptedAnswer(page);
    await answerWithKeypad(page, correct + 1);

    // The prompt now shows the answer outright, and Enter alone won't move on.
    await expect(page.locator("#prompt")).toContainText(`= ${correct}`);
    const afterWrong = await readSave(page);

    await page.click(".key-enter");
    await expect(page.locator("#prompt")).toContainText(`= ${correct}`);

    await answerWithKeypad(page, correct);
    await expect(page.locator("#prompt")).toContainText("?");

    const afterCorrection = await readSave(page);
    expect(afterCorrection.fluency).toEqual(afterWrong.fluency);
    expect(afterCorrection.accuracy).toEqual(afterWrong.accuracy);
    expect(afterCorrection.streak).toEqual(afterWrong.streak);
  });
});

test.describe("takeover Celebrations", () => {
  test("expanding the Active range raises a takeover that waits to be dismissed", async ({ page }) => {
    const errors = trackPageErrors(page);
    // 24 of 25 Mastered is past the 90% threshold, so the next Attempt expands.
    await seed(page, { masteredCount: 24, lastMapShownDay: TODAY() });
    await page.goto("/");

    await answerWithKeypad(page, await promptedAnswer(page));

    const takeover = page.locator("#takeover");
    await expect(takeover).toHaveAttribute("data-visible", "true");
    await expect(takeover).toHaveAttribute("data-kind", "range-expansion");

    // Never auto-dismisses: the Learner can look away and still see it.
    await page.waitForTimeout(2_000);
    await expect(takeover).toHaveAttribute("data-visible", "true");

    await takeover.click();
    await expect(takeover).toHaveAttribute("data-visible", "false");
    expect((await readSave(page)).activeRange.size).toBe(6);

    expect(errors).toEqual([]);
  });

  test("one Attempt that both expands the range and hits a Milestone shows both, expansion first", async ({
    page,
  }) => {
    // The property the Celebration set exists for: a single Attempt can
    // earn more than one takeover, and none of them may be dropped.
    // Streak at 6 with yesterday as the last day means missedDays is 0,
    // so the recovery roll is 1/1 and the Streak deterministically
    // reaches 7 - a Milestone.
    const errors = trackPageErrors(page);
    await seed(page, {
      masteredCount: 24,
      lastMapShownDay: TODAY(),
      streak: { count: 6, lastStreakDay: YESTERDAY(), lastActivityDay: YESTERDAY(), missedDays: 0 },
    });
    await page.goto("/");

    await answerWithKeypad(page, await promptedAnswer(page));

    const takeover = page.locator("#takeover");
    await expect(takeover).toHaveAttribute("data-kind", "range-expansion");
    await takeover.click();

    await expect(takeover).toHaveAttribute("data-kind", "milestone");
    await expect(takeover).toHaveAttribute("data-visible", "true");
    await takeover.click();

    await expect(takeover).toHaveAttribute("data-visible", "false");
    const save = await readSave(page);
    expect(save.activeRange.size).toBe(6);
    expect(save.streak.count).toBe(7);

    expect(errors).toEqual([]);
  });
});

// The landing rule (ticket #11) decides the screen on load, so a direct
// `/#/stats` deep link gets redirected to the map or the quiz. Reach the
// stats page the way the Learner does instead - from the map's link.
async function gotoStats(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#screen-map")).toHaveAttribute("data-active", "true");
  await page.click("#stats-link");
  await expect(page.locator("#screen-stats")).toHaveAttribute("data-active", "true");
}

test.describe("statistics page", () => {
  test("renders both full 12x12 grids with a legend each", async ({ page }) => {
    const errors = trackPageErrors(page);
    await seed(page, { masteredCount: 12 });
    await gotoStats(page);

    await expect(page.locator("#accuracy-grid .stats-cell")).toHaveCount(144);
    await expect(page.locator("#fluency-grid .stats-cell")).toHaveCount(144);
    await expect(page.locator("#accuracy-heading")).toHaveText("Accuracy");
    await expect(page.locator("#fluency-heading")).toHaveText("Fluency");

    expect(errors).toEqual([]);
  });

  test("tapping a cell reveals that Fact's numbers, which never appear in the grid itself", async ({ page }) => {
    await seed(page, { masteredCount: 12 });
    await gotoStats(page);

    // No cell prints its own numbers - that is what the tooltip is for.
    await expect(page.locator("#fluency-grid .stats-cell").first()).toHaveText("");

    const tooltip = page.locator("#stats-tooltip");
    await expect(tooltip).toHaveAttribute("data-visible", "false");

    await page.locator("#fluency-grid .stats-cell").first().click();
    await expect(tooltip).toHaveAttribute("data-visible", "true");
    await expect(tooltip).toContainText("1 × 1");
  });

  test("the header reports days practiced and the Streak, and no Attempt total", async ({ page }) => {
    await seed(page, {
      streak: { count: 4, lastStreakDay: TODAY(), lastActivityDay: TODAY(), missedDays: 0 },
    });
    await gotoStats(page);

    await expect(page.locator("#stats-days")).toHaveText("Practiced: 3 days");
    await expect(page.locator("#stats-streak")).toContainText("4");
    // Raw Attempt totals were deliberately left off this header - they
    // reward grinding, where days practiced rewards showing up.
    await expect(page.locator(".stats-header")).not.toContainText(/attempt/i);
  });
});

test.describe("sound preference", () => {
  test("muting survives a reload", async ({ page }) => {
    await page.goto("/");

    await page.click("#mute-toggle");
    await expect(page.locator("#mute-toggle")).toHaveAttribute("aria-pressed", "true");
    expect((await readSave(page)).muted).toBe(true);

    await page.reload();
    // A same-day reload lands on the quiz, so reach the map to see the toggle.
    await page.click("#map-link");
    await expect(page.locator("#mute-toggle")).toHaveAttribute("aria-pressed", "true");
  });
});
