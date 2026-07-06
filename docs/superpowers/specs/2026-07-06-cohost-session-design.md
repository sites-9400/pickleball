# Co-host an Open Play session — Design

**Date:** 2026-07-06
**Status:** Approved (pending spec review)

## Goal

Let a session owner grant a **second logged-in account full admin access** to the same
Open Play session so they can co-host — manage courts, players, scores, matchmaking, and
check-in together. The owner remains the only one who can **end or delete** the session.

## Non-goals (v1)

- Fine-grained roles (e.g. scorekeeper-only). Co-host = full admin except end/delete.
- Real-time conflict-free simultaneous editing (see Known Limitations).
- Email/username invites (not feasible client-side without a backend). Access is via link.

## Access model (chosen: "invite link", simplest)

Anyone who opens the invite link **while logged into their own account** can self-join as a
co-host **while the owner has invites open**. The owner can stop accepting and revoke
individuals at any time. Security is possession-of-session-link + the `cohostOpen` window
(consistent with how view/check-in links already work — reads are already open to any
authenticated user).

## 1. Data model (Firebase)

Add to a session node:

- `sessions/$sid/cohosts/{uid} = { name, addedAt }` — map of co-hosts (uid → info).
- `sessions/$sid/cohostOpen = true | false` — whether new co-hosts may self-join. Owner
  toggles it; mirrors the existing `checkinOpen` pattern. Default `false`.

`ownerId` is unchanged and remains the single source of ownership truth.

## 2. Firebase Security Rules

Why this shape works: `saveState()` persists via `update(_SESSION_REF, data)` — a **merge**
of specific top-level keys (`players`, `courts`, …) that **never includes `ownerId`**. So we
grant co-hosts write on exactly those keys and leave ownership/cohost management owner-only.

**Firebase rules gotcha respected:** a `.write` granted at an ancestor can't be revoked
deeper. So we do **not** grant co-hosts write at `$sid`; instead we grant write on each
data field explicitly. Every key `saveState` writes must be listed, because a multi-path
`update()` is atomic — one unlisted key rejects the whole write.

Replaces `docs/firebase-rules.json`. Owner must paste into **Firebase Console → Realtime
Database → Rules** (the app cannot deploy rules).

