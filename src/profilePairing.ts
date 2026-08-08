// Device-local record of which Profile(s) (docs/adr/0006) this device has
// paired with, and which one is active right now. Deliberately separate
// from persistence.ts's save file: this is about *this device's*
// relationship to one or more Profiles - which sync target to talk to -
// not progress data itself, and it must never round-trip through
// Firestore. A device that has already paired with a Profile never needs
// to repeat the link/QR flow to switch back to it.
const STORAGE_KEY = "times-tables-quizzer:profiles";

export type PairedProfile = {
  profileId: string;
  label: string;
};

type PairingState = {
  profiles: PairedProfile[];
  activeProfileId: string | null;
};

const EMPTY_STATE: PairingState = { profiles: [], activeProfileId: null };

// 122 bits of randomness (crypto.randomUUID's v4 UUID) - the entire
// access model (docs/adr/0006) rests on this being computationally
// unguessable, the same trust model as an unlisted document link.
export function generateProfileId(): string {
  return crypto.randomUUID();
}

function isPairedProfile(value: unknown): value is PairedProfile {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PairedProfile).profileId === "string" &&
    typeof (value as PairedProfile).label === "string"
  );
}

function load(): PairingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_STATE;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_STATE;
    const { profiles, activeProfileId } = parsed as Partial<PairingState>;
    if (!Array.isArray(profiles) || !profiles.every(isPairedProfile)) return EMPTY_STATE;

    return { profiles, activeProfileId: typeof activeProfileId === "string" ? activeProfileId : null };
  } catch {
    return EMPTY_STATE;
  }
}

function save(state: PairingState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function pairedProfiles(): PairedProfile[] {
  return load().profiles;
}

// The Profile this device is currently syncing against, or null if this
// device has never paired with one (the common case - most devices only
// ever use the app fully locally).
export function activeProfile(): PairedProfile | null {
  const state = load();
  return state.profiles.find((profile) => profile.profileId === state.activeProfileId) ?? null;
}

// Records a newly-paired Profile (from "Start sharing" or "Join
// existing") and makes it active. Re-adding a Profile this device
// already knows just switches to it - pairing is a one-time action per
// (device, Profile) pair, never repeated.
export function addPairedProfile(profile: PairedProfile): void {
  const state = load();
  if (state.profiles.some((existing) => existing.profileId === profile.profileId)) {
    save({ ...state, activeProfileId: profile.profileId });
    return;
  }
  save({ profiles: [...state.profiles, profile], activeProfileId: profile.profileId });
}

// Switches which already-paired Profile is active, with no network
// action and no re-pairing - the whole point of remembering the list.
// A no-op if `profileId` isn't one this device has actually paired with.
export function setActiveProfile(profileId: string): void {
  const state = load();
  if (!state.profiles.some((profile) => profile.profileId === profileId)) return;
  save({ ...state, activeProfileId: profileId });
}

// Forgets a paired Profile on this device only - the Profile itself (and
// any other device paired with it) is untouched. If the removed Profile
// was active, falls back to another already-paired one if there is one.
export function removePairedProfile(profileId: string): void {
  const state = load();
  const profiles = state.profiles.filter((profile) => profile.profileId !== profileId);
  const activeProfileId = state.activeProfileId === profileId ? (profiles[0]?.profileId ?? null) : state.activeProfileId;
  save({ profiles, activeProfileId });
}
