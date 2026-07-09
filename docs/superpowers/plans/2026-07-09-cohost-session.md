# Co-host Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a session owner grant a second logged-in account full admin access to an Open Play session via a token-gated invite link, per `docs/superpowers/specs/2026-07-06-cohost-session-design.md`.

**Architecture:** Pure decision logic (identity, join eligibility, dashboard entry classification, token/link helpers) goes in a new `cohost.js` ES module, tested with `node --test` like `tournament.js`. `app.html` wires it in: the module `<script type="module">` owns all Firebase reads/writes (exposed as `window._*` bridges), the classic `<script>` owns state + rendering. `dashboard.html` imports `cohost.js` directly. Firebase security rules are already committed in `docs/firebase-rules.json` (`be8280d`) — they get pasted into the console in the final task.

**Tech Stack:** Vanilla JS single-file HTML apps, Firebase Realtime Database (compat-free v11 modular SDK from CDN), GitHub Pages hosting (no build step), `node --test` for tests.

## Global Constraints

- **Do NOT `git push` until Task 6.** GitHub Pages auto-deploys `main`; the Firebase rules must be pasted into the console (Task 6) before co-host code goes live. Commit locally after every task.
- **Never add `cohosts` or `cohostOpen` to `saveState()`'s data object** (`app.html` ~line 1386). `update()` is atomic; `cohostOpen` is owner-only in rules, so including it would reject a co-host's *entire* save. Co-host management uses dedicated `set()`/`remove()` calls on subpaths.
- **Escape every user-supplied string interpolated into `innerHTML`** using the existing `esc()` helper in app.html (added in `d8fa40c`). Co-host names come from Google display names — treat as hostile.
- **No new files except `cohost.js`, `tests/cohost.test.js`, `tests/apphtml-harness.mjs`, `tests/cohost-ui.test.js`.** Everything else edits `app.html` / `dashboard.html` in place, following their existing patterns (classic script globals + `window._*` module bridges).
- Test commands: `node --test tests/cohost.test.js` and `node --test tests/cohost-ui.test.js` (run from repo root; `node --test tests/` does NOT work on this machine — pass explicit file paths).
- Line numbers below are from commit `c427205`; re-locate by the quoted anchor text if they've drifted.

---

### Task 1: Pure co-host logic module (`cohost.js`)

**Files:**
- Create: `cohost.js`
- Test: `tests/cohost.test.js`

**Interfaces:**
- Consumes: nothing (pure module, mirrors `tournament.js` style).
- Produces (used by Tasks 2–5):
  - `computeIdentity(uid, ownerId, cohosts) -> {isOwner: bool, isCohost: bool}`
  - `accessState({isOwner, isCohost, wasCohost}) -> 'owner'|'cohost'|'revoked'|'viewer'`
  - `joinEligibility({uid, isAnonymous, ownerId, cohosts}) -> {eligible: bool, reason: 'anonymous'|'owner'|'already'|'ok'}`
  - `classifyDashboardEntry({uid, entry, session}) -> 'owner'|'cohost'|'prune'`
  - `genCohostToken() -> string` (20 hex chars)
  - `buildCohostLink(origin, basePath, sid, token) -> string`

- [ ] **Step 1: Write the failing test**

