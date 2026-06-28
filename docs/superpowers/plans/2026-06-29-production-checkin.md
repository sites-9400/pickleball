# Production (v1) QR Check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a name-only QR self-check-in (roster self-select attendance) to the production app, matching the Modes feature minus skill/rank.

**Architecture:** New `checkin.html` (anonymous, production Firebase config) reads the roster and writes `{name, ts}` inbox entries; `app.html` gains an admin check-in panel, a `checkinOpen` flag (persisted), and an `onChildAdded` import that creates a present player or marks an existing name present; `dashboard.html` defaults `checkinOpen:true`.

**Tech Stack:** Plain HTML/CSS/JS, Firebase RTDB web SDK 11.0.0, QRCode.js (already loaded). Production app, project `pickledistrict-fef9a`.

## Global Constraints

- Production only (`PickleDistrict/files-github/`). No skill / no rank anywhere. Check-in payload is `{name, ts}` only.
- New functions in the regular `<script>` are global (inline onclick reaches them). Firebase refs live in the `<script type="module">`; bridge module helpers via `window.`.
- Persist via existing `saveState()`; never write `ownerId/ownerName/createdAt/date`.
- Montserrat + round `favicon.png` on `checkin.html` to match other pages.
- No automated test harness in production; verify by syntax-check (parse inline scripts) + browser smoke.
- Firebase rules must be pasted by the user into the `pickledistrict-fef9a` console (provided in the spec); without it anonymous check-in writes are denied.

---

### Task 1: app.html — checkinOpen state + import pipeline + admin panel

**Files:**
- Modify: `PickleDistrict/files-github/app.html`

**Interfaces:**
- Produces: global `checkinOpen`, `_importCheckin(key, entry)`, `toggleCheckinOpen()`, `renderCheckinPanel()`, `copyCheckinLink()`; module-side `window._removeCheckin(key)`, `window._checkinLink()`; an `onChildAdded` listener on `sessions/{id}/checkins`.

- [ ] **Step 1: Declare the state variable**

After `let queueOrder = [];` (line 1248) add:

```javascript
let checkinOpen = true;
```

- [ ] **Step 2: Persist it in saveState**

In `saveState()` (line 1316-1328) change the `data` object's last lines to include `checkinOpen`:

```javascript
    sessionEnded, sessionEndTime,
    checkinOpen,
    status: sessionEnded ? 'ended' : 'active'
```

- [ ] **Step 3: Load it in _fbApplyRemote**

After `sessionEndTime    = s.sessionEndTime    || null;` (line 1404) add:

```javascript
  checkinOpen       = (s.checkinOpen !== false);
```

- [ ] **Step 4: Add the import + panel functions (regular script)**

Immediately before `function saveState() {` (line 1315) add:

```javascript
function _importCheckin(key, entry) {
  if (!entry) { window._removeCheckin && window._removeCheckin(key); return; }
  const name = (typeof entry.name === 'string') ? entry.name.trim() : '';
  if (!name) { window._removeCheckin && window._removeCheckin(key); return; }
  const ex = players.find(p => p && typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase());
  if (ex) {
    ex.present = true;
    if (!queueOrder.includes(ex.id)) queueOrder.push(ex.id);
    rebuildMatchQueue(); renderPlayers(); renderQueue(); saveState();
    showToast(`${ex.name} marked here.`);
  } else {
    const p = { id: ++playerIdCounter, name, present: true, gamesPlayed: 0, wins: 0, losses: 0, points: 0, pointsAgainst: 0, lastPlayedRound: -1 };
    players.push(p);
    if (!queueOrder.includes(p.id)) queueOrder.push(p.id);
    rebuildMatchQueue(); renderPlayers(); renderQueue(); saveState();
    showToast(`${p.name} checked in.`);
  }
  window._removeCheckin && window._removeCheckin(key);
}
window._importCheckin = _importCheckin;
function toggleCheckinOpen() {
  checkinOpen = !checkinOpen;
  renderCheckinPanel();
  saveState();
  showToast(checkinOpen ? 'Check-in opened.' : 'Check-in closed.');
}
function copyCheckinLink() {
  const url = window._checkinLink ? window._checkinLink() : '';
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => showToast('Check-in link copied!')).catch(() => prompt('Copy this check-in link:', url));
}
function renderCheckinPanel() {
  const url = window._checkinLink ? window._checkinLink() : '';
  const linkEl = document.getElementById('checkinLinkDisplay');
  if (linkEl) linkEl.textContent = url || 'Generating...';
  const btn = document.getElementById('checkinToggleBtn');
  if (btn) { btn.textContent = checkinOpen ? 'Check-in: Open' : 'Check-in: Closed'; btn.className = 'btn btn-full ' + (checkinOpen ? 'btn-primary' : 'btn-outline'); }
  const st = document.getElementById('checkinStatus');
  if (st) st.textContent = checkinOpen ? 'Players can check in now.' : 'Check-in is closed.';
  const el = document.getElementById('checkinQr');
  if (url && el && window.QRCode) {
    if (el.dataset.qrUrl !== url) { el.innerHTML = ''; new QRCode(el, { text: url, width: 132, height: 132, colorDark: '#1C1F14', colorLight: '#FFFFFF', correctLevel: QRCode.CorrectLevel.M }); el.dataset.qrUrl = url; }
  } else if (url && el && !window.QRCode) {
    setTimeout(renderCheckinPanel, 300);
  }
}
```

