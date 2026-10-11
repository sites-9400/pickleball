# Hybrid matchmaking (Men's / Women's / Mixed courts) — design

Requested by Jude, 2026-10-11. Approved in chat section by section.

## Goal
One open-play session where courts are split into groups: Men's courts (men only), Women's
courts (women only) and Mixed courts (open to anyone). Example: 4 courts = 2 Men's + 2 Women's.

## Scope
- Add-on for the open-play queue modes only: Numbering (`random`), By wait time (`waittime`),
  Balanced (`balanced`). Not for Round robin, Bracket, Ladder, Challenge, Manual.
- Matchmaking algorithms are NOT changed. Hybrid only filters the pool each algorithm sees.
- Hybrid off = today's behaviour exactly.

## Data
- Player: `gender: 'm' | 'f'` (missing = untagged).
- Court def: `group: 'men' | 'women' | 'mixed'`.
- Session: `hybrid: true | false`.
- Queued match: `group` (which court group it is for).

## Setup
- Live admin view: "Hybrid matchmaking" switch (only for the 3 queue modes).
- Turning it on asks "How do you want to split your N courts?" with Men's / Women's / Mixed
  steppers that must add to N. Default: even Men/Women, odd court to Mixed (4 → 2/2/0,
  5 → 2/2/1). Shows waiting counts per gender as a hint. Shows "N players not tagged yet".
- Courts tagged in order: Men's first, then Women's, then Mixed.
- "Split: 2 Men · 2 Women" line reopens the question. Adding/removing a court while hybrid is
  on reopens it. Live games keep playing; only next matches follow the new split.
- Switch off returns to normal matchmaking immediately.

## Tagging
- QR check-in: when hybrid is on, a required "Plays in: Men / Women" row under Skill level.
  Returning players get their saved choice preselected. Hidden when hybrid is off.
- Admin roster: M / F / ? badge next to skill badge, tap cycles ? → M → F (hybrid on only).
  Add player gets the same choice.
- Untagged players can only be placed on Mixed courts.
- Tag kept by roster import; CSV gets a gender column.

## Queue and courts
- Pools from free waiting players: Men = tagged m, Women = tagged f, Mixed = everyone.
- Up Next: run the session's algorithm, unchanged, once per group that has a court, on that
  group's pool. Order: Men's, Women's, then Mixed from whoever is not reserved. One queued
  match per group.
- A freed court takes the queued match of its group. Short pool → court says
  "Need 1 more woman" / "man" / "player". No automatic cross-group moves.
- Swaps and queued-match refills stay within the match's group (Mixed = anyone).
- Locked pairs: an M+F lock can only play together on Mixed; on gendered courts the lock is
  dormant (same as when a partner is absent). Verify in harness.
- Uneven numbers mean the larger group waits longer; Mixed courts even it out. Not hidden.

## Views
- Court cards and Up Next cards show group label (Men's / Women's / Mixed).
- view.html: same labels; waiting list split Men / Women / Not tagged when hybrid is on.
- Game history row shows court group. SW cache bump; browser-check after deploy.

## Testing
1. TDD unit tests via the app.html harness: splits 2/2/0 and 2/1/1, short group, untagged
   Mixed-only, swap/refill in group, M+F locked pair, hybrid off identical.
2. Existing suite stays green.
3. Full-session sim: 4 courts, ~14 M / 8 F, 5 hours, all 3 modes; zero cross-group games on
   gendered courts; repeat counts; men/women wait gap with and without a Mixed court.
4. Real browser check of check-in, split question, chips, TV view.
5. Firebase rules allow `gender` on check-in writes (backup, diff, deploy, read back).
