// Wires the "remind me daily" toggle to the Periodic Background Sync API,
// deliberately NOT unit-tested the way reminderStore.ts's pure
// shouldRemind is. There's no meaningful logic here to assert on without
// a real ServiceWorkerRegistration and Notification permission prompt,
// same reasoning as audio.ts's AudioContext.
//
// Periodic Background Sync is Chromium-only (Android/ChromeOS/desktop
// Chrome), requires the app to already be installed, and even there
// Chrome throttles/denies registration on its own site-engagement
// heuristic. There is no way to get a guaranteed-timed daily reminder
// out of a backend-free web app. isReminderSupported() is what lets the
// UI say so honestly instead of offering a toggle that silently does
// nothing on, say, iOS Safari (which has no periodicSync at all).
const DAILY_REMINDER_TAG = "daily-reminder";

type PeriodicSyncManager = {
  register: (tag: string, options: { minInterval: number }) => Promise<void>;
  unregister: (tag: string) => Promise<void>;
};

function periodicSyncOf(registration: ServiceWorkerRegistration): PeriodicSyncManager | undefined {
  return (registration as ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }).periodicSync;
}

export function isReminderSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "Notification" in window &&
    typeof ServiceWorkerRegistration !== "undefined" &&
    "periodicSync" in ServiceWorkerRegistration.prototype
  );
}

// Requests notification permission (a user-gesture-gated browser prompt,
// same family of restriction as audio.ts's AudioContext) and, if granted,
// registers the daily periodic sync. Resolves false on any refusal or
// failure (permission denied, the engagement heuristic rejecting
// registration, anything) so the caller can tell the Learner/parent it
// didn't take rather than assuming success.
export async function enableDailyReminder(): Promise<boolean> {
  if (!isReminderSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const periodicSync = periodicSyncOf(registration);
    if (!periodicSync) return false;
    await periodicSync.register(DAILY_REMINDER_TAG, { minInterval: 24 * 60 * 60 * 1000 });
    return true;
  } catch {
    return false;
  }
}

export async function disableDailyReminder(): Promise<void> {
  if (!isReminderSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const periodicSync = periodicSyncOf(registration);
  await periodicSync?.unregister(DAILY_REMINDER_TAG);
}