Create `tests/cohost.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIdentity, accessState, joinEligibility,
  classifyDashboardEntry, genCohostToken, buildCohostLink,
} from '../cohost.js';

// ---- computeIdentity ----
test('computeIdentity: owner', () => {
  assert.deepEqual(computeIdentity('u1', 'u1', {}), { isOwner: true, isCohost: false });
});
test('computeIdentity: cohost', () => {
  assert.deepEqual(computeIdentity('u2', 'u1', { u2: { name: 'B', addedAt: 1 } }),
    { isOwner: false, isCohost: true });
});
test('computeIdentity: stranger', () => {
  assert.deepEqual(computeIdentity('u3', 'u1', { u2: {} }), { isOwner: false, isCohost: false });
});
test('computeIdentity: null cohosts and missing uid are safe', () => {
  assert.deepEqual(computeIdentity('u2', 'u1', null), { isOwner: false, isCohost: false });
  assert.deepEqual(computeIdentity(null, 'u1', { u2: {} }), { isOwner: false, isCohost: false });
});
test('computeIdentity: owner listed in cohosts is still owner, not cohost', () => {
  assert.deepEqual(computeIdentity('u1', 'u1', { u1: {} }), { isOwner: true, isCohost: false });
});

// ---- accessState ----
test('accessState transitions', () => {
  assert.equal(accessState({ isOwner: true,  isCohost: false, wasCohost: false }), 'owner');
  assert.equal(accessState({ isOwner: false, isCohost: true,  wasCohost: true  }), 'cohost');
  assert.equal(accessState({ isOwner: false, isCohost: false, wasCohost: true  }), 'revoked');
  assert.equal(accessState({ isOwner: false, isCohost: false, wasCohost: false }), 'viewer');
});

// ---- joinEligibility ----
test('joinEligibility: anonymous or missing uid blocked', () => {
  assert.deepEqual(joinEligibility({ uid: 'u2', isAnonymous: true, ownerId: 'u1', cohosts: {} }),
    { eligible: false, reason: 'anonymous' });
  assert.deepEqual(joinEligibility({ uid: null, isAnonymous: false, ownerId: 'u1', cohosts: {} }),
    { eligible: false, reason: 'anonymous' });
});
test('joinEligibility: owner blocked', () => {
  assert.deepEqual(joinEligibility({ uid: 'u1', isAnonymous: false, ownerId: 'u1', cohosts: {} }),
    { eligible: false, reason: 'owner' });
});
test('joinEligibility: already a cohost blocked', () => {
  assert.deepEqual(joinEligibility({ uid: 'u2', isAnonymous: false, ownerId: 'u1', cohosts: { u2: {} } }),
    { eligible: false, reason: 'already' });
});
test('joinEligibility: fresh logged-in user is eligible', () => {
  assert.deepEqual(joinEligibility({ uid: 'u2', isAnonymous: false, ownerId: 'u1', cohosts: null }),
    { eligible: true, reason: 'ok' });
});

// ---- classifyDashboardEntry ----
test('classify: deleted session prunes', () => {
  assert.equal(classifyDashboardEntry({ uid: 'u1', entry: {}, session: null }), 'prune');
});
test('classify: owned session renders as owner', () => {
  assert.equal(classifyDashboardEntry({ uid: 'u1', entry: {}, session: { ownerId: 'u1' } }), 'owner');
});
test('classify: flagged cohost entry with live membership renders as cohost', () => {
  assert.equal(classifyDashboardEntry({
    uid: 'u2', entry: { cohost: true },
    session: { ownerId: 'u1', cohosts: { u2: { name: 'B' } } },
  }), 'cohost');
});
test('classify: revoked cohost prunes (flag set but membership gone)', () => {
  assert.equal(classifyDashboardEntry({
    uid: 'u2', entry: { cohost: true }, session: { ownerId: 'u1', cohosts: {} },
  }), 'prune');
});
test('classify: unowned entry without cohost flag prunes', () => {
  assert.equal(classifyDashboardEntry({
    uid: 'u2', entry: {}, session: { ownerId: 'u1', cohosts: { u2: {} } },
  }), 'prune');
});

// ---- genCohostToken ----
test('genCohostToken: 20 lowercase hex chars, unique per call', () => {
  const a = genCohostToken(), b = genCohostToken();
  assert.match(a, /^[0-9a-f]{20}$/);
  assert.notEqual(a, b);
});

// ---- buildCohostLink ----
test('buildCohostLink: encodes sid and token', () => {
  assert.equal(
    buildCohostLink('https://x.test', '/pd/', 'sid 1', 'tok&2'),
    'https://x.test/pd/app.html?session=sid%201&cohost=tok%262'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cohost.test.js`
Expected: FAIL — `Cannot find module ... cohost.js`

- [ ] **Step 3: Write the implementation**

Create `cohost.js`:

```js
// Pure co-host logic. No DOM, no Firebase, no I/O.
// (crypto.randomUUID is available in both browsers and Node >= 19.)

export function computeIdentity(uid, ownerId, cohosts) {
  const isOwner = !!uid && uid === ownerId;
  const isCohost = !isOwner && !!uid && !!(cohosts && cohosts[uid]);
  return { isOwner, isCohost };
}

export function accessState({ isOwner, isCohost, wasCohost }) {
  if (isOwner) return 'owner';
  if (isCohost) return 'cohost';
  if (wasCohost) return 'revoked';
  return 'viewer';
}

export function joinEligibility({ uid, isAnonymous, ownerId, cohosts }) {
  if (!uid || isAnonymous) return { eligible: false, reason: 'anonymous' };
  if (uid === ownerId) return { eligible: false, reason: 'owner' };
  if (cohosts && cohosts[uid]) return { eligible: false, reason: 'already' };
  return { eligible: true, reason: 'ok' };
}

// Dashboard index entries (users/{uid}/sessions/{sid}) are kept only when the
// session still grants access: owned, or flagged cohost AND still in cohosts.
export function classifyDashboardEntry({ uid, entry, session }) {
  if (!session) return 'prune';
  if (session.ownerId === uid) return 'owner';
  if (entry && entry.cohost === true && session.cohosts && session.cohosts[uid]) return 'cohost';
  return 'prune';
}

export function genCohostToken() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

export function buildCohostLink(origin, basePath, sid, token) {
  return `${origin}${basePath}app.html?session=${encodeURIComponent(sid)}&cohost=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cohost.test.js`
Expected: PASS (16 tests)

Also run: `node --test tests/tournament.test.js`
Expected: PASS (28 tests, unchanged)

- [ ] **Step 5: Commit**

```bash
git add cohost.js tests/cohost.test.js
git commit -m "feat(cohost): pure co-host logic module (identity, eligibility, dashboard classify, token/link)"
```

---

### Task 2: app.html — cohost state, identity gating, read-only access

**Files:**
- Modify: `app.html` (classic script state block ~line 1324; `_fbApplyRemote` ~line 1509; `applySessionUI` ~line 1596; `saveState` ~line 1386; banner div before `<div class="tab-panel active" id="tab-players">` ~line 1044)
- Modify: `app.html` module script (`onAuthStateChanged` ~line 3293; imports ~line 3246)
- Create: `tests/apphtml-harness.mjs`
- Test: `tests/cohost-ui.test.js`

**Interfaces:**
- Consumes: `computeIdentity`, `accessState` from `cohost.js` (via `window.*` bridges).
- Produces (used by Tasks 3–4):
  - Classic globals: `cohosts` (raw uid→`{name,addedAt}` map), `cohostOpen` (bool), `_access` (`'owner'|'cohost'|'revoked'|'viewer'`), `_wasCohost` (bool)
  - Classic function: `renderAccessBanner()`
  - Module global: `window._uid` (string, set when non-anonymous auth resolves)
  - `saveState()` no-ops when `_access` is `'viewer'` or `'revoked'`

- [ ] **Step 1: Create the app.html VM test harness**

Create `tests/apphtml-harness.mjs` (mirrors the proven offline-verification approach — the live app is Firebase-auth-gated, so tests drive the real function bodies in a Node VM):

```js
// Loads app.html's classic <script> block into a Node VM with a mocked DOM,
// so tests can drive the real functions offline (the live app is Firebase-gated).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as T from '../tournament.js';
import * as C from '../cohost.js';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app.html');

