import "./style.css";
import { createInitialState, submitAttempt, type Dependencies, type EngineState } from "./engine/engine";
import { loadState, saveState } from "./persistence";

const INITIAL_ACTIVE_RANGE = { size: 5 };
const deps: Dependencies = { random: Math.random, now: Date.now };

function getEl<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!;
}

getEl<HTMLDivElement>("app").innerHTML = `
  <main class="quiz">
    <p class="streak" id="streak"></p>
    <p class="prompt" id="prompt"></p>
    <form id="answer-form" autocomplete="off">
      <input id="answer-input" type="number" inputmode="numeric" aria-label="Your answer" />
      <button type="submit">Submit</button>
    </form>
    <p class="feedback" id="feedback" aria-live="polite"></p>
  </main>
`;

const streakEl = getEl<HTMLParagraphElement>("streak");
const promptEl = getEl<HTMLParagraphElement>("prompt");
const formEl = getEl<HTMLFormElement>("answer-form");
const inputEl = getEl<HTMLInputElement>("answer-input");
const feedbackEl = getEl<HTMLParagraphElement>("feedback");

let state: EngineState = loadState() ?? createInitialState(INITIAL_ACTIVE_RANGE, deps);
let factShownAt = deps.now();

function render() {
  const { count } = state.streak;
  streakEl.textContent = `Streak: ${count} day${count === 1 ? "" : "s"}`;
  promptEl.textContent = `${state.fact.a} × ${state.fact.b} = ?`;
  factShownAt = deps.now();
}

formEl.addEventListener("submit", (submitEvent) => {
  submitEvent.preventDefault();

  const answer = Number(inputEl.value);
  const responseTimeMs = deps.now() - factShownAt;
  const result = submitAttempt(state, { type: "attemptSubmitted", answer, responseTimeMs }, deps);
  state = result.state;
  saveState(state);

  feedbackEl.textContent =
    result.celebration === "milestone"
      ? `${state.streak.count}-day streak!`
      : result.celebration === "personal-best"
        ? "New personal best!"
        : result.correct
          ? "Correct!"
          : "Not quite — try again!";
  feedbackEl.dataset.result = result.correct ? "correct" : "incorrect";
  feedbackEl.dataset.celebration = result.celebration;

  inputEl.value = "";
  inputEl.focus();
  render();
});

render();
