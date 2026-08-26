import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { answerWithKeypad, promptedAnswer, seed } from "./helpers";

// docs/adr/0006's device-local pairing record and synced save file; see
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

// "Start sharing" reveals an inline name prompt rather than sharing
// immediately; see main.ts's startSharingButtonEl/startSharingConfirmButtonEl.
async function startSharing(page: Page, label: string): Promise<void> {
  await page.click("#start-sharing-button");
  await page.fill("#start-sharing-name-input", label);
  await page.click("#start-sharing-confirm-button");
}

// jsQR (a real, independent decoder, a devDependency purely for this
// check) confirms the on-screen QR scans as the expected link,
// rather than just asserting some <svg> appeared. Injected into the page
// rather than imported into this Node-side test file, since decoding
// needs a real <canvas> to rasterize the rendered SVG into pixels first.
const JSQR_SOURCE = readFileSync("node_modules/jsqr/dist/jsQR.js", "utf8");

async function scanQrCode(page: Page): Promise<string | null> {
  await page.addScriptTag({ content: JSQR_SOURCE });
  return page.evaluate(async () => {
    const svgEl = document.querySelector("#qr-code-wrap svg");
    if (!svgEl) return null;
    const svgUrl = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svgEl)], { type: "image/svg+xml" }),
    );
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = svgUrl;
    });

    const size = 400;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white"; // the SVG has no background of its own to draw over
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    return (window as unknown as { jsQR: (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null })
      .jsQR(imageData.data, size, size)?.data ?? null;
  });
}

