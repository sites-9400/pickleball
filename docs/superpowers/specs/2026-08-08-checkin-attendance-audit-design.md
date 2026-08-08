# Check-in Attendance Audit — Design

**Date:** 2026-08-08
**Status:** Approved (design); pending spec review before planning
**Scope:** `app.html` only (roster/Players tab + check-in ingestion). No matchmaking
algorithm changes. No Firebase schema/rules changes.

## Problem

Every check-in record is deleted from Firebase once processed (matched to the roster
and marked "Here", or approved/rejected). The arrival timestamp (`ts`), the fact that
someone checked in, and any later leave/return are all discarded. There is no record
the organizer can review afterward to answer **who showed up, and when**.

## Goal

Give the organizer a retained, glanceable attendance record on the list they already
use to mark players "Here":

- **Who showed up + when** — each player's arrival (check-in) time.
- **Leave/return timeline** — each time a player goes on hold and comes back.
- **Exportable** — download the night's attendance as a CSV (with a clipboard fallback).

Non-goals (YAGNI): no separate audit screen, no per-second precision, no server-side
retention beyond the existing session record, no cross-session history.

## Data model

Add one field to each player object (created in `addPlayer()` and via check-in):

```js
events: []   // ordered list of presence transitions
// each entry: { t: 'in' | 'out', ts: <epoch ms> }
```

- `in`  = became present (checked in / marked Here / added back to queue).
- `out` = became not-present (put on hold).
- The **first `in`** is the arrival / check-in time.

Persistence: `events` rides along in the existing `players` blob that `saveState()`
writes and the inbound snapshot handler re-hydrates (it spreads `...p`, so the field is
preserved). No new Firebase paths, no rules change. Survives reload; visible to co-hosts.

### Transition logging (dedup)

A single helper records transitions and prevents duplicates (e.g. "mark all present"
when already present must not double-log):

```js
function logPresence(p, present, ts){
  if(!p) return;
  const last = p.events && p.events.length ? p.events[p.events.length-1].t : null;
  if(present && last !== 'in'){ (p.events ||= []).push({t:'in',  ts}); }
  if(!present && last === 'in'){ (p.events ||= []).push({t:'out', ts}); }
}
```

Only actual state transitions are logged.

### Capture points (where `logPresence` is called)

| Site | Presence | Timestamp source |
|------|----------|------------------|
| `togglePresent(id)` | `p.present` after toggle | `Date.now()` (admin device) |
| `markAll(val)` | `val` for each changed player | `Date.now()` |
| `_importCheckin` → `markPresentName` (existing roster player checks in) | `true` | **`entry.ts`** from the check-in record (real arrival) — fallback `Date.now()` |
| `approveCheckin` / `_importCheckin` new player (`res.player`) | `true` | `entry.ts` — fallback `Date.now()` |

Using `entry.ts` for check-in-page arrivals preserves the true moment the player tapped
"Check in" (the checker's device clock), which today is thrown away.

## UI — roster row (Players tab)

Restructure `.player-name-wrap` into a two-line column and wrap each row so an expanded
timeline can sit beneath it:

```
[avatar] Name  ✎           [·dot] [skill] [via] [Here ✓] [🗑]
         ● Here · 6:12 PM ▾
         └─ (expanded) Checked in 6:12 · On hold 7:40 · Back 8:05
```

### Check-in time chip (under the name)

- **Present:** `● Here · <first check-in time>` — green dot. (Arrival time, not latest.)
- **On hold, has history:** `● Left <last out time>` — red dot. Short form so it does
  not wrap on narrow phones; `text-overflow: ellipsis`, never wrap.
- **Never checked in:** muted `Not checked in yet` — not clickable.
- The chip is the only new tap target; existing row buttons keep working. A `▾`/`▴`
  caret signals expandability. `aria-expanded` reflects state; visible focus ring.

### Expanded timeline

Tapping the chip toggles a small block beneath the row (green left-border):

```
● Checked in   6:12 PM
● On hold      7:40 PM   (red dot)
● Back         8:05 PM
```

Expand state lives in a module-scoped `Set` of player ids (`expandedAttendance`), read by
`renderPlayers()` so it is preserved across re-renders.

### Time format

`fmtTime(ts) => new Date(ts).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})`
→ e.g. `6:12 PM`. Local time. Tabular numerals in the timeline.

## UI — Export CSV

A button in the attendance section header (`⤓ Export CSV`, `btn-outline` styling).
Produces one row per player:

```
Player,Skill,Via,Checked in,Status,Timeline
Maria,Int,QR,6:12 PM,Here,in 6:12
Jude,Adv,manual,6:05 PM,Here,in 6:05; out 7:40; in 8:05
Rosal,Int,QR,6:20 PM,On hold,in 6:20; out 7:40
Ton Ton,Beg,manual,—,Never,—
```

- **Checked in** = first `in` time, or `—`.
- **Status** = `Here` (present) / `On hold` (has history, not present) / `Never`.
- **Timeline** = events joined `"; "` as `in <h:mm>` / `out <h:mm>`.
- Values are CSV-escaped (quote fields containing commas/quotes).
- **Delivery:** build a `Blob`, trigger a download named
  `attendance-<sessionSlug>-<YYYY-MM-DD>.csv`; also write the same text to the clipboard
  as a fallback (mobile file downloads are unreliable) and toast "Attendance copied +
  downloaded."

## Edge cases

- **Players present before this ships** have no `events`; their chip shows nothing until
  their next transition. Acceptable — logging starts from first event.
- **Clock skew:** check-in-page arrivals use the checker's clock; manual toggles use the
  admin's. Truthful to each source; no attempt to reconcile.
- **Duplicate check-ins / rapid toggles:** `logPresence` dedups consecutive same-type
  transitions, so no noise.
- **Empty session / no one checked in:** export button still works (header row only) but
  is only shown when there is at least one player.

## Testing

Via the existing Node render harness (`tests/apphtml-harness.mjs`), no Firebase:

- `logPresence` dedups: two `in`s in a row produce one event; `out` only after an `in`.
- Check-in ingestion uses `entry.ts` (arrival time preserved, not `Date.now()`).
- `renderPlayers()` output: present row shows `Here · <time>`; on-hold-with-history shows
  `Left <time>`; never-checked-in shows the muted label; expanded row emits the timeline
  rows; expand state in the Set survives a re-render.
- CSV builder: correct columns, status mapping, timeline join, CSV-escaping.
- Full suite (currently 121) stays green — no matchmaking/logic regressions.

## Out of scope / future

- CSV → per-event long format, or a shareable read-only attendance view.
- Total-time-present computation, no-show flags, dues reconciliation.
