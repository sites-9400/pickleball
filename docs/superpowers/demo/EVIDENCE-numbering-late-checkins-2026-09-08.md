# Numbering + late check-ins — browser evidence, 2026-09-08

Ran against the real `app.html` at `4da9b9a` (+ the QR-path fix below), Firebase stubbed,
Playwright. Driver: `.claude/skills/test-this-mode/scripts/sim-driver-late-checkins.js`.

**Scenario:** 40 players, 4 courts, 300-minute session, Numbering (`random`) doubles.
30 players present from the start; **10 check in mid-session** at minutes 45, 75, 105,
135, 165, 190, 215, 240, 262 and 280 — through the REAL `togglePresent()`, which is what
invokes `seedWaitClock()`. Every session is run twice on the same RNG seed, once with
`seedWaitClock` neutered (pre-fix baseline) and once with it live. **12 seeds**, averaged.

This driver improves on the stock `sim-driver.js` in one way that matters: it keeps the
real `courts` array populated, so `getActivePlayers()`/`getFreeWaiting()` genuinely exclude
players who are mid-game rather than merely down-weighting them.

## Result

| metric | OFF (pre-fix) | ON (shipped) | |
|---|---|---|---|
| **latecomer took the very next match** | **100%** | **40%** | fixed |
| latecomer draws until first game | 1.00 | 2.05 | fixed |
| latecomer games/hr | 2.387 | 2.266 | fairer |
| early-bird avg games | 9.197 | 9.238 | +0.04, negligible |
| early-bird SD | 0.709 | 0.717 | unchanged |
| early-bird spread | 2.75 | 2.92 | unchanged |
| opponent pairs meeting 3+ | 0 | 0.083 | noise |
| max faced same opponent | 2.00 | 2.08 | noise |
| partner pairs 2+ | 0.75 | 0.75 | unchanged |
| max same partner | 1.58 | 1.67 | noise |
| games per session | 80.2 | 80.2 | unchanged |

## What this proves

1. **The queue-jump was real and is fixed.** Pre-fix, a mid-session check-in took the very
   next match **100% of the time, across all 12 seeds and all 10 latecomers** — 120 for 120.
   With `seedWaitClock` it is 40%, and the average wait doubles. This is the direct
   confirmation the isolated weight calculation (~11,000:1) predicted.
2. **It does NOT fix games-played variance.** Early-bird SD 0.709 -> 0.717 and spread
   2.75 -> 2.92 are flat. The fix redistributes about 1.2 games across 30 players over a
   whole night. It is a correctness fix, not a fairness win — matching the Node-model
   finding recorded in `pickleball-fairness-open-question`.
3. **No anti-repeat regression.** A single seed initially showed `maxFacedSameOpp` 2 -> 3
   and `oppPairs3plus` 0 -> 1, which looked like a regression; across 12 seeds it averages
   2.00 -> 2.08 and 0 -> 0.083, i.e. one extra repeat pair in twelve simulated nights.
   Noise, not a regression. The 2026-08-03 Numbering baseline (0 pairs 3+, max faced 2)
   holds.

## Bug found and fixed during this run

`window._importCheckin` (app.html) — the **QR self-check-in path**, and the most common way
a latecomer actually checks in — did not call `seedWaitClock`. The original fix covered
`togglePresent` and `approveCheckin` but missed it, so QR arrivals kept jumping the queue.
Now covered, with a regression test in `tests/late-checkin-wait.test.js`.

## Screenshots

- `numbering-latecheckin-4courts-40players-5hr-courts.png` — live board. Queue visibly
  ordered by rounds idle; **Trina (2G, a latecomer) sits at position 20**, not position 1.
- `numbering-latecheckin-4courts-40players-5hr-players.png`
- `numbering-latecheckin-4courts-40players-5hr-rankings.png`

## Caveat

The console shows `PERMISSION_DENIED` on `saveState()` writes. Expected — the stub session
is not a real Firebase session. The simulation and every number above run off the in-memory
`players`/`courts`/`gameHistory` arrays, so the writes are irrelevant to the measurement.
