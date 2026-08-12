import { test, expect, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answerWithKeypad, promptedAnswer, readSave, seed, TODAY, YESTERDAY } from "./helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  test("reloading while on the map stays on the map, even on a day the map was already shown", async ({ page }) => {
    // Regression: the once-a-day landing rule used to override every
    // reload regardless of the current hash, so a Learner sitting on the
    // map (having already been shown it once today) and refreshing the
    // page would get flung straight into the quiz - a browser refresh
    // preserves the hash exactly, so this is not a "fresh open" the
    // once-a-day rule should apply to.
    await seed(page, { lastMapShownDay: TODAY() });
    await page.goto("/#/map");

    await expect(page).toHaveURL(/#\/map$/);
    await expect(page.locator("#screen-map")).toHaveAttribute("data-active", "true");

    await page.reload();

    await expect(page).toHaveURL(/#\/map$/);
    await expect(page.locator("#screen-map")).toHaveAttribute("data-active", "true");
  });

  test("reloading while on the stats page stays there too", async ({ page }) => {
    await seed(page, { lastMapShownDay: TODAY() });
    await page.goto("/#/stats");

    await page.reload();

    await expect(page).toHaveURL(/#\/stats$/);
    await expect(page.locator("#screen-stats")).toHaveAttribute("data-active", "true");
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

  // Regression for a real report: on a phone, the keypad's `:active`
  // press feedback would fire but the digit sometimes never landed -
  // about 1 in 20 taps. The cause was a lost `click`: mobile browsers
  // can decide, after already accepting a touch, not to synthesize one
  // after all. main.ts now acts on `pointerdown` for touch/pen input
  // instead of waiting on `click`, which Playwright's default (mouse)
  // `.click()` never exercises - a real touch context via `.tap()` is
  // the only way to drive the code path this regression lives in, and
  // to catch the double-entry a naive fix (acting on both pointerdown
  // and the click that still follows) would cause.
  test("typing on the keypad via a real touch tap registers each digit exactly once", async ({ browser }) => {
    const ctx = await browser.newContext({ hasTouch: true });
    const page = await ctx.newPage();
    const errors = trackPageErrors(page);
    await seed(page, { lastMapShownDay: TODAY() });
    await page.goto("/");

    const answer = await promptedAnswer(page);
    for (const digit of String(answer)) {
      await page.tap(`.key[data-digit="${digit}"]`);
    }
    await expect(page.locator("#typed-answer")).toHaveText(String(answer));

    await page.tap(".key-enter");
    await expect(page.locator("#overlay")).toHaveAttribute("data-visible", "true");

    expect(errors).toEqual([]);
    await ctx.close();
  });

  test("backspace removes a digit rather than clearing the whole entry", async ({ page }) => {
    await seed(page, { lastMapShownDay: TODAY() });
    await page.goto("/");

    await page.click('.key[data-digit="1"]');
    await page.click('.key[data-digit="2"]');
    await page.click("#key-backspace");
    await expect(page.locator("#typed-answer")).toHaveText("1");
  });

  test("a first wrong answer earns a Retry with the answer still hidden", async ({ page }) => {
    // The point of the Retry is recall: being shown "4 × 4 = 16"
    // immediately turns the next keystrokes into copying. The Fact stays
    // up unanswered instead, and only a second miss gives the answer up.
    await seed(page, { lastMapShownDay: TODAY(), fact: { a: 4, b: 4 } });
    await page.goto("/");

    const correct = await promptedAnswer(page);
    await answerWithKeypad(page, correct + 1);

    await expect(page.locator("#overlay")).toContainText("try again");
    await expect(page.locator("#prompt")).toHaveText("4 × 4 = ?");
    const afterWrong = await readSave(page);

    // Getting it right on the second go moves straight on to the next
    // Fact - no answer to copy out - and, being practice rather than a
    // measured Attempt, leaves Fluency, Accuracy and the Streak alone.
    await answerWithKeypad(page, correct);
    await expect(page.locator("#prompt")).toContainText("?");

    const afterRetry = await readSave(page);
    expect(afterRetry.fluency).toEqual(afterWrong.fluency);
    expect(afterRetry.accuracy).toEqual(afterWrong.accuracy);
    expect(afterRetry.streak).toEqual(afterWrong.streak);
  });

  test("a second wrong answer shows the correct one and requires retyping it, without recording an Attempt", async ({
    page,
  }) => {
    // The retype is practice, not measurement (CONTEXT.md's Attempt
    // entry). This asserts the engine-visible consequence: dismissing the
    // correction must not move Fluency, Accuracy, or the Streak.
    await seed(page, { lastMapShownDay: TODAY(), fact: { a: 4, b: 4 } });
    await page.goto("/");

    const correct = await promptedAnswer(page);
    await answerWithKeypad(page, correct + 1);
    // Still hidden after one miss - only the second one gives it up.
    await expect(page.locator("#prompt")).toHaveText("4 × 4 = ?");
    await answerWithKeypad(page, correct + 2);

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

  // Regression for a real report: a Learner progressed through two grids
  // in one sitting but never saw a celebration for either. Root cause -
  // Enter is handled on `pointerdown` for touch (see main.ts's keypad
  // listener), so a tap can reveal this takeover synchronously the
  // instant the finger lands. The same physical tap still produces a
  // trailing `click` afterward, and a browser computes that click's
  // target from the DOM as it looks at dispatch time - which is now
  // this takeover, freshly covering the same screen coordinates. Left
  // unguarded, the takeover dismissed itself within the same tap that
  // raised it, before ever being seen. A mouse `.click()` (every other
  // test in this file) never exercises the pointerdown path at all, so
  // only a real touch tap can catch this.
  test("a takeover raised by a touch tap is not immediately self-dismissed by that same tap's trailing click", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ hasTouch: true });
    const page = await ctx.newPage();
    const errors = trackPageErrors(page);
    await seed(page, { masteredCount: 24, lastMapShownDay: TODAY() });
    await page.goto("/");

    const answer = await promptedAnswer(page);
    for (const digit of String(answer)) {
      await page.tap(`.key[data-digit="${digit}"]`);
    }
    await page.tap(".key-enter");

    const takeover = page.locator("#takeover");
    // No wait here on purpose - this is exactly the window the bug lived
    // in. A pre-fix run finds this already dismissed.
    await expect(takeover).toHaveAttribute("data-visible", "true");
    await expect(takeover).toHaveAttribute("data-kind", "range-expansion");

    // A later, genuine tap still dismisses it normally, once the
    // ghost-click guard's own short window has passed.
    await page.waitForTimeout(600);
    await page.tap("#takeover");
    await expect(takeover).toHaveAttribute("data-visible", "false");
    expect((await readSave(page)).activeRange.size).toBe(6);

    expect(errors).toEqual([]);
    await ctx.close();
  });

  // Regression coverage for the same real report, from the other
  // direction: a session that genuinely did end (app closed, reload,
  // etc.) before a range-expansion takeover was ever dismissed must not
  // lose it - main.ts replays it on the next load instead.
  test("a range-expansion takeover missed in a previous session is replayed on the next load, oldest first", async ({
    page,
  }) => {
    const errors = trackPageErrors(page);
    // The Active range reached 8x8, but only a takeover for 6x6 was ever
    // actually dismissed - 7x7's and 8x8's were lost.
    await seed(page, { activeRangeSize: 8, acknowledgedRangeSize: 5, lastMapShownDay: TODAY() });
    await page.goto("/");

    const takeover = page.locator("#takeover");
    await expect(takeover).toHaveAttribute("data-visible", "true");
    await expect(takeover).toHaveAttribute("data-kind", "range-expansion");

    // Three missed sizes (6, 7, 8) - replayed one at a time, not
    // collapsed into a single "you're now at 8x8" takeover.
    await takeover.click();
    await expect(takeover).toHaveAttribute("data-visible", "true");
    await takeover.click();
    await expect(takeover).toHaveAttribute("data-visible", "true");
    await takeover.click();
    await expect(takeover).toHaveAttribute("data-visible", "false");

    expect((await readSave(page)).acknowledgedRangeSize).toBe(8);
    expect(errors).toEqual([]);
  });

  test("hides the next Fact and does not bill the celebration's duration to it", async ({ page }) => {
    // Both halves of the same problem: input is swallowed while a
    // takeover is up, so the next Fact must not be readable through it,
    // and the clock must not be running on a Fact the Learner has no way
    // to answer. Before this was fixed, lingering three seconds on a
    // takeover recorded ~3700ms for an instantly-answered next Fact.
    await seed(page, { masteredCount: 24, lastMapShownDay: TODAY() });
    await page.goto("/");

    await answerWithKeypad(page, await promptedAnswer(page));
    await expect(page.locator("#takeover")).toHaveAttribute("data-visible", "true");

    await expect(page.locator("#center")).toBeHidden();
    await expect(page.locator("#keypad")).toBeHidden();
    // Not merely hidden by CSS - the Fact is not in the DOM at all, so
    // no styling failure on an older browser can leak it.
    await expect(page.locator("#prompt")).toHaveText("");

    await page.waitForTimeout(3_000);
    await page.locator("#takeover").click();
    await expect(page.locator("#center")).toBeVisible();

    const next = await promptedAnswer(page);
    const key = ((await page.locator("#prompt").textContent()) ?? "").match(/\d+/g)!.slice(0, 2).join("x");
    await answerWithKeypad(page, next);

    const recorded = (await readSave(page)).fluency[key].averageResponseMs;
    expect(recorded).toBeLessThan(3_000);
  });

  test("does not bill idle time at home for a Fact re-shown after leaving and returning to the quiz", async ({
    page,
  }) => {
    // Same underlying property as the takeover test above, but for the
    // navigation path: leaving the quiz for the map and coming back is
    // "Start practice" again, and must restart the clock just as freshly
    // as the very first visit does - otherwise time spent away from the
    // phone gets billed to whichever Fact happens to be showing.
    const errors = trackPageErrors(page);
    await seed(page, { masteredCount: 24, lastMapShownDay: TODAY() });
    await page.goto("/");

    await page.waitForTimeout(3_000);
    await page.click("#map-link");
    await expect(page).toHaveURL(/#\/map$/);

    await page.waitForTimeout(3_000);
    await page.click("#practice-link");
    await expect(page).toHaveURL(/#\/quiz$/);

    const key = ((await page.locator("#prompt").textContent()) ?? "").match(/\d+/g)!.slice(0, 2).join("x");
    await answerWithKeypad(page, await promptedAnswer(page));

    const recorded = (await readSave(page)).fluency[key].averageResponseMs;
    expect(recorded).toBeLessThan(3_000);

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

  test("tapping a legend swatch explains what it means", async ({ page }) => {
    await seed(page, { masteredCount: 12 });
    await gotoStats(page);

    const tooltip = page.locator("#stats-tooltip");
    await expect(tooltip).toHaveAttribute("data-visible", "false");

    await page.locator(".legend-item", { hasText: "100%" }).click();
    await expect(tooltip).toHaveAttribute("data-visible", "true");
    await expect(tooltip).toContainText("Never missed");

    await page.locator(".legend-item", { hasText: "Wrong so far" }).click();
    await expect(tooltip).toContainText("never yet answered correctly");
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

    // A reload preserves the hash exactly, so it lands back on the map
    // (where the toggle was clicked) rather than being sent to the quiz.
    await page.reload();
    await expect(page.locator("#mute-toggle")).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("the hidden reset screen", () => {
  test("is reachable only by typing its hash, and is linked from nowhere", async ({ page }) => {
    await seed(page, { masteredCount: 12, lastMapShownDay: TODAY() });
    await page.goto("/");

    // Nothing anywhere in the app points at it.
    await expect(page.locator('a[href="#/reset"]')).toHaveCount(0);

    // And the landing rule doesn't redirect it away on a cold open,
    // which is the only way it is ever opened.
    await page.goto("/#/reset");
    await expect(page.locator("#screen-reset")).toHaveAttribute("data-active", "true");
  });

  test("erases every trace of progress and returns to a first-ever-open state", async ({ page }) => {
    await seed(page, {
      masteredCount: 20,
      lastMapShownDay: TODAY(),
      streak: { count: 9, lastStreakDay: TODAY(), lastActivityDay: TODAY(), missedDays: 0 },
    });
    await page.goto("/#/reset");

    await page.click("#reset-confirm");

    // Back to the map, because the erased save takes the genuine
    // first-ever-open path rather than a same-day return.
    await expect(page).toHaveURL(/#\/map$/);
    await expect(page.locator("#screen-map")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#map-streak")).toContainText("0 days");

    // Nothing of the old Learner survives. (A save exists again by now -
    // landing on the map records today as lastMapShownDay - but it is a
    // fresh one.)
    const after = await readSave(page);
    expect(after.fluency).toEqual({});
    expect(after.accuracy).toEqual({});
    expect(after.streak.count).toBe(0);
    expect(after.practiceDayCount).toBe(0);
    expect(after.activeRange.size).toBe(2);
  });

  test("leaves progress untouched if the Learner backs out", async ({ page }) => {
    await seed(page, { masteredCount: 20, lastMapShownDay: TODAY() });
    await page.goto("/#/reset");
    const before = await readSave(page);

    await page.click("#reset-cancel");

    await expect(page.locator("#screen-map")).toHaveAttribute("data-active", "true");
    expect(await readSave(page)).toEqual(before);
  });
});

test.describe("the inline Celebration overlay", () => {
  test("hides the next Fact while it is up, and does not charge that time to it", async ({ page }) => {
    // The overlay used to be translucent, so the next Fact was readable
    // straight through "Correct!" - and the digits being typed were
    // washed out along with it, which read as input not registering.
    await seed(page, { lastMapShownDay: TODAY() });
    await page.goto("/");

    await answerWithKeypad(page, await promptedAnswer(page));

    const overlay = page.locator("#overlay");
    await expect(overlay).toHaveAttribute("data-visible", "true");
    await expect(overlay).toHaveText("Correct!");
    await expect(page.locator("#prompt")).toHaveText("");

    // Once it clears, the Fact appears and its clock starts from there.
    await expect(page.locator("#prompt")).toContainText("?", { timeout: 3_000 });
    const key = ((await page.locator("#prompt").textContent()) ?? "").match(/\d+/g)!.slice(0, 2).join("x");
    await answerWithKeypad(page, await promptedAnswer(page));

    const recorded = (await readSave(page)).fluency[key].averageResponseMs;
    expect(recorded).toBeLessThan(1_500);
  });

  test("a keypress dismisses it at once, so the typed digit is visible immediately", async ({ page }) => {
    await seed(page, { lastMapShownDay: TODAY() });
    await page.goto("/");

    await answerWithKeypad(page, await promptedAnswer(page));
    await expect(page.locator("#overlay")).toHaveAttribute("data-visible", "true");

    await page.click('.key[data-digit="7"]');

    await expect(page.locator("#overlay")).toHaveAttribute("data-visible", "false");
    await expect(page.locator("#typed-answer")).toHaveText("7");
    await expect(page.locator("#prompt")).toContainText("?");
  });
});

test.describe("the idle check", () => {
  test("checks in after MAX_RESPONSE_MS idle mid-question, and confirming restarts the clock", async ({ page }) => {
    // Virtual time: fast-forwarding 31 real seconds would make this the
    // slowest spec in the suite for no reason, and Page.clock advances
    // Date.now() along with the timers, so the app can't tell the
    // difference from a real wait.
    await page.clock.install();
    await seed(page, { lastMapShownDay: TODAY() });
    await page.goto("/");
    await expect(page.locator("#screen-quiz")).toHaveAttribute("data-active", "true");

    await page.clock.fastForward("00:31");
    await expect(page.locator("#idle-confirm")).toBeVisible();
    // Swallowed like a takeover: the keypad must not be answerable while
    // this is up, or an answer typed through it would still be measured
    // against the stale factShownAt from before the confirm even showed.
    await expect(page.locator("#keypad")).not.toBeVisible();

    await page.click("#idle-confirm-yes");
    await expect(page.locator("#idle-confirm")).toBeHidden();

    const key = ((await page.locator("#prompt").textContent()) ?? "").match(/\d+/g)!.slice(0, 2).join("x");
    await answerWithKeypad(page, await promptedAnswer(page));

    const recorded = (await readSave(page)).fluency[key].averageResponseMs;
    expect(recorded).toBeLessThan(3_000);
  });

  test("never appears during a Retry or a correction retype, neither of which feeds Fluency", async ({ page }) => {
    await page.clock.install();
    await seed(page, { lastMapShownDay: TODAY(), fact: { a: 4, b: 4 } });
    await page.goto("/");

    await answerWithKeypad(page, 999999); // never a real product in any Active range
    await expect(page.locator("#overlay")).toHaveAttribute("data-visible", "true");

    // Mid-Retry: thinking time here is deliberately untimed (adr/0007),
    // so a long think must not be mistaken for a walk-away.
    await expect(page.locator("#prompt")).toHaveText("4 × 4 = ?");
    await page.clock.fastForward("00:31");
    await expect(page.locator("#idle-confirm")).toBeHidden();

    // And again once the Retry is spent and the answer is on screen.
    await answerWithKeypad(page, 999999);
    await expect(page.locator("#prompt")).toContainText("= 16");
    await page.clock.fastForward("00:31");
    await expect(page.locator("#idle-confirm")).toBeHidden();
  });
});

test.describe("home-screen install", () => {
  test("links a valid manifest with a full icon set, and registers the service worker", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBeTruthy();

    const manifestUrl = new URL(manifestHref!, page.url()).toString();
    const manifestResponse = await page.request.get(manifestUrl);
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();

    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.map((icon: { purpose?: string }) => icon.purpose)).toEqual(
      expect.arrayContaining(["any", "maskable", "monochrome"]),
    );

    // Every icon the manifest points at must actually be servable, not
    // just present in the JSON - a typo'd path here would otherwise only
    // surface as a launcher silently falling back to a generic icon.
    for (const icon of manifest.icons as Array<{ src: string }>) {
      const iconUrl = new URL(icon.src, manifestUrl).toString();
      const response = await page.request.get(iconUrl);
      expect(response.ok(), `${icon.src} should be servable`).toBe(true);
    }

    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)))
      .toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test("iOS shows a manual install hint instead of a button, since Safari has no install prompt API", async ({
    browser,
  }) => {
    const context = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
    const page = await context.newPage();
    await page.goto("/");

    await expect(page.locator("#ios-install-hint")).toBeVisible();
    await expect(page.locator("#install-button")).toBeHidden();

    await context.close();
  });

  test("the daily-reminder toggle starts off, and never claims success it can't back up", async ({ page }) => {
    await page.goto("/");

    const toggle = page.locator("#reminder-toggle");
    await expect(toggle).toHaveText(/Daily reminder: Off/);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();

    // Headless CI has neither a granted notification permission nor the
    // real-world "site engagement" Chrome requires before it will
    // register a periodic sync, so this can't assert it turns on -
    // only that it never shows "On" without the hint explaining why not,
    // the one failure mode that would mislead a parent into thinking
    // reminders are live when they aren't.
    const isOn = (await toggle.getAttribute("aria-pressed")) === "true";
    if (!isOn) {
      await expect(page.locator("#reminder-hint")).toBeVisible();
    }
  });
});

test.describe("the app-update banner", () => {
  test("appears once a newly deployed service worker activates, only on the map and stats screens", async ({
    page,
  }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");

    // The very first load is never "claimed" (sw.ts has no
    // clients.claim()), so this page has no controller yet - a reload is
    // what makes the just-activated worker genuinely control it, the
    // same state any real return visit would be in.
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.ready.then(() => true)))
      .toBe(true);
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    // Force a genuine byte-level difference in the built sw.js - the same
    // file the preview server is serving from disk - so the browser's
    // next registration.update() actually finds something to install,
    // exactly like a real deploy landing while this tab stayed open.
    const swPath = join(__dirname, "..", "dist", "sw.js");
    appendFileSync(swPath, `\n// e2e-forced-update-${Date.now()}\n`);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));

    await expect(page.locator("#update-banner")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#screen-map")).toHaveAttribute("data-active", "true");

    // Never on the quiz - nothing should compete for attention mid-question.
    await page.click("#practice-link");
    await expect(page.locator("#update-banner")).toBeHidden();

    await page.click("#map-link");
    await expect(page.locator("#update-banner")).toBeVisible();

    // Tapping it is just a reload - the new worker is already activated
    // and ready to take over.
    await page.click("#update-banner-button");
    await expect(page.locator("#screen-map")).toHaveAttribute("data-active", "true");

    expect(errors).toEqual([]);
  });
});
