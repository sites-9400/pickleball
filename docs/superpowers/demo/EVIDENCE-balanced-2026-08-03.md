# Balanced mode — fairness audit (40 players, 4 courts, 5 hr)

**Date:** 2026-08-03
**Harness:** `test-this-mode` skill — real `app.html` `chooseMatchPlayers()` (balanced
branch) driven in a browser with Firebase stubbed. Two independent seeds.
**Scenario:** 40 players, **staggered arrivals** (16 present at start, 24 trickling
in over the first ~2 hrs), varied game lengths (~15 min avg), **mixed skill levels**
(12 beginner / 16 intermediate / 12 advanced). 5-hour (300 min) session.

## How Balanced actually works (app.html:2061 + tournament.js:86)

1. Take the **longest-waiting 4** free players (`getFreeWaiting`: `lastPlayedRound`
   asc, then queue order).
2. **Snake-pair those 4 by declared skill** (`skillBalancedTeams`) so each team's
   total skill is as even as possible.

There is **no anti-repeat opponent/partner logic** — unlike Numbering's
`fairWeightedMatch`. Selection is purely wait-order; only *team assignment* considers
skill.

## Results

| Metric | Seed 12345 | Seed 98765 | Read as |
|---|---|---|---|
| games played | 77 | 80 | ✅ matches a real night (~76) |
| **games-per-hour-present** min/max | 1.53 / 2.00 | 1.56 / 2.00 | ✅ everyone plays a fair share |
| games-per-hour sd | 0.11 | 0.14 | ✅ very tight |
| worst max-wait between games | 32 min | 32 min | ✅ nobody stuck |
| median max-wait | 28 min | 29 min | ✅ |
| gamesPlayed min/avg/max | 5 / 7.7 / 10 | 6 / 8.0 / 10 | ✅ tight, skew is arrival-driven |
| **opponent-pairs meeting 3+×** | **44** | **42** | ❌ high |
| **worst: most times two faced off** | **9** | **9** | ❌ high |
| **worst: most times two partnered** | **7** | **8** | ❌ high |
| distinct opponent pairs | 104 | 89 | — |
| on-deck queue depth | 3 | 3 | ✅ expected for non-Numbering |

### Comparison — Numbering (fair-weighted) baseline, same 40p/4court/5hr
| | Balanced | Numbering (new) |
|---|---|---|
| opponent-pairs met 3+× | **42–44** | **0** |
| worst faced-same-opponent | **9** | **2** |

## Verdict

**Balanced is very fair on the "do I get to play?" axis, and unfair on the "do I keep
facing the same people?" axis.**

- **Wait / games fairness: excellent.** Because it always seats the longest-waiting 4,
  games-per-hour-present sits at 1.5–2.0 for everyone (sd ~0.1) and no one waits more
  than ~half an hour, *even with staggered arrivals* — late arrivals slot straight in
  and get their proportional share. This is the mode's strength.

- **Opponent/partner variety: poor.** With no anti-repeat, the stable early cohort
  keeps recycling: 42–44 opponent-pairs met 3+ times and the worst pair faced off
  **9 times** over ~78 games (Numbering: 0 pairs at 3+, max 2). Skill snake-pairing
  makes it worse — it repeatedly yokes the same ADV↔BEG combinations together.

**When to use it:** groups who care about *even, competitive* games and playing-time
equity, and who don't mind seeing the same faces. **When not to:** groups who complain
about "I keep playing the same people" — Numbering is dramatically better there.

**Possible improvement:** graft Numbering's anti-repeat weighting onto the Balanced
candidate selection (pick from a longest-waiting *window* rather than the strict top-4)
before snake-pairing by skill — keeps skill-balance and wait-fairness while breaking up
repeats.

## Evidence
- `balanced-4courts-40players-5hr-courts.png` — live board, header "Doubles · Balanced",
  skill labels (ADV/INT/BEG) visible, snake-pairing on each court
- `balanced-4courts-40players-5hr-rankings.png`
- `balanced-4courts-40players-5hr-players.png`
