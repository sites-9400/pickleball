# Fixed-Teams Round-Robin & Bracket Modes — Design

**Date:** 2026-06-26
**Repo:** PickleDistrict-Modes (https://github.com/sites-9400/pickleball, Firebase `pickleball-255db`)
**Status:** Approved design — ready for implementation planning.

## Problem

The Modes variant has five matchmaking styles (waittime, balanced, random, manual, ladder).
None runs a **competition among fixed teams**: waittime/balanced/random re-pair teammates
every match; ladder keeps partners together but assigns them randomly and uses King-of-the-Court
rotation (no fixed schedule or bracket). Users want two new modes where teams are defined once
and stay fixed for the whole event:

1. **Round-robin** — every team plays every other team; ranked standings.
2. **Bracket** — single/double elimination knockout.

## Decisions (locked with the user)

| Topic | Decision |
|---|---|
| Team entry | Both: an **Auto-pair** button **and** manual assignment, then **Lock Teams**. |
| Round-robin passes | **Host chooses** single (1×) or double (2×) round-robin at setup. |
| Bracket elimination | **Host chooses** single or double elimination at setup. |
| Bracket seeding | **Manual seed order + Shuffle** button. Top seeds get round-1 byes when team count isn't a power of 2. |
| Court assignment | **Auto-fill open courts with manual override** (host can swap in a different eligible pending match). |
| Round-robin ranking | **Wins → point differential → points for** (matches existing leaderboard logic). |
| Build order | **Phased**: (1) team builder + round-robin, (2) single-elim, (3) double-elim, (4) viewer bracket diagram (optional). |

## How it fits the existing system

Two new `session.mode.matchmaking` values: **`roundrobin`** and **`bracket`** (both imply fixed
teams). Chosen on the dashboard at creation, like the existing five. **Format (singles/doubles)
still applies** — `teamSize()` = 1 or 2 — so a 1v1 round-robin or 2v2 bracket both work.

Architecture mirrors the existing **Ladder** pattern:

- A new state object **`tournament`** is the source of truth for teams, schedule/bracket, and
  results. Persisted via **`normTournament` / `cleanTournament`** (same `{_empty:true}` empty-array
  sentinel handling as `normLadder`).
- **Live matches still flow through the existing `courts` slots** (`team1`/`team2` player-id arrays
  + `startedAt`), so **`view.html` renders live courts with zero changes**, exactly like Ladder.
- Mode is read-only after creation: preserved through `update()`, never written by `saveState()`
  (same invariant as `ownerId`).
- A **Reset** action re-generates the tournament (keeps game history), like `resetLadder`.

## Components

### A. Team builder (shared by both modes)

Setup panel on the **Courts tab** when mode is `roundrobin`/`bracket` and the tournament has not
started (analogous to Ladder's "Start Ladder" panel).

- **Auto-pair** button → shuffles present players into teams of `teamSize()`; leftover (< a full
  team) is left unassigned for the host to handle.
- **Manual** → tap players to assign to teams; add/remove/rename teams.
- **Lock Teams** → requires ≥ 2 complete teams; advances to the mode-specific setup step.
- `tournament.teams = [{ id, players:[pid,...], name, seed }]`.

### B. Court mechanics (shared by both modes)

- `tournament` holds all pending matches (RR schedule entries or bracket nodes whose inputs are
  decided). Each match: `{ id, teamA, teamB, score1, score2, submitted, round }`.
- **Auto-fill with manual override:** when a court is open, the app places the next *eligible*
  pending match — one whose two teams are not currently on another court. The host can swap in a
  different eligible pending match on any open court.
- Starting a match copies its teams into a standard `courts` slot (`team1`=teamA players,
  `team2`=teamB players, `startedAt=now`). Scoring/submit/swap reuse the normal court flow.
- On submit: result is written back to the `tournament` match, stats + `gameHistory` updated once
  per match (same accounting as `saveLadderResult`), court freed, next eligible match auto-filled.

### C. Round-robin engine

- After Lock Teams: host picks **1× or 2×** → **Generate schedule** using the circle method →
  balanced rounds (a "round" = a set of matches with no shared team, runnable in parallel across
  courts). Odd team count → one team byes each round (dummy team in the circle).
- Matches auto-fill courts (Component B). Double round-robin = the single schedule repeated twice.
- **Standings** (team-level, on the Rankings tab): **Wins → point differential → points for.**
  Live-updates as scores submit.
- Complete when every scheduled match is submitted → final standings / champion shown.

### D. Bracket engine

- After Lock Teams: **arrange seed order** (move up/down) + **Shuffle** → pick **single/double
  elimination** → **Generate bracket**.
- Non-power-of-2 team count → **top seeds get round-1 byes** (bracket padded to next power of 2;
  byes auto-advance).
- Ready matches (both inputs decided) auto-fill courts; override allowed.
- On submit:
  - **Single elim:** winner advances to the parent node; loser is eliminated.
  - **Double elim:** loser drops to the losers' bracket; eliminated on second loss; winners'-bracket
    champion meets losers'-bracket champion in a grand final.
- **Read-only bracket display** (tree of matches + results) on the Rankings tab. Champion shown
  when the final resolves.

## Persistence

- `tournament` saved like `ladder`: `cleanTournament` for write (empty arrays → `{_empty:true}`),
  `normTournament` for read.
- All writes via `update()`; `mode` never written by `saveState()`.

## Viewer (`view.html`)

- Live courts + match history mirror **unchanged** (free — matches use `courts` slots).
- Read-only **round-robin standings** mirror included.
- Full **bracket diagram in the viewer is deferred** to a later pass (viewers still see live courts
  + history meanwhile).

## Edge cases

- Absent/deleted player mid-tournament: team still renders, missing name → `?` (same as Ladder;
  acceptable for testing).
- **Reset** re-generates teams/schedule/bracket; game history is kept.
- Fallback `startSession()` (app opened without a dashboard session) defaults to doubles/waittime —
  unaffected; these modes require selection at creation.
- Not enough players to form 2 teams → blocked with a toast at Lock Teams.

## Phased build order (implementation)

1. **Team builder + round-robin** (single & double pass) + standings + persistence.
2. **Single-elimination** bracket + bracket display.
3. **Double-elimination** bracket.
4. **Viewer bracket diagram** (optional polish).

Each phase is independently testable and shippable.

## Out of scope (possible future work)

- "Pool play → playoffs" (run round-robin, then seed a bracket by standings).
- Head-to-head tiebreakers in round-robin (chose simple diff-based ranking).
- Auto-pair by rating ("balanced" team formation) — v1 auto-pair is random; manual covers intent.
