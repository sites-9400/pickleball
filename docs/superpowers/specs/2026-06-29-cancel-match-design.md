# Cancel Match (in-progress) — Design

Date: 2026-06-29
Applies to: **both** apps — production (`PickleDistrict/files-github/app.html`) and Modes (`PickleDistrict-Modes/app.html`).

## Problem / goal

While a game is ongoing, the admin needs to be able to **cancel the match** without recording a score. Players can already be **swapped** mid-game, and the score already credits **whoever is on the court when it ends** — those two behaviors exist today and are NOT being rebuilt; this spec only adds Cancel.

Verified existing behavior (do not rebuild):
- **Swap mid-game:** every active-court player has a swap button (`openSwapModal` → `confirmSwap`). Modes also offers "remove the outgoing player from the session."
- **Score → current roster:** `submitScore` reads the *current* `team1`/`team2` arrays at submit time, so swapped-in players get the win/points/history.

## Scope

- Production app: single mode (waiting queue). Gets Sections 1 + 2 + 5.
- Modes app: all modes. Gets Sections 1 + 2 + 3 + 5.

## Section 1 — Entry point & shared rules (both apps)

- A **"Cancel match"** button renders on every **active (unsubmitted)** court, beside Submit. Not shown on submitted or idle courts.
- It opens a **Cancel dialog** — never a one-tap destructive action. The admin must confirm, since a game is being discarded.
- Canceling **never** records: no score, no win/loss, no points-for/against, no `gameHistory` entry. The match is treated as not having happened.
- After confirming, the court goes **idle** and re-fills per that mode's normal rules.
- New function `cancelMatch(courtId)` opens the dialog; a confirm handler applies the chosen fate. Both are exposed via `window.` (module-scope inline-onclick requirement).
- All persistence goes through `update()` (preserve `ownerId`/`ownerName`/`createdAt`/`date`/`mode`); empty arrays serialize via the `{_empty:true}` sentinel and read back through `normArr`/`normLadder`/`normTournament`.

## Section 2 — Queue modes

Applies to: production app (its only mode) and Modes' **wait-time, balanced, random, manual, challenge**. The court holds individual players drawn from the waiting queue. The Cancel dialog offers three fates, applied uniformly to **all** players on that court:

1. **This match only** (default) → players return to the **waiting queue** and get re-matched normally.
2. **Take out of the queue** → players remain in the session (still in the Players list) but are pulled from the waiting rotation, so they are not auto-matched until the admin re-adds them.
3. **Remove from session** → players are deleted from the session entirely.

After the fate is applied the court is cleared to idle. In **challenge** mode the court then auto-refills from the queue if a full opponent set is available (existing `fillChallengeCourts()` path).

## Section 3 — Tournament (round-robin) & ladder (Modes app only)

The unit here is a team/match, not a loose queued player, so the options are reframed.

**Round-robin** (replay/skip only — no team removal):

1. **Replay later** (default) → the underlying tournament match is reset to *unplayed* (scores back to the `-1` "not entered" sentinel, `submitted:false`); the court frees and becomes eligible to be filled by the next match (`fillCourtsFromTournament`). No standings change.
2. **Skip this match** → the match is marked finished with **no result** (a flag such as `skipped:true`, `submitted:true`, scores left at `-1`); `computeStandings` already ignores unsubmitted/no-result matches, so it is excluded from standings. Court frees.

(Explicitly out of scope: removing a team and its remaining matches.)

**Ladder (King of the Court)** — kept simple because ladder movement is conservation-based and mid-round player removal can desync it:

1. **Drop to sitting-out** (default) → the players/teams on that court leave the active ladder rotation and move to the existing "sitting out" group; the admin can re-seed via the existing **Reset**.
2. **Remove from session** → players deleted.

(Explicitly out of scope: clearing/replaying a single ladder court's result mid-round; admins use Reset for a clean re-seed.)

## Section 4 — UI, view.html, invariants, testing

- **UI:** Cancel button on active court cards in `renderCourts` (and ladder/tournament court cards in Modes). A lightweight confirm dialog/modal presents the fate radio options appropriate to the current mode, mirroring the existing swap-modal "send to queue vs remove from session" pattern.
- **view.html:** no new logic required. A cancelled court becomes idle, which the read-only mirror already renders. Verify the mirror reflects the idle court and unchanged standings/leaderboard after a cancel.
- **Invariants honored:** `update()` not `set()`; named `'viewer'` Firebase app untouched; anonymous-user auth guards untouched; `{_empty:true}` sentinel for empty arrays; court timers derive from `startedAt`; every new inline-onclick fn exposed on `window`. No em-dashes in user-facing copy.
- **Tournament/ladder safety:** reuse `tournament.js` pure helpers and the existing `normTournament`/`cleanTournament`, `normLadder`/`cleanLadder` persistence; do not alter the tested scoring/movement math — replay just resets a match to unplayed, skip just flags it as no-result.

## Section 5 — Close-court safety dialog (both apps)

A separate feature from Cancel-match, on the court-remove ("X") control. Today `removeCourt` simply blocks while a match is live ("Submit the score first..."). New behavior:

- **Closing an idle court** (no live match): unchanged, removes directly.
- **Closing a court with a live match:** opens a confirm dialog instead of blocking. Players on the court **go back to the waiting queue** (the court itself is being removed). The match is never silently recorded.
- **If a score has been entered** (both score inputs are valid numbers), the dialog asks whether to record it:
  - **Record score and close** → records the score for whoever is on the court right now (reuses the existing mode-aware `submitScore`), then removes the court. If the score submit is aborted (e.g. the 0-0 guard is declined), the court is kept (close is cancelled).
  - **Close without recording** → discards, players to the waiting queue, court removed.
- **If no score entered:** single "Close court (no score)" action + "Keep court". Players to the queue, court removed.

Implementation: enhance `removeCourt(courtId)` to open a new `#closeCourtOverlay` modal with dynamic action buttons; `closeCourtConfirm(action)` ('record' | 'discard') applies it; `closeCloseCourtModal(e)` dismisses. Reuses `submitScore` for the record path (mode-aware in the Modes app, so round-robin/ladder record correctly). Removes from both `courtDefs` and `courts`. All global (regular `<script>`), no `window.` needed.

### Smoke-test checklist
- **Queue modes (both apps):** start a match; Cancel → "This match only" → players back in queue, no score/history, court idle and re-generatable. Repeat with "Take out of the queue" (players gone from rotation, still in Players list) and "Remove from session" (players deleted). Confirm leaderboard/match-history unchanged by a cancel. Confirm a normal Submit still credits the current roster (swap one player in first, then submit).
- **Challenge:** cancel a court with a full queue → court auto-refills.
- **Round-robin:** Cancel → "Replay later" → match unplayed, court refills with next match, standings unchanged; later the replayed match can be played. Cancel → "Skip this match" → excluded from standings, court frees.
- **Ladder:** Cancel → "Drop to sitting-out" → players leave rotation into sitting-out; Reset re-seeds cleanly. "Remove from session" → players deleted.
- **view.html:** open the live mirror during each cancel → idle court + unchanged standings/leaderboard.
- **Reload mid-session** after a cancel → state restores from Firebase consistently.
- **Close-court dialog:** close an idle court → removes directly. Close a court with a live match, no score → dialog → "Close court" returns players to the queue and removes the court; "Keep court" aborts. Enter a score, close → dialog offers "Record score and close" (score recorded for current roster, then court gone) and "Close without recording" (discarded, players to queue). Decline the 0-0 guard during record → court kept. Verify in the Modes app that record on a round-robin court routes through the tournament scoring.
