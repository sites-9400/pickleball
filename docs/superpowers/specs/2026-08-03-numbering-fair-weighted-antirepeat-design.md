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
- **`K = 1` → fairness-leaning (chosen default):** long-waiters favoured, still random enough for variety.
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
decay = 0.85            // recent games weigh far more than old ones
```

When considering candidate `c` given already-chosen set `S`:

```
penalty(c, S) = 1 / ( 1 + α · Σ_{s∈S} oppScore(c,s) + β · Σ_{s∈S} partnerScore(c,s) )
candidateWeight = selWeight_c · penalty(c, S)
```

- **`α` (opponent avoidance) is the dominant term** — opponents are the sore point.
- `β` (partner avoidance) is smaller but non-zero so an *immediate* repeat partner is still discouraged.
- Defaults (tunable): `α = 3`, `β = 1`. These are starting points to be validated by simulation, not final.

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

### 4. Horizontal stacking — filling multiple courts / the on-deck queue

`rebuildMatchQueue()` already builds up to `MAX_QUEUED=3` on-deck matches by
calling the chooser in a loop, each call drawing from `getFreeWaiting()` (which
excludes players already committed to a court or an earlier on-deck match). This
**is** the horizontal/block fill: each match is a complete foursome taken from the
top of the wait-weighted stack, one game at a time.

Blocking is safe here (it was not, under naive FIFO) because wait-weighting keeps
just-finished players at the bottom of the stack and anti-repeat breaks up any
recent opponents who share a block. No change to the loop structure is needed —
only the per-match chooser changes.

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

## Rollout

- Single mode, behind no flag (Numbering already exists). Defaults ship in code.
- Constants (`K, α, β, γ, decay`) centralised at the top of the function for easy tuning after the next live session.
- Session-notes update: Numbering is no longer "fully random by user decision" — record the reversal and rationale.
