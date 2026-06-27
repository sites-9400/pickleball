# QR Self-Check-In — Phase 2 Design

**Date:** 2026-06-27
**Target codebase:** `PickleDistrict-Modes/` (Modes fork; Firebase `pickleball-255db`; live at https://sites-9400.github.io/pickleball/)
**Source spec:** "Paddle District — Feature Specification" §2d (Player Check-in).
**Status:** Approved in brainstorming; ready for implementation planning.
**Builds on:** Phase 1 (matching styles) — the player `skill` field already exists.

## Context

Phase 2 is the self-check-in foundation: a shareable link + QR code that lets players
self-register into a session, plus the admin side that imports them. The admin can still
add players manually (unchanged), and check-in works before and after the session starts.

### The architecture constraint that shapes everything

Session state lives at a flat path `sessions/{SESSION_ID}` (players, courts, etc.). `app.html`'s
`saveState()` overwrites the **entire** `players` array on every save
(`players: cleanForFirebase(players)`). A public page writing directly into `players` would be
clobbered by the admin's next save. Therefore self-check-ins go to a **separate append-only inbox**
`sessions/{SESSION_ID}/checkins/{pushId}`, and `app.html` remains the **sole writer of `players`**,
importing inbox entries. This preserves the single-writer invariant and avoids the overwrite race.

### Decisions locked during brainstorming

- **Check-in flow:** auto-add. Imported check-ins become present, queue-ready players tagged
  `via:'qr'`; the admin can remove any. No approval tray.
- **Inbox, not direct write** (required by the overwrite model above).
- **Dedicated page** `checkin.html` (mirrors `view.html`: anonymous auth + its own named Firebase
  app instance), separate from the read-only view.
- **Admin open/close toggle:** a `checkinOpen` flag on the session, admin-controlled, enforced both
  in `checkin.html` UI and in the Firebase rules (a closed check-in cannot be bypassed).
- **Name storage:** the form's First name + last initial collapse into the existing single
  `player.name` (e.g. "Maria S"). No new name fields on the player.
- **Player model** gains `via: 'qr' | 'manual'` (default `'manual'`, default-filled on read).
- **Dedupe:** on import, skip a check-in whose name matches (case-insensitive) an existing player.
- **Resilience:** if the admin app is closed at check-in time, entries wait in the inbox and import
  when `app.html` next opens.
- **Firebase rules:** complete replacement ruleset provided for the console (the Modes fork has its
  own isolated project serving only this app). Preserves all current behaviors (dashboard full-scan
  fallback, user index, anonymous view read, owner-only writes) and adds anonymous checkin create.

## Scope

In scope: A) `checkin.html` self-registration page; B) the `checkinOpen` toggle; C) admin import +
share UI in `app.html`; D) `via` field; E) the Firebase ruleset; F) a unit-tested import helper.

Out of scope (later phases): the dedicated post-login Session Setup wizard (spec §2), the public
rankings/summary overhaul, and the sign-in restyle.

## Existing code anchors (Modes fork)

- Session path `sessions/{SESSION_ID}`; owner at `sessions/{SESSION_ID}/ownerId` (set by
  `dashboard.html:224` via `set()`, preserved by `update()`).
- Owner session index at `users/{uid}/sessions/{SESSION_ID}`; dashboard fallback reads the whole
  `sessions` node and filters by `ownerId` (`dashboard.html:300-305`).
- `view.html` isolation pattern: `initializeApp(config, 'viewer')`, `signInAnonymously`, reads
  `sessions/{id}` via `?session=` URL param (`view.html:165-184, 605-638`). QR via the bundled
  `QRCode` lib (`view.html` genViewQR).
- Player object (`app.html:1608`): `{id,name,present,gamesPlayed,wins,losses,points,pointsAgainst,lastPlayedRound,skill}`.
- `addPlayer()` assigns `id:++playerIdCounter` and dedupes by case-insensitive name (`app.html:1601-1615`).
- Player load default-fill (`app.html:1402`); `saveState()` writes `players: cleanForFirebase(players)` (`app.html:1268`).
- `app.html` Firebase module block (`<script type="module">`, ~line 2730+) holds `_db`, `_SESSION_ID`,
  `_SESSION_REF = ref(_db, 'sessions/'+_SESSION_ID)`; pure fns bridged via `window.X`.
