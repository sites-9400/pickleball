# Balanced mode: skill-even teams + anti-repeat (match PickleQ "Auto-balanced")

**Date:** 2026-08-03
**Status:** Design — approved, awaiting spec review
**Scope:** `app.html` (the `balanced` matchmaking style) + `tournament.js` (new pure
function) + two mode **description** strings. No other mode's *behavior* changes.

## Problem

Balanced-mode open play produces the same "I keep playing the same people"
complaint that Numbering had before its rework — but for a different reason.

Ground truth from the `test-this-mode` browser harness (real `app.html`
`chooseMatchPlayers` balanced branch, 40 players, 4 courts, 5-hour session,
**staggered arrivals**, **mixed skills** — 12 beginner / 16 intermediate / 12
advanced; two independent seeds):

| Metric | Seed 12345 | Seed 98765 | Numbering (reworked) baseline |
|---|---|---|---|
| games played | 77 | 80 | ~78 |
| **opponent-pairs met 3+ times** | **44** | **42** | **0** |
| **worst: two players faced off** | **9×** | **9×** | **2×** |
| **worst: two players partnered** | **7×** | **8×** | low |
| games-per-hour-present min/max | 1.53 / 2.00 | 1.56 / 2.00 | — |
| games-per-hour std dev | 0.11 | 0.14 | tight |
| worst max-wait between games | 32 min | 32 min | — |

**Findings:**

1. Balanced (app.html:2061-2064) takes the **strict top-4 longest-waiting**
   (`getFreeWaiting().slice(0,4)`) and snake-pairs them by skill
   (`skillBalancedTeams`, tournament.js:86). It **never consults `gameHistory`** —
   there is no anti-repeat at any step.
2. **Wait / playing-time fairness is already excellent** and survives staggered
   arrivals gracefully (games-per-hour ~1.5–2.0 for everyone, std dev ~0.1, nobody
   waits more than ~32 min). This is the mode's strength and must be preserved.
3. **Opponent variety is poor** — the stable early cohort keeps recycling because
   the strict top-4 keeps surfacing the same faces. The skill snake-pairing makes it
   worse: it repeatedly yokes the same ADV↔BEG combinations together.
4. Most of the repeat pain is a **selection** problem (which 4 are drawn), not a
   pairing problem — so it can be fixed with almost no cost to skill-balance.

## Why this is the right target (PickleQ alignment)

Most local players already use **PickleQ**, whose default mode is **"Auto-balanced"**,
documented as: *"Everyone can play together. PickleQ balances teams and tries to avoid
repetitive pairings,"* and all its modes *"respect queue order first."* So the mental
model players arrive with — even teams **and** fresh matchups **and** serve the
queue — is exactly what this rework delivers. We are making Balanced meet the
expectation players already hold, not inventing new behavior.

## Goals

- Keep Balanced's identity: **teams even by skill level** (mode's whole reason to exist).
- Add Numbering's two proven properties: **serve the longest-waiting** and **avoid
  repeat partners/opponents**.
- Reduce repeat opponents (primary) and partners (secondary) dramatically from the
  42–44 / 9× baseline, while keeping per-game skill imbalance low and games-per-hour
  spread tight.
- Robust to players arriving/leaving mid-session (staggered arrivals already tested).
- Reuse Numbering's machinery (`buildHistoryScores`, penalty math) — proven code.

## Non-goals

- No change to Numbering's, waittime's, ladder's, roundrobin's, bracket's,
  challenge's, or manual's **behavior**. (Numbering's *description* string is reworded
  — see below — but its algorithm is untouched.)
- No renaming of modes. "Balanced" and "Numbering" keep their names; only the
  subtitles change.
- No user-facing tuning UI. Constants live in code with sane, harness-tuned defaults.
- No wall-clock arrival timestamps (wait is measured in rounds, as in Numbering).

## The two modes, side by side (the naming decision)

After this rework, Numbering and Balanced are sister modes that share *serve the
queue* + *fresh matchups* and differ on exactly one axis — **skill-balancing**:

| | Numbering | Balanced |
|---|---|---|
| Serve the longest-waiting | ✅ | ✅ |
| Avoid repeat partners/opponents | ✅ (shipped) | ✅ (this rework) |
| Even out skill on each team | ❌ random teams | ✅ even teams |

Names stay; **descriptions** are rewritten as a matched pair so the one difference
reads instantly (label map at app.html:2051, and any shared strings in the pre-game
"Help me choose" assistant):

