# Numbering mode: fair-weighted draw with anti-repeat opponents

**Date:** 2026-08-03
**Status:** Design — awaiting approval
**Scope:** `app.html` — the `random` (UI label "Numbering") matchmaking style only. No other mode changes.

## Problem

Players in Numbering-mode open play complain they get matched with the same
partners and, more often, the same **opponents** repeatedly.

Ground truth from session `-Oz0WBqbjehYBIihAW-A` (76 games, 33 players), parsed
from the live view and analysed against Monte-Carlo baselines:

| Metric | Observed | Pure-random baseline |
|---|---|---|
| Pairs partnered 2+ times | 19 | ~20 |
| Extra (duplicate) partnerships | 19 | ~23 |
| Opponent pairs met 3+ times | 12 | ~14 |
| Same exact foursome twice | 1 | — |
| Same exact match (same 2 teams) | 0 | — |

**Findings:**

1. The current algorithm is *memoryless uniform random* — `chooseMatchPlayers()`
   does `shuffle(pool).slice(0,4)` then `shuffle` to form teams (app.html:2066-2068).
   It never consults `gameHistory`, even though every record stores `team1Ids`/`team2Ids`.
2. Observed repeats sit **at or slightly below** the pure-random baseline. So the
   repeats are the natural clustering of memoryless random, **not** a bug and **not**
   caused by the on-deck queue shrinking the pool (that hypothesis was tested and
   rejected — if it were true, repeats would exceed the baseline).
3. **Partners were already fine** (nobody had the same partner 3+ times). The real
   pain is **repeat opponents**: Tweetums, Ja9, Edgarfield, and Elmarie each faced
   one specific opponent **4×** in 10–13 games.
4. A secondary fairness gap: Numbering ignores wait time entirely (it shuffles the
   whole pool), so play time is not balanced.

## Goals

- Reduce repeat opponents (primary) and avoid immediate repeat partners (secondary).
- Balance play time fairly **without** punishing early arrivers.
- Preserve a sense of randomness/variety — this is not a rigid rotation.
- Keep it robust to players arriving and leaving mid-session.
- Change **only** Numbering mode. Extract the logic as a pure, unit-testable function.

## Non-goals

- No wall-clock arrival timestamps (not tracked, not needed — see below).
- No changes to waittime / balanced / ladder / roundrobin / bracket / challenge / manual.
- No user-facing tuning UI in this iteration (constants live in code with sane defaults).

## Fairness metric: rounds waited, not games played

Raw `gamesPlayed` is unfair to early arrivers (it penalises them for games they
earned by showing up). The arrival-fair substitute is:

```
wait_i = currentRound - lastPlayedRound_i      // never-played => lastPlayedRound = -1 => large wait
```

Serving longest-waiters first automatically makes total games ∝ time present
(early birds get more games; nobody sits too long) **without** tracking arrival
time. `queueOrder` (arrival order) is the tie-breaker for equal waits.

## Algorithm: fair-weighted draw + anti-repeat

Replaces the `style==='random'` branch of `chooseMatchPlayers()`. Two layers:

### 1. Who plays next — wait-weighted selection

Each free-waiting player gets a selection weight that grows with wait:

```
selWeight_i = (wait_i + 1) ^ K
```

- `K = 0` → pure random (today).
- **`K = 1.5` → fairness-leaning (chosen default):** long-waiters favoured, still random enough for variety.
- `K → ∞` → strict longest-wait-first (fair but rigid, re-introduces clustering).

Players are drawn **one at a time, weighted, without replacement** to form the
foursome. After the first (seed) pick, each subsequent candidate's weight is
multiplied by an anti-repeat penalty against the players already chosen (below),
so the group is biased toward people who have *not* recently played together.

### 2. Anti-repeat — recency-weighted opponent/partner penalty

From `gameHistory` (which stores `team1Ids`/`team2Ids`), compute recency-decayed
scores for each unordered player pair `(a,b)`:

```
oppScore(a,b)     = Σ  decay ^ gamesAgo   over past games where a,b were opponents
partnerScore(a,b) = Σ  decay ^ gamesAgo   over past games where a,b were partners
decay = 0.95            // recent games weigh more, but memory reaches ~3x further back than 0.85
```

When considering candidate `c` given already-chosen set `S`:

```
penalty(c, S) = 1 / ( 1 + α · Σ_{s∈S} oppScore(c,s) + β · Σ_{s∈S} partnerScore(c,s) )
candidateWeight = selWeight_c · penalty(c, S)
```

