// Loads view.html's module <script> block into a Node VM with a mocked DOM and
// stubbed Firebase, so tests can drive the real viewer functions offline.
// The import lines are stripped; their bindings are provided via the context.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as T from '../tournament.js';

const VIEW = join(dirname(fileURLToPath(import.meta.url)), '..', 'view.html');
const COMMON = join(dirname(fileURLToPath(import.meta.url)), '..', 'common.js');

export function loadView({ computeStandings = T.computeStandings } = {}) {
  const html = readFileSync(VIEW, 'utf8');
  const start = html.indexOf('<script type="module">');
  if (start < 0) throw new Error('module script block not found in view.html');
  const end = html.indexOf('</script>', start);
  let code = html.slice(start + '<script type="module">'.length, end);
  code = code.replace(/^import .*$/gm, '');

  const captured = {};   // id -> last innerHTML written
  const els = {};        // id -> fake element
  function fakeEl(id) {
    return {
      id, style: {}, dataset: {}, value: '', textContent: '',
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        toggle(c) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); return this._set.has(c); },
        contains(c) { return this._set.has(c); },
      },
      setAttribute() {}, getAttribute() { return null; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      addEventListener() {},
      clientWidth: 800,
      set innerHTML(v) { captured[id] = v; },
      get innerHTML() { return captured[id] || ''; },
    };
  }
  const documentMock = {
    getElementById: id => (els[id] ||= fakeEl(id)),
    querySelector: () => fakeEl('_q'),
    querySelectorAll: () => [],
    createElement: () => fakeEl('_c'),
    documentElement: fakeEl('_root'),
    body: { appendChild() {} },
  };
  const windowMock = {
    addEventListener() {},
    location: { search: '?session=testsession', pathname: '/view.html', origin: 'https://example.test', href: 'https://example.test/view.html?session=testsession' },
  };
  const ctx = vm.createContext({
    document: documentMock, window: windowMock,
    console, URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    setInterval() { return 1; }, clearInterval() {},
    setTimeout() { return 1; }, clearTimeout() {},
    // Firebase stubs (imports are stripped above)
    initializeApp() { return {}; }, getDatabase() { return {}; },
    getAuth() { return {}; }, ref() { return {}; }, onValue() {},
    signInAnonymously() { return Promise.resolve({}); },
    onAuthStateChanged() {},
    computeStandings,
  });
  // common.js loads as a classic script before the page script, same as the page
  vm.runInContext(readFileSync(COMMON, 'utf8'), ctx);
  vm.runInContext(code, ctx);
  const run = js => vm.runInContext(js, ctx);
  const call = (fn, ...args) => {
    ctx.__args = args;
    return vm.runInContext(`${fn}(...__args)`, ctx);
  };
  return { run, call, captured, els, windowMock };
}