export function loadApp() {
  const html = readFileSync(APP, 'utf8');
  const start = html.indexOf('<script>\n// ===== STATE =====');
  if (start < 0) throw new Error('classic script block not found in app.html');
  const end = html.indexOf('</script>', start);
  const code = html.slice(start + '<script>'.length, end);

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
```

- [ ] **Step 2: Write the failing tests**

Create `tests/cohost-ui.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

function applyAs(app, uid, over) {
  app.run(`window._uid = ${JSON.stringify(uid)};`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap(over))});`);
}

test('owner: _access owner, End Session visible, banner hidden', () => {
  const app = loadApp();
  applyAs(app, 'owner1', {});
  assert.equal(app.run('_access'), 'owner');
  assert.notEqual(app.els['sessionActionBtn'].style.display, 'none');
  assert.equal(app.els['accessBanner'].style.display, 'none');
});

test('cohost: _access cohost, End Session hidden, cohost banner shown', () => {
  const app = loadApp();
  applyAs(app, 'buddy', { cohosts: { buddy: { name: 'Buddy', addedAt: 1 } } });
  assert.equal(app.run('_access'), 'cohost');
  assert.equal(app.els['sessionActionBtn'].style.display, 'none');
  assert.equal(app.els['sessionNewBtn'].style.display, 'none');
  assert.match(app.els['accessBanner'].textContent, /Co-hosting/);
});

test('revoke: cohost removed -> revoked banner, saveState no-ops', () => {
  const app = loadApp();
  applyAs(app, 'buddy', { cohosts: { buddy: { name: 'Buddy', addedAt: 1 } } });
  applyAs(app, 'buddy', { cohosts: null }); // owner revoked
  assert.equal(app.run('_access'), 'revoked');
  assert.match(app.els['accessBanner'].textContent, /no longer a co-host/);
  app.run('window._fbWrite = () => { window.__wrote = (window.__wrote||0)+1; };');
  app.run('saveState();');
  assert.equal(app.run('window.__wrote || 0'), 0);
});

test('viewer: stranger gets view-only banner and no saves', () => {
  const app = loadApp();
  applyAs(app, 'stranger', {});
  assert.equal(app.run('_access'), 'viewer');
  assert.match(app.els['accessBanner'].textContent, /View only/);
  app.run('window._fbWrite = () => { window.__wrote = (window.__wrote||0)+1; };');
  app.run('saveState();');
  assert.equal(app.run('window.__wrote || 0'), 0);
});

test('owner: saveState still writes', () => {
  const app = loadApp();
  applyAs(app, 'owner1', {});
  app.run('window._fbWrite = () => { window.__wrote = (window.__wrote||0)+1; };');
  app.run('saveState();');
  assert.equal(app.run('window.__wrote'), 1);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/cohost-ui.test.js`
Expected: FAIL — `_access is not defined` (and banner/gating assertions fail).

- [ ] **Step 4: Implement in app.html**

**4a. State globals** — in the classic script state block, after `let checkinOpen = true;`:

```js
let cohosts = {};          // uid -> {name, addedAt} (raw Firebase map, owner-managed)
let cohostOpen = false;
let _access = 'owner';     // 'owner' | 'cohost' | 'revoked' | 'viewer' — recomputed per snapshot
let _wasCohost = false;    // once a cohost, losing membership means 'revoked' (not 'viewer')
```

**4b. saveState guard** — first line inside `function saveState() {`:

```js
  if (_access === 'viewer' || _access === 'revoked') return; // rules would reject; don't spam errors
```

**4c. Identity computation** — in `window._fbApplyRemote`, right after the line `sessionOwnerId    = s.ownerId     || '';` region ends (after `checkinOpen` is set, before `applySessionUI();`):

```js
  cohosts     = (s.cohosts && typeof s.cohosts === 'object') ? s.cohosts : {};
  cohostOpen  = s.cohostOpen === true;
  if (window._uid && window.computeIdentity) {
    const _ident = window.computeIdentity(window._uid, sessionOwnerId, cohosts);
    if (_ident.isCohost) _wasCohost = true;
    _access = window.accessState({ ..._ident, wasCohost: _wasCohost });
  }
  renderAccessBanner();
```

