# Check-in Attendance (roster self-select) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Modes check-in page into an attendance page: show the admin's roster, let visitors tap multiple names to mark themselves present, add a new name if missing, and link to the live view afterward.

**Architecture:** `checkin.html` reads `sessions/{id}/players` live (anonymous read already allowed) and writes one inbox entry `{name, skill, ts}` per selected/added name (payload unchanged, so no Firebase rules change). The admin app's importer, today, rejects a name that already exists; we change `checkinToPlayer` (pure, in `tournament.js`) plus `_importCheckin` (in `app.html`) so an existing name instead flips that player to `present:true`.

**Tech Stack:** Plain HTML/CSS/JS, Firebase RTDB (web SDK 11.0.0), `tournament.js` ES module unit-tested with `node --test`. Modes app only.

## Global Constraints

- Modes app only (`PickleDistrict-Modes/`). No production-app change, no `view.html` change, no Firebase rules change.
- Check-in inbox payload stays exactly `{name, skill, ts}` (rules forbid other fields).
- Font Montserrat, favicon `favicon.png` already present in `checkin.html` head — keep them.
- No em-dashes in user-facing copy; plain punctuation.
- `app.html` game functions are global in the regular `<script>`; `_importCheckin`/`checkinToPlayer` are already `window.`-bridged (module ↔ regular). Keep those bridges.
- Persist via existing `saveState()` (uses `update()`).

---

### Task 1: tournament.js — checkinToPlayer marks an existing name present

**Files:**
- Modify: `PickleDistrict-Modes/tournament.js` (`checkinToPlayer`, ~lines 94-106)
- Test: `PickleDistrict-Modes/tests/tournament.test.js`

**Interfaces:**
- Produces: `checkinToPlayer(entry, existingPlayers)` returns `{markPresentName: <existing player's exact name>}` when the trimmed name matches an existing player (case-insensitive), `{player:{...present:true,via:'qr'...}}` for a new valid name, or `{skip:true, reason:'invalid'}` for an empty/invalid name. (The old `{skip:true, reason:'duplicate'}` return is removed.)

- [ ] **Step 1: Update the duplicate test and add the new-behavior assertion**

In `PickleDistrict-Modes/tests/tournament.test.js`, find the existing test:

```javascript
test('checkinToPlayer skips duplicate names case-insensitively', () => {
  const existing = [{name:'Maria S'}];
  const r = checkinToPlayer({name:'maria s', skill:'beginner', ts:1}, existing);
  assert.deepEqual(r, {skip:true, reason:'duplicate'});
});
```

Replace it with:

```javascript
test('checkinToPlayer marks an existing name present (case-insensitive)', () => {
  const existing = [{name:'Maria S'}];
  const r = checkinToPlayer({name:'maria s', skill:'beginner', ts:1}, existing);
  assert.deepEqual(r, {markPresentName:'Maria S'});
});
```

- [ ] **Step 2: Run tests to verify the updated test fails**

Run: `cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes" && node --test`
Expected: FAIL on "marks an existing name present" (current code returns `{skip:true, reason:'duplicate'}`).

- [ ] **Step 3: Change the duplicate branch**

In `tournament.js` `checkinToPlayer`, replace:

```javascript
  const dup = (existingPlayers || []).some(p =>
    p && typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase());
  if (dup) return { skip: true, reason: 'duplicate' };
```

with:

```javascript
  const match = (existingPlayers || []).find(p =>
    p && typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase());
  if (match) return { markPresentName: match.name };
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes" && node --test`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes"
git add tournament.js tests/tournament.test.js
git commit -m "tournament.js: checkinToPlayer marks existing name present instead of skipping

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: app.html — import marks existing players present

**Files:**
- Modify: `PickleDistrict-Modes/app.html` (`_importCheckin`, ~lines 2923-2938)

Depends on Task 1's `{markPresentName}` contract. Verified by syntax check + smoke (no DOM harness).

**Interfaces:**
- Consumes: `window.checkinToPlayer` (Task 1), globals `players`, `queueOrder`, `getPlayer`, `rebuildMatchQueue`, `renderPlayers`, `renderQueue`, `saveState`, `showToast`, `playerIdCounter`, `window._removeCheckin`.

