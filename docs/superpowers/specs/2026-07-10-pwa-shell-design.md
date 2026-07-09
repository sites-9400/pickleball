# PWA Shell — Design

**Date:** 2026-07-10 · **Status:** approved (name: "Pickled")

## Goal

Make the site an installable PWA: add-to-home-screen on iOS/Android, instant
loads from cache, and a friendly offline screen when internet drops.
**Out of scope:** playing sessions offline (that is the separate local-first
core milestone) and app-store packaging (Capacitor, later).

User constraint: **do not deploy** until verified locally and user has tried it.

## Approach

Hand-written service worker (~60 lines), no build tools — matches the repo's
zero-tooling philosophy. Workbox and PWABuilder rejected as machinery
disproportionate to 5 static pages.

## Components

1. **`manifest.webmanifest`** — name/short_name **"Pickled"**, `start_url:
   "./index.html"`, `scope: "./"`, `display: standalone`, theme `#4A5C2F`
   (army green), background `#ffffff`. Icons generated from `logo.png` (white
   background, so plain resizes): `icons/icon-192.png`, `icons/icon-512.png`,
   `icons/maskable-512.png` (logo at ~80% on white, `purpose: maskable`),
   `icons/apple-touch-icon.png` (180px). All paths relative — GitHub Pages
   serves under `/pickleball/`.

2. **`sw.js`** (site root, scope `./`) —
   - **Navigations (HTML): network-first**, fall back to cached page, then
     `offline.html`. Online users always get the newest deploy; no stale-app
     footgun.
   - **Same-origin static assets: stale-while-revalidate** (instant, refreshed
     in background).
   - **CDN modules** (gstatic Firebase 11.0.0, cdnjs qrcode): cache-first —
     version-pinned URLs.
   - **Never intercepted:** non-GET, Firebase Auth/RTDB traffic
     (`*.firebasedatabase.app`, `*.googleapis.com`, `*.firebaseapp.com`) —
     live data stays live.
   - Versioned cache name (`pickled-v1`); `activate` deletes old caches;
     `skipWaiting` + `clients.claim`.

3. **`offline.html`** — small branded offline screen with a Retry button.

4. **Registration** — guarded one-liner in `common.js`
   (`typeof navigator !== 'undefined' && 'serviceWorker' in navigator`);
   `index.html` and `checkin.html` gain the `common.js` script tag (collision
   check required first). Head tags on all five pages: manifest link,
   `theme-color`, `apple-touch-icon`, `apple-mobile-web-app-title` "Pickled".

## Error handling

- SW fetch handler never throws: any cache/network miss on a navigation ends
  at `offline.html` (precached at install).
- Registration failure is silent (app works exactly as today without SW).

## Testing

- `tests/pwa.test.js`: manifest parses with required fields; every precache
  path in `sw.js` exists on disk; all five pages carry manifest link +
  registration; `node --check` passes on `sw.js`.
- Local E2E (no deploy): serve repo with `python3 -m http.server`, drive with
  Playwright — SW controls the page after reload; kill the server and reload
  to prove cache serving; navigate uncached → `offline.html`.
