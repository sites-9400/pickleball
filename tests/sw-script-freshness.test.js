// 2026-09-26: the service worker served same-origin scripts stale-while-revalidate but
// pages network-first, so the first visit after a deploy paired the new view.html with
// the old recap.js and the ended screen crashed. Scripts are now network-first too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadSW({ cached, network }) {
  const handlers = {};
  const store = new Map(Object.entries(cached));
  const cache = { put: async (req, res) => { store.set(new URL(req.url).pathname, res); }, addAll: async () => {} };
  const ctx = vm.createContext({
    self: { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://padq.app' },
            skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async () => cache, keys: async () => [],
              match: async req => store.get(new URL(typeof req === 'string' ? 'https://padq.app/' + req : req.url).pathname) },
    fetch: async req => { if (network == null) throw new TypeError('offline'); return network(req); },
    URL, Promise,
  });
  vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), ctx);
  const get = path => new Promise(resolve => handlers.fetch({
    request: { method: 'GET', mode: 'no-cors', url: 'https://padq.app' + path },
    respondWith: p => resolve(p),
  }));
  return { get };
}
const res = body => ({ body, clone() { return res(body); } });

test('online: a script comes from the network even when an older copy is cached', async () => {
  const sw = loadSW({ cached: { '/recap.js': res('old') }, network: () => res('new') });
  assert.equal((await sw.get('/recap.js')).body, 'new');
});

test('offline: a script falls back to the cached copy', async () => {
  const sw = loadSW({ cached: { '/recap.js': res('old') }, network: null });
  assert.equal((await sw.get('/recap.js')).body, 'old');
});

test('recap.js is precached for offline use', () => {
  assert.match(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /'\.\/recap\.js'/);
});

// Shop stock lives in shop/inventory.json; a stale copy would show sold items as available.
test('online: shop inventory comes from the network even when an older copy is cached', async () => {
  const sw = loadSW({ cached: { '/shop/inventory.json': res('old') }, network: () => res('new') });
  assert.equal((await sw.get('/shop/inventory.json')).body, 'new');
});

test('offline: shop inventory falls back to the cached copy', async () => {
  const sw = loadSW({ cached: { '/shop/inventory.json': res('old') }, network: null });
  assert.equal((await sw.get('/shop/inventory.json')).body, 'old');
});