- [ ] **Step 5: Render the panel from renderPlayers**

At the very start of `function renderPlayers() {` (line 1645) add as the first line of the body:

```javascript
  renderCheckinPanel();
```

- [ ] **Step 6: Add the admin panel HTML (Players tab)**

Between the share card close `</div>` (line 1053) and `<div class="card">` Add Players (line 1055) insert:

```html
    <div class="card">
      <div class="card-title">Player check-in</div>
      <div style="display:flex;justify-content:center;margin-bottom:10px;">
        <div style="background:white;border-radius:10px;padding:8px;line-height:0;display:inline-block;">
          <div id="checkinQr"></div>
        </div>
      </div>
      <div class="share-link-label">Check-in Link</div>
      <div class="share-link-box" id="checkinLinkDisplay" onclick="copyCheckinLink()">Generating...</div>
      <div class="share-btns" style="margin-bottom:10px;">
        <button class="share-btn" onclick="copyCheckinLink()">📋 Copy Link</button>
      </div>
      <button class="btn btn-full btn-primary" id="checkinToggleBtn" onclick="toggleCheckinOpen()">Check-in: Open</button>
      <div id="checkinStatus" style="text-align:center;font-size:0.78rem;font-weight:600;color:var(--muted);margin-top:8px;">Players can check in now.</div>
    </div>
```

- [ ] **Step 7: Add module imports + bridges + listener**

In the module block, change the database import (line 2210) to add `push, onChildAdded, remove`:

```javascript
import { getDatabase, ref, set, update, onValue, get, push, onChildAdded, remove } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";
```

Then, immediately after the `window._getViewLink = function() {...};` block (ends line 2349) add:

```javascript
window._checkinLink = function() {
  return `${window.location.origin}${_basePath()}checkin.html?session=${_SESSION_ID}`;
};
window._removeCheckin = function(key) {
  try { remove(ref(_db, `sessions/${_SESSION_ID}/checkins/${key}`)); } catch(e) {}
};
let _checkinAttached = false;
function _attachCheckinListener() {
  if (_checkinAttached || !_SESSION_ID) return;
  _checkinAttached = true;
  onChildAdded(ref(_db, `sessions/${_SESSION_ID}/checkins`), (snap) => {
    if (window._importCheckin) window._importCheckin(snap.key, snap.val());
  });
}
_attachCheckinListener();
```

- [ ] **Step 8: Syntax-check the inline scripts**

Run:
```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict/files-github" && node -e '
const fs=require("fs");const html=fs.readFileSync("app.html","utf8");
const re=/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi;let m,i=0,errs=0;
while((m=re.exec(html))){const a=m[1]||"";if(/\bsrc=/.test(a))continue;const mod=/type=["\x27]module["\x27]/.test(a);const c=m[2];i++;
try{mod?new Function(c.replace(/^\s*import[^\n;]*;?/gm,"").replace(/\bexport\s+/g,"")):new Function(c);console.log("script #"+i+" OK");}
catch(e){errs++;console.log("script #"+i+" ERROR "+e.message);}}process.exit(errs?1:0);'
```
Expected: all scripts OK.

