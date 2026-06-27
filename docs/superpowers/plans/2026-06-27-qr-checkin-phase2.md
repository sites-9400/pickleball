# QR Self-Check-In — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players self-register into a session via a shareable link/QR (`checkin.html`), with the admin auto-importing them, an open/close toggle, and a Firebase ruleset that allows anonymous check-in creation only when open.

**Architecture:** A new public page `checkin.html` (anonymous auth, its own named Firebase app instance, mirroring `view.html`) appends to an append-only inbox `sessions/{id}/checkins/{pushId}`. `app.html` stays the sole writer of `players`: it subscribes with `onChildAdded`, converts each entry via a pure unit-tested `checkinToPlayer` helper (in `tournament.js`), pushes the new player, and deletes the inbox node. An admin `checkinOpen` flag (default true) gates check-in in both the UI and the security rules. No build step, no backend.

**Tech Stack:** Plain HTML/CSS/JS (ES modules), Firebase Realtime Database, `node --test`. GitHub Pages from repo root.

## Global Constraints

- Target codebase: `PickleDistrict-Modes/` only (Firebase `pickleball-255db`). Do NOT touch `PickleDistrict/files-github/`.
- `app.html` remains the SOLE writer of `players`. `saveState()` uses `update()`, never `set()`; never write `mode`/`ownerId` from app.html.
- The module-scope `<script type="module">` cannot see the regular `<script>`'s `let` globals (e.g. `players`, `playerIdCounter`, `queueOrder`). Cross them via `window.X` bridges. Pure fns from `tournament.js` reach the regular script only via `window.X` bridges declared in the module block.
- `checkin.html` MUST use its own named Firebase app instance: `initializeApp(firebaseConfig, 'checkin')` (like `view.html`'s `'viewer'`), never the default app — this isolates its anonymous auth.
- Firebase strips empty arrays → round-trip via `normArr`/`cleanForFirebase` (`{_empty:true}` sentinel). No raw `undefined` written.
- Player `skill` enum exactly `'beginner'|'intermediate'|'advanced'` (default `'intermediate'`). Player `via` enum exactly `'qr'|'manual'` (default `'manual'`).
- Check-in inbox entry shape exactly `{name:string, skill:string, ts:number}`.
- Session field `checkinOpen` is a boolean, default `true`.
- No em-dashes in user-facing copy.
- firebaseConfig (same project as view.html): `apiKey:"AIzaSyDDyMStj6lavAgA9j6sImmFavauI0lha-E"`, `authDomain:"pickleball-255db.firebaseapp.com"`, `databaseURL:"https://pickleball-255db-default-rtdb.asia-southeast1.firebasedatabase.app"`, `projectId:"pickleball-255db"`. (Copy the full block verbatim from `view.html` lines 170-180 — do not retype partial.)
- QR library already used in the repo: `https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js` (`window.QRCode`).
- Commit after every task. Run from inside `PickleDistrict-Modes/`.

---

### Task 1: `checkinToPlayer` pure helper (TDD)

**Files:**
- Modify: `tournament.js`
- Test: `tests/tournament.test.js`

**Interfaces:**
- Produces: `checkinToPlayer(entry, existingPlayers)` →
  `{skip:true, reason:'invalid'|'duplicate'}` OR
  `{player:{name,present:true,gamesPlayed:0,wins:0,losses:0,points:0,pointsAgainst:0,lastPlayedRound:-1,skill,via:'qr'}}` (NO `id`; the caller assigns it). Dedupe is case-insensitive on `name`. Invalid/missing skill defaults to `'intermediate'`. Empty/whitespace name → `{skip:true,reason:'invalid'}`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/tournament.test.js`:

```javascript
import { checkinToPlayer } from '../tournament.js';

test('checkinToPlayer builds a present qr player with validated skill', () => {
  const r = checkinToPlayer({name:'Maria S', skill:'advanced', ts:1}, []);
  assert.equal(r.skip, undefined);
  assert.equal(r.player.name, 'Maria S');
  assert.equal(r.player.present, true);
  assert.equal(r.player.via, 'qr');
  assert.equal(r.player.skill, 'advanced');
  assert.equal(r.player.wins, 0);
  assert.equal('id' in r.player, false);
});

test('checkinToPlayer defaults unknown skill to intermediate', () => {
  assert.equal(checkinToPlayer({name:'Bob', skill:'pro', ts:1}, []).player.skill, 'intermediate');
  assert.equal(checkinToPlayer({name:'Bob', ts:1}, []).player.skill, 'intermediate');
});

test('checkinToPlayer trims the name', () => {
  assert.equal(checkinToPlayer({name:'  Ana T  ', skill:'beginner', ts:1}, []).player.name, 'Ana T');
});

test('checkinToPlayer skips duplicate names case-insensitively', () => {
  const existing = [{name:'Maria S'}];
  const r = checkinToPlayer({name:'maria s', skill:'beginner', ts:1}, existing);
  assert.deepEqual(r, {skip:true, reason:'duplicate'});
});

test('checkinToPlayer skips empty/whitespace names', () => {
  assert.deepEqual(checkinToPlayer({name:'   ', skill:'beginner', ts:1}, []), {skip:true, reason:'invalid'});
  assert.deepEqual(checkinToPlayer({skill:'beginner', ts:1}, []), {skip:true, reason:'invalid'});
});
```

- [ ] **Step 2: Run tests, verify they fail.**

Run: `node --test`
Expected: FAIL — `checkinToPlayer` is not exported.

- [ ] **Step 3: Implement in `tournament.js`.** Add:

```javascript
export function checkinToPlayer(entry, existingPlayers) {
  const name = (entry && typeof entry.name === 'string') ? entry.name.trim() : '';
  if (!name) return { skip: true, reason: 'invalid' };
  const skills = ['beginner', 'intermediate', 'advanced'];
  const skill = (entry && skills.includes(entry.skill)) ? entry.skill : 'intermediate';
  const dup = (existingPlayers || []).some(p =>
    p && typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase());
  if (dup) return { skip: true, reason: 'duplicate' };
  return { player: {
    name, present: true, gamesPlayed: 0, wins: 0, losses: 0,
    points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill, via: 'qr'
  } };
}
```

- [ ] **Step 4: Run tests, verify they pass.**

Run: `node --test`
Expected: PASS (existing 22 + 5 new = 27).

- [ ] **Step 5: Commit.**

```bash
git add tournament.js tests/tournament.test.js
git commit -m "tournament.js: checkinToPlayer pure helper + tests"
```

---

### Task 2: `via` field on the player model

**Files:**
- Modify: `app.html` — `addPlayer()` (~1608), state-load player map (~1402), `renderPlayers()` row (~1650), `<style>`

**Interfaces:**
- Produces: every player has `via:'qr'|'manual'` (default `'manual'`, default-filled on read); player rows show a QR/manual tag.

- [ ] **Step 1: Default-fill `via` on load.** The load line currently reads:

```javascript
  players      = normArr(s.players).map(p => ({ ...p, skill: p.skill || 'intermediate' }));
```

Replace it with:

```javascript
  players      = normArr(s.players).map(p => ({ ...p, skill: p.skill || 'intermediate', via: p.via || 'manual' }));
```

- [ ] **Step 2: Set `via:'manual'` on manually added players.** In `addPlayer()` change the pushed object to include `via:'manual'`:

```javascript
    players.push({id:++playerIdCounter,name,present:false,gamesPlayed:0,wins:0,losses:0,points:0,pointsAgainst:0,lastPlayedRound:-1,skill:'intermediate',via:'manual'});
```

- [ ] **Step 3: Add CSS for the via tag.** In the `<style>` block add:

```css
.via-tag{font-size:0.55rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;padding:2px 6px;border-radius:5px;margin-left:4px;}
.via-tag.qr{background:#e8f0fe;color:#1a56db;}
.via-tag.manual{background:#eee;color:#777;}
```

- [ ] **Step 4: Render the via tag in each player row.** In `renderPlayers()` row template, immediately after the skill badge button added in Phase 1, insert:

```javascript
      <span class="via-tag ${p.via||'manual'}">${(p.via||'manual')==='qr'?'QR':'manual'}</span>
```

- [ ] **Step 5: Static verify + commit.** Re-read the four edits; confirm `via` defaults consistently. (Live browser check deferred to user.)

```bash
git add app.html
git commit -m "Player via field (qr/manual) with default-fill + row tag"
```

---

### Task 3: `checkinOpen` flag + admin check-in panel (link, QR, open/close toggle)

**Files:**
- Modify: `dashboard.html` — session create payload (~220-227)
- Modify: `app.html` — state var + load (~1417 area), saveState payload, Players-panel markup (near the existing share card ~1030), module block (`window.checkinUrl`), regular script (`toggleCheckinOpen`, `renderCheckinPanel`, checkin QR), `<style>`

**Interfaces:**
- Consumes: `_basePath()`, `_SESSION_ID` (module block); `saveState()`, `showToast()`, `window.QRCode`.
- Produces: session field `checkinOpen` (boolean, default true); `window.checkinUrl()` → the check-in URL string; `window.copyCheckinLink()`; `window.toggleCheckinOpen()`; a Players-panel block showing the check-in link, a QR, and an Open/Closed toggle.

- [ ] **Step 1: Dashboard sets `checkinOpen:true` at create.** In `dashboard.html` where `sessionData` is built (it already sets `ownerId`, `ownerName`, `createdAt`, `mode`), add:

```javascript
    checkinOpen: true,
```

- [ ] **Step 2: app.html state var + load.** Near the other session state vars (where `sessionOwnerId` etc. are declared, ~line 1200/1417), add a global in the regular script:

```javascript
let checkinOpen = true;
```

In the state-load function (where `sessionOwnerId = s.ownerId || ''` etc. ~1417) add:

```javascript
  checkinOpen = (s.checkinOpen !== false); // default open; only an explicit false closes it
```

- [ ] **Step 3: Persist `checkinOpen` in saveState.** In the `saveState()` data object (the one written via `update()` at ~1268, alongside `players: cleanForFirebase(players)`), add:

```javascript
    checkinOpen: checkinOpen,
```

(This persists the flag with every save; new sessions already have it from Step 1, old sessions self-heal to `true` on the first save.)

- [ ] **Step 4: Module-block URL helper.** In the `<script type="module">` block, near `window.copyViewLink`/`_basePath` (~2842), add:

```javascript
window.checkinUrl = () => `${window.location.origin}${_basePath()}checkin.html?session=${_SESSION_ID}`;
window.copyCheckinLink = function() {
  const link = window.checkinUrl();
  navigator.clipboard?.writeText(link).then(() => window.showToast && window.showToast('Check-in link copied!'));
};
```

- [ ] **Step 5: Players-panel markup.** In `app.html`, inside the Players panel (near the existing `id="shareCard"` view-share block ~1030), add a check-in block:

```html
      <div class="checkin-panel" id="checkinPanel">
        <div class="checkin-head">
          <span class="checkin-title">Player check-in</span>
          <button class="checkin-toggle" id="checkinToggleBtn" onclick="toggleCheckinOpen()">Open</button>
        </div>
        <div class="share-link-box" id="checkinLinkDisplay" onclick="copyCheckinLink()">Generating...</div>
        <div class="checkin-qr" id="checkinQrContainer"></div>
      </div>
```

- [ ] **Step 6: CSS.** Add to `<style>`:

```css
.checkin-panel{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);}
.checkin-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.checkin-title{font-size:0.8rem;font-weight:800;color:var(--ink);}
.checkin-toggle{font-family:var(--font);font-size:0.7rem;font-weight:800;border:none;border-radius:14px;padding:5px 12px;cursor:pointer;}
.checkin-toggle.open{background:#e6f4ea;color:#1e7e34;}
.checkin-toggle.closed{background:#fde8e8;color:#c0392b;}
.checkin-qr{display:flex;justify-content:center;margin-top:10px;}
```

- [ ] **Step 7: Regular-script render + toggle.** Add functions (regular `<script>`), and call `renderCheckinPanel()` from wherever `renderPlayers()` is invoked (or at the end of `renderPlayers()`):

```javascript
function renderCheckinPanel(){
  const box=document.getElementById('checkinLinkDisplay');
  const btn=document.getElementById('checkinToggleBtn');
  if(box && window.checkinUrl) box.textContent=window.checkinUrl();
  if(btn){
    btn.textContent = checkinOpen ? 'Open' : 'Closed';
    btn.className = 'checkin-toggle ' + (checkinOpen ? 'open' : 'closed');
  }
  _genCheckinQR();
}
function _genCheckinQR(){
  if(!window.QRCode || !window.checkinUrl){ setTimeout(_genCheckinQR, 300); return; }
  const el=document.getElementById('checkinQrContainer');
  if(!el) return;
  el.innerHTML='';
  new QRCode(el, { text: window.checkinUrl(), width:120, height:120,
    colorDark:'#1C1F14', colorLight:'#FFFFFF', correctLevel: QRCode.CorrectLevel.M });
}
function toggleCheckinOpen(){
  checkinOpen = !checkinOpen;
  renderCheckinPanel();
  saveState();
  showToast(checkinOpen ? 'Check-in opened.' : 'Check-in closed.');
}
window.toggleCheckinOpen = toggleCheckinOpen;
```

At the end of `renderPlayers()` add: `renderCheckinPanel();`

- [ ] **Step 8: Static verify + commit.** Confirm: dashboard sets the flag; load defaults open; saveState persists it; toggle flips + saves; link + QR render. (Live check deferred.)

```bash
git add dashboard.html app.html
git commit -m "Check-in open/close flag + admin panel (link, QR, toggle)"
```

---

### Task 4: Admin import of check-ins (`onChildAdded` → import → delete)

**Files:**
- Modify: `app.html` — firebase-database import list, module block (subscribe + `window._removeCheckin`, bridge `checkinToPlayer`), regular script (`window._importCheckin`)

**Interfaces:**
- Consumes: `checkinToPlayer` (Task 1) via `window.checkinToPlayer`; `players`, `playerIdCounter`, `queueOrder`, `rebuildMatchQueue()`, `renderPlayers()`, `renderQueue()`, `saveState()`, `showToast()`.
- Produces: new check-in inbox entries become present `via:'qr'` players (dupes skipped), and the inbox node is deleted after handling.

- [ ] **Step 1: Ensure imports.** In the `<script type="module">` firebase-database import statement, ensure `onChildAdded` and `remove` are imported (add them if absent). Example shape:

```javascript
import { getDatabase, ref, onValue, get, update, set, onChildAdded, remove } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";
```

(Keep whatever is already imported; just add `onChildAdded` and `remove`.)

- [ ] **Step 2: Bridge `checkinToPlayer`.** In the module block where other `window.X = ...` bridges live (next to `window.resolveChallengeCourt` etc.), add `checkinToPlayer` to the `./tournament.js` import and:

```javascript
window.checkinToPlayer = checkinToPlayer;
```

- [ ] **Step 3: Module-side inbox delete + subscription.** In the module block, after `_SESSION_REF` is defined, add:

```javascript
window._removeCheckin = (key) => remove(ref(_db, `sessions/${_SESSION_ID}/checkins/${key}`));
let _checkinListenerAttached = false;
function _attachCheckinListener(){
  if (_checkinListenerAttached) return;
  _checkinListenerAttached = true;
  onChildAdded(ref(_db, `sessions/${_SESSION_ID}/checkins`), (snap) => {
    if (window._importCheckin) window._importCheckin(snap.key, snap.val());
  });
}
```

Call `_attachCheckinListener();` inside the `if (_authUser) { ... }` branch of the existing `onAuthStateChanged` handler (so it attaches once the real admin is authed; the guard makes re-auth idempotent).

- [ ] **Step 4: Regular-script importer.** In the regular `<script>` (where `players` lives), add:

```javascript
window._importCheckin = function(key, entry){
  if(!entry){ window._removeCheckin && window._removeCheckin(key); return; }
  const res = window.checkinToPlayer ? window.checkinToPlayer(entry, players) : {skip:true,reason:'invalid'};
  if(res.skip){
    if(res.reason==='duplicate') showToast(`${entry.name} is already checked in.`);
    window._removeCheckin && window._removeCheckin(key);
    return;
  }
  const p = res.player; p.id = ++playerIdCounter;
  players.push(p);
  if(!queueOrder.includes(p.id)) queueOrder.push(p.id);
  rebuildMatchQueue(); renderPlayers(); renderQueue(); saveState();
  showToast(`${p.name} checked in.`);
  window._removeCheckin && window._removeCheckin(key);
};
```

- [ ] **Step 5: Verify + commit.** Run `node --test` (must stay 27/27; tournament.js untouched here). Re-trace: onChildAdded fires for backlog + new entries; dupes toast+removed; valid entries push a player then remove the node. Confirm `_importCheckin` lives in the regular script (so it can see `players`) and only the delete/subscribe live in the module. (Live check deferred to user.)

```bash
git add app.html
git commit -m "Admin import of self-check-ins via onChildAdded (dedupe + delete inbox node)"
```

---

### Task 5: `checkin.html` public self-registration page

**Files:**
- Create: `checkin.html`

**Interfaces:**
- Consumes: `sessions/{id}/name` and `sessions/{id}/checkinOpen` (read); writes `sessions/{id}/checkins/{pushId} = {name, skill, ts}`.
- Produces: the public check-in page (a standalone file).

- [ ] **Step 1: Create `checkin.html`.** Model it on `view.html` (copy the `<head>`, brand `<style>` header, and the QR script include as needed). It MUST: use `initializeApp(firebaseConfig, 'checkin')`; sign in anonymously; read `?session=`; gate on `checkinOpen`. Full page:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Check In - Paddle District</title>
<style>
  :root{--army:#3a4a23;--ink:#1C1F14;--bg:#fff;--line:#e3e3dc;--muted:#6b6f60;--font:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
  *{box-sizing:border-box;}
  body{margin:0;font-family:var(--font);background:#f4f5ef;color:var(--ink);min-height:100vh;}
  .header{background:var(--army);color:#fff;padding:22px 18px;text-align:center;}
  .header img{height:54px;margin-bottom:6px;}
  .header h1{margin:0;font-size:1.1rem;font-weight:800;}
  .header .sub{font-size:0.8rem;opacity:0.85;margin-top:3px;}
  .wrap{max-width:420px;margin:0 auto;padding:20px 18px;}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px;}
  label{display:block;font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin:14px 0 6px;}
  input[type=text]{width:100%;font-family:var(--font);font-size:1rem;padding:12px;border:1.5px solid var(--line);border-radius:9px;outline:none;}
  input[type=text]:focus{border-color:var(--army);}
  .skills{display:flex;gap:8px;}
  .skills button{flex:1;font-family:var(--font);font-size:0.82rem;font-weight:700;padding:11px 6px;border:1.5px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);cursor:pointer;}
  .skills button.on{background:var(--army);color:#fff;border-color:var(--army);}
  .submit{width:100%;margin-top:18px;font-family:var(--font);font-size:1rem;font-weight:800;padding:14px;border:none;border-radius:10px;background:var(--army);color:#fff;cursor:pointer;}
  .submit:disabled{opacity:0.5;cursor:default;}
  .msg{text-align:center;padding:24px 10px;}
  .msg .big{font-size:1.15rem;font-weight:800;margin-bottom:8px;}
  .closed{text-align:center;color:var(--muted);padding:30px 10px;font-weight:600;}
  .hidden{display:none;}
</style>
</head>
<body>
  <div class="header">
    <img src="logo.png" alt="Paddle District">
    <h1 id="sessionName">Open Play</h1>
    <div class="sub">Player check-in</div>
  </div>
  <div class="wrap">
    <div class="card" id="card">
      <div id="formArea">
        <label for="nameInput">Your name</label>
        <input type="text" id="nameInput" maxlength="40" placeholder="e.g. Maria S" autocomplete="off">
        <label>Skill level</label>
        <div class="skills" id="skills">
          <button type="button" data-skill="beginner">Beginner</button>
          <button type="button" data-skill="intermediate" class="on">Intermediate</button>
          <button type="button" data-skill="advanced">Advanced</button>
        </div>
        <button class="submit" id="submitBtn">Check in</button>
      </div>
      <div class="msg hidden" id="doneArea">
        <div class="big" id="doneName">You're checked in!</div>
        <div style="color:var(--muted);font-size:0.9rem;">The organizer will get you into a game.</div>
        <button class="submit" id="againBtn" style="margin-top:20px;">Check in someone else</button>
      </div>
      <div class="closed hidden" id="closedArea">Check-in is closed by the organizer.</div>
    </div>
  </div>

<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getDatabase, ref, get, push, onValue } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDDyMStj6lavAgA9j6sImmFavauI0lha-E",
  authDomain: "pickleball-255db.firebaseapp.com",
  databaseURL: "https://pickleball-255db-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pickleball-255db"
};
const app = initializeApp(firebaseConfig, 'checkin');
const db = getDatabase(app);
const auth = getAuth(app);

const SID = new URLSearchParams(window.location.search).get('session');
let skill = 'intermediate';

const formArea = document.getElementById('formArea');
const doneArea = document.getElementById('doneArea');
const closedArea = document.getElementById('closedArea');

function showClosed(){ formArea.classList.add('hidden'); doneArea.classList.add('hidden'); closedArea.classList.remove('hidden'); }
function showForm(){ formArea.classList.remove('hidden'); doneArea.classList.add('hidden'); closedArea.classList.add('hidden'); }

document.querySelectorAll('#skills button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#skills button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); skill = b.getAttribute('data-skill');
}));

document.getElementById('againBtn').addEventListener('click', () => {
  document.getElementById('nameInput').value = '';
  document.getElementById('submitBtn').disabled = false;
  showForm();
});

document.getElementById('submitBtn').addEventListener('click', async () => {
  const name = document.getElementById('nameInput').value.trim();
  if(!name){ document.getElementById('nameInput').focus(); return; }
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  try {
    await push(ref(db, `sessions/${SID}/checkins`), { name, skill, ts: Date.now() });
    document.getElementById('doneName').textContent = `You're checked in, ${name}!`;
    formArea.classList.add('hidden'); doneArea.classList.remove('hidden');
  } catch(e){
    btn.disabled = false;
    alert('Could not check in. Check-in may be closed. Please ask the organizer.');
  }
});

function start(){
  if(!SID){ document.getElementById('card').innerHTML = '<div class="closed">This link is missing a session. Ask the organizer for the correct link.</div>'; return; }
  // Live-gate on checkinOpen + show session name
  onValue(ref(db, `sessions/${SID}/name`), s => { const n = s.val(); if(n) document.getElementById('sessionName').textContent = n; });
  onValue(ref(db, `sessions/${SID}/checkinOpen`), s => {
    if(s.val() === true){ if(doneArea.classList.contains('hidden')) showForm(); }
    else { showClosed(); }
  });
}
signInAnonymously(auth).then(start).catch(() => start());
</script>
</body>
</html>
```

- [ ] **Step 2: Verify + commit.** Confirm: named app `'checkin'`; reads name + checkinOpen; closed state hides the form; submit pushes `{name,skill,ts}` to `sessions/{SID}/checkins`; double-submit guarded; confirmation + reset work. (Live phone check deferred to user.)

```bash
git add checkin.html
git commit -m "Add checkin.html public self-registration page"
```

---

### Task 6: Firebase ruleset file + dev notes + final test

**Files:**
- Create: `docs/firebase-rules.json`
- Modify: `session-notes.md` (gitignored — update on disk; do NOT force-add)

**Interfaces:** none (docs).

- [ ] **Step 1: Write `docs/firebase-rules.json`** with the exact ruleset (owner pastes this into the `pickleball-255db` console):

```json
{
  "rules": {
    "sessions": {
      ".read": "auth != null",
      "$sid": {
        ".write": "auth != null && (!data.exists() ? newData.child('ownerId').val() === auth.uid : data.child('ownerId').val() === auth.uid)",
        "checkins": {
          "$cid": {
            ".write": "auth != null && (root.child('sessions').child($sid).child('ownerId').val() === auth.uid || (!data.exists() && newData.exists() && root.child('sessions').child($sid).child('checkinOpen').val() === true))",
            ".validate": "newData.hasChildren(['name','skill','ts']) && newData.child('name').isString() && newData.child('name').val().length > 0 && newData.child('name').val().length <= 40 && newData.child('skill').isString() && newData.child('skill').val().matches(/^(beginner|intermediate|advanced)$/) && newData.child('ts').isNumber()"
          }
        }
      }
    },
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

- [ ] **Step 2: Update `session-notes.md`** (gitignored, local-only). Append a dated "## Stage 7 — QR Self-Check-In (Phase 2)" entry summarizing: `checkin.html` (anonymous named `'checkin'` app, free-text name + skill, writes `sessions/{id}/checkins`), the admin import via `onChildAdded` (dedupe via `checkinToPlayer`, delete node), the `checkinOpen` flag + admin panel (link/QR/toggle), the `via` field, and that the Firebase rules in `docs/firebase-rules.json` must be pasted in the console for check-in to work. Add a Phase 2 live smoke-test checklist (open check-in scan→submit→appears tagged QR; closed state blocks form + rules reject direct write; dedupe; late arrival; admin app closed then reopened imports backlog; manual add still tagged manual).

- [ ] **Step 3: Final test.** Run `node --test` and confirm 27/27 passing, pristine. Record the result in the report.

- [ ] **Step 4: Commit (rules file only; session-notes is gitignored).**

```bash
git add docs/firebase-rules.json
git commit -m "Add Firebase RTDB ruleset for anonymous check-in; Phase 2 dev notes"
```

---

## Self-Review

**Spec coverage (against `2026-06-27-qr-checkin-phase2-design.md`):**
- A. `checkin.html` self-registration (free-text name + skill, anonymous named app, inbox write, closed state) → Task 5. ✓
- B. `checkinOpen` toggle (dashboard default, app default-fill, admin toggle, rule-enforced) → Tasks 3 (UI/state) + 6 (rules). ✓
- C. Admin import + share UI + `via` tag → Tasks 4 (import) + 3 (share/toggle) + 2 (via tag). ✓
- D. `via` field → Task 2. ✓
- E. Firebase ruleset → Task 6. ✓
- F. Pure `checkinToPlayer` + tests → Task 1. ✓
- Single-writer invariant, named-app isolation, window.X bridges, no em-dashes → Global Constraints + per-task notes. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. Task 6 Step 2 (session-notes prose) describes required content (it is a gitignored dev log, not code).

**Type consistency:** `checkinToPlayer(entry, existingPlayers) → {skip,reason}|{player}` identical in Task 1 and Task 4. Inbox entry `{name,skill,ts}` identical in Task 5 (write), Task 1/Task 4 (read), and Task 6 (`.validate`). `checkinOpen` boolean default-true consistent across dashboard (Task 3), app load/save (Task 3), checkin.html gate (Task 5), and the rule (Task 6). `via:'qr'|'manual'` consistent across Tasks 1, 2, 4. `window.checkinUrl/_importCheckin/_removeCheckin/checkinToPlayer/toggleCheckinOpen/copyCheckinLink` bridge names consistent between definer and caller tasks.

**Implementer verification points (not placeholders — read current code to finalize):** Task 3 Step 2 (exact location of session-state vars + load block), Task 3 Step 7 (where `renderPlayers()` is called / end-of-function hook), Task 4 Step 1 (current firebase-database import list), Task 4 Step 3 (attach inside the existing `if(_authUser)` branch). Each step states what to confirm and the target behavior.
