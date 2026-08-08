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
  // Tests run against the production build, not the dev server: it's the
  // artifact that actually gets deployed, and `base: "./"` in
  // vite.config.ts means this is byte-for-byte what Pages serves.
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
