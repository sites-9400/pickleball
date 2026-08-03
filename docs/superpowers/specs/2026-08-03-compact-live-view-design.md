# Compact Single-Screen "Live" View — Design Spec

**Date:** 2026-08-03
**Status:** Approved — implement as a standalone preview page
**New file:** `play.html` (does NOT modify `app.html`)

## Goal

A PickleQ-style **one-screen live board** — Courts, Queue, matchmaking (Next Up /
On Deck), and a standings peek all visible without tab-hopping — so the app feels as
familiar and mobile-friendly as PickleQ while keeping every Paddle District feature.

Delivered as a **separate page (`play.html`)** so it can be shown to a tester (Jude)
as a live app **without affecting the production `app.html`.** Merging the PR deploys
`play.html` alongside the current app; `app.html` is never touched.

## Why a new file (not an in-place rewrite)

- Production `app.html` stays byte-for-byte safe — zero regression risk.
- GitHub Pages deploys `play.html` at its own URL on merge; nothing about the existing
  app changes. Share `…/play.html` for feedback.
- `play.html` **reuses the entire `app.html` engine verbatim** (Firebase wiring,
  matchmaking, scoring, swaps, timers, share/QR, check-in, co-host). Only the layout
  shell and `switchTab` change, so behavior is identical to the proven app.

## Structure: 4 tabs → 3

| Today (`app.html`) | `play.html` |
|---|---|
| Players | **Players** (roster + check-in + co-host + share mgmt + session start) |
| Courts | → merged into **Live** |
| Queue | → merged into **Live** |
| Rankings | **Rankings** (full leaderboard, unchanged) |

Top nav becomes a segmented control: **Live · Players · Rankings**. Default = **Live**.

### The Live screen (top → bottom, one scroll column)

1. **Live Courts** — existing `#courtList` render (court cards: teams, per-court timer
   with warn state, swap ⇄ beside each name, score boxes + Submit Score) + "＋ Add Court".
2. **Matchmaking** — the existing Queue (`#queueList`, dark panel, numbered by wait) with
   "＋ Add player", plus the existing **Next Up / On Deck** cards, and the **On hold**
   card (`#holdList`) when populated.
3. **Standings strip** — NEW: a slim, collapsible strip showing the top players
   (rank · name · `Wins · ±Diff`) with a **View all →** link to the Rankings tab. Reuses
   the same computation as `renderRankings()`; no new data.

### Players screen

Everything the current Players tab holds, unchanged: Add Players, **player check-in**
(open/close, share link, QR, approve pending), **co-host** invite, skill levels, remove,
the session-start card, and the share card.

### Rankings screen

Unchanged full leaderboard (`renderRankings()` + `renderGameHistory()`).

## Implementation notes

- **Copy** `app.html` → `play.html`. Keep all JS and all render-target IDs
  (`courtList`, `queueList`, `holdList`, `playerList`, rankings containers) so render
  functions work untouched.
- Replace the tab bar markup with the 3-item segmented nav; wrap Courts+Queue markup
  into a single `#tab-live` panel; keep Players and Rankings panels.
- Update `switchTab(name)` to handle `live | players | rankings`:
  `live` → `renderCourts(); renderQueue(); renderStandingsStrip();`
  `rankings` → `renderRankings(); renderGameHistory();`
- Add `renderStandingsStrip()`: take the top N (≈6) from the same sorted ranking data,
  render chips into `#liveStandings`; wire the collapse toggle + "View all →"
  (switches to the rankings tab).
- Share/QR: the per-tab share cards collapse to one placement on Live (header or top of
  Live) + the existing one on Players; reuse `copyViewLink()` and the QR container logic.
- Default active tab = `live`; a not-yet-started session shows the start card (surfaced
  on Live or via Players) — existing empty states apply.
- Compact visual pass (dark queue panel, segmented nav, standings chips, court header
  styling) applied via added CSS scoped to `play.html`; the mockup at
  artifact `59e354b3` is the visual target.

## Non-goals

- No change to `app.html`, `view.html`, `dashboard.html`, or the data model.
- Not the default app yet — this is a preview to validate the direction with a tester.
  Promoting `play.html` to replace `app.html` is a separate later decision.

## Testing

Drive `play.html` in a browser with Firebase stubbed (same harness approach as the
`test-this-mode` skill): start a session, add players, add courts, generate matches,
submit scores, do a swap, and confirm the Live screen shows courts + queue + Next Up/On
Deck + standings updating together, that the segmented nav switches Live/Players/Rankings,
and that no console errors occur. `app.html` unchanged — its behavior is unaffected by
construction.

## Rollout

Branch `feat/compact-live-view` → PR adding `play.html` + this spec. Merge deploys
`play.html` live (new URL) with `app.html` untouched. Share the URL with Jude for
feedback; iterate on the branch.