- [ ] **Step 9: Commit and push**

```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict/files-github"
git add app.html
git commit -m "app.html: QR check-in admin panel + import pipeline (name-only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: checkin.html (new, name-only)

**Files:**
- Create: `PickleDistrict/files-github/checkin.html`

- [ ] **Step 1: Create the file** with exactly this content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<link rel="icon" type="image/png" href="favicon.png">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Check In - Paddle District</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap');
  :root{--army:#3a4a23;--ink:#1C1F14;--bg:#fff;--line:#e3e3dc;--muted:#6b6f60;--font:'Montserrat',sans-serif;}
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
  .submit{width:100%;margin-top:18px;font-family:var(--font);font-size:1rem;font-weight:800;padding:14px;border:none;border-radius:10px;background:var(--army);color:#fff;cursor:pointer;}
  .submit:disabled{opacity:0.5;cursor:default;}
  .secondary{background:#fff;color:var(--army);border:1.5px solid var(--army);}
  .msg{text-align:center;padding:24px 10px;}
  .msg .big{font-size:1.15rem;font-weight:800;margin-bottom:8px;}
  .closed{text-align:center;color:var(--muted);padding:30px 10px;font-weight:600;}
  .hidden{display:none;}
  .roster-row{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1.5px solid var(--line);border-radius:9px;margin-bottom:8px;cursor:pointer;background:#fff;}
  .roster-row.sel{border-color:var(--army);background:#eef2e6;}
  .roster-row.here{opacity:0.55;cursor:default;}
  .roster-row .nm{font-weight:700;font-size:0.95rem;flex:1;}
  .roster-row .ck{width:20px;height:20px;border:2px solid var(--line);border-radius:5px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:0.8rem;color:#fff;font-weight:900;}
  .roster-row.sel .ck{background:var(--army);border-color:var(--army);}
  .here-badge{font-size:0.7rem;font-weight:800;color:var(--army);}
  .empty-hint{color:var(--muted);font-size:0.9rem;padding:6px 0 2px;}
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
      <div id="rosterArea" class="hidden">
        <label>Tap your name, then check in</label>
        <div id="rosterList"></div>
        <div id="rosterEmpty" class="empty-hint hidden">No players added yet. Use "Add me" below.</div>
        <button class="submit" id="checkinBtn" disabled>Check in</button>
        <button class="submit secondary" id="addToggleBtn">My name isn't listed - add me</button>
      </div>
      <div id="formArea" class="hidden">
        <label for="nameInput">Your name</label>
        <input type="text" id="nameInput" maxlength="40" placeholder="e.g. Maria S" autocomplete="off">
        <button class="submit" id="submitBtn">Check in</button>
        <button class="submit secondary" id="backToRosterBtn">Back to list</button>
      </div>
      <div class="msg hidden" id="doneArea">
        <div class="big" id="doneName">You're checked in!</div>
        <div id="doneNames" style="color:var(--muted);font-size:0.9rem;"></div>
        <a id="viewLink" href="#" target="_blank" rel="noopener" class="submit" style="display:block;text-decoration:none;">See live courts &amp; standings</a>
        <button class="submit secondary" id="againBtn">Check in more</button>
      </div>
      <div class="closed hidden" id="closedArea">Check-in is closed by the organizer.</div>
    </div>
  </div>

<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getDatabase, ref, push, onValue } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB8LGAiW_GhGwv69e4ZFFG1XyM3qkWaAt8",
  authDomain: "pickledistrict-fef9a.firebaseapp.com",
  databaseURL: "https://pickledistrict-fef9a-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pickledistrict-fef9a"
};
const app = initializeApp(firebaseConfig, 'checkin');
const db = getDatabase(app);
const auth = getAuth(app);

const SID = new URLSearchParams(window.location.search).get('session');
let roster = [];
let checkinOpen = false;
const selected = new Set();

const rosterArea = document.getElementById('rosterArea');
const formArea = document.getElementById('formArea');
const doneArea = document.getElementById('doneArea');
const closedArea = document.getElementById('closedArea');

function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function hideAll(){ rosterArea.classList.add('hidden'); formArea.classList.add('hidden'); doneArea.classList.add('hidden'); closedArea.classList.add('hidden'); }
function showRoster(){ hideAll(); rosterArea.classList.remove('hidden'); renderRoster(); }
function showForm(){ hideAll(); formArea.classList.remove('hidden'); }
function showClosed(){ hideAll(); closedArea.classList.remove('hidden'); }

function readPlayers(val){
  if(!val) return [];
  const arr = Array.isArray(val) ? val : Object.values(val);
  return arr.filter(p => p && typeof p.name === 'string' && p.name.length)
            .map(p => ({ name: p.name, present: !!p.present }));
}

function updateCheckinBtn(){
  const btn = document.getElementById('checkinBtn');
  btn.disabled = selected.size === 0;
  btn.textContent = selected.size ? `Check in (${selected.size})` : 'Check in';
}

function renderRoster(){
  const list = document.getElementById('rosterList');
  list.innerHTML = roster.map((p, i) => {
    const sel = selected.has(p.name);
    const cls = p.present ? 'roster-row here' : (sel ? 'roster-row sel' : 'roster-row');
    const right = p.present ? '<span class="here-badge">Here ✓</span>' : `<span class="ck">${sel ? '✓' : ''}</span>`;
    return `<div class="${cls}" data-i="${i}"><span class="nm">${esc(p.name)}</span>${right}</div>`;
  }).join('');
  document.getElementById('rosterEmpty').classList.toggle('hidden', roster.length > 0);
  list.querySelectorAll('.roster-row:not(.here)').forEach(row => {
    row.addEventListener('click', () => {
      const p = roster[+row.getAttribute('data-i')];
      if(!p) return;
      if(selected.has(p.name)) selected.delete(p.name); else selected.add(p.name);
      renderRoster();
    });
  });
  updateCheckinBtn();
}

document.getElementById('addToggleBtn').addEventListener('click', showForm);
document.getElementById('backToRosterBtn').addEventListener('click', showRoster);

function showDone(names){
  document.getElementById('doneName').textContent = names.length > 1 ? "You're checked in!" : `You're checked in, ${names[0]}!`;
  document.getElementById('doneNames').textContent = names.join(', ');
  document.getElementById('viewLink').href = `view.html?session=${encodeURIComponent(SID)}`;
  hideAll(); doneArea.classList.remove('hidden');
}

