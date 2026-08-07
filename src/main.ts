import "./style.css";
import { createInitialState, MAX_ACTIVE_RANGE_SIZE, type Celebration, type CelebrationKind, type Dependencies } from "./engine/engine";
import { loadState, saveState, type AppState } from "./persistence";
import { computeProgressMapStatus, type ProgressHighWaterMark, type ProgressReadout } from "./progressMap";
import { decideLanding, hashForRoute, routeFromHash, type Route } from "./route";
import { createInitialScreen, pressBackspace, pressDigit, pressEnter, type ScreenState } from "./screen";

const INITIAL_ACTIVE_RANGE = { size: 5 };
const deps: Dependencies = { random: Math.random, now: Date.now };

// How long the overlay stays up before fading on its own. Neither of
// these gates progress - the Celebration overlay is purely cosmetic
// (the next Fact is already live underneath it), and the wrong-Attempt
// overlay is a brief "not quite" flash, not the mechanism that shows the
// correct answer: the prompt shows that continuously in "correcting"
// mode, underneath, for as long as the retype takes.
const CELEBRATION_DISPLAY_MS = 1200;
const WRONG_ANSWER_FLASH_MS = 900;

// An Attempt can produce several Celebrations at once (ticket #10); this
// picks the single most-significant one to headline the overlay text
// with. Takeover-tagged kinds (rarer, bigger moments) always outrank
// inline ones. The actual takeover screen - filling the display and
// waiting for a dismissal, rather than this auto-fading overlay - is
// ticket #13's job; this is a minimal, coherent stand-in until then.
const CELEBRATION_PRIORITY: CelebrationKind[] = ["range-expansion", "milestone", "personal-best", "correctness-only"];

function primaryCelebration(celebrations: Celebration[]): Celebration | undefined {
  for (const kind of CELEBRATION_PRIORITY) {
    const found = celebrations.find((c) => c.kind === kind);
    if (found) return found;
  }
  return undefined;
}

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

function getEl<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!;
}

getEl<HTMLDivElement>("app").innerHTML = `
  <section class="screen map-screen" id="screen-map">
    <header class="map-header">
      <p class="streak" id="map-streak"></p>
    </header>

    <div class="progress-grid-wrap" id="progress-grid-wrap">
      <div class="progress-grid" id="progress-grid" role="img" aria-label="Progress map"></div>
      <p class="progress-readout" id="progress-readout"></p>
    </div>

    <a class="practice-button" id="practice-link" href="#/quiz">Practice</a>
    <a class="stats-link" id="stats-link" href="#/stats">Stats</a>
  </section>

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
      <button type="button" class="key" data-digit="7">7</button>
      <button type="button" class="key" data-digit="8">8</button>
      <button type="button" class="key" data-digit="9">9</button>
      <button type="button" class="key" data-digit="4">4</button>
      <button type="button" class="key" data-digit="5">5</button>
      <button type="button" class="key" data-digit="6">6</button>
      <button type="button" class="key" data-digit="1">1</button>
      <button type="button" class="key" data-digit="2">2</button>
      <button type="button" class="key" data-digit="3">3</button>
      <button type="button" class="key key-backspace" id="key-backspace" aria-label="Backspace">⌫</button>
      <button type="button" class="key" data-digit="0">0</button>
      <button type="button" class="key key-enter" id="key-enter" aria-label="Enter">⏎</button>
    </section>
  </main>

  <section class="screen stats-screen" id="screen-stats">
    <p>Statistics are coming soon.</p>
    <a href="#/map">Back to map</a>
  </section>
`;

const mapScreenEl = getEl<HTMLElement>("screen-map");
const mapStreakEl = getEl<HTMLParagraphElement>("map-streak");
const progressGridEl = getEl<HTMLDivElement>("progress-grid");
const progressReadoutEl = getEl<HTMLParagraphElement>("progress-readout");

const quizScreenEl = getEl<HTMLElement>("screen-quiz");
const streakEl = getEl<HTMLParagraphElement>("streak");
const promptEl = getEl<HTMLParagraphElement>("prompt");
const typedAnswerEl = getEl<HTMLParagraphElement>("typed-answer");
const overlayEl = getEl<HTMLParagraphElement>("overlay");
const keypadEl = getEl<HTMLElement>("keypad");

const statsScreenEl = getEl<HTMLElement>("screen-stats");

const loaded: AppState = loadState() ?? { engine: createInitialState(INITIAL_ACTIVE_RANGE, deps), lastMapShownDay: null };
let quizState: ScreenState = createInitialScreen(loaded.engine, deps);
let lastMapShownDay = loaded.lastMapShownDay;
let overlayTimeout: ReturnType<typeof setTimeout> | undefined;

// The Progress map's progress-to-expansion readout is monotonic within a
// session (ticket #11) - this is that session's high-water mark, held in
// memory only (not persisted) so it naturally resets on the next page
// load rather than surviving across days.
let progressHighWaterMark: ProgressHighWaterMark | null = null;

function persist() {
  saveState({ engine: quizState.engine, lastMapShownDay });
}

function renderProgressGrid(activeRangeSize: number) {
  progressGridEl.innerHTML = "";
  for (let a = 1; a <= MAX_ACTIVE_RANGE_SIZE; a++) {
    for (let b = 1; b <= MAX_ACTIVE_RANGE_SIZE; b++) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      // The Active range's conquered n x n corner, drawn literally (ADR
      // 0004's grid shape, reused rather than a second metaphor). Sizes
      // 1x1-4x4 render as already-conquered simply because the Active
      // range never starts smaller than 5x5.
      if (a <= activeRangeSize && b <= activeRangeSize) {
        cell.classList.add("grid-cell--filled");
      }
      progressGridEl.appendChild(cell);
    }
  }
}

