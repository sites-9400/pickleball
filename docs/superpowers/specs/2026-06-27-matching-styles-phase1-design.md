# Matching Styles — Phase 1 Design

**Date:** 2026-06-27
**Target codebase:** `PickleDistrict-Modes/` (the Modes fork; Firebase `pickleball-255db`, live at https://sites-9400.github.io/pickleball/)
**Source spec:** "Paddle District — Feature Specification" (UX feedback session with Jude), §2a + §3.
**Status:** Approved in brainstorming; ready for implementation planning.

## Context

The pasted product spec covers nearly the whole app (sign-in, session-setup wizard, QR self-check-in,
active-session management, live rankings, post-session summary). It is too large for one implementation
pass, so it is being phased. This document specifies **Phase 1: Matching Styles** only.

Most of the spec's active-session and mode content already exists in the Modes fork (see
`session-notes.md`): Singles/Doubles format, court count, court cards, score entry with winner
detection + tie rejection, an ordered waiting queue, manual "Pick Match", Round robin, and
King of the Court (shipped as "ladder"). Phase 1 reorganizes the mode menu around the spec's four
named styles, adds one genuinely new mode (Challenge courts), pulls a minimal skill field forward,
and upgrades the in-match player edit/replace and the manual customize flow.

### Decisions locked during brainstorming

- **Target:** extend the Modes fork; archive the whole fork before editing. *(Done: full copy at
  `PickleDistrict-Modes-ARCHIVE-2026-06-27/` + git tag `pre-spec-archive`.)*
- **First slice:** matching styles.
- **Mode menu:** map the spec's 4 named styles to the front; keep the fork's extra modes available.
- **Challenge courts:** per-court (winners stay on their court; losers to back of queue; next
  challengers from front of queue). Runs in parallel across all courts.
- **Numbering:** maps to the existing `random` mode, relabeled.
- **Skill metric:** pull a minimal Beginner/Intermediate/Advanced field forward now (admin-set),
  rather than reusing wins−losses as a proxy. Full QR self-check-in is a later phase.
- **Drag-and-drop:** full touch-drag support (a touch shim), not desktop-only.
- **Override (match edit):** pulling in a player who is currently on another court leaves their old
  seat empty, then backfills it from the queue (or holds it if the queue is empty).

## Scope (Phase 1)

In scope: A) mode-menu reorg + dynamic description card; B) minimal skill field on players;
C) Challenge courts engine; D) Numbering relabel; E) in-match edit/replace panel; F) drag-and-drop
match customization (touch + mouse).

Out of scope (later phases): standalone post-login Session Setup screen, QR self-check-in &
self-registration form, public live-rankings overhaul (tabs / Win% / Points% / medals), public
post-session summary page, sign-in page restyle.

## Existing code anchors (Modes fork)

- Player object (`app.html:1608`):
  `{id,name,present,gamesPlayed,wins,losses,points,pointsAgainst,lastPlayedRound}` — **no skill field**.
- `ratingOf(p)` = wins−losses when `gamesPlayed` else 0 (`app.html:1687`).
- Balanced doubles snake-pairs the longest-waiting 4 by `ratingOf` (`app.html:1699-1701`).
- `chooseMatchPlayers()` drives waittime/balanced/random selection (`app.html` ~1690-1769).
- Swap flow: `openSwapModal(courtId,team,playerIndex)` / `openQueueSwapModal(...)` →
  `_openSwapOptions(outgoingId)` → `confirmSwap(incomingId)` (`app.html:2040-2104`); each court
  player already renders a `⇄` swap button (`app.html:2155`).
- Manual pick: `openManualPick(courtId)` → `#manualOverlay` → `confirmManualPick()` (`app.html` Stage 3).
- Mode picker: `dashboard.html:112` `#newSessionMatchmaking`; written to `session.mode.matchmaking`
  (`dashboard.html:216`); read-only in app.html, mode badge via `modeLabel()`/`#modeBadge`.
- Pure tournament logic + tests: `tournament.js` + `tests/tournament.test.js` (`node --test`).
- Persistence: `saveState()` uses `update()` (never `set()`), player map at `app.html:1562`.