**4d. Access banner element** — in the HTML, immediately BEFORE `<div class="tab-panel active" id="tab-players">`:

```html
<div id="accessBanner" style="display:none;max-width:640px;margin:12px auto 0;padding:10px 14px;border-radius:10px;background:var(--surface2);color:var(--muted);border:1px solid var(--line);font-weight:700;font-size:0.8rem;text-align:center;"></div>
```

**4e. Banner renderer** — add near `applySessionUI` in the classic script:

```js
function renderAccessBanner() {
  const b = document.getElementById('accessBanner');
  if (!b) return;
  const msg = _access === 'revoked' ? "You're no longer a co-host — this session is now view-only."
            : _access === 'viewer'  ? "View only — you don't have admin access to this session."
            : _access === 'cohost'  ? "Co-hosting this session — only the owner can end or delete it."
            : '';
  b.textContent = msg;
  b.style.display = msg ? '' : 'none';
}
```

**4f. Owner-only session controls** — in `applySessionUI`, after the existing `if (sessionEnded) { ... } else { ... }` block (before `updateSessionClock();`):

```js
  // Owner-only End/New Session controls (UI-enforced per cohost spec §3)
  if (_access !== 'owner') {
    if (btn) btn.style.display = 'none';
    if (newBtn) newBtn.style.display = 'none';
  } else if (btn) {
    btn.style.display = '';
  }
```

**4g. Module bridges** — in the module script:
- Add to the `import { ... } from './tournament.js';` area a new import line:

```js
import { computeIdentity, accessState, joinEligibility, genCohostToken, buildCohostLink } from './cohost.js';
window.computeIdentity = computeIdentity;
window.accessState = accessState;
window.joinEligibility = joinEligibility;
window.genCohostToken = genCohostToken;
window.buildCohostLink = buildCohostLink;
```

- In `onAuthStateChanged`, inside `if (_authUser) {`, add as the first line:

```js
    window._uid = user.uid;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/cohost-ui.test.js`
Expected: PASS (5 tests)

Run: `node --test tests/cohost.test.js` and `node --test tests/tournament.test.js`
Expected: PASS (16 + 28, unchanged)

- [ ] **Step 6: Commit**

```bash
git add app.html tests/apphtml-harness.mjs tests/cohost-ui.test.js
git commit -m "feat(cohost): identity gating, access banner, owner-only session controls, saveState guard"
```

---

### Task 3: app.html — owner invite panel

**Files:**
- Modify: `app.html` (HTML after the `checkin-panel` div closing `</div>` ~line 1087; classic script near `renderCheckinPanel`; module script bridges)
- Test: `tests/cohost-ui.test.js` (extend)

**Interfaces:**
- Consumes: `_access`, `cohosts`, `cohostOpen` globals (Task 2); `window.genCohostToken`, `window.buildCohostLink` (Task 2 bridges); `esc()` (existing).
- Produces:
  - Classic functions: `renderCohostPanel()`, `toggleCohostOpen()`, `regenCohostLink()`, `copyCohostLink()`, `removeCohost(uid)`
  - Module bridges: `window._sessionId() -> string`, `window._setCohostOpen(bool) -> Promise`, `window._writeCohostToken(tok) -> Promise`, `window._readCohostToken() -> Promise<string|null>`, `window._removeCohost(uid) -> Promise`

- [ ] **Step 1: Write the failing tests**

Append to `tests/cohost-ui.test.js`:

```js
test('cohost panel: hidden for cohost, visible for owner with escaped names', () => {
  const app = loadApp();
  applyAs(app, 'buddy', { cohosts: { buddy: { name: 'Buddy', addedAt: 1 } } });
  assert.equal(app.els['cohostPanel'].style.display, 'none');

  const app2 = loadApp();
  applyAs(app2, 'owner1', {
    cohostOpen: true,
    cohosts: { evil: { name: 'X<img src=x onerror=alert(1)>', addedAt: 1 } },
  });
  assert.notEqual(app2.els['cohostPanel'].style.display, 'none');
  assert.ok(app2.captured['cohostList'].includes('X&lt;img'), 'cohost name must be escaped');
  assert.ok(!app2.captured['cohostList'].includes('<img src=x'), 'raw injection must not survive');
  assert.ok(app2.captured['cohostList'].includes("removeCohost('evil')"));
});

test('cohost panel: open state reflects cohostOpen', () => {
  const app = loadApp();
  applyAs(app, 'owner1', { cohostOpen: false });
  assert.equal(app.els['cohostOpenBtn'].textContent, 'Closed');
  assert.equal(app.els['cohostInviteBody'].style.display, 'none');
  applyAs(app, 'owner1', { cohostOpen: true });
  assert.equal(app.els['cohostOpenBtn'].textContent, 'Accepting');
  assert.notEqual(app.els['cohostInviteBody'].style.display, 'none');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cohost-ui.test.js`
Expected: the two new tests FAIL (panel elements never rendered).

- [ ] **Step 3: Implement in app.html**

**3a. Panel HTML** — immediately after the `checkin-panel` div's closing `</div>` (the div containing `id="checkinPending"`):