- **`α` (opponent avoidance) is the dominant term** — opponents are the sore point.
- `β` (partner avoidance) is smaller but non-zero so an *immediate* repeat partner is still discouraged.
- Defaults (tuned by simulation, see below): `α = 8`, `β = 1`.

Penalty only *biases* the weighted draw; it never hard-excludes, so the mode
still functions when the pool is small or history is dense.

### 3. Team split — pick the freshest 2v2

Given the drawn foursome `{a,b,c,d}`, evaluate the 3 possible splits
(`ab|cd`, `ac|bd`, `ad|bc`) and score each by the partnerships **and** the
cross-team opponent matchups it would create:

```
splitCost = partnerScore(team1) + partnerScore(team2) + γ · Σ opponentScore(across teams)
```

Choose the minimum-cost split, breaking ties randomly (keeps variety). `γ`
weights opponent-freshness in the pairing step (default `γ = 1`).

### 4. Horizontal stacking + on-deck depth (IMPORTANT — corrected by simulation)

`rebuildMatchQueue()` currently pre-builds up to `MAX_QUEUED=3` on-deck matches.
Each match is a complete foursome drawn from the top of the wait-weighted stack —
the horizontal/block fill. **But depth matters a great deal, and simulation showed
the current depth of 3 is wrong for this algorithm.**

