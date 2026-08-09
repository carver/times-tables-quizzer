import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  // The unit tests cover the engine and the pure UI modules. These cover
  // the wiring those can't reach - routing, persistence across a real
  // reload, and the takeover queue driving actual DOM - so they are
  // deliberately few and each one earns its runtime.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Tests run against a real build, not the dev server - it's the same
  // artifact that actually gets deployed (`base: "./"` in vite.config.ts
  // means this is byte-for-byte what Pages serves), just built in "test"
  // mode rather than plain `npm run build`'s default "production" mode.
  // That distinction matters once a real Firebase project exists
  // (scripts/setup_firebase.py writes its config to `.env.production`,
  // loaded only by Vite's "production" mode): building in "test" mode
  // here means these specs always exercise cloudSync.ts's "demo-"
  // emulator default, never a real project a developer happens to have
  // configured locally - discovered the hard way when a real
  // `.env.production` on a dev machine made this suite start trying to
  // sign in against the real Firebase Auth API instead of the emulator.
  webServer: [
    {
      command: `npm run build -- --mode test && npm run preview -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // The Firebase emulator (docs/adr/0006): cloudSync.ts's default
    // "demo-times-tables-quizzer" project ID only ever talks to this -
    // never a real cloud project - so the sync/pairing specs below get a
    // genuine Firestore+Auth backend without needing any real account.
    // Polls the Auth emulator specifically, not Firestore - Auth
    // consistently finishes initializing noticeably later (~20s vs ~5s)
    // despite starting second in its own startup log, so polling
    // Firestore's port alone reports "ready" while Auth is still
    // warming up and signInAnonymously calls would fail outright.
    {
      // `npx firebase`, not a bare `firebase` - guarantees resolution via
      // the local firebase-tools devDependency regardless of whether the
      // spawning shell happens to have node_modules/.bin on PATH.
      command: "npx firebase emulators:start --only firestore,auth --project demo-times-tables-quizzer",
      url: "http://127.0.0.1:9200/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