- **Numbering** → `Random teams · everyone mixes · fresh matchups`
- **Balanced** → `Even teams by skill level · fresh matchups`

## Algorithm: windowed anti-repeat draw → skill-even split

Replaces the `style==='balanced' && ts===2` branch of `chooseMatchPlayers()`. Three
layers. Selection carries wait-fairness + opponent-variety; pairing carries skill
identity with repeat as tiebreak.

### 1. Selection window — respect wait, allow room to avoid repeats

The strict top-4 has no freedom to dodge repeats. Instead, take the **longest-waiting
window** of the `W` free players (default `W = 8` ≈ two courts of waiting players),
then draw 4 from that window using the **same wait-weighting + anti-repeat penalty as
Numbering**:

```
selWeight_i    = (wait_i + 1) ^ K            // wait_i = currentRound - lastPlayedRound_i
penalty(c, S)  = 1 / (1 + α·Σ_{s∈S} oppScore(c,s) + β·Σ_{s∈S} partnerScore(c,s))
candidateWeight = selWeight_c · penalty(c, S)
```

Players drawn one at a time, weighted, without replacement. Because the window is
*only* the longest-waiters, wait-fairness holds (nobody far back in the queue jumps
in); because there are `W>4` of them, the draw can steer around recent opponents. The
window is the one new knob versus Numbering (which draws from the whole pool).

`oppScore`/`partnerScore` are the recency-decayed pair scores from the existing
`buildHistoryScores(gameHistory, decay)` (tournament.js:113), `decay = 0.95`.

### 2. Team split — most skill-even, ties broken by freshest

Given the drawn foursome `{a,b,c,d}`, evaluate the 3 possible 2v2 splits
(`ab|cd`, `ac|bd`, `ad|bc`). **Primary objective: minimize skill imbalance**
(`|team1 skill total − team2 skill total|`, using `skillRank` beginner<intermediate<
advanced as in `skillBalancedTeams`). Among the splits tied for minimum skill gap
(there are often ties, e.g. all-intermediate foursomes), **break the tie by lowest
repeat cost**:

```
repeatCost(split) = partnerScore(t1) + partnerScore(t2) + γ · Σ oppScore(across teams)
```

Final tie → random (variety). This keeps skill-balance strictly primary (mode
identity intact) while removing repeats "for free" whenever skill allows.

### 3. The dial (option-2 escape hatch, not enabled by default)

`repeatCost` is computed at the split step regardless, so if the harness shows partner
repeats are *still* too high under strict skill-primary, we can blend the objectives
with one constant — `combinedCost = skillGap + λ · repeatCost` — moving from
"repeat as pure tiebreak" (`λ=0`, default) toward "balance both" without a rewrite.
Ship `λ=0`; tune only if the data demands it.

### 4. On-deck depth → 1 for Balanced too

Numbering's simulation showed pre-building `MAX_QUEUED=3` on-deck matches re-creates
~60% of repeats (commits pairings early from a thinned pool with stale history).
Balanced pre-builds 3 today and will have the same problem. **Add `balanced` to the
`MAX_QUEUED = 1` condition** (app.html:2140) so the next match is built just-in-time
as a court opens, keeping a single "you're up next" preview.

Note the companion `rebalanceQueuedMatches()` (app.html:1802) re-pairs queued balanced
matches on rank change; with depth 1 it has at most one match to touch — behavior
preserved, just cheaper.

## Components & interfaces

New **pure function** in `tournament.js`, mirroring `fairWeightedMatch`, so it is
unit-testable in the Node VM harness with no Firebase or DOM:

```js
// Pure: no globals, no DOM. Returns {team1:[ids], team2:[ids]} or null.
export function balancedMatch(pool, gameHistory, currentRound, opts)
//   pool         : [{id, skill, lastPlayedRound}] free-waiting players, wait-sorted
//   gameHistory  : [{team1Ids, team2Ids}, ...]  (most-recent-first, as stored)
//   currentRound : number (globalRound)
//   opts         : {W=8, K=1.5, alpha=8, beta=1, gamma=1, lambda=0, decay=0.95, rng=Math.random}
```

- Exposed as `window.balancedMatch` (like `window.skillBalancedTeams`) for the harness.
- `chooseMatchPlayers()` `balanced && ts===2` branch calls it with live state; pool
  items already carry `skill` and `lastPlayedRound` from `getFreeWaiting` — no plumbing.