document.getElementById('checkinBtn').addEventListener('click', async () => {
  if(!selected.size) return;
  const btn = document.getElementById('checkinBtn');
  btn.disabled = true;
  const names = [...selected];
  try {
    await Promise.all(names.map(nm => push(ref(db, `sessions/${SID}/checkins`), { name: nm, ts: Date.now() })));
    selected.clear();
    showDone(names);
  } catch(e){
    btn.disabled = false;
    alert('Could not check in. Check-in may be closed. Please ask the organizer.');
  }
});

document.getElementById('submitBtn').addEventListener('click', async () => {
  const name = document.getElementById('nameInput').value.trim();
  if(!name){ document.getElementById('nameInput').focus(); return; }
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  try {
    await push(ref(db, `sessions/${SID}/checkins`), { name, ts: Date.now() });
    showDone([name]);
  } catch(e){
    btn.disabled = false;
    alert('Could not check in. Check-in may be closed. Please ask the organizer.');
  }
});

document.getElementById('againBtn').addEventListener('click', () => {
  document.getElementById('nameInput').value = '';
  document.getElementById('submitBtn').disabled = false;
  document.getElementById('checkinBtn').disabled = true;
  if(checkinOpen) showRoster(); else showClosed();
});

function start(){
  if(!SID){ document.getElementById('card').innerHTML = '<div class="closed">This link is missing a session. Ask the organizer for the correct link.</div>'; return; }
  onValue(ref(db, `sessions/${SID}/name`), s => { const n = s.val(); if(n) document.getElementById('sessionName').textContent = n; });
  onValue(ref(db, `sessions/${SID}/players`), s => { roster = readPlayers(s.val()); if(!rosterArea.classList.contains('hidden')) renderRoster(); });
  onValue(ref(db, `sessions/${SID}/checkinOpen`), s => {
    checkinOpen = s.val() === true;
    if(!checkinOpen){ showClosed(); return; }
    if(doneArea.classList.contains('hidden') && formArea.classList.contains('hidden')) showRoster();
  });
}
signInAnonymously(auth).then(start).catch(() => start());
</script>
</body>
</html>
```

- [ ] **Step 2: Syntax-check the module script**

Run:
```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict/files-github" && node -e '
const fs=require("fs");const html=fs.readFileSync("checkin.html","utf8");
const m=/<script\b[^>]*type=["\x27]module["\x27][^>]*>([\s\S]*?)<\/script>/i.exec(html);
if(!m){console.log("no module script");process.exit(1);}
try{new Function(m[1].replace(/^\s*import[^\n;]*;?/gm,""));console.log("checkin module OK");}
catch(e){console.log("ERROR "+e.message);process.exit(1);}'
```
Expected: `checkin module OK`.

- [ ] **Step 3: Commit and push**

```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict/files-github"
git add checkin.html
git commit -m "checkin.html: name-only roster self-select attendance + view link

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: dashboard.html — default checkinOpen on new sessions

