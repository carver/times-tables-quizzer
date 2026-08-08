import { defineConfig } from "vite";

// Separate from the root vite.config.ts on purpose: these tests need a
// live emulator (run via `npm run test:rules`, which wraps this in
// `firebase emulators:exec`) and must never be picked up by plain
// `vitest run` (the root config's `include` deliberately only looks
// under `src/`).
export default defineConfig({
  test: {
    include: ["firestore-tests/**/*.test.ts"],
  },
});