```html
      <div class="checkin-panel" id="cohostPanel" style="display:none;">
        <div class="checkin-head">
          <span class="checkin-title">Co-host</span>
          <button class="checkin-toggle" id="cohostOpenBtn" onclick="toggleCohostOpen()">Closed</button>
        </div>
        <div id="cohostInviteBody" style="display:none;">
          <div class="share-link-box" id="cohostLinkDisplay" onclick="copyCohostLink()">Generating...</div>
          <button class="checkin-toggle" style="margin-top:8px;width:100%;" onclick="regenCohostLink()">New link (invalidates old links)</button>
        </div>
        <div id="cohostList"></div>
      </div>
```

**3b. Classic script functions** — add after `toggleCheckinOpen` (`window.toggleCheckinOpen = toggleCheckinOpen;` line):

```js
// ===== CO-HOST (owner invite panel) =====
let _cohostLink = '';
function renderCohostPanel() {
  const panel = document.getElementById('cohostPanel');
  if (!panel) return;
  if (_access !== 'owner') { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const btn = document.getElementById('cohostOpenBtn');
  if (btn) {
    btn.textContent = cohostOpen ? 'Accepting' : 'Closed';
    btn.className = 'checkin-toggle ' + (cohostOpen ? 'open' : 'closed');
  }
  const body = document.getElementById('cohostInviteBody');
  if (body) body.style.display = cohostOpen ? '' : 'none';
  if (cohostOpen) _refreshCohostLink();
  const list = document.getElementById('cohostList');
  if (list) {
    const entries = Object.entries(cohosts || {});
    list.innerHTML = entries.length
      ? `<div style="margin-top:12px;font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);">Co-hosts</div>` +
        entries.map(([uid, c]) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);"><span style="flex:1;min-width:0;font-weight:700;">${esc((c && c.name) || 'Co-host')}</span><button onclick="removeCohost('${uid}')" style="font-size:0.72rem;font-weight:700;padding:5px 11px;border-radius:6px;border:1.5px solid var(--line);background:none;color:#C0392B;cursor:pointer;">Remove</button></div>`).join('')
      : '';
  }
}
function _refreshCohostLink() {
  const box = document.getElementById('cohostLinkDisplay');
  if (!box) return;
  if (_cohostLink) { box.textContent = _cohostLink; return; }
  if (!window._readCohostToken) { setTimeout(_refreshCohostLink, 300); return; }
  window._readCohostToken().then(tok => {
    if (!tok) return; // toggling on writes the first token
    _cohostLink = window.buildCohostLink(window.location.origin, window.location.pathname.replace(/[^/]*$/, ''), window._sessionId(), tok);
    box.textContent = _cohostLink;
  });
}
function toggleCohostOpen() {
  if (_access !== 'owner') return;
  if (!window._setCohostOpen) { showToast('Still connecting — try again.'); return; }
  const turningOn = !cohostOpen;
  // Opening invites guarantees a token exists BEFORE cohostOpen flips true —
  // the join rule denies when cohostTokens/$sid is absent.
  const ensureToken = turningOn
    ? window._readCohostToken().then(tok => {
        if (tok) return tok;
        const t = window.genCohostToken();
        return window._writeCohostToken(t).then(() => t);
      })
    : Promise.resolve(null);
  ensureToken
    .then(() => window._setCohostOpen(turningOn))
    .then(() => {
      cohostOpen = turningOn;
      renderCohostPanel();
      showToast(turningOn ? 'Accepting co-hosts — share the invite link.' : 'Co-host invites closed.');
    })
    .catch(() => showToast('Could not update co-host settings.'));
}
function regenCohostLink() {
  if (_access !== 'owner') return;
  const t = window.genCohostToken();
  window._writeCohostToken(t).then(() => {
    _cohostLink = '';
    _refreshCohostLink();
    showToast('New invite link generated — old links are dead.');
  }).catch(() => showToast('Could not generate a new link.'));
}
function copyCohostLink() {
  if (!_cohostLink) return;
  navigator.clipboard.writeText(_cohostLink)
    .then(() => showToast('Co-host link copied!'))
    .catch(() => prompt('Copy this co-host invite link:', _cohostLink));
}
function removeCohost(uid) {
  if (_access !== 'owner') return;
  if (!confirm('Remove this co-host? They lose admin access immediately.')) return;
  window._removeCohost(uid)
    .then(() => showToast('Co-host removed.'))
    .catch(() => showToast('Could not remove co-host.'));
}
```

**3c. Wire render call** — in `window._fbApplyRemote`, immediately after the `renderAccessBanner();` line added in Task 2:

```js
  renderCohostPanel();
```

**3d. Module bridges** — in the module script, after the `window._removeCheckin = ...` line:

```js
window._sessionId = () => _SESSION_ID;
window._setCohostOpen = (open) => set(ref(_db, `sessions/${_SESSION_ID}/cohostOpen`), open);
window._writeCohostToken = (tok) => set(ref(_db, `cohostTokens/${_SESSION_ID}`), tok);
window._readCohostToken = () => get(ref(_db, `cohostTokens/${_SESSION_ID}`)).then(s => s.val()).catch(() => null);
window._removeCohost = (uid) => remove(ref(_db, `sessions/${_SESSION_ID}/cohosts/${uid}`));
```

(`set`, `get`, `remove` are already imported at the top of the module script.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/cohost-ui.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app.html tests/cohost-ui.test.js
git commit -m "feat(cohost): owner invite panel — token link, accepting toggle, regenerate, remove"
```

