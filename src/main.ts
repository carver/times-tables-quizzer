import "./style.css";
import { initAudio, playSound, setMuted, type SoundKind } from "./audio";
import {
  currentTakeover,
  dismissCurrentTakeover,
  enqueueTakeovers,
  inlineCelebrations,
  missedRangeExpansionTakeovers,
  type TakeoverQueue,
} from "./celebrationQueue";
import { createInitialState, MAX_ACTIVE_RANGE_SIZE, MAX_RESPONSE_MS, type Celebration, type CelebrationKind, type Dependencies, type EngineState, type Fact } from "./engine/engine";
import { clearState, loadState, parseEngineState, saveState, type AppState } from "./persistence";
import {
  activeProfile,
  addPairedProfile,
  generateProfileId,
  pairedProfiles,
  removePairedProfile,
  setActiveProfile,
  updatePairedProfileLabel,
} from "./profilePairing";
import { computeProgressMapStatus, type ProgressHighWaterMark, type ProgressReadout } from "./progressMap";
import { disableDailyReminder, enableDailyReminder, isReminderSupported } from "./reminders";
import { setLastActivityDay } from "./reminderStore";
import { decideLanding, hashForRoute, joinProfileIdFromHash, routeFromHash, type Route } from "./route";
import { createInitialScreen, pressBackspace, pressDigit, pressEnter, restartFactTimer, type ScreenState } from "./screen";
import { classifyAccuracyCell, classifyFluencyCell, factTooltipText, type CellState } from "./stats";
import { isRemoteUpdate, shouldApplyRemoteUpdate } from "./syncDecisions";

// A smaller starting grid gives a bigger, earlier sense of accomplishment
// on the way to the first expansion. Saves from before this changed carry
// their own migration in persistence.ts's migrate() - see the version-6
// comment there.
const INITIAL_ACTIVE_RANGE = { size: 2 };
const deps: Dependencies = { random: Math.random, now: Date.now };

// Shared "N day(s)" pluralization for the map, quiz, and stats headers'
// Streak/Practiced readouts, so the four call sites can't drift from
// each other on the singular case.
function dayCount(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

// How long the inline-celebration overlay stays up before fading on its
// own, and how long the plain wrong-Attempt flash stays up. Neither of
// these gates progress - the inline overlay is purely cosmetic (the next
// Fact is already live underneath it), and the wrong-Attempt overlay is a
// brief "not quite" flash, not the mechanism that shows the correct
// answer: the prompt shows that continuously in "correcting" mode,
// underneath, for as long as the retype takes (and withholds it
// entirely during the Retry that now comes first - docs/adr/0007). Takeover Celebrations
// (below) deliberately have no such timer - see dismissTakeover.
// Shortened from 1200ms once the Celebration overlay became opaque: it
// now genuinely hides the next Fact while it's up, so its duration is
// dead time in a drill whose whole target is a ~2.5s answer. Any keypress
// dismisses it early, making this a ceiling rather than a fixed pause.
const CELEBRATION_DISPLAY_MS = 600;
const WRONG_ANSWER_FLASH_MS = 900;

function celebrationText(celebration: Celebration, streakCount: number): string {
  switch (celebration.kind) {
    case "range-expansion":
      return "You unlocked a bigger range!";
    case "milestone":
      return `${streakCount}-day streak!`;
    case "personal-best":
      return "New personal best!";
    case "correctness-only":
      return "Correct!";
  }
}

// The issue's feedback-matrix table maps each Celebration kind to exactly
// one sound - kept as its own lookup (rather than folded into
// celebrationText) since audio and overlay/takeover text are triggered at
// different moments for a takeover (queued vs. shown - see
// syncTakeoverDisplay).
function soundForCelebration(kind: CelebrationKind): SoundKind {
  switch (kind) {
    case "correctness-only":
      return "correct";
    case "personal-best":
      return "personal-best";
    case "range-expansion":
      return "range-expansion";
    case "milestone":
      return "milestone";
  }
}

function getEl<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!;
}

getEl<HTMLDivElement>("app").innerHTML = `
  <section class="screen map-screen" id="screen-map">
    <header class="map-header">
      <button type="button" class="mute-toggle" id="mute-toggle" aria-pressed="false"></button>
      <p class="streak" id="map-streak"></p>
    </header>

    <div class="progress-grid-wrap" id="progress-grid-wrap">
      <div class="progress-grid" id="progress-grid" role="img" aria-label="Progress map"></div>
      <p class="progress-readout" id="progress-readout"></p>
    </div>

    <a class="practice-button" id="practice-link" href="#/quiz">Practice</a>
    <a class="stats-link" id="stats-link" href="#/stats">Stats</a>

    <div class="map-settings">
      <button type="button" class="settings-link" id="install-button" hidden>📲 Add to Home Screen</button>
      <button type="button" class="settings-link" id="reminder-toggle" aria-pressed="false"></button>
      <p class="settings-hint" id="reminder-hint" hidden></p>
      <p class="settings-hint" id="ios-install-hint" hidden>
        On iPhone/iPad: tap Share, then "Add to Home Screen".
      </p>

      <button type="button" class="settings-link" id="sync-button"></button>
      <div class="sync-panel" id="sync-panel" hidden>
        <div id="sync-unpaired-actions">
          <button type="button" class="sync-action" id="start-sharing-button">Start sharing from this device</button>
          <div id="start-sharing-form" hidden>
            <input type="text" class="sync-input" id="start-sharing-name-input" placeholder='Name this profile (e.g. "Sam")' />
            <button type="button" class="sync-action" id="start-sharing-confirm-button">Share</button>
          </div>
          <p class="settings-hint">or, if another device already started sharing:</p>
          <input type="text" class="sync-input" id="join-code-input" placeholder="Paste the sync link here" />
          <button type="button" class="sync-action" id="join-button">Join</button>
        </div>
        <div id="sync-paired-actions" hidden>
          <p class="sync-status" id="sync-status"></p>
          <div class="sync-action-row">
            <button type="button" class="sync-action" id="copy-sync-link-button">Copy link</button>
            <button type="button" class="sync-action" id="show-qr-button">Show QR code</button>
          </div>
          <div class="qr-code-wrap" id="qr-code-wrap" hidden></div>
          <div id="profile-switcher-wrap">
            <p class="settings-hint">Profiles:</p>
            <div id="profile-switcher"></div>
          </div>
          <div id="new-profile-form" hidden>
            <input type="text" class="sync-input" id="new-profile-name-input" placeholder='Name this profile (e.g. "Sam")' />
            <button type="button" class="sync-action" id="new-profile-confirm-button">Create</button>
          </div>
          <button type="button" class="sync-action sync-action--quiet" id="stop-syncing-button">
            Stop syncing on this device
          </button>
        </div>
        <p class="settings-hint" id="sync-hint" hidden></p>
      </div>
    </div>
  </section>

  <!-- Shown only mid-"Join existing", and only when this device already
       has its own non-trivial practice history - joining a Profile
       replaces this device's history with the shared one (there is one
       Learner, not two histories to merge - docs/adr/0006), so this is
       the one irreversible-feeling moment in the whole sync feature that
       gets an explicit confirmation rather than happening silently. -->
  <div class="modal-confirm" id="sync-confirm" hidden role="dialog" aria-modal="true">
    <div class="modal-confirm-card">
      <p id="sync-confirm-body"></p>
      <button type="button" class="modal-confirm-primary" id="sync-confirm-yes">Replace with shared history</button>
      <button type="button" class="modal-confirm-secondary" id="sync-confirm-no">Cancel</button>
    </div>
  </div>

  <!-- Shown when a Fact has sat unanswered past MAX_RESPONSE_MS
       (engine.ts) - long enough that the Learner may have walked away
       mid-question rather than just being slow. Confirming restarts the
       clock (screen.ts's restartFactTimer) so idle time at home doesn't
       get billed to the answer once it finally comes. -->
  <div class="modal-confirm" id="idle-confirm" hidden role="dialog" aria-modal="true">
    <div class="modal-confirm-card">
      <p>Still there?</p>
      <button type="button" class="modal-confirm-primary" id="idle-confirm-yes">Yes, I'm back</button>
    </div>
  </div>

  <main class="screen quiz" id="screen-quiz">
    <header class="quiz-header">
      <a class="map-link" id="map-link" href="#/map" aria-label="Home">⌂</a>
      <p class="streak" id="streak"></p>
    </header>

    <section class="center" id="center">
      <p class="prompt" id="prompt"></p>
      <p class="typed-answer" id="typed-answer" aria-label="Your answer"></p>
      <p class="overlay" id="overlay" data-visible="false" aria-live="polite"></p>
    </section>

    <section class="keypad" id="keypad" aria-label="Answer keypad">
      <button type="button" class="key" data-digit="1">1</button>
      <button type="button" class="key" data-digit="2">2</button>
      <button type="button" class="key" data-digit="3">3</button>
      <button type="button" class="key" data-digit="4">4</button>
      <button type="button" class="key" data-digit="5">5</button>
      <button type="button" class="key" data-digit="6">6</button>
      <button type="button" class="key" data-digit="7">7</button>
      <button type="button" class="key" data-digit="8">8</button>
      <button type="button" class="key" data-digit="9">9</button>
      <button type="button" class="key key-backspace" id="key-backspace" aria-label="Backspace">⌫</button>
      <button type="button" class="key" data-digit="0">0</button>
      <button type="button" class="key key-enter" id="key-enter" aria-label="Enter">⏎</button>
    </section>
  </main>

  <section class="screen stats-screen" id="screen-stats">
    <header class="stats-header">
      <a class="map-link" id="stats-map-link" href="#/map" aria-label="Home">⌂</a>
      <p class="stats-days" id="stats-days"></p>
      <p class="streak" id="stats-streak"></p>
    </header>

    <div class="stats-body">
      <section class="stats-section" aria-labelledby="accuracy-heading">
        <h2 class="stats-heading" id="accuracy-heading">Accuracy</h2>
        <ul class="stats-legend">
          <li><button type="button" class="legend-item" data-tip="Correct less than half of recent Attempts."><span class="legend-swatch" data-acc="0"></span>&lt;50%</button></li>
          <li><button type="button" class="legend-item" data-tip="Correct 50–75% of recent Attempts."><span class="legend-swatch" data-acc="1"></span>50–75%</button></li>
          <li><button type="button" class="legend-item" data-tip="Correct 75–90% of recent Attempts."><span class="legend-swatch" data-acc="2"></span>75–90%</button></li>
          <li><button type="button" class="legend-item" data-tip="Correct 90–99% of recent Attempts."><span class="legend-swatch" data-acc="3"></span>90–99%</button></li>
          <li><button type="button" class="legend-item" data-tip="Never missed once, ever."><span class="legend-swatch" data-acc="4"></span>100%</button></li>
        </ul>
        <div class="stats-grid-wrap">
          <div class="stats-grid" id="accuracy-grid" role="group" aria-label="Accuracy grid, 12 by 12 Facts"></div>
        </div>
      </section>

      <section class="stats-section" aria-labelledby="fluency-heading">
        <h2 class="stats-heading" id="fluency-heading">Fluency</h2>
        <ul class="stats-legend">
          <li><button type="button" class="legend-item" data-tip="Takes over 1.5× this Fact's target time — well behind pace."><span class="legend-swatch" data-fluency="0"></span>&gt;1.5×</button></li>
          <li><button type="button" class="legend-item" data-tip="Takes 1.0–1.5× the target time — behind pace, not yet Mastered."><span class="legend-swatch" data-fluency="1"></span>1.0–1.5×</button></li>
          <li><button type="button" class="legend-item" data-tip="At or faster than the target time — Mastered."><span class="legend-swatch" data-fluency="2"></span>0.8–1.0×</button></li>
          <li><button type="button" class="legend-item" data-tip="Comfortably faster than the target time."><span class="legend-swatch" data-fluency="3"></span>0.6–0.8×</button></li>
          <li><button type="button" class="legend-item" data-tip="Well under the target time — very fluent."><span class="legend-swatch" data-fluency="4"></span>&lt;0.6×</button></li>
        </ul>
        <div class="stats-grid-wrap">
          <div class="stats-grid" id="fluency-grid" role="group" aria-label="Fluency grid, 12 by 12 Facts"></div>
        </div>
      </section>

      <ul class="stats-legend stats-legend--shared">
        <li><button type="button" class="legend-item" data-tip="This Fact hasn't been asked yet."><span class="legend-swatch legend-swatch--empty"></span>Not tried yet</button></li>
        <li><button type="button" class="legend-item" data-tip="Attempted at least once, but never yet answered correctly."><span class="legend-swatch legend-swatch--never-correct"></span>Wrong so far</button></li>
        <li><button type="button" class="legend-item" data-tip="Only 1–2 Attempts so far — the color may not be reliable yet."><span class="legend-swatch legend-swatch--provisional"></span>Still new</button></li>
      </ul>
    </div>

    <div class="stats-tooltip" id="stats-tooltip" role="status" aria-live="polite" data-visible="false"></div>
  </section>

  <!-- The reset screen. Deliberately unlinked from every other screen:
       reachable only by typing #/reset, and written down only in the
       README. It's for handing the app over with a clean history, not a
       feature the Learner should stumble into. -->
  <section class="screen reset-screen" id="screen-reset">
    <h2 class="reset-heading">Erase all progress?</h2>
    <p class="reset-body">
      This deletes every Fact's history, the Active range, the Streak, and the
      days-practiced count. It cannot be undone.
    </p>
    <button type="button" class="reset-confirm" id="reset-confirm">Erase everything</button>
    <a class="reset-cancel" id="reset-cancel" href="#/map">Leave it alone</a>
  </section>

  <!-- Lives outside the three routed <section>s, same reasoning as
       .takeover below - which screens it's allowed on is a JS-owned rule
       (updateBannerVisibility), not something a fixed position in the
       markup could express, since it's shown on two of the three routes
       (map, stats) and deliberately never the quiz: nothing should
       compete for a Learner's attention mid-question. -->
  <div class="update-banner" id="update-banner" hidden>
    <button type="button" id="update-banner-button">A new version is ready — tap to update</button>
  </div>

  <!-- ticket #13: the takeover for range-expansion and Milestone Celebrations
       (CONTEXT.md's Celebration entry - "fills the screen and waits for the
       Learner to dismiss it"). Lives outside the three routed <section>s -
       data-visible, not the route, controls whether it's shown, since it
       can cover whichever screen the Learner was on when the Attempt
       landed (always the quiz screen in practice). -->
  <div class="takeover" id="takeover" data-visible="false" data-kind="" role="dialog" aria-modal="true" aria-live="assertive">
    <div class="takeover-content">
      <div class="takeover-grid-wrap" id="takeover-grid-wrap">
        <div class="progress-grid takeover-grid" id="takeover-grid" role="img" aria-label="Active range grid"></div>
      </div>
      <p class="takeover-title" id="takeover-title"></p>
      <p class="takeover-hint">Tap anywhere to continue</p>
    </div>
  </div>
`;

