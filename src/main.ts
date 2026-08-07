import "./style.css";
import { createInitialState, type Dependencies } from "./engine/engine";
import { loadState, saveState } from "./persistence";
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

function getEl<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!;
}

getEl<HTMLDivElement>("app").innerHTML = `
  <main class="quiz">
    <header class="quiz-header">
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
`;

const streakEl = getEl<HTMLParagraphElement>("streak");
const promptEl = getEl<HTMLParagraphElement>("prompt");
const typedAnswerEl = getEl<HTMLParagraphElement>("typed-answer");
const overlayEl = getEl<HTMLParagraphElement>("overlay");
const keypadEl = getEl<HTMLElement>("keypad");

let screen: ScreenState = createInitialScreen(loadState() ?? createInitialState(INITIAL_ACTIVE_RANGE, deps), deps);
let overlayTimeout: ReturnType<typeof setTimeout> | undefined;

function render() {
  const { count } = screen.engine.streak;
  streakEl.textContent = `Streak: ${count} day${count === 1 ? "" : "s"}`;

  if (screen.mode === "correcting") {
    // The correct answer is shown outright - the Learner isn't being
    // quizzed again, they're retyping to practice it.
    promptEl.textContent = `${screen.wrongFact.a} × ${screen.wrongFact.b} = ${screen.correctAnswer}`;
  } else {
    promptEl.textContent = `${screen.engine.fact.a} × ${screen.engine.fact.b} = ?`;
  }

  typedAnswerEl.textContent = screen.typed || " ";
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
  screen = pressDigit(screen, digit);
  render();
}

function handleBackspace() {
  screen = pressBackspace(screen);
  render();
}

function handleEnter() {
  const { screen: next, outcome } = pressEnter(screen, deps);
  screen = next;

  switch (outcome.kind) {
    case "empty":
      return;
    case "correct":
      saveState(screen.engine);
      showOverlay(
        outcome.celebration === "milestone"
          ? `${screen.engine.streak.count}-day streak!`
          : outcome.celebration === "personal-best"
            ? "New personal best!"
            : "Correct!",
        outcome.celebration,
        CELEBRATION_DISPLAY_MS,
      );
      break;
    case "incorrect":
      saveState(screen.engine);
      // A brief flash, not a persistent cover: the correct answer itself
      // is shown by render() in the prompt for the whole "correcting"
      // mode, so the overlay must not sit on top of it for the duration
      // of the retype - that would hide the very thing the Learner is
      // meant to read and copy.
      showOverlay("Not quite — type the answer to continue", "none", WRONG_ANSWER_FLASH_MS);
      break;
    case "correction-dismissed":
      hideOverlay();
      break;
    case "correction-mismatch":
      // No engine change, no state to persist - just let the Learner
      // keep retyping (they can backspace their mistake).
      break;
  }

  render();
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
// up and it's how this screen gets tested.
document.addEventListener("keydown", (keyEvent) => {
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

render();
