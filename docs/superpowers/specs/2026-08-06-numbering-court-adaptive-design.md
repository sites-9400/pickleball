# Court/bench-adaptive matchmaking (Numbering + Balanced)

**Date:** 2026-08-06
**Status:** Design approved, ready for implementation plan
**Scope:** Numbering (`mm() === 'random'`) and Balanced doubles (`mm() === 'balanced'`).
Other modes untouched.
**Origin:** Jerrickson's Aug 5 session (2 courts, ~11–16 players) — repeat-partner complaint.
Investigation in `docs/superpowers/demo/EVIDENCE-numbering-partner-repeats-2026-08-06.md`.

## Problem

Numbering's `fairWeightedMatch` (shipped 2026-08-03) was tuned once, for one big night,
to fix *opponent* repeats. Its partner-avoidance is weak and its settings are fixed
regardless of how many courts or players are present. Real nights vary enormously —
7 players on 1 court behaves nothing like 39 players on 4 courts — and one fixed setting
can't serve both. Players now feel **partner** repeats, especially back-to-back.

## Goals

1. Reduce repeat partners on healthy-turnout nights.
2. Never pair the same two players in **back-to-back** games (whenever any alternative exists).
3. Keep games-played turns fair, tightening them on big nights where it's free.
4. Do no harm on thin nights (few players) — repeats there are a capacity limit, not a
   tuning problem; the system should not meddle or worsen opponents.
5. Small, well-tested change to the existing algorithm — no new selection logic.

## The single driver: "healthy pool?"

All adaptive choices key off one derived condition, computed live from session state:

```
present  = number of present (checked-in, not absent) players
courts   = courtDefs.length
bench    = present − 4 × courts          // players waiting when all courts are full
healthy  = present ≥ 12  AND  bench ≥ 3
```

Rationale (from simulation, 30–40 trials per point): anti-repeat tuning only produces
real partner variety once the pool is rich enough to give the draw genuine choice —
about 12+ present with a few players on the bench. Below that, repeats are forced by
capacity and stronger tuning only adds opponent repeats.

## The four adaptive settings

| Setting | Rule | Purpose |
|---|---|---|
| **"Up Next" preview** | Show only at `courts ≥ 4` | The visible on-deck card only helps when many courts finish often; below that, players don't see a locked-in next match. **Display-only** — see note. |
| **β — partner anti-repeat** | `healthy → 12`, else `1` | Strengthen partner-mixing only when the pool can support it. |
| **decay — history memory** | `1` always | Remember partnerships across the whole session (was 0.95, which faded them too fast). |
| **K — wait-time strictness** | `healthy → 4`, else `1.5` | Be strict about "longest wait plays next" on big nights (free — tightens turns without hurting variety); relaxed on small nights (protects the back-to-back guarantee). |

Note β and K share the same `healthy` gate: a night is either rich enough for both, or
thin and left gentle.

**"Up Next" is display-only, not a queue-depth change.** The seat flow
(`generateMatchForCourt` → `rebuildMatchQueue` → `matchQueue.shift()`) bails when the
queue is empty, so the app must always keep at least one match ready internally or courts
on 1–3 court nights can't be filled. Therefore `MAX_QUEUED` stays `1` for Numbering; the
adaptive rule only **hides the "Up Next" card in the UI** when `courts < 4`. This is
cosmetic — it does not change who is seated or when. The repeat/fairness gains come
entirely from β, decay, K, and the blocker; the internal 1-deep queue (already validated
as the good baseline — depth 3 re-created repeats, depth 1 did not) is unchanged.

## Always-on: recent-partner blocker

Independent of `healthy`. In `fairWeightedMatch`'s split step (choosing how to pair the
4 drawn players into 2v2), **hard-avoid any pair that appeared in the last 3 games**
(`gameHistory[0..2]`). Selection order among the 3 possible splits:

1. Fewest pairs that are "recently seen" (the block).
2. Then the existing freshness cost (partner-repeat + opponent-repeat).
3. Then random tiebreak.

If every split reuses a recent pair (tiny pool), fall back to the least-bad one — the
blocker never stalls the queue and never returns `null`. Because any given pair appears
in only one of the three splits, a single recent pair can always be avoided; back-to-back
repeats effectively go to zero whenever the drawn four allow it.

This layers on β: β makes repeats *unlikely*; the blocker makes a *recent* repeat
*impossible* whenever an alternative exists. It changes only how the 4 are paired, never
who plays — so it has no effect on games-played fairness.

## Why these numbers (evidence summary)

Simulated on the real `fairWeightedMatch` via the `/test-this-mode` harness, comparing
Old (β1, decay .95, K1.5, on-deck 1) vs New (this spec):

- **Healthy nights** (14p/2ct, 20p/3ct, 39p/4ct): repeat-partner instances fall ~40–90%;
  distinct partners up; opponents stay safe (nobody faces the same person >3× on the big
  nights); games-played spread equal or tighter.
