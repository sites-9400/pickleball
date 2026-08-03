# Evidence — Compact Single-Screen Live View (`play.html`)

**Date:** 2026-08-03 · **Branch:** `feat/compact-live-view`

`play.html` reuses the entire `app.html` engine and restructures the layout into a
one-screen **Live** board (Courts + Waiting Queue + Next Up/On Deck + a Standings
strip), with **Players** and **Rankings** as their own tabs. `app.html` is untouched.

## How it was verified

Driven in a real browser with Firebase stubbed (same harness as `test-this-mode`),
booting the real `play.html` and simulating a **Numbering doubles** session:
**16 players · 3 courts · 60 min.**

- Boot: `booted:true`, tabs = **Live · Players · Rankings**, both courts+queue panels
  active under Live, `renderStandingsStrip` present, **0 console errors / 0 page errors**.
- Simulation audit (real `chooseMatchPlayers`): 13 games, `oppPairs3plus:0`,
  `maxFacedSameOpp:1`, `maxSamePartner:1`, games-played 2–4 (avg 3.3), onDeckDepth 1.
- Live screen: standings strip shown with 6 chips, courts rendered, queue rendered —
  all on one screen.
- Players tab and Rankings tab both switch and render (full leaderboard + game history).

## Screenshots

- `compact-live-board.png` — the one-screen Live board (courts, queue + Next Up, standings).
- `compact-players.png` — Players tab (roster / check-in / co-host).
- `compact-rankings.png` — Rankings tab (full leaderboard + game history).

## Scope note

This is a **layout preview** for validation with a tester. It merges Courts+Queue into
Live and adds the standings strip; the court/queue cards keep the existing app styling
(they already carry swap ⇄, score entry, Submit, timers). A deeper PickleQ-density
visual restyle of the cards is a possible follow-up.