**Files:**
- Modify: `PickleDistrict/files-github/dashboard.html`

- [ ] **Step 1: Add the default**

In `createSession()` `sessionData`, add `checkinOpen: true` alongside the other defaults (next to `sessionEnded: false, sessionEndTime: null`):

```javascript
  sessionEnded: false, sessionEndTime: null,
  checkinOpen: true
```

(Place a comma after the previous field as needed so the object stays valid.)

- [ ] **Step 2: Syntax-check**

Run:
```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict/files-github" && node -e '
const fs=require("fs");const html=fs.readFileSync("dashboard.html","utf8");
const re=/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi;let m,i=0,errs=0;
while((m=re.exec(html))){const a=m[1]||"";if(/\bsrc=/.test(a))continue;const mod=/type=["\x27]module["\x27]/.test(a);const c=m[2];i++;
try{mod?new Function(c.replace(/^\s*import[^\n;]*;?/gm,"").replace(/\bexport\s+/g,"")):new Function(c);console.log("script #"+i+" OK");}
catch(e){errs++;console.log("script #"+i+" ERROR "+e.message);}}process.exit(errs?1:0);'
```
Expected: all scripts OK.

- [ ] **Step 3: Commit and push**

```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict/files-github"
git add dashboard.html
git commit -m "dashboard.html: new sessions default checkinOpen=true

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: Firebase rules (user action)

Paste the ruleset from the spec (`2026-06-29-production-checkin-design.md`, Section 4) into the `pickledistrict-fef9a` Realtime Database console. Without it, anonymous check-in writes are denied. This is a manual step for the user; nothing to commit.

---

## Self-Review

- **Spec coverage:** Section 1 (checkin.html name-only) -> Task 2. Section 2 (checkinOpen state + import) -> Task 1 Steps 1-5,7. Section 3 (admin panel) -> Task 1 Steps 4,6. Section 4 (dashboard default + rules) -> Task 3 + Task 4. Section 5 notes -> Global Constraints. Covered.
- **Placeholder scan:** Full code shown; exact commands + expected output. No TBD/TODO. (Task 3 Step 1 references the exact sibling fields to keep the object valid.)
- **Type consistency:** `checkinOpen` declared (Task1 S1), persisted (S2), loaded (S3), toggled (S4), defaulted (Task3). `_importCheckin`/`window._importCheckin` produced in Task1 S4 and called by the listener in S7. `window._checkinLink`/`window._removeCheckin` defined in S7 and used by S4 functions. checkin.html writes `{name, ts}`; importer and rules expect `{name, ts}`. Player object matches production shape (no skill/via).
