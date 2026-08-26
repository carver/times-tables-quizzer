# Times Tables Quizzer

A multiplication practice app for one nine-year-old. It drills multiplication facts, tracks how fast and how accurately each one comes back, and grows the range of facts as they get automatic. No timers, no pressure. Progress can optionally sync across a family's devices ([docs/adr/0006](docs/adr/0006-cross-device-sync-via-a-shared-secret-profile-id.md)); there's still no login, no account creation, no visible signup of any kind.

**Live: https://carver.github.io/times-tables-quizzer/** (whatever is on `main`)

## Running it

```bash
npm install
npm run dev
```

Local to the browser by default: no backend, no login. Progress lives in `localStorage`. Cross-device sync (docs/adr/0006) is opt-in. Turning it on is the only thing that talks to Firebase, and only a device that turns it on downloads the SDK.

| | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit tests (Vitest) |
| `npm run test:rules` | Firestore security rules + cloudSync, against the local Firebase emulator |
| `npm run test:e2e` | browser tests (Playwright, builds first; also starts the Firebase emulator) |
| `npm run test:all` | all three suites |

### Working on cross-device sync

`src/cloudSync.ts` defaults to Firebase's `demo-times-tables-quizzer` project ID, which only ever talks to a local emulator (`firebase-tools`, already a dev dependency), never a real cloud project. Developing and testing against it needs no Google account:

```bash
firebase emulators:start --only firestore,auth   # keep running in one terminal
npm run dev                                       # or npm run test:e2e / npm run test:rules
```

To point the app at a real Firebase project instead (creating one, enabling Firestore + Anonymous Auth, and deploying `firestore.rules` to it), run [`./scripts/setup_firebase.py`](scripts/setup_firebase.py) (Python 3, no extra packages needed). It's an interactive walkthrough for the parts only a human with a Google account can do. It writes the project's config to `.env.production` (see [`.env.production.example`](.env.production.example)) and also publishes it as GitHub repo variables, so the live GitHub Pages deploy gets real sync too, not only local dev.

That filename is deliberate, not plain `.env`: Vite only loads `.env.production` in "production" mode (plain `npm run build`). `npm run dev`, `test:e2e`, and `test:rules` all build or run in other modes, so they keep using the "demo-" emulator default above whether or not `.env.production` exists. A real project configured for deployment never leaks into local dev or test runs.

## Erasing all progress

Add **`#/reset`** to the URL:

```
https://carver.github.io/times-tables-quizzer/#/reset
```

That screen asks to confirm, then deletes every fact's history, the active range, the streak, and the days-practiced count. The app restarts as if opened for the first time.

It is linked from nowhere in the app and is only written down here, so you can hand a device over with a clean history without a reset button sitting where a nine-year-old will find it after a bad run. Progress is stored per browser, so each browser (and a private window) has its own. If this device was synced to a Profile (docs/adr/0006), resetting also detaches it from that Profile; otherwise the very next sync would redeliver the old progress right back.

## How it works

Three screens. The **Progress map** is home: a 12 × 12 grid with the conquered corner filled, shown on the first open of each day. The **quiz** is a prompt and a keypad. The **statistics** page has two grids, one for accuracy and one for fluency, darker meaning better.

Under that, one pure engine module owns all the logic: which fact to ask next, how fluency and accuracy are tracked, when the range expands, and what to celebrate. It's state-in / event-in → state-out / celebrations-out, with randomness and the clock injected, so it's tested without a DOM or a wall clock. Rendering, `localStorage`, audio, and cross-device sync all live outside it.

Sync (docs/adr/0006, opt-in from the Progress map's settings row) is a Firestore mirror of the same `localStorage` save, keyed by a Profile ID shared via a one-time pairing link. The engine itself never knows sync exists.

## Before you change anything

This project carries its reasoning in two places, and both exist because several decisions here look like bugs until you know why:

- **[`CONTEXT.md`](CONTEXT.md)** is the glossary. Fact, Attempt, Fluency, Accuracy, Mastered, Active range, Streak, Celebration, Profile. Use these words; each entry lists the synonyms to avoid.
- **[`docs/adr/`](docs/adr/)** holds the decisions worth defending:
  - Progression and celebration deliberately use *different* speed rules ([0001](docs/adr/0001-separate-progression-and-celebration-speed-rules.md))
  - A missed streak day is recovered by a chance roll, not a grace period ([0002](docs/adr/0002-probabilistic-streak-recovery.md))
  - A fact you just got wrong can't count as Mastered until you get it right again ([0003](docs/adr/0003-mastered-requires-redemption-after-a-wrong-attempt.md))
  - The statistics grids use two single-hue ramps, *not* red/green ([0004](docs/adr/0004-two-single-hue-ramps-for-the-statistics-grids.md))
  - Selection weights by the squared fluency ratio, and damps facts already practiced today ([0005](docs/adr/0005-weight-selection-by-the-squared-fluency-ratio.md))
  - Cross-device sync is a Profile-scoped Firestore document behind a shared-secret link, last-write-wins, replace-not-merge ([0006](docs/adr/0006-cross-device-sync-via-a-shared-secret-profile-id.md))

Work is tracked in GitHub Issues; see [`CLAUDE.md`](CLAUDE.md) and [`docs/agents/`](docs/agents/) for the conventions.

## Tuning

The numbers most likely to need adjusting after real use are all constants at the top of `src/engine/engine.ts`: the target speed, the per-digit typing allowance, the selection exponent and same-day damper, the decay rate, and the 90% mastery threshold. They're expected to move. The reasoning in the ADRs is what shouldn't.
