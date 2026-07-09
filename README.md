# PickleDistrict Modes

Pickleball open-play organizer — a static, single-page-per-screen app
(GitHub Pages) synced through Firebase Realtime Database.

## Pages

- `index.html` — login (Google / email)
- `dashboard.html` — session list, create/delete sessions
- `app.html` — admin: players, courts, match modes, scores, co-hosts
- `view.html` — public read-only live view (projector/phone)
- `checkin.html` — anonymous player self-check-in

Shared logic lives in `tournament.js` and `cohost.js` (ES modules).

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
