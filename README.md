# PickleDistrict Modes

Pickleball open-play organizer — a static, single-page-per-screen app
(GitHub Pages) synced through Firebase Realtime Database.

## Pages

- `index.html` — login (Google / email)
- `dashboard.html` — session list, create/delete sessions
- `app.html` — admin: players, courts, match modes, scores, co-hosts
- `view.html` — public read-only live view (projector/phone)
- `checkin.html` — anonymous player self-check-in

- `shop/index.html` — public shop at padq.app/shop (paddles + grips, cart,
  order-slip image sent to Jude on Messenger). Checkout: **Pay now** (Jude's
  GCash/MariBank InstaPay QR, the buyer adds their payment screenshot, which is
  drawn onto the slip in the browser and never uploaded) or **Chat with Jude
  first** (unpaid slip; also for installments). Shipping is settled in chat.
  QRs: `shop/img/pay-gcash.png`, `shop/img/pay-maribank.png` (Jude OK'd posting).
  Jude confirms payments in her own GCash/bank app. No AI receipt check yet.

Shared logic lives in `tournament.js` and `cohost.js` (ES modules) and
`common.js` (classic script of page helpers — escaping, Firebase array
normalizers, formatters — loaded before each page's own code).

`view.html` and `checkin.html` sign players in anonymously, so most Firebase
Auth accounts are anonymous player devices; real (Google) accounts are hosts.

## Shop stock

Stock is read live from the POS Google Sheet's **Shop Feed** tab (formulas
only: model, color, price, qty of unsold stock; no buyer data), published to
the web as CSV. Only that tab is published; never publish the whole sheet.
`shop/inventory.json` is a fallback snapshot:
`~/.claude/gdocs-env/bin/python scripts/sync-shop.py`. Brand facts, photos
(`shop/img/<line>-<color>.jpg`) and pre-order cards (`COMING`) live in
`shop/index.html`.

## Grip sale shortcut (POS)

Jude logs grip sales from her iPhone with the Shortcut **"Log grip sale"**:
pick grip+color (list shows live stock), qty, customer name, payment
(Cash / GCash / Maribank / Not paid yet). It talks to a **standalone** Apps
Script web app (`scripts/pos-grip-sale.gs`, opens the sheet by ID) that writes
the sale into the first empty row of the `POS - Grips` log (rows 23–113).
The sheet's own bound Apps Script has an unrelated `doPost` and is left alone.
The real secret key is only in the deployed script and the Shortcut, never in
this public repo. Spec: `docs/superpowers/specs/2026-10-07-grip-sale-shortcut-design.md`.

- To redeploy changed code, make a **New deployment** (editing the existing one
  kept serving the old version) and give the new `/exec` URL to the Shortcut.
- To undo a sale, **clear the cells**, never delete the row: deleting rows
  shrinks the stock/revenue formula ranges (23–113).
- Paddles are not covered yet.

## Tests

```bash
npm test          # node --test tests/*.test.js
```

The live app is auth-gated, so tests run the real page logic offline:
`tests/*-harness.mjs` load the actual scripts from `app.html`, `index.html`,
and `view.html` into a Node VM with a mocked DOM and stubbed Firebase, and
tests drive the real functions.

## Deploying

Pushing to `main` deploys via GitHub Actions Pages
(`.github/workflows/deploy-pages.yml`). Firebase rules are **not** deployed
automatically: paste `docs/firebase-rules.json` into Firebase Console →
Realtime Database → Rules whenever it changes.
