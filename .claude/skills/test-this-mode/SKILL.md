---
name: test-this-mode
description: >
  Stress-test a Paddle District matchmaking mode by driving the REAL app.html in a
  browser (Playwright) with Firebase stubbed, running a realistic full-session
  simulation, and auditing partner/opponent repeats + fairness. Use this whenever
  the user wants to test, validate, verify, benchmark, or "see" how a matchmaking
  mode (Numbering, By wait time, Balanced, King of the court, Challenge courts,
  Round robin, Bracket, Manual) behaves over a real open-play session — e.g. "test
  the numbering mode", "how does balanced hold up with 40 players", "simulate a
  5-hour night on this mode", "check for repeat partners", or before shipping any
  matchmaking change. Produces screenshots of the live board as shareable evidence.
---

# Test This Mode

A reusable harness to prove how a matchmaking mode behaves over a full open-play
session, using the **real** `app.html` code (not a reimplementation) driven in a
real browser. Born from the 2026-08-03 Numbering rework, where players complained
of repeat opponents and we needed browser-level evidence, not just unit tests.

## Why this exists / what it proves

Unit tests check functions in isolation. This harness answers the questions
organizers actually ask: *over a real 5-hour night with N players and C courts, how
often do people get the same partner or opponent, and does everyone play a fair
number of games?* It boots the genuine app, runs the genuine `chooseMatchPlayers`
for the chosen mode, and audits the resulting `gameHistory`.

## Default scenario (match real conditions)

- **40 players, 4 courts, 5-hour (300 min) session**, staggered court starts,
  game lengths ~15 min avg → ~76–79 games (today's real night was 76).
- Change players/courts/session in `scripts/sim-driver.js` (the `NCOURTS`,
  `SESSION`, `NAMES` tunables). For ~40 players, 5 courts is the recommended
  real-world setup; 4 courts is what was physically used and a good stress case.

## Procedure

1. **Serve the branch locally** (relative imports of `tournament.js`/`cohost.js`/
   `common.js` need a server; `file://` won't load ES modules):
   ```bash
   python3 -m http.server 8099   # run from the repo root, in the background
   ```
   Confirm: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8099/app.html` → `200`.
   Make sure you're on the branch whose code you want to test (`git branch --show-current`).

2. **Boot the app with Firebase stubbed.** Read `scripts/firebase-stub.js`, set
   `MODE` (and `FORMAT`) at the top to the mode under test, and pass the whole
   function to `mcp__playwright__browser_run_code_unsafe`. It intercepts the three
   Firebase ESM imports, signs in a fake owner, feeds one owner-owned session in
   the chosen mode, and returns `{booted, mode, owner, fairWired}`. Verify
   `booted:true` and `mode` matches. (The app redirects to index.html without a
   `?session=` param and without auth — the stub handles both.)

3. **Run the session simulation.** For queue-style modes (Numbering/`random`,
   `waittime`, `balanced`): read `scripts/sim-driver.js`, adjust tunables if
   needed, and pass it to `browser_run_code_unsafe`. It drives the real
   `chooseMatchPlayers` over a 5-hour discrete-event schedule, then returns an
   `audit`. See **Mode caveats** for score-driven modes.

4. **Screenshot the evidence.** The driver leaves a live round seated on the
   Courts tab. Capture with `mcp__playwright__browser_take_screenshot`
   (`fullPage:true`). Also switch to Players and Rankings tabs
   (`switchTab('players')` / `switchTab('rankings')` via `browser_run_code_unsafe`,
   then re-render) and screenshot each. Save under
   `docs/superpowers/demo/<mode>-<courts>courts-<players>players-<hrs>hr-<tab>.png`.

5. **Report the audit** and write an `EVIDENCE-<mode>-<date>.md` next to the
   screenshots. Compare against the real session's numbers when available.

## What the audit reports

| Field | Meaning | Good sign |
|---|---|---|
| `games` | total games played in the session | close to real night |
| `oppPairs3plus` | # opponent pairs that faced each other 3+ times | near 0 |
| `maxFacedSameOpp` | worst case: most times any two faced off | ≤ 2–3 |
| `partnerPairs2plus` / `maxSamePartner` | partner-repeat spread | low |
| `gpMin/gpAvg/gpMax` | games-played fairness across players | tight spread |
| `onDeckDepth` | `matchQueue` length after rebuild | 1 for Numbering, 3 others |

Baseline for comparison — the 2026-08-03 real Numbering night (old code):
**12 opponent-pairs met 3+, max faced 4×**. The new fair-weighted code at
40p/4courts/5hr: **0 opponent-pairs met 3+, max faced 2**.

## Mode caveats

- **Numbering / By wait time / Balanced** — fully covered by `sim-driver.js`
  (next match = `chooseMatchPlayers`).
- **King of the court (`ladder`) / Challenge courts (`challenge`)** — winners stay,
  so matches advance through `submitScore` / `resolveChallengeCourt`, not
  `chooseMatchPlayers`. Drive the real close/submit flow per round instead: seat via
  the mode's own seeding, then call the real score-submit function with a winner.
- **Round robin / Bracket (`roundrobin`/`bracket`)** — schedule comes from the
  `tournament.js` generator, seeded once at start; drive `fillCourtsFromTournament`
  and submit scores to advance. `chooseMatchPlayers` returns early for these.
- **Manual** — no auto-queue; exercise the Pick Match modal / manual seat functions.

For a first pass on any mode, still boot it (step 2) and screenshot the live board —
even without the full session loop that visually confirms the mode seats sensible
matches in the real UI.

## Cleanup

Kill the local server when done (`pkill -f "http.server 8099"` or the specific PID).
Screenshots are the deliverable — keep them in `docs/superpowers/demo/`.
