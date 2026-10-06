# Rebrand + Live View changes (Sep 29 PD update)

Source: Google Doc "September 29 PD update" + Drive folder "Paddle District" (Jude's).
Status: PLAN, decisions made 2026-10-06. Nothing implemented yet.
Progress: Phase 3 DONE (live). Next: Phase 0, then Phase 4, then Phase 1.
Decisions: (1) app name: KEEP "Pickled" for now, Phase 2 parked. (2) logos: recommended mapping
(badge = big spots, monogram = small headers, square tile = home-screen icon). (3) team colors: live view only.

## Inputs (checked)

| Item | What it is |
|---|---|
| `Kidapawan Ciy Pickleball Community.jpg` | Full badge: "Kidapawan City · PADDLE District · Est 2026 · Community". 2000×2000, **white background, no transparency** |
| `… (1).png` | "P/D" monogram, transparent |
| `… (2).png` | Square app tile: "Paddle District" arch + P/D monogram on dark green |
| `… (5).png` | P/D monogram with white outline, transparent (works on dark) |
| Doc screenshot | Current live view, 3 courts side by side |
| `OP/` subfolder | Open-play photos + IG post: not logo material, not used |

Doc asks for:
1. Web app name: District Live / PD Live / The PD Live / On Deck / Pad-D Live
2. New logo (the Drive files)
3. Live view: light colors on Team 1 / Team 2 so they're easy to tell apart
4. Live view, 3 courts only: compact, courts stacked on top of each other, Team A left vs Team B right

## Decisions needed

1. **App name.** Today the installed app is "Pickled" and the pages say "Paddle District". The name goes on the home-screen icon label, browser tab titles and link previews. Domain stays padq.app.
2. **Which logo where** (recommendation):
   - Full badge: big spots only (login card, shop hero, link-preview image, recap/order-slip images). Its small text ("Kidapawan City", "Est 2026") is unreadable below ~120px tall.
   - Outlined monogram (5): small headers (live view, host app, check-in, shop top bar) and favicon.
   - Square tile (2): home-screen app icon (192/512/maskable/apple-touch).
   - Ask Jude for a **transparent PNG or SVG of the badge**. Until then I can cut the white out myself (it's a clean shape), but the original file will be sharper.
3. **Team colors.** Recommendation: Team A light green tint, Team B light blue tint (dark-mode versions too), on live view courts and the Up Next card. Also the host app's courts? The doc only says live view.

## Phase 0: court timer bug after continuing an old open play

The doc screenshot's timers read `31500:53`, `31500:51`, `31501:06` (about 21.9 days). Cause (user report,
confirmed in code): Jude **continued an old, ended open play**. `continueSession()` in app.html adds the
break to `sessionPausedMs` so the *session* clock skips it, but games still on court keep their original
`startedAt`, so their timers (`Date.now() - startedAt`) count the whole 3-week gap. (My earlier guess, a
wrong device clock, was wrong.)
- Fix: in `continueSession()`, shift `startedAt` of every unfinished court forward by the same gap
  (`now - sessionEndTime`), so a game's timer resumes where it stopped, the same rule as the session clock.
  This also keeps the game length recorded in game history / CSV (endedAt - startedAt) honest.
- Safety net: cap the court timer display (over 99 min shows `99:00+`), so bad data can never show nonsense on a TV.
- Not affected: matchmaking. Wait fairness counts rounds (`lastPlayedRound`), not clock time.
- Already-continued sessions keep their old timestamps (the fix applies from the next Continue).
- Test: unit test that Continue shifts unfinished courts by the gap and leaves finished ones alone;
  browser check by ending a session, faking a long gap, and continuing.

## Phase 1: logo swap

Every page loads the same few files, so this is mostly asset work:
- `logo.png` → used in index, dashboard, app, play, view, checkin, shop (header + hero). Split into
  `logo.png` (badge, for big spots) and `logo-mark.png` (monogram, for headers); update the `<img>`
  sizing per page, because the badge is wider than tall and the old logo was a 3:1 wordmark.
- `favicon.png`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/maskable-512.png`
  (needs a safe-zone margin), `icons/apple-touch-icon.png` → from the square tile / monogram.
- `og-image.png` (1200×630 link preview) → rebuild with the badge.
- Shop order slip (canvas) and recap image draw `../logo.png` / logo → check they still look right.
- Bump the SW cache (`pickled-v28` → v29) so installed apps pick up the new icons. Note: phones that
  installed the app may keep the old home-screen icon until they reinstall (same as the domain move).

## Phase 2: app name (after decision 1)

- `manifest.webmanifest` name/short_name, `apple-mobile-web-app-title` on 7 pages, `<title>`s,
  og/twitter titles, offline.html, sw.js comment. "Paddle District" stays as the community name.
- short_name must fit under a home-screen icon (≈12 chars): "PD Live" / "On Deck" fit, "District Live" is borderline.

## Phase 3: live view team colors - DONE 2026-10-06 (live)

Shipped: `--teamA`/`--teamB` tints per theme in view.html (light #E5EFD3 / #DCEBF6, dark #2F4A1C / #1C3549),
`.team-a`/`.team-b` on court cards and Next Up/On Deck cards; tests/view-team-colors.test.js.


- view.html: `.team-view` gets `.team-a` / `.team-b` classes with light tints (light + dark mode),
  label "Team A"/"Team B" tinted to match. Same tint on Up Next / queue team blocks.
- UI only; no match or queue logic touched.

## Phase 4: 3-courts compact stacked layout

Only when the session has exactly 3 courts (doc: "For 3 courts lang"):

```
┌ Court 1 ── 12:41 ── Rd 21 ─────────────────────────────────┐
│ [Team A] Franklin · Alexa Gabrielle   VS   Amy · Che [Team B] │
├ Court 2 ── 08:02 ── Rd 22 ─────────────────────────────────┤
│ [Team A] jake · Ton Ton               VS   Johanna · March  [Team B] │
├ Court 3 ── 03:15 ── Rd 19 ─────────────────────────────────┤
│ [Team A] Lucille · Harold             VS   Macky · Mira     [Team B] │
└───────────────────────────────────────────────────────────────┘
```
- `balanceCourtGrid`/`renderCourts` in view.html: n === 3 → one column, each court a short row,
  Team A block left, Team B block right (with the Phase 3 colors). Other court counts unchanged.
- Check on TV landscape (1920×1080) and phone (390px): on phones it already stacks, so it just gets compact.
- UI only; matchmaking untouched (standing rule).

## Verification (every phase)

- `npm test` (321 now) + new tests for the timer offset/cap and the 3-court layout class.
- Browser check of every page in light + dark, phone + desktop + 1920 TV; compare before/after screenshots.
- After deploy: check padq.app in a fresh browser context (Pages caches pages for 10 min).

## Order and size

Phase 0 (small, real bug) → 3 + 4 together (one file, view.html) → 1 (assets, can wait for Jude's transparent badge) → 2 (needs the name).
Each phase ships on its own.