Pre-building commits pairings *early*, from a pool thinned by the reserved on-deck
players, using *stale* history (before the in-flight games finish). For an
anti-repeat + wait-fairness algorithm that is corrosive. Measured effect on
repeat-opponent pairs (session replay, 30 seeds; today's actual was ~12):

| on-deck depth | opp pairs met 3+ |
|---|---|
| 0 (just-in-time) | ~0.8 |
| **1 (chosen)** | **~1.4–2.0** |
| 2 | ~3.4 |
| 3 (today's app) | ~7–8  ❌ loses ~60% of the benefit |

**Decision: set `MAX_QUEUED = 1` for `random` (Numbering) mode** — generate the
next match just-in-time as a court opens, keeping a single "you're up next"
preview. Depth 0 is marginally better on anti-repeat but shows no preview and has
a slightly longer wait tail; depth 1 keeps ~85% of the gain plus the preview. This
result is timing-robust: it holds under fixed 15-min games and random 10–25-min
games with staggered court starts (the algorithm keys off game count/history, not
the clock). Other modes keep their existing `MAX_QUEUED`.

## Components & interfaces

Extract a **pure function** (mirroring the existing `window.skillBalancedTeams`)
so it is testable in the Node VM harness with no Firebase:

```js
// Pure: no globals, no DOM. Returns {team1:[ids], team2:[ids]} or null.
window.fairWeightedMatch(pool, gameHistory, currentRound, opts)
//   pool         : [{id, lastPlayedRound, queueOrder}] free-waiting players
//   gameHistory  : [{team1Ids, team2Ids}, ...]  (most-recent-first, as stored)
//   currentRound : number (globalRound)
//   opts         : {K=1, alpha=3, beta=1, gamma=1, decay=0.85, teamSize=2, rng=Math.random}
```

- `chooseMatchPlayers()` `style==='random'` branch calls this with live state.
- `rng` is injectable so tests are deterministic.
- Singles (`teamSize=1`): selection + anti-repeat opponent logic still apply; the
  team-split step is trivial (1v1), so only `oppScore` matters.

## Edge cases

- **Pool < 4 (doubles) / < 2 (singles):** return `null` (unchanged behaviour).
- **Exactly 4 free:** only one foursome; still pick the freshest team split.
- **No/!thin history (session start):** scores are 0 → behaves as pure wait-weighted random.
- **Brand-new arrival mid-session:** `lastPlayedRound = -1` → large wait → prioritised (fair). Acceptable; note as a tuning point if a late rush ever starves regulars.
- **Byes / odd counts:** handled upstream by `getFreeWaiting`/queue as today; the chooser only ever sees whole foursomes.

## Testing

Unit tests (Node VM harness, `tests/`), deterministic via injected `rng`:

1. **Fairness:** with equal history, a player waiting 10 rounds is selected far more
   often than one waiting 1 round across many seeded draws.
2. **Anti-repeat opponents:** given history where A faced B 3× recently, A+B end up
   on opposite teams far less often than chance.
3. **Immediate partner repeat:** a pair that just partnered is rarely re-paired next draw.
4. **Team split:** for a fixed foursome with known history, the lowest-cost split is chosen.
5. **Small pool / empty history / singles:** returns valid matches, no throw.
6. **Not deterministic:** with default `rng`, repeated calls on the same pool vary.

Regression / simulation:

7. Replay a synthetic multi-court session (and/or re-simulate the 76-game session)
   and assert repeat-opponent and repeat-partner metrics drop meaningfully below the
   pure-random baseline documented above, while wait-time variance also drops.
   Reuse the Monte-Carlo analysis already written for this investigation.

## Simulation validation (pre-implementation)

A faithful replay of session `-Oz0WBqbjehYBIihAW-A` was built: 33 real players,
4 courts, 76-game target, **arrivals/departures derived from each player's first/last
appearance** (staggered — 22 arrive by round 9, last at round 35). Both the current
and proposed algorithms were run through the **same discrete-event scheduler** and
averaged over 40 seeds. The current-algorithm arm reproduced today's actual numbers
(opp-pairs-3+ 12.1 vs 12 actual; max-faced-opp 4.1 vs 4), confirming the model.

| Metric (avg, 40 seeds) | Current random | **Proposed (K1.5 α8 d.95)** |
|---|---|---|
| Opponent pairs met 3+ times | 12.1 | **0.68** |
| Max times facing same opponent | 4.1 | **2.45** |
| Repeat-partner games (of ~9) | 1.29 | **0.45** |
| Players with 0 repeat partners | 9.7 / 33 | **21.0 / 33** |
| Distinct partners (variety) | 7.5 | **8.4** |
| Distinct opponents (variety) | 13.2 | **15.9** |
| Worst wait between games (rounds) | 26.6 | **16.5** |

Findings that shaped the tuning: `decay` (memory length) is the biggest lever;
`0.85 → 0.95` is what eliminates the 4×-opponent cases. Variety **increases** (more
distinct partners/opponents), so anti-repeat does not make play feel scripted. The
recommended config captures ~95% of the maximum achievable gain found in a 360-config
sweep, while staying less extreme than the top config (avoids overfitting to one session).

Simulation scripts live in the session scratchpad; the regression test (below) should
re-establish these numbers as a guardrail.

### Rejected: starvation guard

A "force-seat anyone waiting past N rounds" guard was simulated and **rejected**. To
shrink the wait tail meaningfully it must fire almost every game, which collapses the
draw into FIFO and pushes repeat-opponents *above* today's level. A gentle cap barely
helps. Long waits are a **capacity** limit (too many players for the courts), not a
matchmaking flaw — wait-weighting (`K`) already distributes waits as fairly as
possible. Fix waits operationally (below), not in the chooser.

### Operational guidance (belongs in organizer docs, not code)

Repeats and long waits are ultimately bounded by the **bench** = players not on a
court. Simulation across sizes shows the algorithm needs a bench of ~10–12 to work;
below that (players ≈ 4 × courts) the waiting group has no choice and repeats are
forced regardless of software. Rule of thumb — about **one court per 5–6 players**:

| Players | Best # courts |
|---|---|
| 30 | 5 |
| 35 | 6 |
| 40 | 6–7 |

Too many courts (bench < 8) spikes repeats; too few (bench > 20) means long waits and
little play. For the ~33-player sessions this feature targets, **5 courts** is the
sweet spot (today's 4 left too big a bench and more sitting than necessary).

### Replay of today under the full plan

A replay of the real session (33 players, real attendance windows, 4 courts, on-deck
depth 1, variable 10/15/20/25-min games, staggered starts, **hard 5-hour cap
4pm–9pm** — court paid by the hour) produced, for one seed: **1 opponent pair met 3+
times** (today: 12), **max faced same opponent 3** (today: 4), **25/33 players with
zero repeat partners** (today: 10), 62 games (today: 76 — the model's 17.5-min
average game vs the real ~15.8 is a throughput artifact). 40-seed averages: ~1–2
opponent pairs met 3+, max faced ~2.4. See `2026-08-03-today-under-new-plan.txt`.

## Rollout

- Single mode, behind no flag (Numbering already exists). Defaults ship in code.
- Constants centralised at the top of the function for easy tuning after the next live session. Tuned defaults: `K=1.5, α=8, β=1, γ=1, decay=0.95`.
- **On-deck depth for Numbering: `MAX_QUEUED = 1`** (just-in-time). No starvation guard.
- Session-notes update: Numbering is no longer "fully random by user decision" — record the reversal and rationale.
- Organizer-facing: add the court/bench guidance above to the how-to docs.