const mapScreenEl = getEl<HTMLElement>("screen-map");
const mapStreakEl = getEl<HTMLParagraphElement>("map-streak");
const progressGridEl = getEl<HTMLDivElement>("progress-grid");
const progressReadoutEl = getEl<HTMLParagraphElement>("progress-readout");
const muteToggleEl = getEl<HTMLButtonElement>("mute-toggle");
const practiceLinkEl = getEl<HTMLAnchorElement>("practice-link");
const installButtonEl = getEl<HTMLButtonElement>("install-button");
const reminderToggleEl = getEl<HTMLButtonElement>("reminder-toggle");
const reminderHintEl = getEl<HTMLParagraphElement>("reminder-hint");
const iosInstallHintEl = getEl<HTMLParagraphElement>("ios-install-hint");
const syncButtonEl = getEl<HTMLButtonElement>("sync-button");
const syncPanelEl = getEl<HTMLDivElement>("sync-panel");
const syncUnpairedActionsEl = getEl<HTMLDivElement>("sync-unpaired-actions");
const syncPairedActionsEl = getEl<HTMLDivElement>("sync-paired-actions");
const startSharingButtonEl = getEl<HTMLButtonElement>("start-sharing-button");
const startSharingFormEl = getEl<HTMLDivElement>("start-sharing-form");
const startSharingNameInputEl = getEl<HTMLInputElement>("start-sharing-name-input");
const startSharingConfirmButtonEl = getEl<HTMLButtonElement>("start-sharing-confirm-button");
const joinCodeInputEl = getEl<HTMLInputElement>("join-code-input");
const joinButtonEl = getEl<HTMLButtonElement>("join-button");
const syncStatusEl = getEl<HTMLParagraphElement>("sync-status");
const copySyncLinkButtonEl = getEl<HTMLButtonElement>("copy-sync-link-button");
const showQrButtonEl = getEl<HTMLButtonElement>("show-qr-button");
const qrCodeWrapEl = getEl<HTMLDivElement>("qr-code-wrap");
const newProfileFormEl = getEl<HTMLDivElement>("new-profile-form");
const newProfileNameInputEl = getEl<HTMLInputElement>("new-profile-name-input");
const newProfileConfirmButtonEl = getEl<HTMLButtonElement>("new-profile-confirm-button");
const profileSwitcherEl = getEl<HTMLDivElement>("profile-switcher");
const stopSyncingButtonEl = getEl<HTMLButtonElement>("stop-syncing-button");
const syncHintEl = getEl<HTMLParagraphElement>("sync-hint");
const syncConfirmEl = getEl<HTMLDivElement>("sync-confirm");
const syncConfirmBodyEl = getEl<HTMLParagraphElement>("sync-confirm-body");
const syncConfirmYesEl = getEl<HTMLButtonElement>("sync-confirm-yes");
const syncConfirmNoEl = getEl<HTMLButtonElement>("sync-confirm-no");

const idleConfirmEl = getEl<HTMLDivElement>("idle-confirm");
const idleConfirmYesEl = getEl<HTMLButtonElement>("idle-confirm-yes");

const quizScreenEl = getEl<HTMLElement>("screen-quiz");
const streakEl = getEl<HTMLParagraphElement>("streak");
const promptEl = getEl<HTMLParagraphElement>("prompt");
const typedAnswerEl = getEl<HTMLParagraphElement>("typed-answer");
const overlayEl = getEl<HTMLParagraphElement>("overlay");
const keypadEl = getEl<HTMLElement>("keypad");

const takeoverEl = getEl<HTMLDivElement>("takeover");
const takeoverGridEl = getEl<HTMLDivElement>("takeover-grid");
const takeoverTitleEl = getEl<HTMLParagraphElement>("takeover-title");

const updateBannerEl = getEl<HTMLDivElement>("update-banner");
const updateBannerButtonEl = getEl<HTMLButtonElement>("update-banner-button");

