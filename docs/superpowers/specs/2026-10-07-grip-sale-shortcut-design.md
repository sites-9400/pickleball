# Grip sale shortcut — design

Approved 2026-10-07.

## Goal
Jude logs a grip sale into the POS sheet ("LOCO" spreadsheet, tab `POS - Grips`)
from her iPhone with one Shortcut, no spreadsheet editing.

## Flow (iPhone Shortcut "Log grip sale")
1. Shortcut GETs the catalog from the web app: one line per in-stock grip,
   `Tough Cookie · Blue Velvet (Dark Blue) · 4 left`.
2. Choose from List (grip + color in one tap).
3. Ask for Number: qty (default 1).
4. Ask for Text: customer name (required).
5. Choose from List: Cash / GCash / Maribank / Not paid yet.
6. POST JSON `{key, item, qty, name, payment}` to the web app.
7. Show the reply: `Logged: 1 × Tough Cookie Blue Velvet (Dark Blue) for Alexa · ₱150 · 3 left`.

## Web app (standalone Apps Script project, `scripts/pos-grip-sale.gs`)
Standalone (opens the sheet with `openById`) because the sheet's own bound script
already has a `doPost`; that script is left untouched.
- Deployed as web app, execute as owner, access Anyone; every call must carry
  the secret `KEY` (kept out of this public repo).
- `doGet`: catalog lines from stock table B7:G18 (model, color, price, available),
  in-stock rows only. No buyer data ever returned.
- `doPost`: validates key, item (matched back to a stock row), qty ≥ 1 and
  ≤ available, payment, non-empty name. Under `LockService`, finds the first
  row in 23–113 where B–F, I, J, L are all blank and writes:
  B date (today, Asia/Manila), C name, D model, E color, F qty,
  I payment (blank if not paid), J amount paid (qty × price, or 0),
  L `Paid` / `Unpaid`.
- Never writes G, H, K (array-formula spill columns) or N (color helper).
- Log full (no free row ≤ 113, the SUMIFS range end) → refuse with
  "Log is full, tell Eve".
- Errors reply `Not logged: <reason>`; nothing is written.

## Side effects
Stock table and the public Shop Feed (padq.app/shop) update from the sheet's
own formulas.

## Testing
- Local Node harness runs the real .gs against a mocked sheet built from the
  tab's current layout: happy path, unpaid, out of stock, bad key, bad item,
  missing name, log full, formula columns untouched.
- User deploys and tries a real sale on the phone.
