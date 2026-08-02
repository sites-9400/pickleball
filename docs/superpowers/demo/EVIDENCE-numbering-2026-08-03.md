# Evidence — Numbering mode (fair-weighted + anti-repeat)

Generated 2026-08-03 by driving the **real branch `app.html`** in a browser (Playwright),
Firebase stubbed for auth + DB only. Everything else — `chooseMatchPlayers → fairWeightedMatch`,
`rebuildMatchQueue`/`MAX_QUEUED`, rendering — is the real shipped code.

## Setup (matches today's real conditions)
- **40 players, 4 courts, 5-hour session** (300 min), staggered court starts, game lengths
  sampled ~15 min avg → **79 games** (today's real night was 76).
- Mode: Doubles · Numbering.

## Result vs today's actual open play

| Metric | Today (actual, old code) | New code (this run) |
|---|---|---|
| Games | 76 | 79 |
| Opponent pairs met 3+ times | **12** | **0** |
| Max times facing same opponent | **4** | **2** |
| Partner pairs repeated | many | 5 (max 2×) |
| Games per player (min/avg/max) | 4/9/13 | 5/7.9/10 |
| On-deck depth | 3 | **1** |

## Screenshots (this folder)
- `numbering-4courts-40players-5hr-courts.png` — live court board, 4 courts, real Numbering matchups
- `numbering-4courts-40players-5hr-attendance.png` — 40/40 checked in
- `numbering-4courts-40players-5hr-rankings.png` — games-played spread (fairness)

Reproduce anytime with the `/test-this-mode` skill (`.claude/skills/test-this-mode/`).
Note: at **5 courts** the same session yields 0 partner repeats too — one more reason to run
5 courts for ~40 players.