const statsScreenEl = getEl<HTMLElement>("screen-stats");
const resetScreenEl = getEl<HTMLElement>("screen-reset");
const resetConfirmEl = getEl<HTMLButtonElement>("reset-confirm");
const statsDaysEl = getEl<HTMLParagraphElement>("stats-days");
const statsStreakEl = getEl<HTMLParagraphElement>("stats-streak");
const accuracyGridEl = getEl<HTMLDivElement>("accuracy-grid");
const fluencyGridEl = getEl<HTMLDivElement>("fluency-grid");
const statsTooltipEl = getEl<HTMLDivElement>("stats-tooltip");

const loaded: AppState = loadState() ?? {
  engine: createInitialState(INITIAL_ACTIVE_RANGE, deps),
  lastMapShownDay: null,
  muted: false,
  remindersEnabled: false,
};
let quizState: ScreenState = createInitialScreen(loaded.engine, deps);
let lastMapShownDay = loaded.lastMapShownDay;
let muted = loaded.muted;
let remindersEnabled = loaded.remindersEnabled;
setMuted(muted);
let overlayTimeout: ReturnType<typeof setTimeout> | undefined;

let idleCheckTimeout: ReturnType<typeof setTimeout> | undefined;
// The factShownAt this timeout was armed for, so re-renders that don't
// change it (e.g. typing a digit) don't restart the 30s countdown.
let idleCheckArmedFor: number | undefined;

// The queue of takeover-tagged Celebrations waiting to be shown
// (celebrationQueue.ts) plus which one, if any, is currently rendered
// into the takeover DOM - held separately so syncTakeoverDisplay can tell
// "still the same takeover, don't re-show/re-play it" apart from "a new
// one just became current" purely by reference equality, without a
// second identity scheme.
//
// Seeded at boot (rather than always starting empty) with any
// range-expansion takeover this save reached but never actually got
// dismissed for - see engine.ts's acknowledgedRangeSize and
// celebrationQueue.ts's missedRangeExpansionTakeovers. Ahead of
// syncTakeoverDisplay's first real call (applyRoute, below), so a
// catch-up takeover renders on the very first paint rather than needing
// a throwaway render to surface it.
let takeoverQueue: TakeoverQueue = missedRangeExpansionTakeovers(
  loaded.engine.acknowledgedRangeSize,
  loaded.engine.activeRange.size,
);
let displayedTakeover: Celebration | undefined;

// The Progress map's progress-to-expansion readout is monotonic within a
// session (ticket #11) - this is that session's high-water mark, held in
// memory only (not persisted) so it naturally resets on the next page
// load rather than surviving across days.
let progressHighWaterMark: ProgressHighWaterMark | null = null;

// The one way to hand the app a *different Learner's* EngineState
// (switching Profiles, starting a new one, joining one). The high-water
// mark above is per-Learner - it's keyed by Active range size only, so
// left alone it would clamp the next Learner's "N to go" against the
// previous Learner's best masteredCount whenever both sit at the same
// range size (ticket #17). Same-Profile updates arriving from another
// device (applyPendingRemoteUpdate) deliberately do NOT go through here:
// that's still the same Learner, so their mark should carry on.
function adoptLearnerState(engine: EngineState) {
  quizState = createInitialScreen(engine, deps);
  progressHighWaterMark = null;
}

function persist() {
  saveState({ engine: quizState.engine, lastMapShownDay, muted, remindersEnabled });

  // Mirrors just this one DayKey into IndexedDB (reminderStore.ts) so the
  // service worker's periodicsync handler can tell whether today's
  // practice has already happened without an open page to ask -
  // fire-and-forget, same as the rest of persistence here never blocking
  // on I/O completing.
  const { lastActivityDay } = quizState.engine.streak;
  if (lastActivityDay !== null) void setLastActivityDay(lastActivityDay);
}

// --- Cross-device sync (docs/adr/0006) ---
//
// Entirely additive on top of everything above: localStorage (persist(),
// loadState() at boot) stays the always-present, synchronous, zero-
// network local save exactly as it's always been - this section only
// bolts a Firestore mirror of the `engine` field on top, active only
// once this device has paired with a Profile (profilePairing.ts).
// `lastMapShownDay`/`muted`/`remindersEnabled` never appear here; they
// stay device-local (see the ADR for why).
//
// cloudSync.ts is loaded via a dynamic import - never a static one - so
// Firebase's SDK is only ever downloaded by a device that actually turns
// sync on (see the ADR's "new runtime dependency" section).
let cloudSyncModule: typeof import("./cloudSync") | undefined;

function loadCloudSync(): Promise<typeof import("./cloudSync")> {
  return (cloudSyncModule ? Promise.resolve(cloudSyncModule) : import("./cloudSync")).then((mod) => (cloudSyncModule = mod));
}

// A remote engine state waiting to be reconciled in - set whenever a
// genuine (non-echo) snapshot arrives, cleared once actually applied.
let pendingRemoteEngineState: EngineState | undefined;

// Swaps in a pending remote update if one exists and it's currently safe
// to do so (syncDecisions.shouldApplyRemoteUpdate) - never while the
// Learner is live on the quiz route. Returns whether it actually applied
// anything, so callers know whether a re-render is warranted. Mirrors
// the merged result back into localStorage (persist()) so this device's
// own next boot already reflects it - never pushes back to the cloud,
// since Firestore is already the source this data came from.
function applyPendingRemoteUpdate(route: Route): boolean {
  if (!pendingRemoteEngineState || !shouldApplyRemoteUpdate(route)) return false;

  quizState = createInitialScreen(pendingRemoteEngineState, deps);
  pendingRemoteEngineState = undefined;
  persist();
  return true;
}

// The live-subscription callback (cloudSync.subscribeToProfile). Runs
// whenever this Profile's document changes, whether from this device's
// own write settling or a genuinely different one from elsewhere.
function handleRemoteSnapshot(data: Record<string, unknown> | undefined, meta: { hasPendingWrites: boolean }) {
  if (!data || !isRemoteUpdate(meta)) return;

  const engine = parseEngineState(data);
  if (!engine) return; // a malformed/partial document - nothing safe to reconcile against

  pendingRemoteEngineState = engine;
  const route = routeFromHash(window.location.hash);
  // Applied outside the normal applyRoute flow (nothing navigated us
  // here), so re-render explicitly - applyRoute's own leading check
  // will find pendingRemoteEngineState already cleared and just render.
  if (applyPendingRemoteUpdate(route)) applyRoute(route);
}

// Pushes this device's current engine state to the cloud - called after
// every genuine local Attempt (handleEnter), never after a device-local
// settings change (mute/reminders). Silently a no-op on a device that
// hasn't paired with a Profile - the overwhelming majority of installs.
function pushEngineStateToCloud() {
  const profile = activeProfile();
  if (!profile) return;
  // writeProfile is a whole-document replace (ADR 0006), so the label has
  // to ride along on every single write, not just the first - otherwise
  // the very next Attempt after naming a Profile would silently wipe the
  // name back out.
  void loadCloudSync().then((mod) => mod.writeProfile(profile.profileId, { ...quizState.engine, label: profile.label }));
}

// Starts (or restarts, if switching Profiles) the live subscription for
// `profileId`. Exported for the pairing UI (task 4) to call right after
// "Start sharing"/"Join existing" completes, in addition to running here
// at boot for a device that's already paired from a previous session.
let unsubscribeFromProfile: (() => void) | undefined;

function startSyncing(profileId: string) {
  unsubscribeFromProfile?.();
  void loadCloudSync().then((mod) => {
    unsubscribeFromProfile = mod.subscribeToProfile(profileId, handleRemoteSnapshot);
  });
}

// A shareable link rather than a bare Profile ID, so pairing is "paste
// what your other phone sent you" - route.ts's joinProfileIdFromHash
// (and this function's own input-parsing counterpart below) is the only
// place that knows this shape.
function pairingLinkForProfile(profileId: string): string {
  const url = new URL(window.location.href);
  url.hash = `#/join/${encodeURIComponent(profileId)}`;
  return url.toString();
}

// Accepts either a full pasted link or a bare Profile ID typed/pasted on
// its own, so "Join" isn't picky about exactly what got copied.
function profileIdFromPastedText(raw: string): string | null {
  const trimmed = raw.trim();
  const hashIndex = trimmed.indexOf("#/join/");
  if (hashIndex !== -1) return joinProfileIdFromHash(trimmed.slice(hashIndex));
  return /^[0-9a-f-]{10,}$/i.test(trimmed) ? trimmed : null;
}

// "Non-trivial" mirrors docs/adr/0006's replace-not-merge rule: a device
// that has never actually been practiced on (a brand-new install, or one
// that's only ever sat on the map screen) has nothing worth confirming
// before replacing - the confirmation exists to protect real history,
// not to add a click to every join.
function hasNonTrivialLocalProgress(engine: EngineState): boolean {
  return Object.keys(engine.fluency).length > 0 || engine.streak.count > 0;
}

function showSyncHint(text: string) {
  syncHintEl.textContent = text;
  syncHintEl.hidden = false;
}

// Reflects the current pairing state into the sync panel - called
// whenever it changes (start sharing, join, switch, stop) and whenever
// the panel is opened, the same "render wherever the state can change"
// pattern renderMuteToggle/renderReminderToggle already use.
function renderSyncPanel() {
  const profile = activeProfile();

  // Never leave a stale QR (or "Hide QR code" label) on screen for a
  // Profile that's no longer active - e.g. after switching or stopping
  // sync. Cheap to always reset here rather than track "which Profile is
  // this QR actually for."
  qrCodeWrapEl.hidden = true;
  qrCodeWrapEl.innerHTML = "";
  showQrButtonEl.textContent = "Show QR code";
  newProfileFormEl.hidden = true;
  newProfileNameInputEl.value = "";
  startSharingFormEl.hidden = true;
  startSharingNameInputEl.value = "";

  if (profile) {
    syncButtonEl.textContent = `🔗 Synced: ${profile.label}`;
    syncUnpairedActionsEl.hidden = true;
    syncPairedActionsEl.hidden = false;
    syncStatusEl.textContent = `This device is synced to "${profile.label}".`;
  } else {
    syncButtonEl.textContent = "🔗 Sync across devices";
    syncUnpairedActionsEl.hidden = false;
    syncPairedActionsEl.hidden = true;
  }

  renderProfileSwitcher();
}

