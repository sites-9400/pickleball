# Production (v1) QR Check-in — Design

Date: 2026-06-29
Applies to: **production app** (`PickleDistrict/files-github/`): new `checkin.html`, plus `app.html`, `dashboard.html`. (Spec/plan live in the Modes repo docs/ because that is this workspace's planning home and the production repo only holds the deployable site.)

## Problem / goal

Port the QR self-check-in feature (already in the Modes app) into the lean production app, adapted to production's simpler model. **No skill / no rank** anywhere — the user was explicit. Visitors open a QR link, see the organizer's roster, tap their name(s) to mark themselves present, or add a new name if not listed, then get a link to the live view. The organizer controls an Open/Closed toggle and shares a link + QR from the Players tab.

## Key constraints / facts (verified against production)

- Production player object is `{id, name, present, gamesPlayed, wins, losses, points, pointsAgainst, lastPlayedRound}` — **no `skill`, no `via`**. Keep it that way. Check-in payload is `{name, ts}` only.
- Production `app.html` has a regular `<script>` (global game code) and a `<script type="module">` (Firebase). Module imports today: `set, update, onValue, get`. Need to add `onChildAdded, remove`. `checkin.html` needs `push`.
- Writes go through the module's debounced `window._fbWrite(data)` called by `saveState()`. To delete an inbox node, add a module-side `window._removeCheckin(key)` using `remove(ref(...))`.
- Helpers all exist: `getPlayer, presentPlayers, removePlayer, togglePresent, renderQueue, renderPlayers, rebuildMatchQueue, showToast, playerIdCounter, queueOrder`. QR lib (`qrcode.min.js`) already loaded. `_basePath()` and `window._getViewLink()` exist in the module.
- `view.html` (and `checkin.html`) read `?session=<id>`.
- No production test harness (no `tournament.js`, no `node --test`). Verification is syntax-check + browser smoke (the production norm).
- Production Firebase project: `pickledistrict-fef9a` (config already in production `index.html`/`app.html`/`view.html`).

## Section 1 — checkin.html (new, name-only)

A name-only version of the Modes attendance page, with the production Firebase config:
- Anonymous auth via a named `'checkin'` Firebase app. Reads `sessions/{id}/players`, `name`, `checkinOpen` live.
- Gated by `checkinOpen`: when not true, show "Check-in is closed by the organizer."
- **Roster (main):** tap-to-select multi list of admin-added names (**name only, no skill tag**). Players already `present` show greyed with "Here ✓" and are not selectable. Empty roster → hint + the add form.
- **"Check in (N)":** writes one `{name, ts}` inbox entry per selected name.
- **"My name isn't listed - add me":** a name-only text field (no skill picker) → writes `{name, ts}`.
- **Done state:** lists the names submitted + a "See live courts & standings" link (`view.html?session=<id>`) + "Check in more" (back to roster).
- Montserrat font + round `favicon.png` to match the other pages.

## Section 2 — app.html: state + import pipeline

- Declare `let checkinOpen = true;` near the other state vars.
- `saveState()`: add `checkinOpen: checkinOpen` to the written `data`.
- `window._fbApplyRemote(s)`: add `checkinOpen = (s.checkinOpen !== false);` (default open; only an explicit `false` closes).
- **Import (regular script, global + window-exposed):** `_importCheckin(key, entry)`:
  - Trim `entry.name`; empty → just delete the node.
  - If a player with that name exists (case-insensitive): set `present = true`, ensure in `queueOrder`, `rebuildMatchQueue/renderPlayers/renderQueue/saveState`, toast "`<name>` marked here."
  - Else create `{id:++playerIdCounter, name, present:true, gamesPlayed:0, wins:0, losses:0, points:0, pointsAgainst:0, lastPlayedRound:-1}` (no skill/via), add to `queueOrder`, render+save, toast "`<name>` checked in."
  - Always `window._removeCheckin(key)` afterward.
- **Module block:** add imports `onChildAdded, remove`; define `window._removeCheckin = key => remove(ref(_db, 'sessions/'+_SESSION_ID+'/checkins/'+key))`; define `window._checkinLink = () => `${origin}${_basePath()}checkin.html?session=${_SESSION_ID}``; attach once (after auth/session ready) `onChildAdded(ref(_db,'sessions/'+_SESSION_ID+'/checkins'), snap => window._importCheckin && window._importCheckin(snap.key, snap.val()))`. `onChildAdded` fires for existing children on attach, so the backlog (check-ins that queued while the admin app was closed) imports automatically on next load.

## Section 3 — app.html: admin check-in panel (Players tab)

A card in `tab-players` (near the share card): heading "Player check-in", the check-in link (tap to copy via `copyCheckinLink()`), a QR (`#checkinQr`, rendered with the existing `QRCode` lib, retry if not yet loaded), and a toggle button `toggleCheckinOpen()` showing "Check-in: Open / Closed" with status. `renderCheckinPanel()` keeps link/QR/toggle in sync; called from `renderPlayers()` and after toggling. `toggleCheckinOpen()` flips `checkinOpen`, `saveState()`, re-renders, toasts.

## Section 4 — dashboard.html + Firebase rules

- `dashboard.html createSession()`: add `checkinOpen: true` to `sessionData` so new sessions start open and the rule passes on the first anonymous write.
- **Firebase rules (production console, `pickledistrict-fef9a`) — user must paste.** Production's base rules are the same auth-scoped sessions/users rules Modes was forked from; add the `checkins` block (validate `{name, ts}` — no skill). Full recommended ruleset to paste:

```json
{
  "rules": {
    "sessions": {
      ".read": "auth != null",
      "$sid": {
        ".write": "auth != null && auth.token.firebase.sign_in_provider != 'anonymous' && (!data.exists() ? newData.child('ownerId').val() === auth.uid : data.child('ownerId').val() === auth.uid)",
        "checkins": {
          "$cid": {
            ".write": "auth != null && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || (!data.exists() && newData.exists() && root.child('sessions').child($sid).child('checkinOpen').val() === true))",
            ".validate": "newData.hasChildren(['name','ts'])",
            "name": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 40" },
            "ts":   { ".validate": "newData.isNumber()" },
            "$other": { ".validate": false }
          }
        }
      }
    },
    "users": {
      "$uid": { ".read": "auth != null && auth.uid === $uid", ".write": "auth != null && auth.uid === $uid" }
    }
  }
}
```

`sessions/.read = "auth != null"` lets the anonymous check-in page read the roster (no separate read rule needed); the `checkins` write rule allows anonymous create only when `checkinOpen === true`.

## Section 5 — Out of scope / notes

- No skill/rank anywhere. No `view.html` change. No Modes-app change.
- Same trust/consistency model as Modes: check-ins only become players when the admin app is open to import (or on its next load via `onChildAdded` backlog). `checkinOpen` persists in Firebase, surviving admin logout.
- Multi-tab admin double-import caveat is unchanged (single-admin assumption).

### Smoke-test checklist
- Admin: Players tab shows the check-in panel — copy link, QR renders, toggle flips Open/Closed and persists across reload/logout.
- `checkin.html?session=<id>` (private window): roster shows admin names (no skill); `checkinOpen=false` → closed message.
- Tap 2-3 names → "Check in (3)" → admin marks them present ("Here"), inbox drains; reload admin → backlog import still marks them.
- Present player shows greyed "Here ✓", not selectable.
- "Add me" (name only) → new present player appears.
- Done state: names + working view link (`view.html?session=<id>`) + "Check in more".
- New session created from dashboard starts with check-in Open.
