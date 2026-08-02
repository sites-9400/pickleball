# Pre-Game Assistant ("Help me choose") — Design Spec

**Date:** 2026-08-03
**Status:** Approved — ready to implement
**Location:** `dashboard.html` (New Session card)

## Problem

Creating a session forces the organizer to pick a **Matchmaking** style from a
dropdown of 8 modes (Round robin, King of the court, Challenge courts, Numbering,
By wait time, Balanced, Manual, Bracket) plus a **Format** (Doubles/Singles). Each
has a one-line description, but a non-expert host has no way to reason from "what
kind of night do I want" to the right mode. They pick blind, and a wrong pick makes
for a bad session.

## Goal

An optional **"Help me choose"** assistant that interviews the organizer in plain
English and **pre-fills** the two existing dropdowns with a recommendation. It never
starts the session itself — the organizer still taps **Start**, keeping full control.

## Non-goals

- Not a chatbot / no LLM. This is a deterministic decision tree — works offline.
- Does not replace the dropdowns; they remain fully usable.
- Does not add, persist, or change any session data model. It only sets the values of
  `#newSessionFormat` and `#newSessionMatchmaking`.
- Does **not** build a new matchmaking mode. (See "Future" — Pair Play.)

## Placement & behavior

- A full-width **"✦ Help me choose"** button sits in the New Session card, below the
  Format/Matchmaking row, above **Start New Session**.
- Tapping it opens a **centered modal dialog** (not a bottom sheet — avoids clipping
  and keyboard-hiding). Closable via ✕, backdrop tap, or the flow completing.
- On a recommendation, **Use this setup** sets both dropdowns, closes the modal,
  refreshes the mode description + Start-button label (`updateModeDesc()`), and flashes
  the two selects with a toast (`Filled in: <Mode> <Format>`).
- The assistant is **client-only** — no Firebase, no auth dependency.

## The decision tree (≤ 4 steps to a recommendation)

Progress shown as three dots; a **‹ Back** control in the header pops one step on every
screen after the first.

```
Step 1  Format
        Doubles (2v2)  |  Singles (1v1)

Step 2  Partners  (the primary fork)
        Shuffle partners each game →  |  Stick with their partner →

── Path A · Shuffle each game ──────────────────────────
Step 3A  Vibe  (order as listed)
   Mix it up — fresh matchups .......... random   (Numbering)
   Fair & equal for everyone ........... waittime (By wait time)
   Even games by skill level ........... balanced (Doubles) / waittime (Singles*)
   Competitive — win to stay on ........ challenge(Challenge courts)

── Path B · Stick with partner (fixed teams) ───────────
Step 3B  Roster
   Everyone's here, set list → Step 4B
   Still arriving / drop-in ............ ladder   (King of the court)

Step 4B  Structure  (only when roster is set)
   Everyone plays everyone ............. roundrobin
   Knockout bracket .................... roundrobin + "bracket coming soon" note‡
   Just casual games together .......... roundrobin + "Pair Play" gap note§

Step 4 (all paths)  How big is tonight?   — see "Size step"
```