---

### Task 4: app.html — co-host join flow

**Files:**
- Modify: `app.html` (modal HTML after the `endOverlay` modal ~line 1294; classic script; module script)
- Test: `tests/cohost-ui.test.js` (extend)

**Interfaces:**
- Consumes: `joinEligibility` bridge (Task 2), `_access`/`cohosts`/`sessionOwnerId`/`sessionName` globals, `renderAccessBanner()` (Task 2).
- Produces:
  - Classic: `maybeOfferCohostJoin()`, `confirmCohostJoin()`, `closeCohostJoin()`
  - Module: `window._cohostUrlToken() -> string|null`, `window._joinAsCohost(sessionName) -> Promise`

- [ ] **Step 1: Write the failing tests**

Append to `tests/cohost-ui.test.js`:

```js
// The fake-DOM overlay element starts with NO classes, but the real page ships
// it with class="hidden". Prime that state before each join-offer test so
// contains('hidden') assertions mean what they mean in the browser.
function primeOverlay(app) {
  app.run(`document.getElementById('cohostJoinOverlay').classList.add('hidden');`);
}

test('join offer: eligible visitor with token gets the confirm card once', () => {
  const app = loadApp();
  primeOverlay(app);
  app.run(`window._cohostUrlToken = () => 'tok123';`);
  applyAs(app, 'visitor', {});
  assert.ok(!app.els['cohostJoinOverlay'].classList.contains('hidden'), 'overlay should open');
  assert.match(app.els['cohostJoinText'].textContent, /Test Session/);
  // second snapshot must not re-offer after dismissal
  app.run(`closeCohostJoin();`);
  applyAs(app, 'visitor', {});
  assert.ok(app.els['cohostJoinOverlay'].classList.contains('hidden'), 'must not re-open');
});

test('join offer: owner and existing cohost are never prompted', () => {
  const app = loadApp();
  primeOverlay(app);
  app.run(`window._cohostUrlToken = () => 'tok123';`);
  applyAs(app, 'owner1', {});
  assert.ok(app.els['cohostJoinOverlay'].classList.contains('hidden'));

  const app2 = loadApp();
  primeOverlay(app2);
  app2.run(`window._cohostUrlToken = () => 'tok123';`);
  applyAs(app2, 'buddy', { cohosts: { buddy: { name: 'B', addedAt: 1 } } });
  assert.ok(app2.els['cohostJoinOverlay'].classList.contains('hidden'));
});

test('join offer: no token param means no prompt', () => {
  const app = loadApp();
  primeOverlay(app);
  applyAs(app, 'visitor', {});
  assert.ok(app.els['cohostJoinOverlay'].classList.contains('hidden'));
});

test('join rejection: failed write shows dead-link banner', async () => {
  const app = loadApp();
  app.run(`window._cohostUrlToken = () => 'tok123';`);
  app.run(`window._joinAsCohost = () => Promise.reject(new Error('PERMISSION_DENIED'));`);
  applyAs(app, 'visitor', {});
  app.run(`confirmCohostJoin();`);
  await new Promise(r => setImmediate(r)); // let the rejection handler run
  assert.match(app.els['accessBanner'].textContent, /no longer active/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cohost-ui.test.js`
Expected: the four new tests FAIL (`closeCohostJoin is not defined` / overlay never opens).

- [ ] **Step 3: Implement in app.html**

**3a. Join modal HTML** — immediately after the `endOverlay` modal's closing `</div>`:

```html
<div class="modal-overlay hidden" id="cohostJoinOverlay">
  <div class="end-modal">
    <h2>Join as co-host?</h2>
    <p id="cohostJoinText">You'll get admin access to manage courts, players, and scores.</p>
    <button class="btn btn-primary btn-full" style="margin-bottom:8px" onclick="confirmCohostJoin()">Join as co-host</button>
    <button class="btn btn-outline btn-full" onclick="closeCohostJoin()">Not now</button>
  </div>
</div>
```

**3b. Classic script** — add after the co-host panel functions from Task 3:

```js
// ===== CO-HOST (join flow) =====
let _cohostJoinOffered = false;
function maybeOfferCohostJoin() {
  if (_cohostJoinOffered) return;
  const tok = window._cohostUrlToken ? window._cohostUrlToken() : null;
  if (!tok || !window._uid || !window.joinEligibility) return;
  const el = window.joinEligibility({ uid: window._uid, isAnonymous: false, ownerId: sessionOwnerId, cohosts });
  _cohostJoinOffered = true;               // decide once per page load
  if (!el.eligible) return;                // owner / already-cohost: proceed silently
  document.getElementById('cohostJoinText').textContent =
    `Join "${sessionName || 'this session'}" as co-host? You'll get admin access to manage courts, players, and scores.`;
  document.getElementById('cohostJoinOverlay').classList.remove('hidden');
}
function closeCohostJoin() {
  document.getElementById('cohostJoinOverlay').classList.add('hidden');
}
function confirmCohostJoin() {
  closeCohostJoin();
  window._joinAsCohost(sessionName).then(() => {
    showToast("You're a co-host now!");
  }).catch(() => {
    const b = document.getElementById('accessBanner');
    b.textContent = 'This invite link is no longer active — ask the host for a new one.';
    b.style.display = '';
  });
}
```

**3c. Wire the offer** — in `window._fbApplyRemote`, immediately after the `renderCohostPanel();` call added in Task 3:

```js
  maybeOfferCohostJoin();