// These specs run against the real Firebase Local Emulator Suite
// (playwright.config.ts's second webServer entry). cloudSync.ts's
// default "demo-times-tables-quizzer" project ID only ever talks to it,
// never a real cloud project, so no account/credentials are needed to
// run this suite.
//
// Every "Synced" assertion below waits up to SYNC_TIMEOUT_MS, well past
// Playwright's 5s default: the Firestore/Auth emulator's own JVM cold
// start (playwright.config.ts's comment on the Auth port having a ~20s
// warm-up) can still be settling when the very first sign-in + write in
// a run lands, even though the webServer health check already reported
// both emulators "up". "Accepting connections" and "fast enough for a
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
    await startSharing(pageA, "Sam");
    await expect(pageA.locator("#sync-button")).toContainText("Synced: Sam", { timeout: SYNC_TIMEOUT_MS });

    const profileId = await activeProfileId(pageA);
    const stateA = await readEngineState(pageA);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto(`/#/join/${profileId}`);
    // The name travels with the Profile document itself, not just
    // device A's own local label, so a fresh device joining sees it too.
    await expect(pageB.locator("#sync-button")).toContainText("Synced: Sam", { timeout: SYNC_TIMEOUT_MS });

    const stateB = await readEngineState(pageB);
    expect(stateB.fact).toEqual(stateA.fact);
    expect(stateB.streak).toEqual(stateA.streak);

    await ctxA.close();
    await ctxB.close();
  });

  test("the QR code encodes the same link as 'Copy sync link', and scanning it (opening the decoded link) joins with matching progress", async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto("/");
    await pageA.click("#practice-link");
    await answerWithKeypad(pageA, await promptedAnswer(pageA));
    await pageA.click("#map-link");

    await pageA.click("#sync-button");
    await startSharing(pageA, "Shared progress");
    await expect(pageA.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });

    await expect(pageA.locator("#show-qr-button")).toHaveText("Show QR code");
    await pageA.click("#show-qr-button");
    await expect(pageA.locator("#qr-code-wrap")).toBeVisible();
    await expect(pageA.locator("#show-qr-button")).toHaveText("Hide QR code");

    const profileId = await activeProfileId(pageA);
    const scannedLink = await scanQrCode(pageA);
    expect(scannedLink).toBe(await pageA.evaluate((id) => `${new URL(window.location.href).origin}/#/join/${id}`, profileId));

    // Toggling again hides it rather than re-fetching/re-rendering.
    await pageA.click("#show-qr-button");
    await expect(pageA.locator("#qr-code-wrap")).toBeHidden();
    await expect(pageA.locator("#show-qr-button")).toHaveText("Show QR code");

    const stateA = await readEngineState(pageA);

    // A phone's camera app scanning this QR just opens the decoded link,
    // simulated here by literally navigating a fresh device to it.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto(scannedLink!);
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
    await startSharing(pageA, "Shared progress");
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
    // Device A's shared profile never answered anything, so
    // joining replaced Device C's own streak of 1.
    expect((await readEngineState(pageC)).streak.count).toBe(0);

    await ctxA.close();
    await ctxC.close();
  });

  test("joining with no non-trivial local progress skips the confirmation entirely", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto("/");
    await pageA.click("#sync-button");
    await startSharing(pageA, "Shared progress");
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

  test("Start a new profile creates a fresh, separate Profile and the switcher can hop back to the original", async ({
    page,
  }) => {
    await page.goto("/");
    await page.click("#practice-link");
    await answerWithKeypad(page, await promptedAnswer(page));
    await page.click("#map-link");

    await page.click("#sync-button");
    await startSharing(page, "Shared progress");
    await expect(page.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });
    const originalProfileId = await activeProfileId(page);
    const originalState = await readEngineState(page);
    expect(originalState.streak.count).toBe(1);

    await page.click("#new-profile-button");
    await page.fill("#new-profile-name-input", "Sam");
    await page.click("#new-profile-confirm-button");

    // The new Profile is active immediately, a fresh
    // EngineState, not the original's progress carried over.
    await expect(page.locator("#sync-button")).toContainText("Sam", { timeout: SYNC_TIMEOUT_MS });
    const newProfileId = await activeProfileId(page);
    expect(newProfileId).not.toBe(originalProfileId);
    const freshState = await readEngineState(page);
    expect(freshState.activeRange.size).toBe(2);
    expect(freshState.streak.count).toBe(0);

    // The original Profile is still paired, not replaced, the whole
    // point being "switch back easily" rather than a one-way move.
    await expect(page.locator("#profile-switcher")).toContainText("Sam");
    await expect(page.locator("#profile-switcher")).toContainText("Shared progress");
    await page.click('#profile-switcher button:has-text("Shared progress")');

    await expect(page.locator("#sync-button")).toContainText("Shared progress", { timeout: SYNC_TIMEOUT_MS });
    const restoredState = await readEngineState(page);
    expect(restoredState.streak.count).toBe(1);
    expect(restoredState.fact).toEqual(originalState.fact);
  });

  test("switching to another Profile at the same Active range size restarts the 'N to go' high-water mark (#17)", async ({
    page,
  }) => {
    // 2 of the 2x2 grid's 4 Facts Mastered: ceil(0.9 * 4) = 4 needed, so
    // "2 to go". A fresh Profile is also size 2, which is exactly the
    // collision the session high-water mark (keyed by range size only)
    // used to get wrong.
    await seed(page, { activeRangeSize: 2, masteredCount: 2 });
    await page.goto("/#map");
    await expect(page.locator("#progress-readout")).toHaveText("2 to go");

    await page.click("#sync-button");
    await startSharing(page, "Ada");
    await expect(page.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });

    await page.click("#new-profile-button");
    await page.fill("#new-profile-name-input", "Sam");
    await page.click("#new-profile-confirm-button");
    await expect(page.locator("#sync-button")).toContainText("Sam", { timeout: SYNC_TIMEOUT_MS });

    // Sam has Mastered nothing, so all 4 are still to go, not Ada's 2.
    await expect(page.locator("#progress-readout")).toHaveText("4 to go");

    // And hopping back restores Ada's own count rather than Sam's.
    await page.click('#profile-switcher button:has-text("Ada")');
    await expect(page.locator("#sync-button")).toContainText("Ada", { timeout: SYNC_TIMEOUT_MS });
    await expect(page.locator("#progress-readout")).toHaveText("2 to go");
  });

  test("Stop syncing detaches this device but leaves its local progress untouched", async ({ page }) => {
    await page.goto("/");
    await page.click("#sync-button");
    await startSharing(page, "Shared progress");
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
    await startSharing(page, "Shared progress");
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

  test("Start sharing and Start a new profile both refuse to proceed without a name", async ({ page }) => {
    await page.goto("/");
    await page.click("#sync-button");

    await page.click("#start-sharing-button");
    await page.click("#start-sharing-confirm-button");
    await expect(page.locator("#sync-hint")).toContainText("name");
    await expect(page.locator("#sync-button")).toHaveText("🔗 Sync across devices");

    // The form is already open from the click above, so fill it directly
    // rather than the startSharing() helper, which would toggle it shut.
    await page.fill("#start-sharing-name-input", "Shared progress");
    await page.click("#start-sharing-confirm-button");
    await expect(page.locator("#sync-button")).toContainText("Synced", { timeout: SYNC_TIMEOUT_MS });

    await page.click("#new-profile-button");
    await page.click("#new-profile-confirm-button");
    await expect(page.locator("#sync-hint")).toContainText("name");
    await expect(page.locator("#sync-button")).toContainText("Shared progress");
  });
});
