import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const ACCENT = "#2563eb"; // matches --accent in style.css
const CREAM = "#fcfcfb"; // matches --stats-surface (light) in style.css

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
    // outright under Vitest, since they need a browser and a served app.
    include: ["src/**/*.test.ts"],
  },
  plugins: [
    VitePWA({
      // Custom service worker (src/sw.ts) rather than the plugin's fully
      // generated one: the daily-reminder Periodic Background Sync
      // handler needs code of its own alongside Workbox's precaching.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        // This app is a handful of small hashed bundles, not worth
        // Workbox's default size ceiling warning.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The app's dynamically-imported chunks, Firebase's SDK
        // (cloudSync, ~175KB gzipped, docs/adr/0006) and the QR code
        // generator (pairingQrCode), are deliberately excluded from
        // eager precaching: Workbox's default globPatterns would
        // otherwise have the service worker download both for every
        // installed device up front, on first install, silently
        // defeating the entire point of code-splitting them behind the
        // sync panel's own actions. sw.ts adds a runtime CacheFirst route
        // for both instead, so each is still cached for offline use,
        // but only after a device loads it once.
        globIgnores: ["**/cloudSync-*.js", "**/pairingQrCode-*.js"],
      },
      // main.ts registers the service worker itself (see the
      // navigator.serviceWorker.register call) so it can be sequenced
      // with the rest of startup rather than an auto-injected script.
      injectRegister: false,
      // Never run the SW under `vite dev`. The dev server's own
      // module graph already reloads instantly, and a stale precache
      // fighting Vite's dev server during iteration isn't worth it.
      devOptions: { enabled: false },
      manifest: {
        name: "Times Tables Quizzer",
        short_name: "Times Tables",
        description: "Practice multiplication facts and build real fluency.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: CREAM,
        theme_color: ACCENT,
        icons: [
          { src: "icons/icon-any-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-any-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          // Android 13+'s themed-icon layer (the "grayscale option"):
          // alpha-only glyph, recolored by the OS to match the wallpaper.
          { src: "icons/icon-monochrome-192.png", sizes: "192x192", type: "image/png", purpose: "monochrome" },
          { src: "icons/icon-monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
        ],
      },
    }),
  ],
});