// One pill row doing double duty as the Profile switcher and the
// "start a new Profile" entry point, rather than two separately-shown
// blocks (a standalone "Start a new profile" button plus a switcher
// that only ever appeared once a second Profile already existed) - see
// docs/adr/0006's "Profile, not Household" section for why a device can
// end up paired with more than one. Always shown whenever this device
// is paired with at least one, even just its own.
function renderProfileSwitcher() {
  profileSwitcherEl.innerHTML = "";
  const active = activeProfile();
  for (const profile of pairedProfiles()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-link";
    const isActive = profile.profileId === active?.profileId;
    button.textContent = isActive ? `${profile.label} ✓` : profile.label;
    button.disabled = isActive;
    button.addEventListener("click", () => void switchToProfile(profile.profileId));
    profileSwitcherEl.appendChild(button);
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.id = "new-profile-button";
  addButton.className = "settings-link";
  addButton.textContent = "+ New";
  addButton.addEventListener("click", () => {
    newProfileFormEl.hidden = !newProfileFormEl.hidden;
    if (!newProfileFormEl.hidden) newProfileNameInputEl.focus();
  });
  profileSwitcherEl.appendChild(addButton);
}

// A document from before Profiles carried a name (or a corrupted write)
// falls back to the pre-existing generic name rather than showing
// something blank in the switcher/sync status.
function labelFromDocument(data: Record<string, unknown>): string {
  return typeof data.label === "string" && data.label.trim() ? data.label : "Shared progress";
}

// Switching, unlike joining, never needs the replace-confirmation - a
// device already paired with both Profiles has already agreed (at join
// time) to let sync own its state, so there's no "first time" local
// history at risk of a surprise replace.
async function switchToProfile(profileId: string): Promise<void> {
  setActiveProfile(profileId);
  const mod = await loadCloudSync();
  const data = await mod.fetchProfile(profileId);
  if (data) updatePairedProfileLabel(profileId, labelFromDocument(data));
  const engine = data ? parseEngineState(data) : null;
  adoptLearnerState(engine ?? createInitialState(INITIAL_ACTIVE_RANGE, deps));
  persist();
  startSyncing(profileId);
  renderSyncPanel();
  applyRoute(routeFromHash(window.location.hash));
}

// Unlike "Start sharing" (which publishes *this device's* current
// progress so another device can join it), this is for a second Learner
// starting from nothing: a genuinely fresh EngineState goes up as a new
// Profile, this device pairs with it and switches over, and the
// previous Profile stays paired - one tap away in the switcher above -
// rather than being replaced or left behind.
async function startNewProfile(rawLabel: string): Promise<void> {
  const label = rawLabel.trim();
  if (!label) {
    showSyncHint("Give the new profile a name first.");
    return;
  }

  const profileId = generateProfileId();
  const mod = await loadCloudSync();
  const freshState = createInitialState(INITIAL_ACTIVE_RANGE, deps);
  const success = await mod.writeProfile(profileId, { ...freshState, label });
  if (!success) {
    showSyncHint("Couldn't reach the sync service - check your connection and try again.");
    return;
  }

  addPairedProfile({ profileId, label });
  adoptLearnerState(freshState);
  persist();
  startSyncing(profileId);
  renderSyncPanel();
  applyRoute(routeFromHash(window.location.hash));
  showSyncHint(`Started a new profile: "${label}". Switch back anytime from the switcher below.`);
}

// Turns this device's own current progress into a shareable Profile for
// the first time - unlike "Start a new profile", the EngineState that
// goes up is whatever's already here, not a fresh one.
async function startSharing(rawLabel: string): Promise<void> {
  const label = rawLabel.trim();
  if (!label) {
    showSyncHint("Give this profile a name first.");
    return;
  }

  const profileId = generateProfileId();
  const mod = await loadCloudSync();
  // Awaited deliberately, unlike pushEngineStateToCloud's ongoing
  // fire-and-forget pushes: the whole point of this one-time upload is
  // that the link is immediately shareable, so this waits for the
  // backend to actually confirm it rather than assuming success.
  const success = await mod.writeProfile(profileId, { ...quizState.engine, label });
  if (!success) {
    showSyncHint("Couldn't reach the sync service - check your connection and try again.");
    return;
  }
  addPairedProfile({ profileId, label });
  startSyncing(profileId);
  renderSyncPanel();
  showSyncHint('Ready — tap "Copy link" and send it to the other phone.');
}

function completeJoin(profileId: string, remoteEngine: EngineState, label: string) {
  addPairedProfile({ profileId, label });
  adoptLearnerState(remoteEngine);
  persist();
  startSyncing(profileId);
  joinCodeInputEl.value = "";
  renderSyncPanel();
  applyRoute(routeFromHash(window.location.hash));
}

// Set only while docs/adr/0006's replace-confirmation is up, so the
// Confirm button has something to act on and Cancel has nothing to
// clean up beyond hiding the dialog.
let pendingJoinProfileId: string | null = null;
let pendingJoinRemoteEngine: EngineState | undefined;
let pendingJoinLabel: string | undefined;

function showJoinConfirm(local: EngineState, remote: EngineState) {
  syncConfirmBodyEl.textContent =
    `This phone already has its own practice history (Streak: ${dayCount(local.streak.count)}, ` +
    `${local.activeRange.size}×${local.activeRange.size} range). Joining will replace it with the shared history ` +
    `(Streak: ${dayCount(remote.streak.count)}, ${remote.activeRange.size}×${remote.activeRange.size} range). Continue?`;
  syncConfirmEl.hidden = false;
}

// The entry point for "Join existing" - fetches whatever's actually
// there first rather than assuming, since a mistyped/stale link should
// fail honestly rather than silently pairing to nothing.
async function beginJoin(profileId: string): Promise<void> {
  const mod = await loadCloudSync();
  const data = await mod.fetchProfile(profileId);
  if (!data) {
    showSyncHint("Couldn't find that sync link's shared progress - double check it was pasted in full.");
    return;
  }

  const remoteEngine = parseEngineState(data);
  if (!remoteEngine) {
    showSyncHint("That shared progress looks corrupted - try copying the sync link again from the other device.");
    return;
  }
  const label = labelFromDocument(data);

  if (hasNonTrivialLocalProgress(quizState.engine)) {
    pendingJoinProfileId = profileId;
    pendingJoinRemoteEngine = remoteEngine;
    pendingJoinLabel = label;
    showJoinConfirm(quizState.engine, remoteEngine);
    return;
  }

  completeJoin(profileId, remoteEngine, label);
}

// Builds one 12x12 grid of cells - shared by the Progress map's own grid
// and, unchanged, by the range-expansion takeover below (ticket #13:
// "reuse the Progress map's 12x12 grid rendering rather than inventing a
// second grid visual" / ADR 0004's one-shared-grid-shape precedent).
// `newSize`, when given, is the range size an expansion just reached -
// the newly filled row (a === newSize) and column (b === newSize) get
// `grid-cell--new` so CSS can animate them filling in, staggered via
// `--reveal-delay` in the order the takeover fills them: across the new
// row first, then down the new column.
function buildProgressGrid(container: HTMLDivElement, activeRangeSize: number, newSize?: number) {
  container.innerHTML = "";
  let newCellIndex = 0;
  for (let a = 1; a <= MAX_ACTIVE_RANGE_SIZE; a++) {
    for (let b = 1; b <= MAX_ACTIVE_RANGE_SIZE; b++) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      // The Active range's conquered n x n corner, drawn literally (ADR
      // 0004's grid shape, reused rather than a second metaphor). Size
      // 1x1 renders as already-conquered simply because the Active range
      // never starts smaller than 2x2.
      if (a <= activeRangeSize && b <= activeRangeSize) {
        cell.classList.add("grid-cell--filled");
      }
      if (newSize !== undefined && a <= newSize && b <= newSize && (a === newSize || b === newSize)) {
        cell.classList.add("grid-cell--new");
        cell.style.setProperty("--reveal-delay", `${newCellIndex * 25}ms`);
        newCellIndex++;
      }
      container.appendChild(cell);
    }
  }
}

function renderProgressGrid(activeRangeSize: number) {
  buildProgressGrid(progressGridEl, activeRangeSize);
}

function progressReadoutText(readout: ProgressReadout): string {
  switch (readout.kind) {
    case "remaining":
      return `${readout.count} to go`;
    case "maintenance":
      return `${readout.masteredCount} of ${readout.totalCount} sharp`;
  }
}

// The mute toggle (ticket #13: "the toggle lives on the Progress map
// only, never on the quiz screen - a mute button within reach of a
// fast-tapping thumb gets hit by accident"). Rendered wherever `muted`
// can change - on the initial map render and right after the button's
// own click - rather than only once at startup.
function renderMuteToggle() {
  muteToggleEl.textContent = muted ? "🔇 Sound off" : "🔊 Sound on";
  muteToggleEl.setAttribute("aria-pressed", String(muted));
}

// Mirrors renderMuteToggle's pattern - rendered wherever remindersEnabled
// can change (the initial map render and right after the toggle's own
// click).
function renderReminderToggle() {
  reminderToggleEl.textContent = remindersEnabled ? "🔔 Daily reminder: On" : "🔕 Daily reminder: Off";
  reminderToggleEl.setAttribute("aria-pressed", String(remindersEnabled));
}

