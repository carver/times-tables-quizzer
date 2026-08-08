// Firebase/Firestore glue for cross-device Profile sync (docs/adr/0006).
// Deliberately NOT unit-tested the way syncDecisions.ts's pure functions
// are - there's no meaningful logic here to assert on without a real
// Firestore connection, same reasoning as audio.ts's AudioContext and
// reminders.ts's Periodic Background Sync. Covered instead by
// firestore-tests/rules.test.ts (the access rules) and manual/e2e
// verification against the local emulator.
//
// This module is only ever reached via a dynamic `import("./cloudSync")`
// from main.ts, gated on the Learner/parent actually turning sync on -
// that's what keeps Firebase's SDK out of the bundle for anyone who
// never uses this feature (see the ADR's "new runtime dependency"
// section).
import { type FirebaseApp, initializeApp } from "firebase/app";
import {
  type Auth,
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  type DocumentData,
  type Firestore,
  getDoc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";

// Firebase's own convention: a project ID starting with "demo-" only
// ever talks to a local emulator and is never a real cloud project (it
// doesn't need to exist in real GCP at all) - see firebase.json /
// .firebaserc. Using that as the single signal for "am I in emulator
// mode" means there's no separate flag that could drift out of sync
// with which project ID is actually configured.
const DEMO_PROJECT_ID = "demo-times-tables-quizzer";

function firebaseConfig() {
  const env = import.meta.env;
  const projectId = env.VITE_FIREBASE_PROJECT_ID || DEMO_PROJECT_ID;
  return {
    projectId,
    // The emulator doesn't validate these against anything real, so a
    // demo project can use placeholder values - only a real projectId
    // (from your own Firebase console) needs the rest filled in too.
    apiKey: env.VITE_FIREBASE_API_KEY || "demo-api-key",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    appId: env.VITE_FIREBASE_APP_ID || "demo-app-id",
    isEmulator: projectId.startsWith("demo-"),
  };
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

// Idempotent - safe to call every time cloudSync.ts's dynamic import
// resolves, since a device may already have an app/auth/db instance from
// earlier in the same session.
function ensureInitialized(): { auth: Auth; db: Firestore } {
  if (app && auth && db) return { auth, db };

  const config = firebaseConfig();
  app = initializeApp(config);

  // persistentLocalCache is what makes this offline-first "for free":
  // reads are served from an IndexedDB-backed cache instantly (online or
  // not), and writes made while offline queue automatically and replay
  // once the connection returns - see docs/adr/0006's Firebase-vs-
  // Supabase comparison, this is the deciding feature.
  db = initializeFirestore(app, { localCache: persistentLocalCache() });
  auth = getAuth(app);

  if (config.isEmulator) {
    connectFirestoreEmulator(db, "127.0.0.1", 8181);
    connectAuthEmulator(auth, "http://127.0.0.1:9200", { disableWarnings: true });
  }

  return { auth, db };
}

// Anonymous Auth here is a cheap "must be signed in at all" gate against
// drive-by bots (firestore.rules), not the real access boundary - see
// this module's top comment and docs/adr/0006. It is emphatically not
// per-Profile identity: every device signs in anonymously the same way
// regardless of which Profile it then reads/writes.
async function ensureSignedIn(): Promise<void> {
  const { auth: authInstance } = ensureInitialized();
  if (!authInstance.currentUser) {
    await signInAnonymously(authInstance);
  }
}

function profileRef(profileId: string) {
  const { db: dbInstance } = ensureInitialized();
  return doc(dbInstance, "profiles", profileId);
}

// One-time fetch - used by the "Join existing" flow to confirm a pasted/
// scanned Profile ID actually exists before committing to it.
export async function fetchProfile(profileId: string): Promise<DocumentData | null> {
  await ensureSignedIn();
  const snapshot = await getDoc(profileRef(profileId));
  return snapshot.exists() ? snapshot.data() : null;
}

// Firestore rejects `undefined` field values outright, and this app's
// EngineState can legitimately contain `null` (e.g. streak.lastStreakDay
// before the first-ever Attempt) - both handled fine by a plain
// `setDoc`, called out here only because it's the one Firestore quirk
// worth knowing before touching this function.
//
// Resolves to whether the write actually succeeded rather than
// rejecting, so a caller that fires this off without awaiting it
// (pushEngineStateToCloud, matching persist()'s own never-block-on-I/O
// pattern) can never produce an unhandled rejection - and a caller that
// DOES need to know the write landed (main.ts's "Start sharing", where
// the whole point is the link being immediately shareable - setDoc's
// promise only resolves once the backend actually acknowledges it, not
// merely once queued locally) gets a real answer instead of having to
// guess from a void return.
export async function writeProfile(profileId: string, data: Record<string, unknown>): Promise<boolean> {
  await ensureSignedIn();
  try {
    await setDoc(profileRef(profileId), { ...data, version: 1, updatedAt: serverTimestamp() });
    return true;
  } catch (error) {
    console.error("cloudSync: write to profile", profileId, "failed", error);
    return false;
  }
}

export type ProfileSubscriber = (data: DocumentData | undefined, meta: { hasPendingWrites: boolean }) => void;

// Live updates for as long as the subscription is held - the offline
// cache means this fires immediately with whatever's cached even before
// any network round-trip completes, then again whenever something
// changes (locally or from another device).
export function subscribeToProfile(profileId: string, onUpdate: ProfileSubscriber): Unsubscribe {
  let unsubscribeSnapshot: Unsubscribe | undefined;
  let cancelled = false;

  void ensureSignedIn().then(() => {
    if (cancelled) return;
    unsubscribeSnapshot = onSnapshot(profileRef(profileId), (snapshot) => {
      onUpdate(snapshot.data(), { hasPendingWrites: snapshot.metadata.hasPendingWrites });
    });
  });

  return () => {
    cancelled = true;
    unsubscribeSnapshot?.();
  };
}
