// WebAudio synthesis for ticket #13's five audio moments (CONTEXT.md /
// the issue's feedback-matrix table). Deliberately NOT unit-tested the
// way celebrationQueue.ts is: there is no meaningful pure logic here to
// assert on without a real AudioContext, and jsdom doesn't provide one.
// The mute flag and lazy-init guard below are the only state; the rest
// is direct node wiring, kept in this one module so main.ts never touches
// an AudioContext or an oscillator directly.
//
// No audio asset files, no dependency: every sound is a handful of
// oscillator/gain nodes scheduled against the AudioContext's own clock,
// per the issue's explicit "synthesised via WebAudio, not shipped as
// asset files" commitment.
export type SoundKind = "correct" | "wrong" | "personal-best" | "range-expansion" | "milestone";

let ctx: AudioContext | null = null;
let muted = false;

// Browsers refuse to produce sound from an AudioContext that wasn't
// created/resumed inside a user-gesture handler. main.ts calls this from
// the Progress map's "Practice" tap (the landing flow's free gesture,
// CONTEXT.md) and, defensively, from the very first pointerdown/keydown
// anywhere, since a same-day return visit skips the map and lands
// straight on the quiz (route.ts's decideLanding), where the first
// keypad/keyboard press is the only gesture on offer instead.
export function initAudio(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return; // No WebAudio support. Sound is a nice-to-have, never a hard dependency for practicing.
  ctx = new Ctor();
}

export function setMuted(value: boolean): void {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

// A single tone: attack straight to `peak`, exponential decay to
// near-silence by `now + duration`. Exponential ramps can't target
// exactly 0 (they're a divide), so every envelope bottoms out at a tiny
// epsilon instead: inaudible, but keeps the Web Audio API happy.
function tone(
  audio: AudioContext,
  startAt: number,
  frequencyHz: number,
  duration: number,
  peak: number,
  type: OscillatorType = "sine",
): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequencyHz, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + Math.min(0.02, duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

// A tone that slides from one frequency to another, used for the
// personal-best "ascending chirp" and as a building block for the
// range-expansion swell.
function sweep(
  audio: AudioContext,
  startAt: number,
  fromHz: number,
  toHz: number,
  duration: number,
  peak: number,
  type: OscillatorType = "sine",
): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, startAt);
  osc.frequency.exponentialRampToValueAtTime(toHz, startAt + duration);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + Math.min(0.02, duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

// Correct: a short, soft tick, just present enough to confirm the tap
// landed, over almost before it's noticed.
function playCorrect(audio: AudioContext, now: number): void {
  tone(audio, now, 1046.5, 0.09, 0.18, "sine"); // C6
}

// Wrong: the sound that matters most in this file. Soft and low on purpose;
// the issue is explicit that a harsh buzzer teaches a nine-year-old to
// fear the app. One low sine tone, gentle volume, no harmonics-heavy
// waveform (square/sawtooth would read as a buzzer), longer and softer
// than the correct-tick rather than sharper.
function playWrong(audio: AudioContext, now: number): void {
  tone(audio, now, 196, 0.35, 0.1, "sine"); // G3, quiet and unhurried
}

// Personal best: brighter than the plain correct tick, and rising rather
// than static, the "ascending chirp" the table calls for.
function playPersonalBest(audio: AudioContext, now: number): void {
  sweep(audio, now, 700, 1400, 0.22, 0.22, "triangle");
}

// Range expansion: the loudest, richest sound in the app by deliberate
// design (the issue: "it's the only event that represents weeks of
// work"). A rising major-triad arpeggio (root-third-fifth-octave) layered
// with a low sweep underneath, at a higher peak gain than every other
// sound here. It's the one moment allowed to be big.
function playRangeExpansion(audio: AudioContext, now: number): void {
  const root = 261.6; // C4
  const notes = [root, root * 1.25, root * 1.5, root * 2]; // C-E-G-C
  notes.forEach((freq, i) => {
    tone(audio, now + i * 0.09, freq, 0.4, 0.32, "triangle");
  });
  sweep(audio, now, 110, 440, 0.5, 0.22, "sine"); // a low swell underneath the arpeggio
}

// Milestone (Streak x7): a short three-note fanfare, distinct in
// character from range-expansion's rising arpeggio so the two takeovers
// never sound alike even when they queue back to back.
function playMilestone(audio: AudioContext, now: number): void {
  const notes = [523.25, 659.25, 783.99]; // C5-E5-G5
  notes.forEach((freq, i) => {
    tone(audio, now + i * 0.12, freq, 0.3, 0.28, "square");
  });
  tone(audio, now + 0.36, 1046.5, 0.5, 0.3, "triangle"); // sustained C6 to land the fanfare
}

const PLAYERS: Record<SoundKind, (audio: AudioContext, now: number) => void> = {
  correct: playCorrect,
  wrong: playWrong,
  "personal-best": playPersonalBest,
  "range-expansion": playRangeExpansion,
  milestone: playMilestone,
};

export function playSound(kind: SoundKind): void {
  if (muted || !ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  PLAYERS[kind](ctx, ctx.currentTime);
}