function renderMap() {
  const { engine } = quizState;
  const { count } = engine.streak;
  mapStreakEl.textContent = `Streak: ${dayCount(count)}`;
  renderMuteToggle();
  renderReminderToggle();
  renderSyncPanel();

  renderProgressGrid(engine.activeRange.size);

  const status = computeProgressMapStatus(engine, deps.now(), progressHighWaterMark);
  progressHighWaterMark = status.highWaterMark;
  progressReadoutEl.textContent = progressReadoutText(status.readout);
  progressReadoutEl.dataset.kind = status.readout.kind;

  if (status.readout.kind === "remaining") {
    // "The current frontier row/column is where the progress-to-expansion
    // indicator lives" (ticket #11) - anchor it at the boundary corner
    // where the filled square ends and the next row/column begins,
    // rather than as a generic caption under the grid.
    const frontierPercent = (engine.activeRange.size / MAX_ACTIVE_RANGE_SIZE) * 100;
    progressReadoutEl.style.left = `${frontierPercent}%`;
    progressReadoutEl.style.top = `${frontierPercent}%`;
  } else {
    // No frontier left to point at once the grid is full - the
    // maintenance readout sits in its normal place under the grid.
    progressReadoutEl.style.left = "";
    progressReadoutEl.style.top = "";
  }
}

// Ticket #12's statistics grids - a class name per off-ramp CellState
// (ADR 0004), plus a shared "provisional" modifier for the dashed ring
// so a 1-2-Attempt Fact still gets its real bucket color underneath.
function statsCellClass(state: CellState): string {
  switch (state.kind) {
    case "locked":
      return "stats-cell stats-cell--locked";
    case "unattempted":
      return "stats-cell stats-cell--unattempted";
    case "neverCorrect":
      return "stats-cell stats-cell--never-correct";
    case "value":
      return state.provisional ? "stats-cell stats-cell--provisional" : "stats-cell";
  }
}

// Builds one 12x12 grid of cell buttons. `varPrefix` picks which ramp's
// CSS custom properties (--acc-1..5 or --fluency-1..5, style.css) a
// "value" cell's bucket resolves to - the bucket→color mapping itself
// lives entirely in CSS so light/dark mode swap for free (ADR 0004:
// dark steps are their own validated set, not the light ramp flipped).
function buildStatsGrid(container: HTMLDivElement, varPrefix: "acc" | "fluency", classify: (fact: Fact) => CellState) {
  const { engine } = quizState;
  const now = deps.now();
  container.innerHTML = "";

  for (let a = 1; a <= MAX_ACTIVE_RANGE_SIZE; a++) {
    for (let b = 1; b <= MAX_ACTIVE_RANGE_SIZE; b++) {
      const fact: Fact = { a, b };
      const state = classify(fact);

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = statsCellClass(state);
      if (state.kind === "value") {
        cell.style.backgroundColor = `var(--${varPrefix}-${state.bucket + 1})`;
      }

      // Per-Fact numbers live in the tap/hover tooltip, never in the cell
      // itself (ADR 0004) - the same text also backs the accessible name,
      // so a screen reader gets exactly what a sighted hover/tap gets.
      const text = factTooltipText(fact, engine, now);
      cell.setAttribute("aria-label", text);
      cell.addEventListener("pointerenter", () => showStatsTooltip(cell, text));
      cell.addEventListener("focus", () => showStatsTooltip(cell, text));
      cell.addEventListener("click", () => showStatsTooltip(cell, text));
      cell.addEventListener("pointerleave", hideStatsTooltip);
      cell.addEventListener("blur", hideStatsTooltip);

      container.appendChild(cell);
    }
  }
}

// Positions the shared tooltip near the cell that triggered it, flipping
// below when there isn't room above and clamping horizontally so it
// never runs off-screen. Wired to hover, tap, AND keyboard focus below,
// so the same detail is reachable the same way regardless of input
// device.
function showStatsTooltip(cell: HTMLElement, text: string) {
  statsTooltipEl.textContent = text;
  statsTooltipEl.dataset.visible = "true";

  const cellRect = cell.getBoundingClientRect();
  const tipRect = statsTooltipEl.getBoundingClientRect();
  const margin = 8;

  let left = cellRect.left + cellRect.width / 2 - tipRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));

  let top = cellRect.top - tipRect.height - margin;
  if (top < margin) top = cellRect.bottom + margin;

  statsTooltipEl.style.left = `${left}px`;
  statsTooltipEl.style.top = `${top}px`;
}

function hideStatsTooltip() {
  statsTooltipEl.dataset.visible = "false";
}

function renderStats() {
  const { engine } = quizState;

  // Header is days practiced and current Streak ONLY (ticket #12) - no
  // total-Attempts figure, no time-series chart.
  const days = engine.practiceDayCount;
  statsDaysEl.textContent = `Practiced: ${dayCount(days)}`;
  const { count } = engine.streak;
  statsStreakEl.textContent = `Streak: ${dayCount(count)}`;

  buildStatsGrid(accuracyGridEl, "acc", (fact) => classifyAccuracyCell(fact, engine));
  buildStatsGrid(fluencyGridEl, "fluency", (fact) => classifyFluencyCell(fact, engine, deps.now()));
}

function renderQuiz() {
  const { count } = quizState.engine.streak;
  streakEl.textContent = `Streak: ${dayCount(count)}`;

  if (currentTakeover(takeoverQueue) || factCovered) {
    // Don't put the next Fact in the DOM at all while a takeover is up.
    // The takeover's opaque backdrop and the visibility rule in
    // style.css both already hide it, but each is one CSS feature away
    // from failing on an older browser, and the consequence of failing
    // is the Learner reading the next Fact and typing an answer that
    // gets swallowed. Nothing to render is nothing to leak.
    promptEl.textContent = "";
    typedAnswerEl.textContent = " ";
    disarmIdleCheck();
    return;
  }

  if (quizState.mode === "correcting") {
    // The correct answer is shown outright - the Learner isn't being
    // quizzed again, they're retyping to practice it. Nothing here feeds
    // Fluency (CONTEXT.md), so there's no idle-check to arm.
    promptEl.textContent = `${quizState.wrongFact.a} × ${quizState.wrongFact.b} = ${quizState.correctAnswer}`;
    disarmIdleCheck();
  } else if (quizState.mode === "retrying") {
    // Same Fact, still asking - the answer is deliberately withheld for
    // one more try. No idle-check either: a Retry is untimed by
    // design (it's the thinking time the reveal used to cut short), so
    // there's no response clock for a walk-away to spoil.
    promptEl.textContent = `${quizState.wrongFact.a} × ${quizState.wrongFact.b} = ?`;
    disarmIdleCheck();
  } else {
    promptEl.textContent = `${quizState.engine.fact.a} × ${quizState.engine.fact.b} = ?`;
    updateIdleCheck();
  }

  typedAnswerEl.textContent = quizState.typed || " ";
}

// Checks in after a Fact has sat unanswered past MAX_RESPONSE_MS
// (engine.ts) - long enough that the Learner may have walked away rather
// than just being slow. Re-arms relative to `factShownAt` itself (not
// "now") so repeated re-renders that don't change it - a keypress, a
// stats-tooltip dismissal - never restart the countdown; only an actual
// new Fact or a genuine restartFactTimer (below) does.
function updateIdleCheck() {
  if (quizState.mode !== "answering") return;
  const { factShownAt } = quizState;
  if (idleCheckArmedFor === factShownAt) return;
  disarmIdleCheck();
  idleCheckArmedFor = factShownAt;
  const delay = Math.max(0, MAX_RESPONSE_MS - (deps.now() - factShownAt));
  idleCheckTimeout = setTimeout(showIdleConfirm, delay);
}

function disarmIdleCheck() {
  clearTimeout(idleCheckTimeout);
  idleCheckTimeout = undefined;
  idleCheckArmedFor = undefined;
}

function showIdleConfirm() {
  idleConfirmEl.hidden = false;
  // Same belt-and-braces reasoning as document.body.dataset.takeover:
  // the Fact has already sat unanswered long enough to trigger this, so
  // there's nothing lost in also hiding it while the Learner confirms
  // they're back.
  document.body.dataset.idleConfirm = "true";
}

// True while an opaque Celebration overlay is covering the next Fact.
// The wrong-Attempt flash doesn't set this: it stays translucent, and
// the prompt beneath it is the correct answer the Learner needs to read.
let factCovered = false;

// Shows overlay text, optionally auto-fading after `autoHideMs` (omit to
// leave it up until the next explicit show/hide call).
function showOverlay(text: string, celebration: string, autoHideMs?: number, coversFact = false) {
  clearTimeout(overlayTimeout);
  overlayEl.textContent = text;
  overlayEl.dataset.visible = "true";
  overlayEl.dataset.celebration = celebration;
  factCovered = coversFact;
  if (autoHideMs !== undefined) {
    overlayTimeout = setTimeout(hideOverlay, autoHideMs);
  }
}

function hideOverlay() {
  clearTimeout(overlayTimeout);
  overlayEl.dataset.visible = "false";

  if (factCovered) {
    factCovered = false;
    // The Fact was hidden behind an opaque Celebration, so its clock was
    // running through a window the Learner couldn't read it in - the same
    // defect the takeover queue has (see restartFactTimer). Start it from
    // the moment the Fact actually becomes readable.
    quizState = restartFactTimer(quizState, deps);
  }
  renderQuiz();
}