```

**3d. Module script** — near the other cohost bridges (Task 3d):

```js
const _COHOST_URL_TOKEN = _urlParams.get('cohost');
window._cohostUrlToken = () => _COHOST_URL_TOKEN;
window._joinAsCohost = (sName) => {
  const u = _authUser;
  if (!u) return Promise.reject(new Error('not signed in'));
  return set(ref(_db, `sessions/${_SESSION_ID}/cohosts/${u.uid}`), {
    name: u.displayName || u.email || 'Co-host',
    addedAt: Date.now(),
    token: _COHOST_URL_TOKEN,
  }).then(() =>
    update(ref(_db, `users/${u.uid}/sessions/${_SESSION_ID}`), {
      name: sName || 'Open Play',
      lastOpened: Date.now(),
      cohost: true,
    })
  );
};
```

> Deliberate: the join `set()` does NOT go through `_fbWrite`/`_fbMarkWrite`, so the resulting snapshot is not echo-suppressed — the UI flips to co-host mode on the very next `onValue`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/cohost-ui.test.js`
Expected: PASS (11 tests)

Run all: `node --test tests/cohost.test.js tests/tournament.test.js tests/cohost-ui.test.js`
Expected: PASS (55 total)

- [ ] **Step 5: Commit**

```bash
git add app.html tests/cohost-ui.test.js
git commit -m "feat(cohost): join flow — confirm card, token-gated self-join, dead-link message"
```

---

### Task 5: dashboard.html — co-host cards, prune filter, delete ordering

**Files:**
- Modify: `dashboard.html` (module imports ~line 160; `loadSessions` prune block ~line 288; `renderSessionList` ~line 248; `sessionCard` ~line 324; `confirmDelete` ~line 381)

**Interfaces:**
- Consumes: `classifyDashboardEntry` from `cohost.js` (direct ES import — dashboard is a module script; pure logic already tested in Task 1).
- Produces: `sessionCard(id, s, kind)` where `kind` is `'owner' | 'cohost'`.

- [ ] **Step 1: Import cohost.js**

At the top of the dashboard module script, after the firebase imports:

```js
import { classifyDashboardEntry } from './cohost.js';
```

- [ ] **Step 2: Replace the ownership/prune block in `loadSessions`**

Find the block starting `// Verify ownership — the index is user-writable...` (added in `d8fa40c`) and replace the classification loop with:

```js
    // Classify each index entry: owned -> render, cohost (flagged AND still a
    // member) -> render badged, anything else (revoked/deleted/unowned) -> prune.
    const entries = [];
    results.forEach((r, i) => {
      const id = ids[i];
      const kind = classifyDashboardEntry({
        uid: currentUser.uid,
        entry: userSessions[id] || {},
        session: r ? r[1] : null,
      });
      if (kind === 'prune') { remove(ref(db, `users/${currentUser.uid}/sessions/${id}`)).catch(() => {}); return; }
      entries.push([id, r[1], kind]);
    });
```

(The `if (!entries.length) { loadSessionsByOwner(); return; }` and `renderSessionList(entries);` lines that follow stay as they are.)

- [ ] **Step 3: Thread `kind` through rendering**

In `renderSessionList`, change the card mapping line to:

```js
  list.innerHTML = sorted.map(([id, s, kind]) => sessionCard(id, s, kind)).join('');
```

In `sessionCard`, change the signature and the two relevant fragments:

```js
function sessionCard(id, s, kind = 'owner') {
```

Badge row — replace the existing badge span with:

```js
        <span class="badge ${isLive?'badge-live':'badge-ended'}">${isLive?'Live':'Ended'}</span>
        ${kind === 'cohost' ? '<span class="badge badge-ended" title="You have admin access; only the owner can delete">Co-host</span>' : ''}
```

Actions — wrap the delete button so co-host cards omit it:

```js
    <div class="session-actions" onclick="event.stopPropagation()">
      <a href="${viewHref}" target="_blank" class="btn btn-outline btn-sm" title="Open live view">${eyeSvg} View</a>
      ${kind === 'cohost' ? '' : `<button class="btn btn-outline btn-sm" onclick="promptDelete('${id}')" title="Delete session" aria-label="Delete session">${trashSvg}</button>`}
    </div>
```

- [ ] **Step 4: Delete ordering — token before session**

In `confirmDelete`, add the `cohostTokens` removal FIRST (the token rule authorizes via `sessions/$sid/ownerId`, which must still exist):

```js
  try {
    await remove(ref(db, `cohostTokens/${id}`));   // must precede session removal (spec §1)
    await remove(ref(db, `sessions/${id}`));
    await remove(ref(db, `users/${currentUser.uid}/sessions/${id}`));
    showToast('Session deleted.');
  } catch (e) {
    showToast('Could not delete session.');
  }
```

