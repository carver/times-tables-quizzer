import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

// The host's IANA zone name when TZ is one (America/Los_Angeles). A
// POSIX string (TZ=PDT7, which the sandbox sets) leaves Intl's
// resolvedOptions().timeZone undefined, and an undefined timezoneId
// lets Chromium fall back to UTC, reopening the midnight split described
// at `use.timezoneId` below. Etc/GMT zones carry the current offset
// instead (their sign is inverted: UTC-7 is Etc/GMT+7), which keeps Node
// and the browser on the same calendar day for the length of a run.
function hostTimezoneId(): string {
  const named = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (named) return named;
  const hours = Math.round(new Date().getTimezoneOffset() / 60);
  return hours === 0 ? "Etc/UTC" : `Etc/GMT${hours > 0 ? "+" : "-"}${Math.abs(hours)}`;
}

export default defineConfig({
  testDir: "./e2e",
  // The unit tests cover the engine and the pure UI modules. These cover
  // the wiring those can't reach (routing, persistence across a real
  // reload, and the takeover queue driving actual DOM), so they are
  // deliberately few and each one earns its runtime.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-failure",
    // Headless Chromium defaults to UTC regardless of the host's own
    // timezone. That's invisible most of the day, but engine.ts's dayKey
    // (and e2e/helpers.ts's matching TODAY()/YESTERDAY()) both take the
    // *local* calendar day, so once the host's local evening crosses
    // midnight UTC, a spec that seeds "today" from the test process and
    // a page that computes "today" from the browser silently disagree by
    // a day, and anything gated on same-day-vs-new-day (the landing
    // rule, the Streak) breaks in a way that looks like flakiness but
    // reproduces every time after that hour. Pinning the browser to
    // whichever timezone is actually running the tests keeps both sides
    // computing the same calendar day, on any machine, at any hour.
    timezoneId: hostTimezoneId(),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Tests run against a real build, not the dev server. It's the same
  // artifact that gets deployed (`base: "./"` in vite.config.ts
  // means this is byte-for-byte what Pages serves), just built in "test"
  // mode rather than plain `npm run build`'s default "production" mode.
  // That distinction matters once a real Firebase project exists
  // (scripts/setup_firebase.py writes its config to `.env.production`,
  // loaded only by Vite's "production" mode): building in "test" mode
  // here means these specs always exercise cloudSync.ts's "demo-"
  // emulator default, never a real project a developer happens to have
  // configured locally. Discovered the hard way when a real
  // `.env.production` on a dev machine made this suite start trying to
  // sign in against the real Firebase Auth API instead of the emulator.
  //
  // The Firebase emulator (docs/adr/0006) is not started here. `npm run
  // test:e2e` wraps this whole run in `firebase emulators:exec`, the same
  // way `test:rules` does: exec waits for every emulator (Auth finishes
  // ~15s after Firestore) before running Playwright, and tears the
  // Firestore JVM down afterwards. As a webServer entry, Playwright only
  // killed the `firebase` node process; the Java child it spawned kept
  // port 8181 and broke the next `test:rules`.
  webServer: {
    command: `npm run build -- --mode test && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