// The Learner touching the keypad ends the previous Attempt's overlay
// immediately, whatever time it had left. The overlay sits on top of the
// typed answer as well as the prompt, so leaving it up means the digit
// that was just pressed is washed out along with everything else - which
// reads as "my typing isn't doing anything" and invites a re-tap. The
// input was always being accepted; it just wasn't visibly landing.
function handleDigit(digit: string) {
  hideOverlay();
  quizState = pressDigit(quizState, digit);
  renderQuiz();
}

function handleBackspace() {
  hideOverlay();
  quizState = pressBackspace(quizState);
  renderQuiz();
}

// Plays and shows every inline Celebration from the set at once - "plays
// simultaneously" per CONTEXT.md, which for the sounds means literally
// overlapping playSound calls, and for the overlay means the first (in
// practice the only - engine.ts pushes exactly one of correctness-only /
// personal-best per Attempt, never both) heads the on-screen text. A
// future inline kind that fires alongside another would still get its
// own sound from the loop below even though only one gets the overlay
// text - sound is never silently dropped, only the headline text picks
// one.
function playInlineCelebrations(celebrations: Celebration[], streakCount: number) {
  if (celebrations.length === 0) return;
  for (const c of celebrations) playSound(soundForCelebration(c.kind));

  const [primary] = celebrations;
  showOverlay(celebrationText(primary, streakCount), primary.kind, CELEBRATION_DISPLAY_MS, true);
}

// Renders whichever takeover is now at the front of `takeoverQueue`, or
// hides the takeover entirely once the queue drains - and does nothing at
// all if the front of the queue hasn't actually changed since last call,
// so re-running this after every enqueue/dismiss never re-triggers the
// sound or restarts the reveal animation for a takeover already on
// screen. This is the only place a takeover's sound plays - deliberately
// at display time, not at the moment the underlying Attempt happened, so
// two queued takeovers each get their own sound in turn rather than both
// firing at once up front.
function syncTakeoverDisplay() {
  const current = currentTakeover(takeoverQueue);
  if (current === displayedTakeover) return;
  displayedTakeover = current;

  if (!current) {
    takeoverEl.dataset.visible = "false";
    document.body.dataset.takeover = "false";
    // The queue has drained, so the Learner can finally answer. Start
    // the Fact's timer from here rather than from the Attempt that
    // raised the takeover - see restartFactTimer in screen.ts.
    quizState = restartFactTimer(quizState, deps);
    return;
  }

  takeoverEl.dataset.kind = current.kind;
  takeoverTitleEl.textContent = celebrationText(current, quizState.engine.streak.count);
  if (current.kind === "range-expansion" && current.rangeSize !== undefined) {
    // Reads the size off the Celebration itself, not live off
    // quizState.engine.activeRange.size - a boot-time catch-up
    // (missedRangeExpansionTakeovers) can replay several past
    // expansions in sequence, each needing to show the grid as it
    // looked at that exact moment, not wherever the Learner has since
    // progressed to. The engine only ever grows the Active range one
    // step at a time (nextActiveRange), so the reached size IS the
    // newly-filled row/column - no separate pre-expansion size needed.
    buildProgressGrid(takeoverGridEl, current.rangeSize, current.rangeSize);
  }
  takeoverEl.dataset.visible = "true";
  // Belt and braces on top of the takeover's opaque backdrop: the quiz
  // content underneath is hidden outright while a takeover is up, so the
  // next Fact can't be read and pre-answered through it. The backdrop
  // alone already covers it, but that depends on a colour staying
  // opaque, and this states the intent where a future restyle will see
  // it. Input is swallowed during a takeover, so a Fact glimpsed early
  // would only invite typing that goes nowhere.
  document.body.dataset.takeover = "true";
  playSound(soundForCelebration(current.kind));
}

// The Learner's tap (or Enter/Space from a keyboard - see the keydown
// handler below) advancing past the current takeover. Never on a timer:
// the issue is explicit that auto-dismiss risks the Learner missing the
// best moment in the app by looking away at the wrong instant, and that
// two takeovers queued back to back (range-expansion then Milestone) is
// correct behavior a timer would only get in the way of.
//
// A real bug this guards against: the takeover is often raised by Enter,
// which - on touch - is handled on pointerdown (see the keypad listener
// below) so it can appear the instant the finger lands, synchronously
// hiding the keypad underneath. The same physical tap still produces a
// trailing `click` a moment later, and a browser computes *that* click's
// target from the DOM as it looks at dispatch time, not from where the
// finger actually was - which is now this takeover, freshly covering
// that exact spot. Left unguarded, the takeover dismisses itself within
// the same tap that raised it, before a Learner ever sees it.
//
// Guarded against `lastPointerHandledAt` (below), not a fixed "just
// became visible" timer: that variable is only ever set by a touch/pen
// pointerdown, never a mouse click, so this only ever delays a dismissal
// that's plausibly the ghost click trailing that same touch gesture. A
// mouse dismissal - which was never at risk of this in the first place,
// since mouse input never takes the pointerdown path below - is never
// held up, however immediately it happens.
function dismissTakeover() {
  const current = currentTakeover(takeoverQueue);
  if (!current) return;
  if (performance.now() - lastPointerHandledAt < 500) return;

  // The dismissal itself is the acknowledgment - see engine.ts's
  // acknowledgedRangeSize and this queue's own boot-time seeding above.
  // Persisted immediately (not batched into the next Attempt's persist())
  // so a dismissed-but-not-yet-re-earned takeover can never come back on
  // a reload right after this exact moment.
  if (current.kind === "range-expansion" && current.rangeSize !== undefined) {
    quizState = { ...quizState, engine: { ...quizState.engine, acknowledgedRangeSize: current.rangeSize } };
    persist();
  }

  takeoverQueue = dismissCurrentTakeover(takeoverQueue);
  syncTakeoverDisplay();
  // Paints the Fact that renderQuiz deliberately withheld while the
  // takeover was up. Runs after syncTakeoverDisplay so that, if another
  // takeover was queued behind this one, the Fact stays withheld.
  renderQuiz();
}

// The Learner confirming "still there" after MAX_RESPONSE_MS (engine.ts)
// restarts the clock exactly like returning to the quiz from elsewhere
// (applyRoute) or a takeover clearing (hideOverlay) - all three are the
// same underlying case: time passed that the Fact's clock shouldn't be
// charged for.
function confirmStillThere() {
  idleConfirmEl.hidden = true;
  document.body.dataset.idleConfirm = "false";
  quizState = restartFactTimer(quizState, deps);
  renderQuiz();
}

idleConfirmYesEl.addEventListener("click", confirmStillThere);

function handleEnter() {
  const { screen: next, outcome } = pressEnter(quizState, deps);
  quizState = next;

  switch (outcome.kind) {
    case "empty":
      return;
    case "correct":
      persist();
      pushEngineStateToCloud();
      playInlineCelebrations(inlineCelebrations(outcome.celebrations), quizState.engine.streak.count);
      takeoverQueue = enqueueTakeovers(takeoverQueue, outcome.celebrations);
      syncTakeoverDisplay();
      break;
    case "incorrect":
      persist();
      pushEngineStateToCloud();
      // The wrong-answer sound: a soft low tone, never a buzzer (the
      // issue's central commitment - the Learner is nine). Plays every
      // time, independent of whether this Attempt also carries a
      // takeover Celebration (e.g. a Milestone can complete on a wrong
      // Attempt - Streak advances regardless of correctness).
      playSound("wrong");
      // A brief flash, not a persistent cover: the correct answer itself
      // is shown by renderQuiz() in the prompt for the whole "correcting"
      // mode, so the overlay must not sit on top of it for the duration
      // of the retype - that would hide the very thing the Learner is
      // meant to read and copy. No inline Celebrations are ever produced
      // by an incorrect outcome (engine.ts only pushes correctness-only /
      // personal-best on the correct path), so this never competes with
      // playInlineCelebrations' overlay.
      //
      // The answer isn't given away here: the Fact stays up for a second
      // try (screen.ts's "retrying"), so the flash asks for one rather
      // than pointing at an answer that isn't on screen.
      showOverlay("Not quite — try again", "none", WRONG_ANSWER_FLASH_MS);
      takeoverQueue = enqueueTakeovers(takeoverQueue, outcome.celebrations);
      syncTakeoverDisplay();
      break;
    case "retry-incorrect":
      // Second miss: the answer comes out now. No engine change to
      // persist and no Attempt recorded - the Fact was measured once, on
      // the first Enter - so this is purely the handover into retyping.
      playSound("wrong");
      showOverlay("Not quite — type the answer to continue", "none", WRONG_ANSWER_FLASH_MS);
      break;
    case "retry-correct":
      // Recalled without being shown the answer. Worth the correct sound
      // and a word of encouragement - but not a Celebration: the engine
      // recorded a wrong Attempt for this Fact and nothing here changes
      // that, so there's nothing to persist or push either.
      playSound("correct");
      showOverlay("Got it — that's the one!", "none", CELEBRATION_DISPLAY_MS);
      break;
    case "correction-dismissed":
      hideOverlay();
      break;
    case "correction-mismatch":
      // No engine change, no state to persist - just let the Learner
      // keep retyping (they can backspace their mistake).
      break;
  }

  renderQuiz();
}

// iOS Safari only applies the CSS `:active` pseudo-class to a tap when
// something on the page has a touchstart listener bound - otherwise every
// `:active` rule (the keypad's pressed-state feedback) is silently inert
// on a phone. This listener does nothing itself; it exists purely to
// switch that behavior on.
document.addEventListener("touchstart", () => {}, { passive: true });