- [ ] **Step 1: Add the markPresentName branch to `_importCheckin`**

Replace the current body of `window._importCheckin` (from the `const res = ...` line through the new-player block) so it reads:

```javascript
window._importCheckin = function(key, entry) {
  if (!entry) { window._removeCheckin && window._removeCheckin(key); return; }
  const res = window.checkinToPlayer ? window.checkinToPlayer(entry, players) : {skip:true, reason:'invalid'};
  if (res.markPresentName) {
    const ex = players.find(p => p && typeof p.name === 'string' && p.name.toLowerCase() === res.markPresentName.toLowerCase());
    if (ex) {
      ex.present = true;
      if (!queueOrder.includes(ex.id)) queueOrder.push(ex.id);
      rebuildMatchQueue(); renderPlayers(); renderQueue(); saveState();
      showToast(`${ex.name} marked here.`);
    }
    window._removeCheckin && window._removeCheckin(key);
    return;
  }
  if (res.skip) {
    if (res.reason === 'invalid') console.warn('[checkin] skipped invalid entry', key, entry);
    window._removeCheckin && window._removeCheckin(key);
    return;
  }
  const p = res.player; p.id = ++playerIdCounter;
  players.push(p);
  if (!queueOrder.includes(p.id)) queueOrder.push(p.id);
  rebuildMatchQueue(); renderPlayers(); renderQueue(); saveState();
  showToast(`${p.name} checked in.`);
  window._removeCheckin && window._removeCheckin(key);
};
```

- [ ] **Step 2: Syntax-check the inline scripts**

Run:
```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes" && node -e '
const fs=require("fs");const html=fs.readFileSync("app.html","utf8");
const re=/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi;let m,i=0,errs=0;
while((m=re.exec(html))){const a=m[1]||"";if(/\bsrc=/.test(a))continue;const mod=/type=["\x27]module["\x27]/.test(a);const c=m[2];i++;
try{mod?new Function(c.replace(/^\s*import[^\n;]*;?/gm,"").replace(/\bexport\s+/g,"")):new Function(c);console.log("script #"+i+" OK");}
catch(e){errs++;console.log("script #"+i+" ERROR "+e.message);}}process.exit(errs?1:0);'
```
Expected: all scripts OK.

- [ ] **Step 3: Commit**

