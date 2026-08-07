import "./style.css";
import { createInitialState, MAX_ACTIVE_RANGE_SIZE, type Celebration, type CelebrationKind, type Dependencies, type Fact } from "./engine/engine";
import { loadState, saveState, type AppState } from "./persistence";
import { computeProgressMapStatus, type ProgressHighWaterMark, type ProgressReadout } from "./progressMap";
import { decideLanding, hashForRoute, routeFromHash, type Route } from "./route";
import { createInitialScreen, pressBackspace, pressDigit, pressEnter, type ScreenState } from "./screen";
import { classifyAccuracyCell, classifySpeedCell, factTooltipText, type CellState } from "./stats";

const INITIAL_ACTIVE_RANGE = { size: 5 };
const deps: Dependencies = { random: Math.random, now: Date.now };

// Shared "N day(s)" pluralization for the map, quiz, and stats headers'
// Streak/Practiced readouts, so the four call sites can't drift from
// each other on the singular case.
function dayCount(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

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
    <header class="stats-header">
      <a class="map-link" id="stats-map-link" href="#/map" aria-label="Home">⌂</a>
      <p class="stats-days" id="stats-days"></p>
      <p class="streak" id="stats-streak"></p>
    </header>

    <div class="stats-body">
      <section class="stats-section" aria-labelledby="accuracy-heading">
        <h2 class="stats-heading" id="accuracy-heading">Accuracy</h2>
        <ul class="stats-legend">
          <li><span class="legend-swatch" data-acc="0"></span>&lt;50%</li>
          <li><span class="legend-swatch" data-acc="1"></span>50–75%</li>
          <li><span class="legend-swatch" data-acc="2"></span>75–90%</li>
          <li><span class="legend-swatch" data-acc="3"></span>90–99%</li>
          <li><span class="legend-swatch" data-acc="4"></span>100%</li>
        </ul>
        <div class="stats-grid-wrap">
          <div class="stats-grid" id="accuracy-grid" role="group" aria-label="Accuracy grid, 12 by 12 Facts"></div>
        </div>
      </section>

      <section class="stats-section" aria-labelledby="speed-heading">
        <h2 class="stats-heading" id="speed-heading">Speed</h2>
        <ul class="stats-legend">
          <li><span class="legend-swatch" data-speed="0"></span>&gt;1.5×</li>
          <li><span class="legend-swatch" data-speed="1"></span>1.0–1.5×</li>
          <li><span class="legend-swatch" data-speed="2"></span>0.8–1.0×</li>
          <li><span class="legend-swatch" data-speed="3"></span>0.6–0.8×</li>
          <li><span class="legend-swatch" data-speed="4"></span>&lt;0.6×</li>
        </ul>
        <div class="stats-grid-wrap">
          <div class="stats-grid" id="speed-grid" role="group" aria-label="Speed grid, 12 by 12 Facts"></div>
        </div>
      </section>

      <ul class="stats-legend stats-legend--shared">
        <li><span class="legend-swatch legend-swatch--empty"></span>Not tried yet</li>
        <li><span class="legend-swatch legend-swatch--never-correct"></span>Wrong so far</li>
        <li><span class="legend-swatch legend-swatch--provisional"></span>Still new</li>
      </ul>
    </div>

    <div class="stats-tooltip" id="stats-tooltip" role="status" aria-live="polite" data-visible="false"></div>
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
const statsDaysEl = getEl<HTMLParagraphElement>("stats-days");
const statsStreakEl = getEl<HTMLParagraphElement>("stats-streak");
const accuracyGridEl = getEl<HTMLDivElement>("accuracy-grid");
const speedGridEl = getEl<HTMLDivElement>("speed-grid");
const statsTooltipEl = getEl<HTMLDivElement>("stats-tooltip");

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
  mapStreakEl.textContent = `Streak: ${dayCount(count)}`;

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
// CSS custom properties (--acc-1..5 or --speed-1..5, style.css) a
// "value" cell's bucket resolves to - the bucket→color mapping itself
// lives entirely in CSS so light/dark mode swap for free (ADR 0004:
// dark steps are their own validated set, not the light ramp flipped).
function buildStatsGrid(container: HTMLDivElement, varPrefix: "acc" | "speed", classify: (fact: Fact) => CellState) {
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
  buildStatsGrid(speedGridEl, "speed", (fact) => classifySpeedCell(fact, engine, deps.now()));
}

function renderQuiz() {
  const { count } = quizState.engine.streak;
  streakEl.textContent = `Streak: ${dayCount(count)}`;

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
  // A tooltip anchored to a now-hidden cell would otherwise stay stuck
  // on screen after navigating away.
  hideStatsTooltip();

  if (route === "map") renderMap();
  if (route === "quiz") renderQuiz();
  if (route === "stats") renderStats();
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