\* **Singles + Balanced:** singles has no teams to balance, so it maps to `waittime`
and the result card says so ("Singles has no teams to balance, so this runs as By wait
time").

‡ **Bracket:** not built yet. The knockout choice recommends `roundrobin` with a
"Coming soon — knockout brackets aren't built yet" note.

§ **Casual fixed-partner gap:** no casual drop-in mode keeps partners together today.
Recommends `roundrobin` (closest) with an honest teal note pointing at a future
**Pair Play** mode. See `pickleball-pair-play-mode-idea` in project memory.

### Leaf → mode summary

| Path | Answer | Mode value | Label |
|---|---|---|---|
| A | Mix it up | `random` | Numbering |
| A | Fair & equal | `waittime` | By wait time |
| A | Even by skill (Doubles) | `balanced` | Balanced |
| A | Even by skill (Singles) | `waittime` | By wait time (remapped) |
| A | Competitive | `challenge` | Challenge courts |
| B | Still arriving | `ladder` | King of the court |
| B | Everyone plays everyone | `roundrobin` | Round robin |
| B | Knockout bracket | `roundrobin` | Round robin (+ coming-soon note) |
| B | Just casual together | `roundrobin` | Round robin (+ Pair Play note) |
| result | "I'll set matches myself" | `manual` | Manual (escape hatch) |

## Size step ("How big is tonight?")

- Always the **last** step, right before the result. **Skippable** ("Skip — just show
  the pick") so the quick path is never blocked.
- Two **type-in number boxes** (no stepper arrows, spinner hidden): **Expected players**
  and **Courts**. Defaults 12 / 3. Bounds: players 2–60, courts 1–12 (clamped on read).
- `inputmode="numeric"` so phones show the numeric keypad.

### Keyboard-safe requirement (mobile)

Focusing a number box must never leave the inputs, **Continue**, or **Skip** hidden
behind the on-screen keyboard. Implementation:

1. `inputmode="numeric"` (compact keypad).
2. Use the **`visualViewport`** API: while the modal is open, on `resize`/`scroll` set
   the overlay's height to `visualViewport.height` and top to its offset, and when the
   keyboard is open anchor the sheet to the top (`align-items:flex-start`). This keeps
   the whole sheet within the visible area above the keyboard.
3. On focus, `scrollIntoView({block:'center'})` as a fallback.

## Result card

- Badge "✓ We recommend" + **`<Mode> <Format>`** title + one-line rationale.
- **Guidance line** (only when size provided):
  - Round robin: `<teams> teams · <games> games · about <mins> min on <C> courts`
    where `teams = floor(P / teamSize)`, `games = teams·(teams−1)/2`,
    `rounds = ceil(games / C)`, `mins = round(rounds·12 / 5)·5`.
  - Other modes: `<onCourt> on court · about <waiting> waiting each round on <C> courts`
    where `onCourt = min(P, C·matchSize)`, `waiting = max(0, P − onCourt)`.
  - `teamSize = 1` (singles) or `2` (doubles); `matchSize = teamSize·2`.
- **Feasibility / poor-fit notes:**
  - `P < matchSize` → "Heads up — you'll need at least `<matchSize>` players to fill a
    `<format>` court."
  - Round robin with `teams > 8` → "Big group — that's a long fixed schedule
    (`<games>` games). By wait time keeps a crowd this size moving." + a **Switch to By
    wait time** button that re-renders the result for `waittime`.
- **Show other options** (collapsed): 1–2 runner-ups per leaf + **"I'll set matches
  myself (Manual)."** Each has a **Use →** that applies immediately.
- **Use this setup** applies the primary recommendation.

### Runner-ups per mode

`waittime → [random, balanced]`, `balanced → [waittime, random]`,
`random → [waittime, balanced]`, `challenge → [ladder, waittime]`,
`ladder → [roundrobin, challenge]`, `roundrobin → [ladder, manual]`.

## Visual / interaction

- **No emoji.** Sparkle, check, and chevron are inline **stroked SVG** matching the
  app's existing chevron style. Choice rows are typographic (bold title + muted subline
  + chevron) with an accent left-rule on hover.
- Uses existing theme tokens (`--army`, `--accent`, `--army-pale`, etc.) and the
  Montserrat face already loaded by the dashboard.
- Respects `prefers-reduced-motion`; visible focus states on all controls.

## Testing

Manual browser pass over every branch (Firebase not required for the assistant):
Doubles/Singles × each vibe; both roster paths; structure incl. bracket + casual-gap;
Singles+Balanced remap; size guidance for round robin (small vs `teams>8` nudge) and a
rotating mode; the `P < matchSize` warning; Skip; each runner-up + Manual; **Use this
setup** correctly sets both selects and updates the Start button label; keyboard-safe
behavior on a narrow viewport.

## Future

**Pair Play** mode — fixed partners matched by wait-time fairness, casual/drop-in. The
proper answer to the casual fixed-partner gap this assistant currently routes to Round
robin. Its own spec someday. Tracked in memory as `pickleball-pair-play-mode-idea`.