```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes"
git add app.html
git commit -m "app.html: importing a check-in for an existing name marks them present

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: checkin.html — roster self-select + add + view link

**Files:**
- Modify (full rewrite): `PickleDistrict-Modes/checkin.html`

Verified by syntax check + smoke. Writes only `{name, skill, ts}` inbox entries (no rules change).

**Interfaces:**
- Consumes: Firebase reads `sessions/{id}/players`, `sessions/{id}/name`, `sessions/{id}/checkinOpen`; write `push(sessions/{id}/checkins, {name, skill, ts})`. Marking-present happens admin-side (Tasks 1-2).

- [ ] **Step 1: Replace the entire file with the new version**

Write `PickleDistrict-Modes/checkin.html` with exactly this content:

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
  .skills{display:flex;gap:8px;}
  .skills button{flex:1;font-family:var(--font);font-size:0.82rem;font-weight:700;padding:11px 6px;border:1.5px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);cursor:pointer;}
  .skills button.on{background:var(--army);color:#fff;border-color:var(--army);}
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
  .roster-row .sk{font-size:0.68rem;font-weight:800;text-transform:uppercase;color:var(--muted);}
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
        <label>Skill level</label>
        <div class="skills" id="skills">
          <button type="button" data-skill="beginner">Beginner</button>
          <button type="button" data-skill="intermediate" class="on">Intermediate</button>
          <button type="button" data-skill="advanced">Advanced</button>
        </div>
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
  apiKey: "AIzaSyDDyMStj6lavAgA9j6sImmFavauI0lha-E",
  authDomain: "pickleball-255db.firebaseapp.com",
  databaseURL: "https://pickleball-255db-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pickleball-255db"
};
const app = initializeApp(firebaseConfig, 'checkin');
const db = getDatabase(app);
const auth = getAuth(app);

const SID = new URLSearchParams(window.location.search).get('session');
const SKILLS = ['beginner','intermediate','advanced'];
let skill = 'intermediate';
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
            .map(p => ({ name: p.name, skill: p.skill, present: !!p.present }));
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
    const sk = SKILLS.includes(p.skill) ? p.skill.slice(0,3) : 'int';
    const right = p.present ? '<span class="here-badge">Here ✓</span>' : `<span class="ck">${sel ? '✓' : ''}</span>`;
    return `<div class="${cls}" data-i="${i}"><span class="nm">${esc(p.name)}</span><span class="sk">${sk}</span>${right}</div>`;
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

document.querySelectorAll('#skills button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#skills button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); skill = b.getAttribute('data-skill');
}));

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
    await Promise.all(names.map(nm => {
      const p = roster.find(r => r.name === nm);
      const sk = (p && SKILLS.includes(p.skill)) ? p.skill : 'intermediate';
      return push(ref(db, `sessions/${SID}/checkins`), { name: nm, skill: sk, ts: Date.now() });
    }));
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
    await push(ref(db, `sessions/${SID}/checkins`), { name, skill, ts: Date.now() });
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
  skill = 'intermediate';
  document.querySelectorAll('#skills button').forEach(x => x.classList.remove('on'));
  document.querySelector('#skills button[data-skill="intermediate"]').classList.add('on');
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
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes" && node -e '
const fs=require("fs");const html=fs.readFileSync("checkin.html","utf8");
const m=/<script\b[^>]*type=["\x27]module["\x27][^>]*>([\s\S]*?)<\/script>/i.exec(html);
if(!m){console.log("no module script");process.exit(1);}
try{new Function(m[1].replace(/^\s*import[^\n;]*;?/gm,""));console.log("checkin module OK");}
catch(e){console.log("ERROR "+e.message);process.exit(1);}'
```
Expected: `checkin module OK`.

- [ ] **Step 3: Smoke test in a browser**

With a live session whose `checkinOpen` is true and a few admin-added players:
- Open `checkin.html?session=<id>` (private window). Roster lists the admin's players; session name shows in the header.
- Tap 2-3 names -> button reads "Check in (3)" -> tap it -> done screen lists those names. On the admin app those players flip to **present** ("Here") with a toast each; inbox drains. Reload the admin app mid-way -> backlog import still marks them.
- A player already present shows greyed with "Here ✓" and is not tappable.
- "My name isn't listed - add me" -> form -> enter a new name + skill -> done; new present player appears on admin (QR tag). "Back to list" returns to the roster.
- Done screen: "See live courts & standings" opens `view.html?session=<id>`; "Check in more" returns to the roster.
- Toggle `checkinOpen` off on the admin -> the page shows the closed message.

- [ ] **Step 4: Commit and push all three tasks**

```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes"
git add checkin.html
git commit -m "checkin.html: roster self-select attendance + add-me + live view link

Show the admin roster; tap names to mark present (via the existing inbox);
add a new name if not listed; link to the live view after checking in.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Self-Review

- **Spec coverage:** Section 1 (roster multi-select, greyed present, checkinOpen gate, empty hint) -> Task 3 Step 1. Section 2 (add form) -> Task 3. Section 3 (submit one entry per name, done state with view link + check-in more) -> Task 3. Section 4 (importer marks existing present) -> Task 1 (`tournament.js`) + Task 2 (`app.html`). Section 5 notes (no rules/view/prod change) -> Global Constraints. Covered.
- **Placeholder scan:** No TBD/TODO; full file content and full functions shown; exact commands with expected output.
- **Type consistency:** `{markPresentName}` produced in Task 1, consumed in Task 2. `readPlayers`/`renderRoster`/`showDone`/`showRoster`/`showForm`/`showClosed`/`selected`/`roster`/`checkinOpen` defined and used consistently in Task 3. Inbox payload `{name, skill, ts}` consistent across checkin write, rules, and importer.