function handleKeypadTarget(target: HTMLElement) {
  const digit = target.dataset.digit;
  if (digit !== undefined) {
    handleDigit(digit);
  } else if (target.id === "key-backspace") {
    handleBackspace();
  } else if (target.id === "key-enter") {
    handleEnter();
  }
}

// A tap that visibly registers (the `:active` flash fires) but never
// produces a `click` is a real, reported failure mode - even with
// touch-action: manipulation, a mobile browser can still decide, after
// the fact, not to synthesize a click for a touch it accepted. pointerdown
// fires unconditionally the instant the touch lands, so touch/pen input
// acts on that directly instead of ever waiting on a click that might not
// come. Mouse (and a keyboard/assistive-tech "activate", which dispatches
// a genuine pointer sequence with its own pointerdown) are left on the
// click listener below - untouched, and not part of the failure this is
// fixing.
//
// `pointerEvent.preventDefault()` alone is not enough to stop the click
// that follows: the Pointer Events spec only guarantees it suppresses
// the compatibility *mouse* events, and Chromium (confirmed here by a
// real-touch e2e test - a mouse-driven `.click()` never exercises this
// path) still synthesizes `click` for a touch tap regardless. A short
// time-window guard on the click handler is what actually prevents the
// same tap from entering its digit twice.
//
// The guard's sentinel is -Infinity, not 0: performance.now() starts
// near zero at page load, so a tap in the first moments of a fresh page
// would otherwise compute `performance.now() - 0` as itself under
// 500ms and get wrongly treated as a just-handled pointerdown's
// trailing click, even though no pointerdown had actually run yet.
let lastPointerHandledAt = -Infinity;

keypadEl.addEventListener("pointerdown", (pointerEvent) => {
  if (pointerEvent.pointerType === "mouse") return;
  const target = pointerEvent.target;
  if (!(target instanceof HTMLElement)) return;
  pointerEvent.preventDefault();
  lastPointerHandledAt = performance.now();
  handleKeypadTarget(target);
});

keypadEl.addEventListener("click", (clickEvent) => {
  if (performance.now() - lastPointerHandledAt < 500) return;
  const target = clickEvent.target;
  if (!(target instanceof HTMLElement)) return;
  handleKeypadTarget(target);
});

takeoverEl.addEventListener("click", dismissTakeover);

// The physical keyboard keeps working - it costs almost nothing to wire
// up and it's how this screen gets tested. A visible takeover intercepts
// Enter/Space as its own dismissal first (and swallows every other key)
// so a Learner tabbing/typing through a takeover can never leak input
// through to the quiz underneath - the whole point of "takeovers require
// a tap to dismiss and never auto-advance" is that nothing else can move
// the Attempt along while one is up. Below that, key handling is guarded
// to the quiz route so typing on the map or stats screen (e.g. tabbing
// through and hitting digits by accident) can't submit an Attempt no one
// asked for.
document.addEventListener("keydown", (keyEvent) => {
  if (takeoverEl.dataset.visible === "true") {
    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
      keyEvent.preventDefault();
      dismissTakeover();
    }
    return;
  }

  if (!idleConfirmEl.hidden) {
    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
      keyEvent.preventDefault();
      confirmStillThere();
    }
    return;
  }

  if (routeFromHash(window.location.hash) !== "quiz") return;

  if (/^[0-9]$/.test(keyEvent.key)) {
    handleDigit(keyEvent.key);
  } else if (keyEvent.key === "Enter") {
    keyEvent.preventDefault();
    handleEnter();
  } else if (keyEvent.key === "Backspace") {
    keyEvent.preventDefault();
    handleBackspace();
  }
});

// Erases the save and reloads, so every module rebuilds from the
// genuine first-ever-open path rather than this session's in-memory
// state being written straight back out by the next persist().
resetConfirmEl.addEventListener("click", () => {
  clearState();
  // A device left paired to a Profile (docs/adr/0006) would otherwise
  // have this reset immediately undone: the live subscription (started
  // again on the very next boot, unconditionally, for any paired device)
  // would redeliver the old shared progress moments after reload. "Erase
  // everything" has to mean it, so this device is detached first.
  const profile = activeProfile();
  if (profile) removePairedProfile(profile.profileId);
  window.location.hash = hashForRoute("map");
  window.location.reload();
});

muteToggleEl.addEventListener("click", () => {
  muted = !muted;
  setMuted(muted);
  renderMuteToggle();
  persist();
});

function showReminderHint(text: string) {
  reminderHintEl.textContent = text;
  reminderHintEl.hidden = false;
}

// Turning the reminder off never fails (there's nothing to be denied),
// but turning it on can fail several ways - permission refused, the
// browser lacking Periodic Background Sync entirely, or Chrome's own
// site-engagement heuristic rejecting the registration - and in every
// failing case this leaves remindersEnabled false and says why, rather
// than showing "On" for a reminder that will never actually fire.
reminderToggleEl.addEventListener("click", () => {
  void (async () => {
    if (remindersEnabled) {
      await disableDailyReminder();
      remindersEnabled = false;
      renderReminderToggle();
      persist();
      return;
    }

    if (!isReminderSupported()) {
      showReminderHint(
        "Daily reminders aren't supported in this browser. On Android, install this app to the home screen with Chrome first.",
      );
      return;
    }

    reminderHintEl.hidden = true;
    const enabled = await enableDailyReminder();
    remindersEnabled = enabled;
    renderReminderToggle();
    persist();
    if (!enabled) {
      showReminderHint("Reminders need notification permission - check your browser/site settings and try again.");
    }
  })();
});

syncButtonEl.addEventListener("click", () => {
  syncPanelEl.hidden = !syncPanelEl.hidden;
  if (!syncPanelEl.hidden) renderSyncPanel();
});

startSharingButtonEl.addEventListener("click", () => {
  startSharingFormEl.hidden = !startSharingFormEl.hidden;
  if (!startSharingFormEl.hidden) startSharingNameInputEl.focus();
});

startSharingConfirmButtonEl.addEventListener("click", () => {
  void startSharing(startSharingNameInputEl.value);
});

newProfileConfirmButtonEl.addEventListener("click", () => {
  void startNewProfile(newProfileNameInputEl.value);
});

joinButtonEl.addEventListener("click", () => {
  const profileId = profileIdFromPastedText(joinCodeInputEl.value);
  if (!profileId) {
    showSyncHint("That doesn't look like a valid sync link - paste the whole thing.");
    return;
  }
  syncHintEl.hidden = true;
  void beginJoin(profileId);
});

copySyncLinkButtonEl.addEventListener("click", () => {
  const profile = activeProfile();
  if (!profile) return;
  const link = pairingLinkForProfile(profile.profileId);

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(link).then(
      () => showSyncHint("Sync link copied — paste it on the other phone (e.g. in a text message)."),
      () => showSyncHint(`Copy this link and send it to the other phone: ${link}`),
    );
  } else {
    showSyncHint(`Copy this link and send it to the other phone: ${link}`);
  }
});

// A phone's camera app decodes a URL-shaped QR straight into "open this
// link" - which lands on the join flow (route.ts's joinProfileIdFromHash)
// with no typing/pasting step at all, unlike "Copy sync link". Toggle
// rather than a one-shot reveal, matching the sync panel's own
// open/closed button; qrcode-generator is loaded lazily here too (see
// pairingQrCode.ts's own comment) so it never ships to a household that
// only ever uses the text-link path.
showQrButtonEl.addEventListener("click", () => {
  void (async () => {
    if (!qrCodeWrapEl.hidden) {
      qrCodeWrapEl.hidden = true;
      showQrButtonEl.textContent = "Show QR code";
      return;
    }

    const profile = activeProfile();
    if (!profile) return;
    const link = pairingLinkForProfile(profile.profileId);
    const { pairingQrCodeSvg } = await import("./pairingQrCode");
    qrCodeWrapEl.innerHTML = pairingQrCodeSvg(link);
    qrCodeWrapEl.hidden = false;
    showQrButtonEl.textContent = "Hide QR code";
  })();
});

// Detaches this device from its Profile - the Profile itself, and any
// other device synced to it, are untouched. This device's own local
// progress is left exactly as it currently stands (not erased), just no
// longer pushed to or pulled from the cloud.
stopSyncingButtonEl.addEventListener("click", () => {
  const profile = activeProfile();
  if (!profile) return;
  unsubscribeFromProfile?.();
  unsubscribeFromProfile = undefined;
  removePairedProfile(profile.profileId);
  renderSyncPanel();
});

syncConfirmYesEl.addEventListener("click", () => {
  if (pendingJoinProfileId && pendingJoinRemoteEngine && pendingJoinLabel) {
    completeJoin(pendingJoinProfileId, pendingJoinRemoteEngine, pendingJoinLabel);
  }
  syncConfirmEl.hidden = true;
  pendingJoinProfileId = null;
  pendingJoinRemoteEngine = undefined;
  pendingJoinLabel = undefined;
});

syncConfirmNoEl.addEventListener("click", () => {
  syncConfirmEl.hidden = true;
  pendingJoinProfileId = null;
  pendingJoinRemoteEngine = undefined;
  pendingJoinLabel = undefined;
});

// Chrome/Android fires this instead of showing its own install banner
// when the page calls preventDefault() on it, handing control of exactly
// when/how to prompt to the app - stashed here and used by the install
// button's click handler below. Safari has no such event at all (see the
// iOS hint instead).
let deferredInstallPrompt: Event | null = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButtonEl.hidden = false;
});

installButtonEl.addEventListener("click", () => {
  const promptEvent = deferredInstallPrompt as (Event & { prompt: () => Promise<void> }) | null;
  if (!promptEvent) return;
  installButtonEl.hidden = true;
  deferredInstallPrompt = null;
  void promptEvent.prompt();
});

