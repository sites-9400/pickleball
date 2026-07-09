// PWA shell — manifest validity, service-worker precache integrity, and
// per-page wiring (manifest link + registration path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'dashboard.html', 'app.html', 'view.html', 'checkin.html'];

test('manifest is valid and its icons exist', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Pickled');
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url && m.scope, 'start_url and scope required');
  assert.ok(!m.start_url.startsWith('/'), 'must be relative (GitHub Pages subpath)');
  assert.ok(m.icons.length >= 3);
  for (const icon of m.icons) {
    assert.ok(existsSync(join(ROOT, icon.src)), `${icon.src} missing`);
  }
  assert.ok(m.icons.some(i => i.purpose === 'maskable'), 'maskable icon required');
});

test('sw.js parses and every precached path exists', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const check = spawnSync(process.execPath, ['--check', join(ROOT, 'sw.js')]);
  assert.equal(check.status, 0, String(check.stderr));
  const m = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
  assert.ok(m, 'PRECACHE list not found');
  const paths = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.ok(paths.length >= 10, 'suspiciously small precache list');
  for (const p of paths) {
    assert.ok(existsSync(join(ROOT, p)), `precached ${p} missing on disk`);
  }
  for (const page of PAGES) {
    assert.ok(paths.includes(`./${page}`), `${page} not precached`);
  }
});

test('every page links the manifest and loads the registering script', () => {
  for (const page of PAGES) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    assert.ok(html.includes('rel="manifest"'), `${page}: manifest link missing`);
    assert.ok(html.includes('src="common.js"'), `${page}: common.js (SW registration) missing`);
    assert.ok(html.includes('apple-touch-icon'), `${page}: apple-touch-icon missing`);
  }
  const common = readFileSync(join(ROOT, 'common.js'), 'utf8');
  assert.ok(common.includes("serviceWorker.register('./sw.js')"), 'registration missing in common.js');
});
