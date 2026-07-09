// Loads app.html's classic <script> block into a Node VM with a mocked DOM,
// so tests can drive the real functions offline (the live app is Firebase-gated).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as T from '../tournament.js';
import * as C from '../cohost.js';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app.html');
const COMMON = join(dirname(fileURLToPath(import.meta.url)), '..', 'common.js');

export function loadApp() {
  const html = readFileSync(APP, 'utf8');
  const start = html.indexOf('<script>\n// ===== STATE =====');
  if (start < 0) throw new Error('classic script block not found in app.html');
  const end = html.indexOf('</script>', start);
  const code = html.slice(start + '<script>'.length, end);

  const captured = {};   // id -> last innerHTML written
  const els = {};        // id -> fake element
  // A real innerHTML replacement rebuilds child <input>s from their value
  // attributes; mirror that so re-renders reset fake input values too.
  function syncInputsFromHtml(html) {
    for (const m of String(html).matchAll(/<input[^>]*\bid="([^"]+)"[^>]*\bvalue="([^"]*)"/g)) {
      (els[m[1]] ||= fakeEl(m[1])).value = m[2];
    }
  }
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
      set innerHTML(v) { captured[id] = v; syncInputsFromHtml(v); },
      get innerHTML() { return captured[id] || ''; },
    };
  }
  const documentMock = {
    getElementById: id => (els[id] ||= fakeEl(id)),
    querySelector: () => fakeEl('_q'),
    querySelectorAll: sel => sel === '.ct-score'
      ? Object.values(els).filter(e => /^score[12]_/.test(e.id))
      : [],
    createElement: () => fakeEl('_c'),
    documentElement: fakeEl('_root'),
    activeElement: null,
    body: { appendChild() {} },
  };
  const windowMock = {
    addEventListener() {},
    location: { pathname: '/app.html', origin: 'https://example.test', href: '' },
    computeIdentity: C.computeIdentity, accessState: C.accessState,
    joinEligibility: C.joinEligibility, genCohostToken: C.genCohostToken,
    buildCohostLink: C.buildCohostLink,
    skillBalancedTeams: T.skillBalancedTeams, bestSkillMatch: T.bestSkillMatch,
    checkinToPlayer: T.checkinToPlayer, resolveChallengeCourt: T.resolveChallengeCourt,
    buildTeams: T.buildTeams, generateRoundRobin: T.generateRoundRobin,
    computeStandings: T.computeStandings, nextEligibleMatch: T.nextEligibleMatch,
  };
  const ctx = vm.createContext({
    document: documentMock, window: windowMock,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    setInterval() { return 1; }, clearInterval() {},
    setTimeout() { return 1; }, clearTimeout() {},
    confirm() { return true; }, prompt() {},
    console, Date, Math, JSON, Object, Array, String, Number, Promise,
    ResizeObserver: class { observe() {} },
  });
  // common.js loads as a classic script before the page script, same as the page
  vm.runInContext(readFileSync(COMMON, 'utf8'), ctx);
  vm.runInContext(code, ctx);
  vm.runInContext('showToast = () => {};', ctx);
  const run = js => vm.runInContext(js, ctx);
  return { run, captured, els, windowMock };
}

// Minimal-but-valid remote snapshot; override fields per test.
export function snap(over = {}) {
  return {
    ownerId: 'owner1', name: 'Test Session', sessionName: 'Test Session',
    sessionStartTime: 1700000000000, sessionEnded: false, checkinOpen: true,
    players: { _empty: true }, courts: { _empty: true }, courtDefs: { _empty: true },
    matchQueue: { _empty: true }, gameHistory: { _empty: true }, queueOrder: { _empty: true },
    globalRound: 0, playerIdCounter: 0, courtIdCounter: 0, mqIdCounter: 0,
    ...over,
  };
}
