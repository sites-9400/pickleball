# Numbering mode — partner-repeat investigation (Jerrickson Aug 5 complaint)

**Date:** 2026-08-06 · **Branch:** main (live code) · **Harness:** /test-this-mode
(real `fairWeightedMatch` in `app.html`, Firebase stubbed, Playwright)

## The complaint (real session, Aug 5)
Session `-OzEU8KV6bCRmQ8BYgyE`, Numbering mode, ~16 active players, **2 courts**, 32 games.
Jerrick played 10 games; **7 distinct partners, 3 repeats** (TUPE Rd7+Rd25, TOTO Rd19+Rd26,
MARVIN Rd22+Rd32) while **9 players never partnered him**. His first 6 games were all fresh;
the back third (Rd25/26/32) were all repeats.

## Root cause (code)
`tournament.js` `fairWeightedMatch` draws 4 by wait-weight × repeat penalty:
`pen = 1/(1 + alpha*oppScore + beta*partScore)`, defaults **alpha=8, beta=1, decay=0.95**.
Partner-avoidance (β=1) is deliberately **8× weaker** than opponent-avoidance (α=8) — the
Aug-3 rework was tuned to kill *opponent* repeats ("partners were already fine"). The pain
has shifted to partners; the tuning is one-sided. `decay=0.95` also fades partner history
fast, so ~7–10-round-old partners return easily late in a night.

## Reproduction + A/B (40 trials each, 16p / 2 courts / 32 games)

| Config | repeat-partner instances | partner-pairs 2+ | avg distinct partners | Jerrick distinct | oppPairs 3+ | max faced | GP min–max |
|---|---|---|---|---|---|---|---|
| **β=1 (LIVE)** | 5.58 | 5.45 | 7.31 | 7.53 | 1.32 | 2.73 | 6.3–9.8 |
| β=5 | 4.92 | 4.85 | 7.39 | 7.40 | 1.52 | ~2.8 | 6.5–9.7 |
| β=12 | 3.73 | 3.70 | 7.54 | 7.45 | 1.90 | 2.85 | 6.7–9.8 |
| β=25 | 3.25 | 3.25 | 7.60 | 7.78 | 2.23 | 2.88 | 6.6–9.7 |
| β=12, decay=1 | 3.65 | 3.60 | 7.55 | 7.60 | — | — | 6.6–9.8 |

**Reads:**
- **Reproduced.** On the LIVE algo Jerrick averages ~7.5 distinct partners per ~8 games —
  i.e. partner repeats every night. His real 10-game night (7 distinct) sits in the tail.
- **β helps the repeat *rate*.** β=1→12 cuts repeat-partner instances **−33%** (5.58→3.73);
  β=25 → −42%. Knee is ~β=8–12 (diminishing returns after).
- **Fairness is NOT hurt.** Games-played spread (GP min–max) is unchanged — actually
  slightly tighter at high β. The feared wait-fairness trade-off did not appear.
- **Small opponent cost.** Pushing partner-avoidance mildly relaxes opponent-avoidance
  (they share the additive draw penalty): oppPairs-3+ 1.32→1.90 at β=12, but max-faced
  stays **< 3**. Acceptable trade.
- **decay=1 (full memory)** adds a little more (β=12: 3.73→3.65); secondary to β.

## Structural lever — more courts (16p / **3 courts** / 48 games)

| Config | avg distinct partners | Jerrick distinct | Jerrick GP |
|---|---|---|---|
| 2 courts, β=1 | 7.31 | 7.53 | 8.2 |
| **3 courts, β=1** | **9.77** | **10.18** | **12.5** |
| 3 courts, β=5 | 9.85 | 10.00 | 12.1 |

More courts raises the **distinct-partner ceiling**: everyone plays ~50% more games and
meets ~2.5 more different partners — independent of β. (The two levers are complementary:
β lowers the repeat rate; courts raise how many people you get to play with at all.)

## Recommendation
1. **β ≈ 8–12** in `fairWeightedMatch` opts (Numbering). Biggest partner-repeat cut before
   diminishing returns; fairness intact; opponent cost small (max-faced < 3).
2. **Run 3 courts** at ~16 players (your ~1-court-per-5–6 guideline). Cheapest, zero-code,
   helps every mode.
3. Optional: nudge `decay` toward 1 for a little extra partner memory.

**Not yet applied** — matchmaking-algo changes require explicit sign-off
(see memory: don't-touch-matchmaking-algo). This is evidence for a decision.

## Caveats
- Harness models court occupancy softly (via `lastPlayedRound` wait-weight; `courts[]` empty
  during the loop), identical across both β arms → A/B is fair. Absolute repeat *counts* scale
  with total games, so compare configs at equal game counts (done above).
- Matchmaking uses `Math.random`; all numbers are means over 40 trials.

Live board screenshot: `numbering-2courts-16players-live.png` (Doubles · Numbering, real roster).
Drivers: `.playwright-mcp/ab-driver.js`, `ab-driver2.js`.
