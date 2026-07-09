# Co-host an Open Play session — Design

**Date:** 2026-07-06 (revised 2026-07-09: secret invite token, dashboard stale-entry cleanup;
updated same day after security review — XSS escaping + owner-only dashboard index shipped in
`d8fa40c`, §4 and §7 adjusted to build on it)
**Status:** Approved (pending spec review)

## Goal

Let a session owner grant a **second logged-in account full admin access** to the same
Open Play session so they can co-host — manage courts, players, scores, matchmaking, and
check-in together. The owner remains the only one who can **end or delete** the session.

## Non-goals (v1)

- Fine-grained roles (e.g. scorekeeper-only). Co-host = full admin except end/delete.
- Real-time conflict-free simultaneous editing (see Known Limitations).
- Email/username invites (not feasible client-side without a backend). Access is via link.

## Access model (chosen: "invite link with secret token")

Anyone who opens the invite link **while logged into their own account** can self-join as a
co-host **while the owner has invites open**. The owner can stop accepting and revoke
individuals at any time. Security is possession of a **secret invite token** in the link +
the `cohostOpen` window.

Why a token (not just the session id): the check-in QR and view link already broadcast the
session id to everyone at the venue, so a bare `?cohost=1` link would let any player
self-promote to admin while invites are open. The token closes that hole.

**Token placement gotcha:** the token cannot live under `sessions/$sid` — the rules grant
`.read` to all authenticated users at the `sessions` level (view/check-in depend on it) and
Firebase cannot revoke a read deeper in the tree. So the token lives in a **top-level
`cohostTokens/$sid` node** with owner-only read/write. Rules can still reference it in the
self-join check even though non-owner clients can't read it.

## 1. Data model (Firebase)

Add to a session node:

- `sessions/$sid/cohosts/{uid} = { name, addedAt, token }` — map of co-hosts (uid → info).
  `token` is the invite token the joiner presented (checked by rules on creation).
- `sessions/$sid/cohostOpen = true | false` — whether new co-hosts may self-join. Owner
  toggles it; mirrors the existing `checkinOpen` pattern. Default `false`.

Add a top-level node (outside the open-read `sessions` subtree):

- `cohostTokens/$sid = "<random token>"` — owner-only read/write. Generated via
  `crypto.randomUUID()` (or a slice) when the owner opens invites. Regenerating it
  invalidates previously shared links.

`ownerId` is unchanged and remains the single source of ownership truth.

