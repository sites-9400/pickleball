// Pickled service worker — installable shell + offline fallback.
// Strategy: navigations AND same-origin scripts are network-first (online users
// always get the newest deploy, and a fresh page is never paired with a stale
// script: that pairing crashed view.html's ended screen on 2026-09-26), other
// static assets (icons, manifest) are stale-while-revalidate, version-pinned CDN modules are cache-first, and
// Firebase auth/database traffic is never intercepted. Real offline play is
// the separate local-first milestone — this only keeps the shell usable.
const CACHE = 'pickled-v34';
const PRECACHE = [
  './index.html',
  './dashboard.html',
  './app.html',
  './view.html',
  './checkin.html',
  './offline.html',
  './common.js',
  './tournament.js',
  './cohost.js',
  './recap.js',
  './manifest.webmanifest',
  './favicon.png',
  './icons/icon-192.png',
];
// CDN hosts we cache (version-pinned URLs). Everything else cross-origin —
// Firebase RTDB/Auth, Google sign-in — passes through untouched.
const CDN_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putCopy(req, res) {
  const copy = res.clone();
  caches.open(CACHE).then(c => c.put(req, copy));
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = CDN_HOSTS.includes(url.host);
  if (!sameOrigin && !cdn) return; // live Firebase traffic: hands off

  if (req.mode === 'navigate') {
    // ignoreSearch so app.html?session=X falls back to the cached shell
    e.respondWith(
      fetch(req).then(res => putCopy(req, res)).catch(() =>
        caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./offline.html')))
    );
    return;
  }

  if (cdn) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => putCopy(req, res)))
    );
    return;
  }

  // same-origin script or data (shop/inventory.json stock counts): network-first,
  // cached copy only when offline
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.json')) {
    e.respondWith(fetch(req).then(res => putCopy(req, res)).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }

  // other same-origin asset: serve cache immediately, refresh it in the background
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => putCopy(req, res)).catch(() => hit);
      return hit || net;
    })
  );
});