- `copyViewLink()` builds `view.html?session=` from `_basePath()` (`app.html:2842-2851`).

## Design

### A. `checkin.html` — public self-registration page

A new standalone page modeled on `view.html`:
- Own named Firebase app instance: `initializeApp(firebaseConfig, 'checkin')` + `signInAnonymously`
  (isolated from admin Google auth, same reason as the viewer instance).
- Reads `?session={id}` from the URL. Reads `sessions/{id}/name` (header) and
  `sessions/{id}/checkinOpen` (gate).
- **If `checkinOpen !== true`:** show "Check-in is closed by the organizer." and render no form.
- **If open:** render the form — First name (text, required, trimmed, <=30 chars), Last initial
  (single letter, required, uppercased), Skill (radio: Beginner / Intermediate / Advanced, required).
- On submit: build `name = First + " " + Initial`, `push(ref(db,'sessions/'+id+'/checkins'), {name, skill, ts: Date.now()})`.
  Then show a confirmation ("You're checked in, Maria S. The organizer will get you into a game.")
  with a **Check in someone else** button that resets the form. Disable the submit button between
  click and confirmation to prevent double-submit.
- Brand styling consistent with `view.html` (dark green header + logo). No em-dashes in copy.
- Never reads or writes any session state other than `name`, `checkinOpen`, and its own `checkins` push.

### B. `checkinOpen` toggle (admin-controlled, rule-enforced)

- New session field `sessions/{id}/checkinOpen` (boolean).
- **Default open:** `dashboard.html` sets `checkinOpen: true` in the session create payload; `app.html`
  default-fills `checkinOpen=true` on load if the field is missing (old sessions) and writes it once
  via `update()`.
- Admin toggles it from the Players panel (see C); writes via `update()` (never `set()`).
- `checkin.html` reads it (UI gate) and the Firebase rules require it `=== true` for anonymous create
  (server-side enforcement).

### C. `app.html` — import, share UI, `via` tag

**Import (the only new writer path into `players`):**
- In the Firebase module block, subscribe with `onChildAdded(ref(_db,'sessions/'+_SESSION_ID+'/checkins'), cb)`.
  This fires for the existing backlog on first subscribe and for each new check-in after.
- For each child: call `window.checkinToPlayer(entry, players)`.
  - If it returns `{skip:true, reason}`: toast (e.g. "Maria S is already checked in") and remove the
    inbox node.
  - Else: assign `id:++playerIdCounter` to the returned player, `players.push(player)`,
    `queueOrder.push(id)`, then `rebuildMatchQueue(); renderPlayers(); renderQueue(); saveState();`
    toast ("Maria S checked in"), and `remove(ref(_db,'sessions/'+_SESSION_ID+'/checkins/'+childKey))`.
- Imported players are `present:true`, `via:'qr'`, queue-ready (consistent with the auto-add decision).
- Removing the inbox node after import keeps the inbox small and prevents re-import.

**Share UI (Players panel):** a "Player check-in" block with:
- The check-in link `checkin.html?session={id}` (read-only field + Copy button), built like
  `copyViewLink()` but pointing at `checkin.html`.
- An on-demand QR of that link (reuse the bundled `QRCode` lib, same as the view QR).
- An **Open / Closed** toggle bound to `checkinOpen` (writes via `update()`); label reflects state.

**`via` tag:** each player row shows a small "QR" or "manual" tag beside the skill badge.

### D. `via` field on the player model

- `addPlayer()` sets `via:'manual'`. Imported players get `via:'qr'`.
- Default-fill on load: `via: p.via || 'manual'` (alongside the existing `skill` default-fill).
- Rides to Firebase via the existing `cleanForFirebase(players)` pass-through (no serialization change).

### E. Pure helper `checkinToPlayer` (tournament.js or new module)

`checkinToPlayer(entry, existingPlayers)`:
- Validate: `entry.name` non-empty string after trim; `entry.skill` one of the enum (else default
  `'intermediate'`).
- Dedupe: if any `existingPlayers[i].name.toLowerCase() === entry.name.trim().toLowerCase()`, return
  `{skip:true, reason:'duplicate'}`.