**Deletion ordering:** when the owner deletes a session, delete `cohostTokens/$sid`
**before** `sessions/$sid` — the token rule authorizes by `sessions/$sid/ownerId`, which no
longer exists after the session is deleted.

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
            ".write": "root.child('sessions').child($sid).child('ownerId').val() === auth.uid || ($uid === auth.uid && auth.token.firebase.sign_in_provider != 'anonymous' && (!newData.exists() || (!data.exists() && root.child('sessions').child($sid).child('cohostOpen').val() === true && root.child('cohostTokens').child($sid).exists() && newData.child('token').val() === root.child('cohostTokens').child($sid).val())))",
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
    "cohostTokens": {
      "$sid": {
        ".read": "root.child('sessions').child($sid).child('ownerId').val() === auth.uid",
        ".write": "root.child('sessions').child($sid).child('ownerId').val() === auth.uid"
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
  node: **create** requires `cohostOpen === true` **and** a matching invite token in the payload;
  **remove self** (`!newData.exists()`) is always allowed. No self-update case is needed.
- `cohostTokens/$sid` is owner-only for clients, but the self-join rule can still compare
  against it via `root.child(...)`. The rule also requires the token node to **exist** —
  otherwise `null === null` would let a token-less join through if `cohostOpen` were ever
  true without a generated token.
- `checkins` write now also accepts a co-host (so co-hosts can approve/reject pending check-ins).

## 3. UI flows

### Owner — "Invite co-host"
- New control near the Share button (or in the check-in/share card): **Invite co-host**.
- Opens a small panel: a copyable link `app.html?session=$SID&cohost=$TOKEN`, an **Accepting
  new co-hosts** toggle (writes `cohostOpen`), a **New link** button (regenerates the token,
  invalidating old links), and a list of current co-hosts (name) each with **Remove**.
- Tapping Invite generates the token if absent (writes `cohostTokens/$sid`), sets
  `cohostOpen=true`, and reveals the link.

### Co-host — join
- App load parses `?cohost=$TOKEN`. If the user is **logged in, non-anonymous, not the owner,
  and not already a co-host**, show a confirm card: *"Join **[session name]** as co-host?"*
- On confirm: write `sessions/$sid/cohosts/{uid} = {name, addedAt, token}` and
  `users/{uid}/sessions/{sid} = {name, lastOpened, cohost:true}`, then load the app with full
  controls. If the write is rejected (invites closed **or** stale/wrong token — the client
  can't tell which, since it can't read the token), show *"This invite link is no longer
  active — ask the host for a new one."*

### Revoke
- Owner removes a co-host (`cohosts/$uid` deleted). That co-host's next `saveState` write is
  rejected by rules; the app detects the write error / their absence from `cohosts` on the next
  `onValue` snapshot and switches them to a read-only banner ("You're no longer a co-host").

### Owner-only actions
- **End Session** and **Delete** buttons are hidden/disabled when `isCohost` (not owner).
  Rules still permit `status`/`sessionEnded` writes (needed for normal saves), so this is
  **UI-enforced**, per the approved simple model.

## 4. Dashboard

Baseline (shipped 2026-07-09, commit `d8fa40c`): `app.html` registers a session under
`users/{uid}/sessions` **only when the user owns it**, and the dashboard verifies
`ownerId` on every index entry — **pruning any unowned or deleted entry** from the index.

Co-host changes build on that:

- The co-host join flow writes its own `users/{uid}/sessions/{sid} = {name, lastOpened,
  cohost:true}` entry (see §3), since app.html's owner-only registration will skip it.
- **Update the dashboard prune filter**: keep an unowned entry when it's flagged
  `cohost:true` **and** the fetched session still lists this uid in `cohosts`. Render those
  badged **"Co-host"** (vs owner's own); co-host cards omit Delete. Without this filter
  change, the current prune would silently delete co-host entries — it is a prerequisite,
  not an optional cleanup.
- **Stale-entry cleanup** falls out of the same filter: revoked (uid gone from `cohosts`)
  or deleted sessions are pruned as they are today.

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
- **Post-join token leak (accepted):** a joined co-host's `cohosts/$uid` node stores the
  token and is readable by any logged-in user (open reads on `sessions`). So after someone
  joins, the current token is discoverable while `cohostOpen` remains true. Mitigations:
  owner closes accepting once expected co-hosts have joined, can revoke anyone, and **New
  link** regenerates the token. A post-join write that strips the token from the node was
  considered and deliberately skipped for simplicity.
- **End/Delete is UI-enforced only** for co-hosts: rules must allow `sessionEnded`/`status`
  writes (every `saveState` includes them), so a console-savvy co-host could technically end
  a session. Accepted — co-hosts are explicitly trusted invitees.

## 7. Testing

- **Logic (offline VM harness):** identity gating (`isOwner`/`isCohost`), join-card
  conditions, revoke → read-only transition, dashboard co-host filtering — driven through the
  real functions with a mocked DOM (same harness approach used this session).
- **Rules:** validate the new JSON in the **Firebase Rules Simulator** (owner write ok;
  cohost write to `players` ok; cohost write to `ownerId` denied; non-cohost write denied;
  self-join with `cohostOpen=true` + correct token ok; with `cohostOpen=false` denied; with
  wrong/missing token denied; self-remove ok regardless; non-owner read of
  `cohostTokens/$sid` denied).
- **End-to-end:** two real Google accounts on two devices — invite, join, both edit different
  courts, revoke, confirm read-only.
- **Concurrency checks (from 2026-07-09 code review):**
  - *Echo suppression:* `app.html` drops snapshots arriving within 1s of its own write
    (`_lastWrite` guard). With a co-host writing constantly, verify one host's change made
    within that window still reaches the other (or accept + document the refresh behavior).
  - *Score-typing clobber:* `_fbApplyRemote` preserves only the **focused** score input; a
    co-host save while the owner is between score fields reverts the first field. Verify
    during E2E; if it bites in practice, preserve both dirty score inputs per court.
- **Dashboard prune regression:** with the cohost filter in place, confirm a co-host entry
  survives dashboard load, and a revoked one is pruned.

## 8. Rollout / ordering

1. Update `docs/firebase-rules.json` + owner pastes rules into Firebase Console. **Deploy rules
   first** — app changes are backward-compatible, but co-host writes fail until rules are live.
2. App changes: identity helpers, invite panel, join flow, revoke, read-only banner.
3. Dashboard co-host listing.
