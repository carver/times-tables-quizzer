import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so one build works both at the root (local
  // `vite preview`, which the e2e suite drives) and under the project
  // subpath GitHub Pages serves this from (/times-tables-quizzer/).
  // Hard-coding `/times-tables-quizzer/` instead would mean the artifact
  // CI tests and the artifact CI deploys are not the same build.
  base: "./",
  test: {
    // Scope Vitest to the unit tests next to the source. Without this it
    // also collects `e2e/*.spec.ts`, which are Playwright specs and fail
    // outright under Vitest - they need a browser and a served app.
    include: ["src/**/*.test.ts"],
  },
});
