import { expect, test, type Page } from "@playwright/test";
import { answerWithKeypad, promptedAnswer } from "./helpers";

// docs/adr/0006's device-local pairing record and synced save file - see
// src/profilePairing.ts and src/persistence.ts respectively. Read
// directly rather than through the UI since neither is meant to be
// visible; these specs assert on their effects, not their existence.
const PROFILES_KEY = "times-tables-quizzer:profiles";
const STATE_KEY = "times-tables-quizzer:state";

async function activeProfileId(page: Page): Promise<string> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), PROFILES_KEY);
  return (JSON.parse(raw ?? "{}") as { activeProfileId: string }).activeProfileId;
}

async function readEngineState(page: Page) {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STATE_KEY);
  return JSON.parse(raw!);
}

// These specs run against the real Firebase Local Emulator Suite
// (playwright.config.ts's second webServer entry) - cloudSync.ts's
// default "demo-times-tables-quizzer" project ID only ever talks to it,
// never a real cloud project, so no account/credentials are needed to
// run this suite.
//
// Every "Synced" assertion below waits up to SYNC_TIMEOUT_MS, well past
// Playwright's 5s default: the Firestore/Auth emulator's own JVM cold
// start (playwright.config.ts's comment on the Auth port having a ~20s
// warm-up) can still be settling when the very first sign-in + write in
// a run lands, even though the webServer health check already reported
// both emulators "up" - "accepting connections" and "fast enough for a
// real request" turned out not to be the same thing here. In the full
// suite this cost is usually hidden (app.spec.ts's other tests run
// first and incidentally finish warming the emulator up), but this file
// needs to be reliable running alone too.
const SYNC_TIMEOUT_MS = 20_000;

test.describe("cross-device sync (docs/adr/0006)", () => {
  test("Start sharing pairs this device, and a fresh device opening the link joins with matching progress", async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto("/");
    await pageA.click("#practice-link");
    await answerWithKeypad(pageA, await promptedAnswer(pageA));
    await pageA.click("#map-link");

    await pageA.click("#sync-button");
    await pageA.click("#start-sharing-button");
    await expect(pageA.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });

    const profileId = await activeProfileId(pageA);
    const stateA = await readEngineState(pageA);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto(`/#/join/${profileId}`);
    await expect(pageB.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });

    const stateB = await readEngineState(pageB);
    expect(stateB.fact).toEqual(stateA.fact);
    expect(stateB.streak).toEqual(stateA.streak);

    await ctxA.close();
    await ctxB.close();
  });

  test("a device with its own existing history must confirm before joining replaces it, and Cancel leaves it untouched", async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto("/");
    await pageA.click("#sync-button");
    await pageA.click("#start-sharing-button");
    await expect(pageA.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });
    const profileId = await activeProfileId(pageA);

    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    await pageC.goto("/");
    await pageC.click("#practice-link");
    await answerWithKeypad(pageC, await promptedAnswer(pageC));
    await pageC.click("#map-link");

    await pageC.click("#sync-button");
    await pageC.fill("#join-code-input", profileId);
    await pageC.click("#join-button");
    await expect(pageC.locator("#sync-confirm")).toBeVisible();
    await expect(pageC.locator("#sync-confirm-body")).toContainText("already has its own practice history");

    await pageC.click("#sync-confirm-no");
    await expect(pageC.locator("#sync-confirm")).toBeHidden();
    await expect(pageC.locator("#sync-button")).toHaveText("🔗 Sync across devices");
    expect((await readEngineState(pageC)).streak.count).toBe(1);

    await pageC.click("#join-button");
    await expect(pageC.locator("#sync-confirm")).toBeVisible();
    await pageC.click("#sync-confirm-yes");
    await expect(pageC.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });
    // Device A's shared profile never actually answered anything, so
    // joining genuinely replaced Device C's own streak of 1.
    expect((await readEngineState(pageC)).streak.count).toBe(0);

    await ctxA.close();
    await ctxC.close();
  });

  test("joining with no non-trivial local progress skips the confirmation entirely", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto("/");
    await pageA.click("#sync-button");
    await pageA.click("#start-sharing-button");
    await expect(pageA.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });
    const profileId = await activeProfileId(pageA);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto("/");
    await pageB.click("#sync-button");
    await pageB.fill("#join-code-input", profileId);
    await pageB.click("#join-button");

    await expect(pageB.locator("#sync-confirm")).toBeHidden();
    await expect(pageB.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });

    await ctxA.close();
    await ctxB.close();
  });

  test("Stop syncing detaches this device but leaves its local progress untouched", async ({ page }) => {
    await page.goto("/");
    await page.click("#sync-button");
    await page.click("#start-sharing-button");
    await expect(page.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });

    await page.click("#stop-syncing-button");

    await expect(page.locator("#sync-button")).toHaveText("🔗 Sync across devices");
    const raw = await page.evaluate((key) => window.localStorage.getItem(key), PROFILES_KEY);
    expect(JSON.parse(raw!).profiles).toEqual([]);
  });

  test("the hidden reset screen also detaches a synced device, so the wipe isn't immediately undone by the next sync", async ({
    page,
  }) => {
    await page.goto("/");
    await page.click("#sync-button");
    await page.click("#start-sharing-button");
    await expect(page.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });

    await page.goto("/#/reset");
    await page.click("#reset-confirm");
    await expect(page).toHaveURL(/#\/map$/);

    const raw = await page.evaluate((key) => window.localStorage.getItem(key), PROFILES_KEY);
    expect(JSON.parse(raw!).profiles).toEqual([]);
    await expect(page.locator("#sync-button")).toHaveText("🔗 Sync across devices");
  });

  test("rejects a sync link that doesn't parse as a valid link or bare ID", async ({ page }) => {
    await page.goto("/");
    await page.click("#sync-button");
    await page.fill("#join-code-input", "not a real link");
    await page.click("#join-button");

    await expect(page.locator("#sync-hint")).toBeVisible();
    await expect(page.locator("#sync-hint")).toContainText("valid sync link");
    await expect(page.locator("#sync-button")).toHaveText("🔗 Sync across devices");
  });
});