function progressReadoutText(readout: ProgressReadout): string {
  switch (readout.kind) {
    case "remaining":
      return `${readout.count} to go`;
    case "maintenance":
      return `${readout.masteredCount} of ${readout.totalCount} sharp`;
  }
}

function renderMap() {
  const { engine } = quizState;
  const { count } = engine.streak;
  mapStreakEl.textContent = `Streak: ${count} day${count === 1 ? "" : "s"}`;

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

function renderQuiz() {
  const { count } = quizState.engine.streak;
  streakEl.textContent = `Streak: ${count} day${count === 1 ? "" : "s"}`;

  if (quizState.mode === "correcting") {
    // The correct answer is shown outright - the Learner isn't being
    // quizzed again, they're retyping to practice it.
    promptEl.textContent = `${quizState.wrongFact.a} × ${quizState.wrongFact.b} = ${quizState.correctAnswer}`;
  } else {
    promptEl.textContent = `${quizState.engine.fact.a} × ${quizState.engine.fact.b} = ?`;
  }

  typedAnswerEl.textContent = quizState.typed || " ";
}

// Shows overlay text, optionally auto-fading after `autoHideMs` (omit to
// leave it up until the next explicit show/hide call).
function showOverlay(text: string, celebration: string, autoHideMs?: number) {
  clearTimeout(overlayTimeout);
  overlayEl.textContent = text;
  overlayEl.dataset.visible = "true";
  overlayEl.dataset.celebration = celebration;
  if (autoHideMs !== undefined) {
    overlayTimeout = setTimeout(() => {
      overlayEl.dataset.visible = "false";
    }, autoHideMs);
  }
}

function hideOverlay() {
  clearTimeout(overlayTimeout);
  overlayEl.dataset.visible = "false";
}

function handleDigit(digit: string) {
  quizState = pressDigit(quizState, digit);
  renderQuiz();
}

function handleBackspace() {
  quizState = pressBackspace(quizState);
  renderQuiz();
}

// Shows the most-significant Celebration from the set, if any; used by
// both the "correct" and "incorrect" outcomes below since a wrong
// Attempt can still carry one (e.g. a Milestone - Streak advances on
// every Attempt regardless of correctness). Returns whether it showed
// one, so callers can fall back to their own default overlay when not.
function showPrimaryCelebration(celebrations: Celebration[], streakCount: number): boolean {
  const primary = primaryCelebration(celebrations);
  if (!primary) return false;

  showOverlay(
    celebrationText(primary, streakCount),
    primary.kind,
    // Inline celebrations auto-fade quickly so they never block the next
    // Attempt; takeover ones stay up until the next overlay call replaces
    // them (a placeholder for #13's real dismiss flow).
    primary.tag === "inline" ? CELEBRATION_DISPLAY_MS : undefined,
  );
  return true;
}

function handleEnter() {
  const { screen: next, outcome } = pressEnter(quizState, deps);
  quizState = next;

  switch (outcome.kind) {
    case "empty":
      return;
    case "correct":
      persist();
      showPrimaryCelebration(outcome.celebrations, quizState.engine.streak.count);
      break;
    case "incorrect":
      persist();
      if (!showPrimaryCelebration(outcome.celebrations, quizState.engine.streak.count)) {
        // A brief flash, not a persistent cover: the correct answer itself
        // is shown by renderQuiz() in the prompt for the whole "correcting"
        // mode, so the overlay must not sit on top of it for the duration
        // of the retype - that would hide the very thing the Learner is
        // meant to read and copy.
        showOverlay("Not quite — type the answer to continue", "none", WRONG_ANSWER_FLASH_MS);
      }
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

keypadEl.addEventListener("click", (clickEvent) => {
  const target = clickEvent.target;
  if (!(target instanceof HTMLElement)) return;

  const digit = target.dataset.digit;
  if (digit !== undefined) {
    handleDigit(digit);
  } else if (target.id === "key-backspace") {
    handleBackspace();
  } else if (target.id === "key-enter") {
    handleEnter();
  }
});

// The physical keyboard keeps working - it costs almost nothing to wire
// up and it's how this screen gets tested. Guarded to the quiz route so
// typing on the map or stats screen (e.g. tabbing through and hitting
// digits by accident) can't submit an Attempt no one asked for.
document.addEventListener("keydown", (keyEvent) => {
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

// Hash routing between the map, quiz, and stats screens (route.ts) -
// deliberately just toggling which <section> is visible off of
// `location.hash`, so the browser/Android back button works for free.
function applyRoute(route: Route) {
  mapScreenEl.dataset.active = String(route === "map");
  quizScreenEl.dataset.active = String(route === "quiz");
  statsScreenEl.dataset.active = String(route === "stats");

  if (route === "map") renderMap();
  if (route === "quiz") renderQuiz();
}

window.addEventListener("hashchange", () => applyRoute(routeFromHash(window.location.hash)));

// CONTEXT.md's Progress map landing rule: shown on the first open of
// each calendar day, straight to the quiz on later opens the same day.
// Reuses the engine's dayKey (via decideLanding) rather than a second
// notion of "day".
const landing = decideLanding(lastMapShownDay, deps.now());
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
applyRoute(landing.route);