// Fires once the Learner actually installs (via the button above, or
// Chrome's own menu) - the deferred prompt is spent either way, and
// there's nothing left to offer.
window.addEventListener("appinstalled", () => {
  installButtonEl.hidden = true;
  deferredInstallPrompt = null;
});

// iOS Safari has no beforeinstallprompt/appinstalled events at all - the
// only "Add to Home Screen" path there is the manual Share-sheet one, so
// this shows a static instruction instead of a button when running on an
// iPhone/iPad that isn't already installed.
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
if (isIOS && !isStandalone) {
  iosInstallHintEl.hidden = false;
}

// Shown once a newer deployed version has activated in the background -
// sw.ts calls self.skipWaiting() unconditionally, so a new version takes
// over as *the* active worker without ever waiting on this tab, but
// without clients.claim() it still doesn't take over *this already-open
// page* until a reload. That gap is exactly what the banner is for: the
// Learner is running stale JS against what's now an outdated deploy, and
// a tap reloads onto the version the new worker already has ready.
let updateAvailable = false;

function updateBannerVisibility() {
  const route = routeFromHash(window.location.hash);
  // Never the quiz (or the unlisted reset screen) - nothing should
  // compete for attention mid-question, and there's no rush: the update
  // is already sitting there activated, waiting for whenever the Learner
  // next lands on the map or stats.
  const eligibleRoute = route === "map" || route === "stats";
  updateBannerEl.hidden = !(updateAvailable && eligibleRoute);
}

updateBannerButtonEl.addEventListener("click", () => window.location.reload());

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js")
    .then((registration) => {
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        // A controller already existed *before* this new worker showed up
        // - i.e. this is a real update replacing one already serving the
        // page, not this tab's own first-ever install (which also runs
        // through "installing" -> "activated" but has nothing to update
        // away from).
        const isGenuineUpdate = navigator.serviceWorker.controller !== null;
        installing.addEventListener("statechange", () => {
          if (isGenuineUpdate && installing.state === "activated") {
            updateAvailable = true;
            updateBannerVisibility();
          }
        });
      });

      // The registration itself doesn't re-check the network on its own -
      // registration.update() is what actually asks the server for a
      // fresh copy of sw.js and kicks off "updatefound" if it differs.
      // Deferred past the load event (and an extra beat past that) so
      // this never competes with anything the initial paint needs, then
      // re-checked occasionally rather than on some tight poll: once on
      // returning to the tab (a Learner is most likely to have missed a
      // deploy after being away a while - throttled so rapid tab
      // switching can't spam it) plus a periodic fallback for a tab that
      // just stays open.
      const checkForUpdate = () => void registration.update();
      const RECHECK_MIN_INTERVAL_MS = 5 * 60_000;
      const PERIODIC_RECHECK_MS = 60 * 60_000;
      let lastCheckAt = 0;
      const checkIfDue = () => {
        const now = Date.now();
        if (now - lastCheckAt < RECHECK_MIN_INTERVAL_MS) return;
        lastCheckAt = now;
        checkForUpdate();
      };

      // Guards against the "load" event having already fired before this
      // listener attaches (a real risk this far down an async .then chain,
      // not just theoretical) - in which case it would simply never come.
      const scheduleFirstCheck = () => setTimeout(checkIfDue, 5_000);
      if (document.readyState === "complete") {
        scheduleFirstCheck();
      } else {
        window.addEventListener("load", scheduleFirstCheck);
      }
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkIfDue();
      });
      setInterval(checkIfDue, PERIODIC_RECHECK_MS);
    })
    .catch(() => {
      // Best-effort: a failed registration only costs install eligibility
      // and background reminders, never the ability to practice.
    });
}

// The stats legend's swatches are static markup (unlike the grids, never
// rebuilt), so this wiring runs once rather than per-render - each
// swatch's explanation is baked into its own data-tip rather than looked
// up, since these don't vary with engine state. Shares the same tooltip
// element/positioning as the grid cells (showStatsTooltip/hideStatsTooltip
// above) so a tap anywhere on the stats screen behaves the same way.
document.querySelectorAll<HTMLButtonElement>(".legend-item").forEach((item) => {
  const text = item.dataset.tip;
  if (text === undefined) return;
  item.addEventListener("pointerenter", () => showStatsTooltip(item, text));
  item.addEventListener("focus", () => showStatsTooltip(item, text));
  item.addEventListener("click", () => showStatsTooltip(item, text));
  item.addEventListener("pointerleave", hideStatsTooltip);
  item.addEventListener("blur", hideStatsTooltip);
});

// WebAudio refuses to produce sound until a real user gesture has
// touched the AudioContext (CONTEXT.md-adjacent browser rule, not a
// domain one) - tapping "Practice" on the Progress map is the gesture
// the landing flow supplies for free (the issue body), but a same-day
// return visit skips the map entirely (route.ts's decideLanding sends it
// straight to the quiz), so the very first pointerdown/keydown anywhere
// is wired up too as a fallback gesture. initAudio() is idempotent, so
// having multiple listeners race to call it first is harmless.
practiceLinkEl.addEventListener("click", () => initAudio(), { once: true });
document.addEventListener("pointerdown", () => initAudio(), { once: true });
document.addEventListener("keydown", () => initAudio(), { once: true });

// Hash routing between the map, quiz, and stats screens (route.ts) -
// deliberately just toggling which <section> is visible off of
// `location.hash`, so the browser/Android back button works for free.
function applyRoute(route: Route) {
  // Reconcile any remote update that arrived while it wasn't safe to
  // apply (the Learner was mid-question on the quiz route) - every route
  // change is a natural point to catch up, including the very first one
  // at boot.
  applyPendingRemoteUpdate(route);

  const arrivingAtQuiz = route === "quiz" && quizScreenEl.dataset.active !== "true";

  mapScreenEl.dataset.active = String(route === "map");
  quizScreenEl.dataset.active = String(route === "quiz");
  statsScreenEl.dataset.active = String(route === "stats");
  resetScreenEl.dataset.active = String(route === "reset");
  // A tooltip anchored to a now-hidden cell would otherwise stay stuck
  // on screen after navigating away.
  hideStatsTooltip();
  updateBannerVisibility();

  // Arriving at the quiz screen from elsewhere (as opposed to already
  // being on it) is a fresh "Start practice" - factShownAt must restart
  // here too, or a Learner who leaves the quiz screen idle and comes
  // back has their response time measured from the original visit.
  if (arrivingAtQuiz) quizState = restartFactTimer(quizState, deps);

  if (route !== "quiz") {
    // Nothing renders the quiz screen from here on, so nothing will call
    // updateIdleCheck again - a still-pending timeout would otherwise pop
    // the "still there?" dialog while the Learner is looking at another
    // screen entirely (e.g. the Android back button navigating away).
    disarmIdleCheck();
    idleConfirmEl.hidden = true;
    document.body.dataset.idleConfirm = "false";
  }

  if (route === "map") renderMap();
  if (route === "quiz") renderQuiz();
  if (route === "stats") renderStats();
}

window.addEventListener("hashchange", () => applyRoute(routeFromHash(window.location.hash)));

// Captured before anything below has a chance to overwrite
// window.location.hash (decideLanding's own landing-hash normalization
// does exactly that when the requested hash isn't one of its three
// routes, which "#/join/<id>" never is) - reading this hash again later
// would silently see "#/map" instead and never notice the join at all.
const joinProfileId = joinProfileIdFromHash(window.location.hash);

// CONTEXT.md's Progress map landing rule: shown on the first open of
// each calendar day, straight to the quiz on later opens the same day.
// Reuses the engine's dayKey (via decideLanding) rather than a second
// notion of "day". An empty hash - a genuinely fresh open - is passed
// through as "nothing requested" rather than routeFromHash's own "map"
// fallback, so decideLanding can tell that apart from a reload that
// already had an explicit route in the URL (see its own comment).
const requestedRoute = window.location.hash === "" ? undefined : routeFromHash(window.location.hash);
const landing = decideLanding(lastMapShownDay, deps.now(), requestedRoute);
if (landing.shownOnDay !== undefined) {
  lastMapShownDay = landing.shownOnDay;
  persist();
}
const landingHash = hashForRoute(landing.route);
if (window.location.hash !== landingHash) {
  // Setting `location.hash` to a new value queues a `hashchange` event
  // rather than firing synchronously, so the very first paint below
  // can't rely on that event alone.
  window.location.hash = landingHash;
}
// Surfaces a boot-time catch-up takeover (takeoverQueue's own seeding,
// above) on the very first paint - every other syncTakeoverDisplay call
// site runs off the back of a just-submitted Attempt, which hasn't
// happened yet this early.
syncTakeoverDisplay();
applyRoute(landing.route);

// A device that paired with a Profile in an earlier session resumes
// syncing immediately, with no re-pairing - the whole reason
// profilePairing.ts remembers it locally. The overwhelming majority of
// installs have never paired with anything, so this is a no-op for them
// (and Firebase's SDK never even downloads - see loadCloudSync above).
const pairedProfile = activeProfile();
if (pairedProfile) {
  startSyncing(pairedProfile.profileId);
}

// A pairing link (route.ts's joinProfileIdFromHash - "#/join/<id>", from
// "Copy link") is a one-time action, not a screen with its
// own back-button-navigable state - consumed here once (the hash was
// already normalized to the map above, as part of the landing decision).
if (joinProfileId) {
  syncPanelEl.hidden = false;
  renderSyncPanel();
  showSyncHint("Looking for the shared progress from that link…");
  void beginJoin(joinProfileId);
}
