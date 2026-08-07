# Recover a missed Streak day probabilistically, not with a fixed grace period

A plain "miss a day, Streak resets to zero" was the initial design, chosen for simplicity. It was deliberately replaced with a variable-ratio recovery mechanic: after missing days, each subsequent Attempt has a `1 / (missed days + 1)` chance of recovering the Streak (continuing it, never backfilling the missed days). This intentionally borrows the "variable-ratio reward schedule" mechanic games (and gambling) use because it's an unusually effective consistency incentive — the trade-off is a Streak's fate becomes non-deterministic rather than a simple rule to track.

To keep the mechanic from ever punishing genuine effort, "missed days" is frozen while the Learner is actively practicing but hasn't yet won a recovery roll — only days with zero Attempts count against them — and there's no cap on retries, so persistence always eventually recovers the Streak.

Considered and rejected: a fixed N-day grace period (simpler, but loses the engagement value and still requires tracking "have I used my grace day"); a flat recovery percentage regardless of days missed (doesn't scale difficulty with the size of the gap).