- **Back-to-back repeats** at 7p/1ct: ~3 per session → **0** with the blocker; total
  repeats unchanged (still unavoidable) but spread out.
- **Thin night** (7p/1ct): New ≈ Old by design — β stays at 1, nothing forced.
- **Adaptive K:** on a big night it tightens games-played noticeably at almost no variety
  cost; on a small night high K would *re-create* back-to-back repeats, which is why K
  stays low there.

## Balanced mode (doubles)

Balanced shares the same shape (draw players, then split into two teams), so it gets the
same treatment — with one rule that protects its identity: **skill-even teams stay the
top priority.**

- **Same adaptive config.** The `healthy` gate feeds `balancedMatch` the same
  `{ beta, decay, K }` (β 12/1, decay 1, K 4/1.5). Balanced draws from its longest-waiting
  window `W` (unchanged).
- **Blocker as a tie-break, not an override.** `balancedMatch` already chooses the most
  skill-even 2v2 split and breaks ties by repeat cost (`tournament.js:226-227`). Insert the
  recent-partner blocker into that tie-break: among the splits with the **minimum skill
  gap**, prefer those that avoid a last-3-games pair, then the existing repeat cost, then
  random. Skill balance is never sacrificed (tolerance 0) — the blocker only decides
  between splits that are *already equally balanced*.
- **Same "Up Next" display rule** (hide below 4 courts) and internal `MAX_QUEUED` of 1.

Why tie-break-only is enough (evidence, 16p/2ct, mixed skill, 40 trials): mixed-skill
pools usually offer several equally-balanced splits, so the blocker has room to work
without loosening balance. Result vs today: **team skill gap unchanged (0.58 vs 0.60),
back-to-back repeats −42% (4.4 → 2.6), total repeats −38%, turns tighter.** Because it
never trades away balance, no tolerance knob is needed.

## Implementation sketch

`app.html` (helper + two call sites + render) and `tournament.js` (both match functions):

1. **`app.html` — new helper** `adaptiveConfig()` returning `{ beta, decay, K }` from
   `presentPlayers().length` and `courtDefs.length` per the `healthy` rule above. Shared
   by both modes. ("Up Next" visibility is a separate direct `courtDefs.length >= 4` check
   at render time.)
2. **`app.html:2242`** (`chooseMatchPlayers`, `random` branch): pass
   `{ teamSize: ts, ...adaptiveConfig() }` into `fairWeightedMatch`.
3. **`app.html:2238`** (`chooseMatchPlayers`, `balanced` branch): pass
   `adaptiveConfig()` into `balancedMatch` (currently `{}`).
4. **`app.html` — "Up Next" render**: hide the on-deck card when
   `(mm() === 'random' || mm() === 'balanced')` and `courtDefs.length < 4`. Leave
   `MAX_QUEUED` at `1` (internal seat flow depends on a ready match). Don't touch other modes.
5. **`tournament.js` `fairWeightedMatch`** (split step ~L165): add the recent-partner
   blocker as the primary sort key over the existing split cost. New `blockWindow` option
   (default 3); `0` disables (preserves current output for callers/tests).
6. **`tournament.js` `balancedMatch`** (split step ~L226): among the minimum-skill-gap
   splits, add the recent-partner blocker ahead of the existing repeat-cost tie-break.
   Same `blockWindow` option/default. Skill gap remains the top sort key (no balance loss).

Non-goals: no change to opponent handling (`alpha`), no change to Balanced's skill-balance
priority or draw window `W`, no change to other modes, no change to the draw's core
weighted-selection math beyond the `K` value.

## Testing

- **Unit** (`tests/fair-match*.test.js`):
  - `fairWeightedMatch` blocker avoids a last-3-games pair when an alternative split
    exists; falls back without error when all are blocked; `blockWindow: 0` reproduces
    current output.
  - `balancedMatch` still returns a **minimum-skill-gap** split (balance never sacrificed),
    but breaks skill-ties toward non-recent partners; `blockWindow: 0` reproduces current
    output.
  - `adaptiveConfig()` returns correct `{ beta, decay, K }` at the boundaries (11 vs 12
    players; 3 vs 4 courts; bench 2 vs 3).
- **Session** (`/test-this-mode`): re-run the reference scenarios for **both** modes —
  Numbering at 7p/1ct, 14p/2ct, 20p/3ct, 39p/4ct; Balanced with a mixed-skill roster at
  16p/2ct — and confirm the evidence numbers hold on the wired path (esp. Balanced's skill
  gap unchanged).

## Risks

- **Thin-night expectations:** the change deliberately does little at <12 players.
  Messaging to organizers: for more variety, more players is the lever (a 3rd/4th court
  needs the bodies to fill it). Not a code fix.
- **All-present assumption:** simulations assume everyone present the whole session; real
  come-and-go nights run somewhat worse in absolute terms, but the Old→New improvement
  holds relatively.
