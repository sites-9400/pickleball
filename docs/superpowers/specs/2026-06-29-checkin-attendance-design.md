# Check-in Attendance (roster self-select) — Design

Date: 2026-06-29
Applies to: **Modes app only** (`PickleDistrict-Modes/`). `checkin.html`, `app.html`, `tournament.js`. The production app has no check-in page.

## Problem / goal

The QR check-in page is a blind add form: you type a name + skill and a brand-new player is created. There is no way for a drop-in to mark themselves "here" against the roster the organizer already built, and a returning/known name is just rejected as a duplicate. Goal: turn the check-in page into an **attendance** page where a visitor sees the admin's player list, taps one or more names to mark them present, and can add a new name if theirs is not listed. After checking in they get a link to the live view.

## What already works (do not rebuild / no change needed)

- **Anonymous read of the roster:** Firebase rules grant `sessions/.read = "auth != null"`, and `checkin.html` already authenticates anonymously (named `'checkin'` Firebase app). So it can read `sessions/{id}/players` live with **no rules change**.
- **Inbox write model:** anonymous users may write `sessions/{id}/checkins/{cid} = {name, skill, ts}` only when `checkinOpen === true`; the rules forbid any other fields (`$other: validate false`). This spec keeps that exact payload, so **no Firebase rules change is required**.
- **Import pipeline:** `app.html` `onChildAdded` on `checkins` → `_importCheckin(key, entry)` → `checkinToPlayer(entry, players)` → adds player + deletes the inbox node. Backlog import on app load handles entries that arrived while the admin app was closed.
- **Session id + view URL:** both `checkin.html` and `view.html` read `?session=<id>`. The view link is `view.html?session=<SID>` (same directory).

## Decisions (confirmed)

- **Full roster shown.** Anyone with the link sees all admin-added names and can mark any of them present (same open-trust model as the existing check-in and the public view page).
- **Done state** shows the live-view link **and** a "check in more" action to return to the list.

## Section 1 — checkin.html: roster self-select (main view)

- On load (after anon auth), subscribe live to `sessions/{id}/players` and `sessions/{id}/checkinOpen` and `sessions/{id}/name` (name already wired).
- If `checkinOpen !== true`: show the existing "check-in is closed" state; hide the roster.
- Render the roster as a **tappable multi-select list**, one row per player: name + small skill tag. Tapping a row toggles a selected checkmark. Maintain a `selected` Set of player names.
- Players whose `present === true` render **greyed with a "Here ✓" badge and are not selectable** (already attending; nothing to do). Note: a player flips to greyed only after the admin app imports the check-in, so there can be a short delay if the admin app is not open (existing import limitation; acceptable).
- A sticky **"Check in (N)"** button is enabled when `selected.size > 0`.
- A secondary **"My name isn't listed - add me"** button reveals the existing add form (name input + skill picker, Section 2).
- Empty roster (admin added nobody yet): show a friendly hint and the "add me" form directly.

## Section 2 — checkin.html: add a new name (secondary)

- The current form (name + skill, default intermediate), unchanged in behavior: on submit, `push(checkins, {name, skill, ts: Date.now()})`.
- Reuses the same submit path as the multi-select (one entry per name).

## Section 3 — checkin.html: submit + done state

- **Check in (N):** for each selected name, `push(sessions/{id}/checkins, {name, skill, ts: Date.now()})` where `skill` is that roster player's stored skill (fallback `'intermediate'`). Disable the button while writing; on success go to the done state.
- **Done state:** "You're checked in!" + a list of the names just submitted, plus:
  - **"See live courts & standings"** link → `view.html?session=<SID>` (new tab).
  - **"Check in more"** button → clears `selected` and returns to the roster view.
- Write failures (e.g. check-in closed mid-session) surface the existing alert and re-enable the button.

## Section 4 — app.html + tournament.js: import marks existing players present

The single behavioral change. Today `checkinToPlayer` returns `{skip:true, reason:'duplicate'}` when the name already exists, and `_importCheckin` discards it. New behavior:

- **`tournament.js` `checkinToPlayer(entry, existingPlayers)`** (pure, unit-tested): when the trimmed name matches an existing player (case-insensitive), return `{ markPresentName: <existing player's exact name> }` instead of `{skip, reason:'duplicate'}`. New name → unchanged `{player:{...present:true...}}`. Invalid/empty name → unchanged `{skip, reason:'invalid'}`.
- **`app.html` `_importCheckin(key, entry)`**: handle the new branch — find the existing player by name (case-insensitive), set `present = true`, ensure they are in `queueOrder`, then `rebuildMatchQueue(); renderPlayers(); renderQueue(); saveState();` and toast "`<name>` marked here." Always delete the inbox node afterward (as today). The `{player}` (new) and `{skip}` (invalid) branches are unchanged.
- This makes "select an existing name" mark attendance, and "add me" create a present player, through the same inbox + import path.

## Section 5 — Out of scope / notes

- No Firebase rules change. No production-app change. No `view.html` change.
- The admin app must be open (or opened later) to import; attendance is eventually consistent via the existing backlog import. Known multi-tab double-import caveat is unchanged.
- Skill is not re-collected for existing players (their stored skill is used); the skill picker only applies to the "add me" path.

### Smoke-test checklist
- Open `checkin.html?session=<id>` (anonymous): roster shows the admin's players; `checkinOpen=false` hides it with the closed message.
- Tap 2-3 names → "Check in (3)" → admin app marks those players **present** (Players panel "Here"), toast per name; inbox drains. Reload admin app mid-way → backlog import still marks them.
- A name already present shows greyed "Here ✓" and can't be selected.
- "My name isn't listed - add me" → add a new name + skill → new present player appears with QR tag.
- Done state shows the names submitted, a working **view** link (`view.html?session=<id>`), and "check in more" returns to the roster.
- `tournament.js` unit tests: existing name → `{markPresentName}`; new name → `{player}`; empty → `{skip:'invalid'}`.