- [ ] **Step 5: Verify**

Syntax check the module script (extract and `node --check` — same technique as prior sessions):

```bash
python3 - <<'EOF'
import re
src = open('dashboard.html').read()
for i, m in enumerate(re.finditer(r'<script(?: type="module")?>(.*?)</script>', src, re.S)):
    body = re.sub(r"from ['\"]https://[^'\"]+['\"]", "from './stub.mjs'", m.group(1))
    open(f'/tmp/dash_{i}.mjs', 'w').write(body)
EOF
printf 'export default {};' > /tmp/stub.mjs
cd /tmp && for f in dash_*.mjs; do node --check "$f" && echo "OK: $f"; done; cd -
```
Expected: `OK:` for every block.

Run: `node --test tests/cohost.test.js` (classifyDashboardEntry behavior is covered there)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard.html
git commit -m "feat(cohost): dashboard renders co-host sessions, prunes revoked entries, deletes token before session"
```

---

### Task 6: Deploy rules, push, and E2E verification (USER ACTIONS REQUIRED)

**Files:** none (console + two-device verification)

**Interfaces:** consumes everything; nothing after this.

- [ ] **Step 1: USER — paste rules into Firebase Console**

Open **Firebase Console → pickleball-255db → Realtime Database → Rules**, paste the full contents of `docs/firebase-rules.json`, and **Publish**. (The app cannot deploy rules; this must be done by hand. Rules are backward-compatible with the live app.)

- [ ] **Step 2: USER — Rules Simulator checks** (spec §7)

In the console's Rules Playground verify:
- owner write to `sessions/$sid/players` → **allow**
- cohost (auth uid present in `cohosts`) write to `sessions/$sid/players` → **allow**
- cohost write to `sessions/$sid/ownerId` → **deny**
- non-cohost authenticated write to `sessions/$sid/players` → **deny**
- self-create `sessions/$sid/cohosts/$uid` with `cohostOpen=true` + payload token matching `cohostTokens/$sid` → **allow**
- same with `cohostOpen=false` → **deny**; with wrong/missing token → **deny**; with `cohostTokens/$sid` absent → **deny**
- self-delete own `cohosts/$uid` → **allow** regardless of `cohostOpen`
- non-owner read of `cohostTokens/$sid` → **deny**

- [ ] **Step 3: Push (Pages deploys)**

```bash
node --test tests/cohost.test.js tests/cohost-ui.test.js tests/tournament.test.js  # all green first
git push
```
Wait for the GitHub Actions Pages deploy to finish (Actions tab → latest run green).

- [ ] **Step 4: USER — two-account E2E** (spec §7)

With two Google accounts on two devices:
1. Owner: open session → Co-host panel → toggle **Accepting** → copy link.
2. Account B: open link → confirm card shows session name → **Join as co-host** → full admin UI + "Co-hosting this session" banner; End Session button absent.
3. Both edit **different** courts; both sets of changes persist.
4. **Concurrency checks (spec §7):** B saves while owner is typing the second score on a court — note whether the first typed score survives; owner and B write within 1s of each other — note whether both UIs converge on the next change. Record findings in the spec's Known Limitations if they bite.
5. Owner: toggle Accepting **off** → account C's link visit shows "no longer active" message after tapping Join.
6. Owner: **New link** → old link (account C) rejected, new link works while Accepting is on.
7. Owner: **Remove** co-host B → B sees "no longer a co-host" banner; B's edits stop persisting.
8. Dashboard B: co-hosted session shows badged **Co-host** with no Delete while active; after revoke, the card disappears on reload (pruned).
9. Owner dashboard: delete the session → B's app shows the no-session state; `cohostTokens/$sid` gone (check console Data tab).

- [ ] **Step 5: Close out**

Update `session-notes.md` with a dated entry summarizing the feature (pattern: see existing entries), then:

```bash
git add session-notes.md
git commit -m "docs: cohost feature session notes"
git push
```

---

## Self-Review Notes

- **Spec coverage:** §1 data model → Tasks 3 (token, cohostOpen) + 4 (cohosts entry, users index) + 5 (deletion ordering); §2 rules → committed `be8280d`, deployed Task 6; §3 UI flows → Tasks 3 (invite), 4 (join), 2+3 (revoke banner + Remove), 2 (owner-only End/Delete); §4 dashboard → Task 5; §5 identity helper → Task 2; §6 limitations → no code (documented); §7 testing → Tasks 1–4 (unit), Task 6 (rules sim + E2E incl. concurrency checks); §8 rollout → Global Constraints (no push before rules) + Task 6 ordering.
- **Type consistency:** `_access` values (`'owner'|'cohost'|'revoked'|'viewer'`) match `accessState` returns; `classifyDashboardEntry` returns (`'owner'|'cohost'|'prune'`) match Task 5's `kind` handling; bridge names (`window._readCohostToken`, `_writeCohostToken`, `_setCohostOpen`, `_removeCohost`, `_sessionId`, `_cohostUrlToken`, `_joinAsCohost`, `_uid`) are consistent across Tasks 2–4.
- **Known simplification:** viewer/revoked read-only is banner + `saveState` guard + hidden End/New buttons; other admin buttons remain visible but their writes are rules-rejected — accepted by spec §3/§6.