```json
{
  "rules": {
    "sessions": {
      ".read": "auth != null",
      "$sid": {
        ".write": "auth != null && auth.token.firebase.sign_in_provider != 'anonymous' && (!data.exists() ? newData.child('ownerId').val() === auth.uid : data.child('ownerId').val() === auth.uid)",

        "cohostOpen": {
          ".write": "root.child('sessions').child($sid).child('ownerId').val() === auth.uid"
        },

        "cohosts": {
          ".write": "root.child('sessions').child($sid).child('ownerId').val() === auth.uid",
          "$uid": {
            ".write": "root.child('sessions').child($sid).child('ownerId').val() === auth.uid || ($uid === auth.uid && auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('cohostOpen').val() === true || !newData.exists()))",
            ".validate": "!newData.exists() || newData.hasChildren(['name','addedAt'])"
          }
        },

        "players":          { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "courts":           { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "courtDefs":        { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "matchQueue":       { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "gameHistory":      { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "queueOrder":       { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "globalRound":      { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "playerIdCounter":  { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "courtIdCounter":   { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "mqIdCounter":      { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "sessionStartTime": { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "sessionName":      { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "name":             { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "ladder":           { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "tournament":       { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "sessionEnded":     { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "sessionEndTime":   { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "checkinOpen":      { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },
        "status":           { ".write": "auth.token.firebase.sign_in_provider != 'anonymous' && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists())" },

        "checkins": {
          "$cid": {
            ".write": "auth != null && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists() || (!data.exists() && newData.exists() && root.child('sessions').child($sid).child('checkinOpen').val() === true))",
            ".validate": "newData.hasChildren(['name','skill','ts'])",
            "name":  { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 40" },
            "skill": { ".validate": "newData.isString() && newData.val().matches(/^(beginner|intermediate|advanced)$/)" },
            "ts":    { ".validate": "newData.isNumber()" },
            "$other": { ".validate": false }
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

Notes:
- `ownerId` has no field rule and `$sid/.write` is owner-only ⇒ co-hosts cannot change owner.
- `cohosts`/`cohostOpen` are owner-managed; a co-host may write only their **own** `cohosts/$uid`
  node and only while `cohostOpen === true` (or to remove themselves — the `!newData.exists()` leave case).
- `checkins` write now also accepts a co-host (so co-hosts can approve/reject pending check-ins).

## 3. UI flows

### Owner — "Invite co-host"
- New control near the Share button (or in the check-in/share card): **Invite co-host**.
- Opens a small panel: a copyable link `app.html?session=$SID&cohost=1`, an **Accepting new
  co-hosts** toggle (writes `cohostOpen`), and a list of current co-hosts (name) each with **Remove**.
- Tapping Invite sets `cohostOpen=true` and reveals the link.

### Co-host — join
- App load parses `?cohost=1`. If the user is **logged in, non-anonymous, not the owner, and not
  already a co-host**, show a confirm card: *"Join **[session name]** as co-host?"*
- On confirm: write `sessions/$sid/cohosts/{uid} = {name, addedAt}` and
  `users/{uid}/sessions/{sid} = {name, lastOpened, cohost:true}`, then load the app with full
  controls. If `cohostOpen` is false, show *"The host isn't accepting co-hosts right now."*

### Revoke
- Owner removes a co-host (`cohosts/$uid` deleted). That co-host's next `saveState` write is
  rejected by rules; the app detects the write error / their absence from `cohosts` on the next
  `onValue` snapshot and switches them to a read-only banner ("You're no longer a co-host").

### Owner-only actions
- **End Session** and **Delete** buttons are hidden/disabled when `isCohost` (not owner).
  Rules still permit `status`/`sessionEnded` writes (needed for normal saves), so this is
  **UI-enforced**, per the approved simple model.

## 4. Dashboard

- Today the dashboard lists sessions where `s.ownerId === uid`. Co-hosted sessions won't appear.
- Change: also read `users/{uid}/sessions` entries flagged `cohost:true`, fetch each
  `sessions/{sid}`, and render them badged **"Co-host"** (vs owner's own). Co-host cards omit
  Delete.

## 5. Identity helper (app.html)

- On auth resolve, compute `isOwner = (ownerId === uid)` and
  `isCohost = cohosts?.[uid] != null`. Gate owner-only UI on `isOwner`. A non-owner,
  non-cohost logged-in user viewing the app stays effectively read-only (writes rejected) —
  optionally show a read-only banner.

## 6. Known limitations (v1, accepted)

- **Concurrency:** sync is whole-state merge per top-level key (`courts` is one key). Two
  admins editing the **same instant** ⇒ last full-state write wins and can clobber the other's
  change. Fine for split duties (one runs courts, one scores); not real-time co-editing. v2
  could write per-court paths for finer merges.
- **Link security:** any logged-in user with the session id can self-join while `cohostOpen`
  is true. Mitigation = owner closes accepting after the co-host joins, and can revoke. A
  short random token on the link (checked in rules) is a documented **future** hardening if
  stale-link reuse becomes a concern.

## 7. Testing

- **Logic (offline VM harness):** identity gating (`isOwner`/`isCohost`), join-card
  conditions, revoke → read-only transition, dashboard co-host filtering — driven through the
  real functions with a mocked DOM (same harness approach used this session).
- **Rules:** validate the new JSON in the **Firebase Rules Simulator** (owner write ok;
  cohost write to `players` ok; cohost write to `ownerId` denied; non-cohost write denied;
  self-join with `cohostOpen=true` ok, with false denied).
- **End-to-end:** two real Google accounts on two devices — invite, join, both edit different
  courts, revoke, confirm read-only.

## 8. Rollout / ordering

1. Update `docs/firebase-rules.json` + owner pastes rules into Firebase Console. **Deploy rules
   first** — app changes are backward-compatible, but co-host writes fail until rules are live.
2. App changes: identity helpers, invite panel, join flow, revoke, read-only banner.
3. Dashboard co-host listing.