- Else return `{player: {name: entry.name.trim(), present:true, gamesPlayed:0, wins:0, losses:0,
  points:0, pointsAgainst:0, lastPlayedRound:-1, skill:<validated>, via:'qr'}}` (NO `id` — the caller
  assigns it from `playerIdCounter`, keeping the helper pure).
- Bridged into the regular script via `window.checkinToPlayer` (module-block bridge pattern).

### F. Firebase Realtime Database rules (complete replacement, paste in console)

Owner pastes this in the `pickleball-255db` console. It preserves current behavior and adds anonymous
checkin create gated by `checkinOpen`.

```json
{
  "rules": {
    "sessions": {
      ".read": "auth != null",
      "$sid": {
        ".write": "auth != null && (!data.exists() ? newData.child('ownerId').val() === auth.uid : data.child('ownerId').val() === auth.uid)",
        "checkins": {
          "$cid": {
            ".write": "auth != null && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || (!data.exists() && newData.exists() && root.child('sessions').child($sid).child('checkinOpen').val() === true))",
            ".validate": "newData.hasChildren(['name','skill','ts']) && newData.child('name').isString() && newData.child('name').val().length > 0 && newData.child('name').val().length <= 40 && newData.child('skill').isString() && newData.child('skill').val().matches(/^(beginner|intermediate|advanced)$/) && newData.child('ts').isNumber()"
          }
        }
      }
    },
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

Rule notes:
- `sessions/.read: auth != null` keeps anonymous view reads AND the dashboard full-scan fallback working.
- `sessions/$sid/.write` is owner-only (create requires you set yourself as `ownerId`; later writes
  require you already are). This cascades to the whole session subtree for the admin.
- `sessions/$sid/checkins/$cid/.write` additionally grants a non-owner (anonymous) the right to
  **create** (`!data.exists()`) a check-in, only when `checkinOpen === true`. Non-owners cannot update
  or delete existing entries (the `!data.exists()` clause). The owner can delete (cleanup after import).
- `.validate` enforces shape: required `name`/`skill`/`ts`, name length, skill enum, numeric ts.
- Anonymous can read `checkins` (cascades from `sessions/.read`); acceptable (same exposure as view
  data) and harmless.

## Data model changes

- Player gains `via: 'qr' | 'manual'` (default `'manual'`).
- Session gains `checkinOpen: boolean` (default `true`).
- New inbox subtree `sessions/{id}/checkins/{pushId} = {name, skill, ts}` (transient; deleted on import).

## Invariants honored

- `app.html` remains the sole writer of `players`; `saveState()` uses `update()`, never `set()`.
- `checkin.html` uses its own named Firebase app instance (like `view.html`'s `'viewer'`); never the
  default/admin app.
- Firebase empty arrays still round-trip via `normArr`/`cleanForFirebase`.
- Pure logic (`checkinToPlayer`) is unit-tested and reached from the regular script via a `window.X`
  bridge.
- `view.html` unchanged this phase.

## Testing

- **Unit (`node --test`):** `checkinToPlayer` — valid entry → correct player (present, via:'qr',
  validated skill, no id); case-insensitive duplicate → `{skip:true}`; missing/invalid skill →
  defaults to intermediate; name trimmed.
- **Live smoke (deferred to user; needs the deployed staging site + a phone):**
  - Open check-in: scan QR → form → submit → player appears in admin within seconds, tagged QR,
    present and queue-ready.
  - Closed: admin toggles Closed → `checkin.html` shows the closed message and the form is gone;
    confirm a direct DB write is rejected by the rules.
  - Dedupe: same name twice → second is skipped with a toast.
  - Late arrival: check in after the session has started → imports fine.
  - Admin app closed at check-in time → entries import when admin reopens `app.html`.
  - Manual add still works and is tagged "manual".

## Rollout

1. Implement A-F on a feature branch (TDD for `checkinToPlayer`).
2. `node --test` green; JS sanity.
3. Owner pastes the ruleset in the `pickleball-255db` console.
4. Deploy to the staging site; run the live smoke checklist.
5. Append a dated entry to `session-notes.md`.
