# Times Tables Quizzer

A multiplication practice app for one nine-year-old. It drills multiplication facts, tracks how fast and how accurately each one comes back, and grows the range of facts as they get automatic — no timers, no pressure, no accounts.

**Live: https://carver.github.io/times-tables-quizzer/** (whatever is on `main`)

## Running it

```bash
npm install
npm run dev
```

Everything is local to the browser — no backend, no login. Progress lives in `localStorage`.

| | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit tests (Vitest) |
| `npm run test:e2e` | browser tests (Playwright, builds first) |
| `npm run test:all` | both suites |

## Erasing all progress

Add **`#/reset`** to the URL:

```
https://carver.github.io/times-tables-quizzer/#/reset
```

That screen asks to confirm, then deletes every fact's history, the active range, the streak, and the days-practiced count. The app restarts as if opened for the first time.

It is linked from nowhere in the app and is only written down here — so you can hand a device over with a clean history without a reset button sitting where a nine-year-old will find it after a bad run. Progress is stored per browser, so each browser (and a private window) has its own.

## How it works

Three screens. The **Progress map** is home — a 12 × 12 grid with the conquered corner filled, shown on the first open of each day. The **quiz** is a prompt and a keypad. The **statistics** page has two grids, one for accuracy and one for fluency, darker meaning better.

Under that, one pure engine module owns all the logic: which fact to ask next, how fluency and accuracy are tracked, when the range expands, and what to celebrate. It's state-in / event-in → state-out / celebrations-out, with randomness and the clock injected, so it's tested without a DOM or a wall clock. Rendering, `localStorage`, and audio live outside it.

## Before you change anything

This project carries its reasoning in two places, and both exist specifically because several decisions here look like bugs until you know why:

- **[`CONTEXT.md`](CONTEXT.md)** — the glossary. Fact, Attempt, Fluency, Accuracy, Mastered, Active range, Streak, Celebration. Use these words; each entry lists the synonyms to avoid.
- **[`docs/adr/`](docs/adr/)** — the decisions worth defending:
  - Progression and celebration deliberately use *different* speed rules ([0001](docs/adr/0001-separate-progression-and-celebration-speed-rules.md))
  - A missed streak day is recovered by a chance roll, not a grace period ([0002](docs/adr/0002-probabilistic-streak-recovery.md))
  - A fact you just got wrong can't count as Mastered until you get it right again ([0003](docs/adr/0003-mastered-requires-redemption-after-a-wrong-attempt.md))
  - The statistics grids use two single-hue ramps, *not* red/green ([0004](docs/adr/0004-two-single-hue-ramps-for-the-statistics-grids.md))
  - Selection weights by the squared fluency ratio, and damps facts already practiced today ([0005](docs/adr/0005-weight-selection-by-the-squared-fluency-ratio.md))

Work is tracked in GitHub Issues; see [`CLAUDE.md`](CLAUDE.md) and [`docs/agents/`](docs/agents/) for the conventions.

## Tuning

The numbers most likely to need adjusting after real use are all constants at the top of `src/engine/engine.ts`: the target speed, the per-digit typing allowance, the selection exponent and same-day damper, the decay rate, and the 90% mastery threshold. They're expected to move — the reasoning in the ADRs is what shouldn't.