## Design

### A. Mode menu reorg + dynamic description card

Reorganize `#newSessionMatchmaking` (`dashboard.html`) into two `<optgroup>`s:

- **Primary styles:** Round robin (`roundrobin`), King of the court (`ladder`),
  Challenge courts (`challenge`, NEW), Numbering (`random`).
- **More styles:** By wait time (`waittime`), Balanced (`balanced`), Manual (`manual`),
  Bracket (`bracket`).

Add a `#modeDesc` description card beneath the select that updates on `change` from a
`MODE_DESC` map (one short paragraph per matchmaking value), implementing spec §2a's dynamic card.
Update `modeLabel()` and `#modeBadge` in `app.html` so the Courts-tab badge shows the new friendly
labels (incl. "Challenge courts" and "Numbering").

`session.mode.matchmaking` continues to be the persisted key; existing sessions keep working because
their stored value (e.g. `waittime`) still maps to a menu entry. Mode remains set only at dashboard
create time and preserved via `update()`.

*Note:* spec §2 envisions a dedicated post-login "Session Setup" screen. Phase 1 enhances the
existing dashboard create panel in place; the standalone screen ships with the check-in phase.

### B. Minimal skill field (pulled forward)

Add `skill: 'beginner' | 'intermediate' | 'advanced'` to the player object (default
`'intermediate'`). On read, default-fill when missing so pre-existing players/sessions stay valid.

Admin UI:
- Skill selector in the Add Player flow.
- A tappable **skill badge** on each player row (cycles/edits the level), styled per level.
- A small count summary line on the Players panel, e.g. `3 Beg · 3 Int · 2 Adv`.

Logic: add `skillRank(p)` → `{beginner:1, intermediate:2, advanced:3}` (default 2). Skill-aware
selection/pairing (balanced mode and "auto best match") sorts/pairs by `skillRank` first, with
`ratingOf` as the tiebreaker. Persist `skill` in the saveState player map (`app.html:1562`) and in
the cloud session summary so later phases (rankings badges) can read it.

### C. Challenge courts — new per-court engine

New matchmaking value `challenge`.

- **Initial fill:** like waittime — longest-waiting players fill open courts (random pairing within
  the chosen group). Reuses the standard `courts` slots so `view.html` mirrors unchanged.
- **On score submit (new branch in `submitScore`, parallel to the ladder/tournament branches):**
  - Reject ties (Challenge needs a decisive winner), consistent with ladder.
  - **Winning team stays** on the same court: build a fresh court slot for that court id with the
    winners retained, `score1/score2` cleared, `submitted:false`, `round:++globalRound`,
    `startedAt:now` (so the timer resets and view.html re-renders).
  - **Losing team → back of the waiting queue.**
  - **Challengers** to fill the now-open opposing side are pulled from the **front of the waiting
    queue** (2 players in doubles, 1 in singles).
  - **Insufficient queue:** if there aren't enough challengers, the court **holds** — winners remain
    seated, opposing side shown as waiting/empty — until enough players are present; it fills on the
    next queue change.
  - Player stats + `gameHistory` update once per submitted court/round, same as other modes.
- `generateMatchForCourt` / `rebuildMatchQueue` are guarded for challenge mode the way ladder is
  (challenge manages its own fill on submit; no separate auto-queue rebuild fighting it).

Pure helper extracted to `tournament.js` for unit testing: given (winnerIds, loserIds,
queueIds, teamSize) → {stayIds, newOpponentIds, updatedQueue}. Bridged to the regular script via
`window.resolveChallengeCourt = ...` (module → global bridge pattern).

### D. Numbering = relabel of `random`

No behavioral change. Dropdown label and `#modeDesc` text become "Numbering — players number off and
rotate randomly"; value stays `random`; `modeLabel()` shows "Numbering". (Logic continues to be the
existing random select+pair.)

### E. In-match edit / replace panel (3 options + removed-player fate)

Rework the existing swap modal (triggered by the per-seat `⇄` button on a court card, and the queue
equivalent) into three explicit options for the tapped seat:

1. **Auto-generate** — pick the best skill match from the waiting queue: smallest
   `|skillRank(candidate) − skillRank(outgoing)|`, tiebreak by longest wait then `ratingOf`.
   Resolves to a single candidate id and runs the swap.
2. **Pick from waiting queue** — list present, not-currently-playing players (today's
   `_openSwapOptions` behavior); tap to choose.
3. **Override** — list **any checked-in player, including those currently on another court**. If the
   chosen player is queued, it's a normal swap. If they are **currently playing on another court**,
   pulling them in **leaves their old seat empty**, and that seat is then **backfilled from the front
   of the queue** (or held empty if the queue is empty, surfaced as a waiting seat).

Additionally, a control for the **outgoing** player (the one being replaced): **move to waiting
queue** (default) or **remove from session** (`present=false`). Applies across all three options.

Reuses `confirmSwap` / `openQueueSwapModal` plumbing; `renderCourts`/`renderQueue`/`saveState` run
after each action. All new inline-handler functions exposed via `window.fnName = fnName`.

### F. Drag-and-drop match customization (touch + mouse)

Extend the manual "Pick Match" / customize flow (`#manualOverlay`):

- Keep **tap-to-pick** as a always-available path.
- Add **drag-and-drop**: draggable player chips (waiting/available list) → droppable court seats.
- Support **both** HTML5 mouse DnD and **touch drag** via a lightweight pointer/touch shim
  (`pointerdown`/`pointermove`/`pointerup` with a floating drag ghost), since the app is used
  courtside on phones. No external library, no build step.
- Dropping a chip on an occupied seat replaces that seat (respecting team-size caps); dropping on an
  empty seat fills it. Live A-vs-B preview as today.

## Data model changes

- Player gains `skill` (string enum, default `'intermediate'`); default-filled on read.
- New matchmaking value `challenge` accepted in `session.mode.matchmaking`.
- No new top-level state object: Challenge reuses the existing `courts` slots + `waiting queue`.
  (Contrast with ladder/tournament which needed their own persisted objects.)
- `globalRound` increments per challenge re-seed, same convention as other modes.

## Invariants honored

- `saveState()` uses `update()` not `set()`; never writes `mode`.
- Mode is set only at dashboard create; existing values still map to a menu entry.
- Court timers derive from `startedAt`.
- Firebase empty-array sentinel handled by `normArr` (no new arrays escape it).
- `view.html` keeps its named `'viewer'` Firebase app instance; Challenge/edit reuse standard
  `courts` slots so view.html needs no per-match changes this phase.
- Module-scope pure fns reach inline handlers only via `window.X` bridges.
- New inline `onclick` functions exposed with `window.fnName = fnName`.

## Testing

- **Unit (`node --test`, in `tests/`):**
  - `resolveChallengeCourt` — winners stay, losers to queue back, challengers from queue front,
    doubles vs singles, insufficient-queue hold, conservation (no players lost/duplicated).
  - Skill-aware selection/pairing — best-match selection picks nearest `skillRank` with correct
    tiebreaks; balanced pairing stays skill-even.
- **Live smoke-test (browser, Firebase login required), added to `session-notes.md` checklist:**
  - Challenge: start, submit a score → winners stay, losers queue, challengers come on; drain queue
    so a court holds, then add a player → court fills; ties rejected; view.html mirrors live; reload
    mid-session restores state.
  - Skill: add players with each level; badges + counts show; balanced/auto-best-match respect skill.
  - Edit/replace: all 3 options; override pulling a playing player empties+backfills the old seat;
    outgoing player routed to queue vs removed correctly.
  - Drag-and-drop: works with mouse on desktop and with touch on a phone; tap-to-pick still works.
  - Mode menu: optgroups + description card update; mode badge shows new labels; an existing
    `waittime`/`ladder`/`roundrobin` session still loads.

## Rollout

1. Archive (done) → 2. implement A–F behind the existing fork structure → 3. unit tests green →
4. JS syntax check + live smoke-test per checklist → 5. commit per-feature, push to
`sites-9400/pickleball` `main` (GitHub Pages) → 6. append a dated entry to the fork's
`session-notes.md`.