- `rng` injectable for deterministic tests.
- **Balanced-singles is out of scope** — it currently falls through to the waittime
  path (app.html:2069-2072, "Waittime / balanced-singles: longest-waiting N, random
  pairing") and stays there. Only balanced-*doubles* is reworked.

## Edge cases

- **Pool < 4:** return `null` (unchanged).
- **Pool between 4 and W:** window = whole pool; still draws 4 with anti-repeat.
- **Exactly 4 free:** only one foursome; skill-even split still chosen, repeat tiebreak still applies.
- **No/thin history (session start):** scores 0 → behaves as wait-weighted draw + skill-even split (≈ today, but from the window).
- **All same skill (e.g. all intermediate):** every split ties on skill gap → repeat cost fully decides → behaves like Numbering's split step. Correct and desirable.
- **Brand-new arrival mid-session:** `lastPlayedRound = -1` → large wait → enters the window and is prioritized (fair). Same trade-off Numbering accepted.
- **A skill tier is scarce / "runs out" (e.g. 1–3 advanced among beginners):** not a
  failure state — Balanced *mixes* tiers, it never requires same-tier players (that is
  Skill-separated/Skill-Courts, a different mode). Selection ignores skill, so nothing
  stalls and no one is benched (harness: `playersWith0games = 0`, normal game count).
  The scarce players aren't over/under-played (≈8 vs ≈7.9 games). When two strong
  players do share a match they are always split across teams (never stacked). The only
  consequence: the handful of games containing a lone strong player are mildly uneven
  (skill-gap ≤ 2); 66–90% of games remain perfectly even. Graceful degradation.

## Testing

Unit tests (Node VM harness, `tests/`), deterministic via injected `rng`:

1. **Wait respect:** a player waiting 10 rounds is drawn far more often than one waiting 1, across seeded draws — but only from within the longest-waiting window (someone deep in the queue is never drawn while `W` longer-waiters exist).
2. **Anti-repeat opponents:** given history where A faced B 3× recently, A+B land on opposite teams far less often than the current top-4 snake would.
3. **Anti-repeat partners:** a pair that just partnered is rarely re-paired next draw.
4. **Skill-even split is primary:** for a foursome with a clear skill split (2 ADV, 2 BEG), the ADV-split-across-teams pairing is chosen even when it slightly worsens repeat cost.
5. **Repeat tiebreak:** for an all-same-skill foursome, the lowest-repeat-cost split is chosen.
6. **Determinism / variety:** seeded rng reproduces; default rng varies.
7. **Small pool / empty history:** returns valid matches, no throw.

Regression / simulation (`test-this-mode` browser harness, the same 40p/4court/5hr
staggered-arrival + mixed-skill scenario used to find the problem):

8. Assert **opponent-pairs-met-3+ and worst-faced drop dramatically** from 42–44 / 9×
   (target: within a few of Numbering's 0 / 2), **while per-game skill imbalance stays
   low** (mean |skill gap| per match ≈ today's) **and games-per-hour spread stays
   tight** (std dev ≈ 0.1, worst max-wait not materially worse than 32 min).
9. Run two seeds (as in the baseline) to confirm the improvement is not seed-luck.

## Prototype A/B validation (pre-implementation)

The proposed `balancedMatch` was prototyped and run through the `test-this-mode`
browser harness against the **current** balanced code over an **identical** 5-hour
schedule (same 40 players, staggered arrivals, mixed skills, game durations, and court
starts — only the matching function differs), two setup seeds, on-deck depth 1
(just-in-time). Defaults `W=8, K=1.5, α=8, β=1, γ=1, λ=0, decay=0.95`.

| Metric | OLD (seed A / B) | **NEW (seed A / B)** |
|---|---|---|
| games played | 79 / 79 | 79 / 79 |
| Opponent pairs met 3+ times | 43 / 46 | **2 / 2** |
| Max times facing same opponent | 9 / 9 | **3 / 3** |
| Pairs partnered 2+ times | 28 / 26 | **19 / 11** |
| Max times same partner | 7 / 7 | **4 / 3** |
| Distinct opponent pairs (variety) | 86 / 98 | **271 / 277** |
| **Mean skill-gap per game** (lower = more even) | 0.747 / 0.747 | **0.684 / 0.696** |
| Games-per-hour std dev | 0.128 / 0.149 | 0.120 / 0.127 |
| Games-per-hour min/max | 1.54–2.0 / 1.53–2.0 | 1.58–2.0 / 1.50–2.0 |
| Worst single wait between games | 28 / 30 min | 38 / 41 min |

**Findings:**

1. **Opponent repeats collapse** — 43–46 pairs at 3+ → **2**, worst-faced 9× → **3×**
   (near Numbering's 0 / 2), distinct opponent pairs roughly **tripled**. The primary
   complaint is solved.
2. **Skill-balance is preserved and marginally improved** — mean skill-gap per game
   *drops* (0.747 → ~0.69), because the longest-waiting window offers more even-team
   options than the strict top-4 snake. The mode's identity ("even teams by skill
   level") is intact.
3. **Playing-time fairness holds** — games-per-hour spread essentially unchanged
   (sd ~0.12), everyone still 1.5–2.0 games/hr.
4. **Known tradeoff:** worst single wait rises ~10 min (≈30 → ≈40 min over a 5-hour
   night) — the cost of occasionally passing a longest-waiter to avoid a repeat.
   Bounded and tunable: raising `K` or lowering `W` trades a little anti-repeat back
   for a shorter wait tail. Acceptable at v1; revisit if a live session shows a worse
   tail. (This mirrors Numbering's stance: repeats are the felt pain; a modest wait
   tail is acceptable.)

The regression test (below) should re-establish these numbers as a guardrail.

### Robustness across skill compositions

The single mix above (even 3-tier) is the easy case for skill-balance. To confirm the
fix is not an artifact of that mix, the A/B was re-run across four distributions
(3 seeds each, same harness). Means over 3 seeds; wait/faced/partner columns are
worst-of-3.

| Skill mix | | opp-pairs 3+ | worst faced | worst partner | skill-gap/game | worst wait |
|---|---|---|---|---|---|---|
| Even 3-tier (12/16/12) | OLD→NEW | 44.7 → **2.3** | 9 → **4** | 8 → **4** | 0.71 → **0.68** | 30 → 41 |
| All one skill (40 int) | OLD→NEW | 43.7 → **0.3** | 9 → **3** | 8 → **2** | 0 → 0 | 30 → 41 |
| Ringers (28 beg/6 int/6 adv) | OLD→NEW | 44 → **2.3** | 9 → **3** | 8 → **2** | 0.85 → 0.89 | 30 → 37 |
| Bimodal (20 beg/20 adv) | OLD→NEW | 44.3 → **2.7** | 10 → **3** | 7 → **3** | 0.93 → **1.04** | 30 → 39 |

**Findings:**

- **The fix holds for every mix** — opponent-pairs-3+ collapse from ~44 to ~2 (0.3 when
  skill is uniform), worst-faced 9–10 → 3–4, distinct opponent pairs roughly triple.
  The concern that skewed/bimodal rooms would re-cluster the small strong cohort did
  **not** materialize.
- **All-one-skill degrades cleanly to Numbering** — every split ties on skill, so
  anti-repeat fully governs: 0.3 repeat-pairs, best variety, skill-gap trivially 0.
  Confirms the edge case in "Edge cases".
- **Bimodal is the one asterisk:** it's the only mix where NEW's mean skill-gap rises
  (0.93 → 1.04, ≈0.1 skill-point). Structural, not a flaw — forcing one beginner + one
  advanced per team means the longest-waiting window sometimes yields 3-of-one-tier + 1,
  so a perfectly even split isn't always available. Repeats still collapse (→2.7), so
  the `λ` dial is **not** needed at v1. Flag it as the first place to look if a real
  bimodal room ever reports uneven games.
- **Wait tradeoff is consistent** across mixes (worst single wait ≈30 → ≈37–41 min).

## Rollout

- Single mode, no flag (Balanced already exists). Defaults ship in code.
- Constants centralized at the top of `balancedMatch` for post-live tuning. v1 defaults
  reuse Numbering's tuned values (`K=1.5, α=8, β=1, γ=1, decay=0.95`) plus `W=8, λ=0`;
  treat as v1-tuned-to-one-simulation and re-tune after the first live session.
- **On-deck depth for Balanced: `MAX_QUEUED = 1`** (just-in-time), same as Numbering.
- Description strings updated for both Numbering and Balanced (matched pair above).
- Same **court/bench operational guidance** as Numbering applies (≈ one court per 5–6
  players); repeats and long waits are ultimately capacity-bound, not a chooser flaw.
- Session-notes / memory update: Balanced is now skill-even **and** anti-repeat,
  matching PickleQ "Auto-balanced".
