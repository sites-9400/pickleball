// Loads index.html's auth <script type="module"> with Firebase imports
// rewritten to the controllable stub (fbstub-index.mjs), so tests can drive
// the real sign-in/sign-up flows offline.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const INDEX = join(TESTS, '..', 'index.html');

function fakeEl(id) {
  return {
    id, style: {}, value: '', textContent: '', className: '', disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  };
}

export async function loadIndexAuth() {
  const html = readFileSync(INDEX, 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('module script not found in index.html');
  const stubUrl = pathToFileURL(join(TESTS, 'fbstub-index.mjs')).href;
  const body = m[1].replace(/from ['"]https:\/\/[^'"]+['"]/g, `from '${stubUrl}'`);
  const dir = mkdtempSync(join(tmpdir(), 'idxauth-'));
  const file = join(dir, 'index-auth.mjs');
  writeFileSync(file, body);

  // Globals the module references at top level and inside handlers.
  const els = {};
  const location = {
    pathname: '/pickleball/index.html',
    _href: '', get href() { return this._href; }, set href(v) { this._href = v; },
  };
  globalThis.document = { getElementById: id => (els[id] ||= fakeEl(id)) };
  globalThis.window = { location };
  // navigator is a getter-only global in Node — override via defineProperty
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1' },
    configurable: true,
  });
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };

  const stub = await import(stubUrl);
  stub.state.authCallbacks.length = 0;
  stub.calls.sets.length = 0;
  await import(pathToFileURL(file).href);
  const el = id => globalThis.document.getElementById(id); // auto-creates
  return { els, el, location, stub, win: globalThis.window };
}
