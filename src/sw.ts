// The service worker: precaches the built app (so it opens without a
// network round-trip, install prompt eligibility on Chrome requires one
// regardless) and, when the browser supports it, answers the daily
// Periodic Background Sync tag reminders.ts registers by checking
// reminderStore's mirrored lastActivityDay and showing a notification if
// today's practice hasn't happened yet.
//
// Runs under its own tsconfig (tsconfig.sw.json, WebWorker lib rather
// than DOM; see its comment) since `self` here is a ServiceWorkerGlobalScope,
// not a Window, and the two typings conflict if mixed in one program.
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { getLastActivityDay, shouldRemind } from "./reminderStore";

// Periodic Background Sync isn't in TypeScript's shipped DOM/WebWorker
// libs (it's Chromium-only and unstandardized), so this is a minimal
// ambient shape for just what this file touches.
interface PeriodicSyncEvent extends ExtendableEvent {
  readonly tag: string;
}

// vite-plugin-pwa's injectManifest strategy replaces this with the real
// list of built asset URLs at build time, the standard Workbox+Vite
// boilerplate for typing that replacement.
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

self.skipWaiting();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// The cloudSync (Firebase) and pairingQrCode chunks are excluded from
// the precache manifest above on purpose (vite.config.ts's globIgnores).
// Each is only ever downloaded by a device that dynamically
// imports it (main.ts, once sync is turned on / "Show QR code" is
// tapped). This route just means that once a device has fetched either,
// it's cached like everything else for offline reuse, never fetched
// eagerly by every installed device up front.
registerRoute(
  ({ url }) => /\/(cloudSync|pairingQrCode)-.*\.js$/.test(url.pathname),
  new CacheFirst({ cacheName: "lazy-chunk" }),
);

const REMINDER_TAG = "daily-reminder";
const REMINDER_ICON = "icons/icon-any-192.png";

async function maybeShowReminder(): Promise<void> {
  const lastActivityDay = await getLastActivityDay();
  if (!shouldRemind(lastActivityDay, Date.now())) return;

  await self.registration.showNotification("Time to practice!", {
    body: "A quick round of multiplication Facts is waiting for you.",
    icon: REMINDER_ICON,
    tag: REMINDER_TAG,
  });
}

self.addEventListener("periodicsync", (event) => {
  const syncEvent = event as PeriodicSyncEvent;
  if (syncEvent.tag !== REMINDER_TAG) return;
  syncEvent.waitUntil(maybeShowReminder());
});

// Tapping the reminder notification should focus an already-open tab
// rather than pile up a second one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((client): client is WindowClient => "focus" in client);
      if (existing) return existing.focus();
      return self.clients.openWindow("./");
    }),
  );
});
