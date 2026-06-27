# Matching Styles — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Modes fork's matchmaking around four named styles, add a new Challenge-courts mode, pull a minimal player skill field forward, and upgrade the in-match player edit/replace and manual customize flows (with touch+mouse drag-and-drop).

**Architecture:** Extend the existing Modes fork in place. Pure, combinatorial logic (challenge-court resolution, skill matching/pairing) goes in the already-present `tournament.js` ES module with `node --test` unit tests, bridged into `app.html`'s regular script via `window.X` assignments. UI/Firebase wiring lives in `app.html` and `dashboard.html`. No build step, no new dependencies. Challenge mode and the edit panel reuse the standard `courts` slots and the waiting queue, so `view.html` needs no per-match changes this phase.

**Tech Stack:** Plain HTML/CSS/JS (ES modules), Firebase Realtime Database, `node --test` for unit tests. GitHub Pages deploy from repo root.

## Global Constraints

- Target codebase: `PickleDistrict-Modes/` only (Firebase `pickleball-255db`). Do NOT touch `PickleDistrict/files-github/`.
- `saveState()` uses `update()`, never `set()`; never write `mode` from app.html (set once at dashboard create).
- Court timers derive from `startedAt` (ms epoch), never in-memory counters.
- Firebase strips empty arrays → must round-trip through `normArr` (and the existing `norm*`/`clean*` helpers). No raw empty arrays written.
- `view.html` keeps its named `'viewer'` Firebase app instance — do not modify view.html in this phase.
- Pure functions in `tournament.js` are reachable from app.html's regular `<script>` only via `window.fnName = fnName` bridges declared in the `<script type="module">` block.
- Every new inline `onclick`/`ondrop` handler function must be exposed with `window.fnName = fnName`.
- Avoid em-dashes in user-facing copy; use plain punctuation.
- Player skill enum is exactly `'beginner' | 'intermediate' | 'advanced'`, default `'intermediate'`.
- New matchmaking value is exactly `'challenge'`. `'random'` is relabeled "Numbering" (value unchanged).
- Commit after every task. Run from inside `PickleDistrict-Modes/`.

---

### Task 1: Player skill field — data model + persistence

**Files:**
- Modify: `app.html` — `addPlayer()` (~1608), state load `players = normArr(s.players)` (~1387), saveState player map (~1562)

**Interfaces:**
- Produces: every player object carries `skill: 'beginner'|'intermediate'|'advanced'` (default `'intermediate'`), persisted to Firebase and default-filled on read.

- [ ] **Step 1: Default-fill skill on load.** In the state-load function, immediately after the line `players = normArr(s.players);` (~1387), add a normalization map:

```javascript
  players      = normArr(s.players).map(p => ({ ...p, skill: p.skill || 'intermediate' }));
```

(Replace the existing `players = normArr(s.players);` line with the version above.)

- [ ] **Step 2: Set skill on new players.** In `addPlayer()` (~1608), change the pushed object to include `skill`:

```javascript
    players.push({id:++playerIdCounter,name,present:false,gamesPlayed:0,wins:0,losses:0,points:0,pointsAgainst:0,lastPlayedRound:-1,skill:'intermediate'});
```

- [ ] **Step 3: Persist skill in the saveState player map.** Find the saveState players map (~1562):

```javascript
    players: players.map(p=>({name:p.name,present:p.present,gamesPlayed:p.gamesPlayed,wins:p.wins,losses:p.losses,points:p.points,pointsAgainst:p.pointsAgainst})),
```

This is the *cloud summary* map. Locate instead the FULL player serialization used by `saveState()` (search for the object written under the live `players` key in `saveState`; in this fork the full player objects are written directly). Ensure `skill` is included wherever player objects are serialized for the live session. If players are serialized via spread/`cleanForFirebase`, no change is needed (skill rides along); if there is an explicit field list, add `skill:p.skill`. Verify by reading the saveState body around the `players` key before editing.

- [ ] **Step 4: Browser smoke check.** Load `app.html` against a test session, add a player, reload the page. Confirm in the browser console `players[0].skill === 'intermediate'` and that it survives reload (persisted + default-filled).

- [ ] **Step 5: Commit.**

```bash
git add app.html
git commit -m "Add player skill field (beginner/intermediate/advanced) with persistence + default-fill"
```

---

### Task 2: Player skill UI — badge, add-player selector, counts

**Files:**
- Modify: `app.html` — `renderPlayers()` row markup (~1650), add a `setSkill()` function near `togglePresent`, add a skill counts line, add CSS for `.skill-badge`

**Interfaces:**
- Consumes: `player.skill` (Task 1).
- Produces: `window.setSkill(id)` cycling beginner→intermediate→advanced→beginner; a visible per-row skill badge; a counts summary string.

- [ ] **Step 1: Add CSS.** In the `<style>` block, add:

```css
.skill-badge{font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;padding:3px 7px;border-radius:6px;border:none;cursor:pointer;font-family:var(--font);}
.skill-badge.beginner{background:#e6f4ea;color:#1e7e34;}
.skill-badge.intermediate{background:#fff4e0;color:#b8860b;}
.skill-badge.advanced{background:#fde8e8;color:#c0392b;}
.skill-counts{font-size:0.72rem;font-weight:600;color:var(--muted);margin-top:6px;}
```

- [ ] **Step 2: Add `setSkill()`** near `togglePresent()` (~1616):

```javascript
function setSkill(id){
  const order=['beginner','intermediate','advanced'];
  const p=getPlayer(id); if(!p) return;
  const i=order.indexOf(p.skill||'intermediate');
  p.skill=order[(i+1)%order.length];
  renderPlayers(); saveState();
}
window.setSkill = setSkill;
```

- [ ] **Step 3: Render the badge in each player row.** In `renderPlayers()` row template (~1651-1657), insert the badge before the attendance toggle:

```javascript
      <button class="skill-badge ${p.skill||'intermediate'}" onclick="setSkill(${p.id})" title="Tap to change skill">${({beginner:'Beg',intermediate:'Int',advanced:'Adv'})[p.skill||'intermediate']}</button>
```

- [ ] **Step 4: Render the counts summary.** Add a `<div class="skill-counts" id="skillCounts"></div>` next to the present/total counts in the Players panel markup, and set it at the top of `renderPlayers()`:

```javascript
  const sc={beginner:0,intermediate:0,advanced:0};
  players.forEach(p=>{ sc[p.skill||'intermediate']++; });
  const scEl=document.getElementById('skillCounts'); if(scEl) scEl.textContent=`${sc.beginner} Beginner · ${sc.intermediate} Intermediate · ${sc.advanced} Advanced`;
```

- [ ] **Step 5: Browser smoke check.** Add players, tap a badge — confirm it cycles Beg→Int→Adv and the counts line updates; reload to confirm persistence.

- [ ] **Step 6: Commit.**

```bash
git add app.html
git commit -m "Player skill UI: tappable badge, skill cycle, counts summary"
```

---

### Task 3: tournament.js — Challenge-court resolution (pure + tests)

**Files:**
- Modify: `tournament.js`
- Test: `tests/tournament.test.js`

**Interfaces:**
- Produces: `resolveChallengeCourt({ winnerIds, loserIds, queueIds, teamSize })` →
  `{ stayIds, opponentIds, updatedQueue, ready }`. Losers append to the back of the queue; challengers are drawn from the front; `ready=false` and `opponentIds=[]` when the queue can't field a full team. Players are conserved (no loss/duplication).

- [ ] **Step 1: Write the failing tests.** Append to `tests/tournament.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveChallengeCourt } from '../tournament.js';

test('challenge doubles: winners stay, losers to back, challengers from front', () => {
  const r = resolveChallengeCourt({ winnerIds:[1,2], loserIds:[3,4], queueIds:[5,6,7], teamSize:2 });
  assert.deepEqual(r.stayIds, [1,2]);
  assert.deepEqual(r.opponentIds, [5,6]);
  assert.deepEqual(r.updatedQueue, [7,3,4]);
  assert.equal(r.ready, true);
});

test('challenge singles: one stays, one challenger', () => {
  const r = resolveChallengeCourt({ winnerIds:[1], loserIds:[2], queueIds:[3], teamSize:1 });
  assert.deepEqual(r.stayIds, [1]);
  assert.deepEqual(r.opponentIds, [3]);
  assert.deepEqual(r.updatedQueue, [2]);
  assert.equal(r.ready, true);
});

test('challenge holds when queue too small', () => {
  const r = resolveChallengeCourt({ winnerIds:[1,2], loserIds:[3,4], queueIds:[5], teamSize:2 });
  assert.deepEqual(r.stayIds, [1,2]);
  assert.deepEqual(r.opponentIds, []);
  assert.deepEqual(r.updatedQueue, [5,3,4]);
  assert.equal(r.ready, false);
});

test('challenge conserves players', () => {
  const r = resolveChallengeCourt({ winnerIds:[1,2], loserIds:[3,4], queueIds:[5,6], teamSize:2 });
  const all = [...r.stayIds, ...r.opponentIds, ...r.updatedQueue].sort();
  assert.deepEqual(all, [1,2,3,4,5,6]);
});
```

- [ ] **Step 2: Run tests, verify they fail.**

Run: `node --test`
Expected: FAIL — `resolveChallengeCourt` is not exported.

- [ ] **Step 3: Implement in `tournament.js`.** Add:

```javascript
export function resolveChallengeCourt({ winnerIds, loserIds, queueIds, teamSize }) {
  const stayIds = [...winnerIds];
  // losers wait at the back; challengers come from the front
  const pool = [...queueIds, ...loserIds];
  if (pool.length >= teamSize) {
    return { stayIds, opponentIds: pool.slice(0, teamSize), updatedQueue: pool.slice(teamSize), ready: true };
  }
  return { stayIds, opponentIds: [], updatedQueue: pool, ready: false };
}
```

- [ ] **Step 4: Run tests, verify they pass.**

Run: `node --test`
Expected: PASS (all four new tests + the existing 15).

- [ ] **Step 5: Commit.**

```bash
git add tournament.js tests/tournament.test.js
git commit -m "tournament.js: resolveChallengeCourt pure helper + tests"
```

---

### Task 4: tournament.js — skill helpers (pure + tests)

**Files:**
- Modify: `tournament.js`
- Test: `tests/tournament.test.js`

**Interfaces:**
- Produces:
  - `skillRank(skill)` → `1|2|3` (default `2` for unknown/missing).
  - `bestSkillMatch(outgoingSkill, candidates)` → the id of the candidate with the smallest `|skillRank diff|`; ties broken by candidate order (caller pre-sorts by wait). `candidates` = `[{id, skill}]`. Returns `null` if empty.
  - `skillBalancedTeams(playerObjs, teamSize)` → `{team1, team2}` of ids, snake-distributed by `skillRank` desc then by array order. `playerObjs` = `[{id, skill}]` of length `teamSize*2`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/tournament.test.js`:

```javascript
import { skillRank, bestSkillMatch, skillBalancedTeams } from '../tournament.js';

test('skillRank maps levels and defaults to 2', () => {
  assert.equal(skillRank('beginner'), 1);
  assert.equal(skillRank('intermediate'), 2);
  assert.equal(skillRank('advanced'), 3);
  assert.equal(skillRank('whatever'), 2);
});

test('bestSkillMatch picks nearest skill, ties by order', () => {
  const cands = [{id:5,skill:'advanced'},{id:6,skill:'beginner'},{id:7,skill:'beginner'}];
  // outgoing intermediate(2): beginner diff 1, advanced diff 1 -> first in order wins (id5)
  assert.equal(bestSkillMatch('intermediate', cands), 5);
  // outgoing beginner(1): id6 diff 0 wins
  assert.equal(bestSkillMatch('beginner', cands), 6);
  assert.equal(bestSkillMatch('beginner', []), null);
});

test('skillBalancedTeams snake-distributes by skill (doubles)', () => {
  const ps = [{id:1,skill:'advanced'},{id:2,skill:'advanced'},{id:3,skill:'beginner'},{id:4,skill:'beginner'}];
  const { team1, team2 } = skillBalancedTeams(ps, 2);
  // strongest..weakest = 1,2,3,4 -> snake: team1=[1,4], team2=[2,3]
  assert.deepEqual(team1, [1,4]);
  assert.deepEqual(team2, [2,3]);
});
```

- [ ] **Step 2: Run tests, verify they fail.**

Run: `node --test`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement in `tournament.js`.** Add:

```javascript
export function skillRank(skill) {
  return { beginner:1, intermediate:2, advanced:3 }[skill] || 2;
}

export function bestSkillMatch(outgoingSkill, candidates) {
  if (!candidates || !candidates.length) return null;
  const target = skillRank(outgoingSkill);
  let best = candidates[0], bestDiff = Math.abs(skillRank(best.skill) - target);
  for (const c of candidates.slice(1)) {
    const d = Math.abs(skillRank(c.skill) - target);
    if (d < bestDiff) { best = c; bestDiff = d; }
  }
  return best.id;
}

export function skillBalancedTeams(playerObjs, teamSize) {
  const sorted = [...playerObjs].sort((a,b) => skillRank(b.skill) - skillRank(a.skill));
  const team1 = [], team2 = [];
  // snake: 0->t1, 1->t2, 2->t2, 3->t1, ... keeps total skill even
  sorted.forEach((p, i) => { (i % 4 === 0 || i % 4 === 3 ? team1 : team2).push(p.id); });
  return { team1, team2 };
}
```

- [ ] **Step 4: Run tests, verify they pass.**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tournament.js tests/tournament.test.js
git commit -m "tournament.js: skillRank/bestSkillMatch/skillBalancedTeams + tests"
```

---

### Task 5: Mode menu reorg + dynamic description card + labels

**Files:**
- Modify: `dashboard.html` — `#newSessionMatchmaking` select (~112), add `#modeDesc` card + `change` handler
- Modify: `app.html` — `modeLabel()` (~1688)

**Interfaces:**
- Produces: dashboard select grouped into Primary/More styles with a `challenge` option and "Numbering" label for `random`; a live description card; app.html `modeLabel()` understands `challenge` and shows "Numbering" for `random`.

- [ ] **Step 1: Regroup the select.** Replace the `#newSessionMatchmaking` `<select>` options (`dashboard.html` ~112-119) with:

```html
        <select id="newSessionMatchmaking" class="mode-select">
          <optgroup label="Primary styles">
            <option value="roundrobin">Round robin</option>
            <option value="ladder">King of the court</option>
            <option value="challenge">Challenge courts</option>
            <option value="random">Numbering</option>
          </optgroup>
          <optgroup label="More styles">
            <option value="waittime">By wait time</option>
            <option value="balanced">Balanced (by skill)</option>
            <option value="manual">Manual (pick each match)</option>
            <option value="bracket">Bracket (fixed teams)</option>
          </optgroup>
        </select>
```

- [ ] **Step 2: Add the description card + map.** Directly after the matchmaking `.mode-field` block, add:

```html
      <div class="mode-desc" id="modeDesc"></div>
```

In `dashboard.html`'s script, add and wire:

```javascript
const MODE_DESC = {
  roundrobin: 'Fixed teams play a full schedule against each other. Ranked by wins, then point differential.',
  ladder: 'King of the court. Winners move up a court, losers move down. Partners stay together.',
  challenge: 'Winners stay on their court. Losers go to the back of the waiting queue and the next challengers come on.',
  random: 'Numbering. Players are numbered off and rotate into random matchups.',
  waittime: 'The players who have waited longest are matched up next.',
  balanced: 'Teams are balanced by skill level for even games.',
  manual: 'You pick every match yourself, court by court.',
  bracket: 'Fixed teams play a single or double elimination bracket. (Bracket play arrives in a later phase.)'
};
function updateModeDesc(){
  const sel=document.getElementById('newSessionMatchmaking');
  const el=document.getElementById('modeDesc');
  if(sel&&el) el.textContent=MODE_DESC[sel.value]||'';
}
document.getElementById('newSessionMatchmaking')?.addEventListener('change', updateModeDesc);
updateModeDesc();
```

Add CSS for `.mode-desc`:

```css
.mode-desc{margin-top:8px;font-size:0.78rem;line-height:1.45;color:var(--muted);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;}
```

- [ ] **Step 3: Update `modeLabel()` in app.html** (~1690). Replace the `m` map with:

```javascript
  const m = {waittime:'By wait time', balanced:'Balanced', random:'Numbering', manual:'Manual', ladder:'King of the court', roundrobin:'Round robin', bracket:'Bracket', challenge:'Challenge courts'}[mm()] || mm();
```

- [ ] **Step 4: Browser smoke check.** Open dashboard, change the matchmaking select across all options, confirm the description card updates and Challenge/Numbering appear under Primary. Create a `challenge` session and confirm the Courts-tab badge reads "... · Challenge courts".

- [ ] **Step 5: Commit.**

```bash
git add dashboard.html app.html
git commit -m "Mode menu: primary/more optgroups, Challenge + Numbering, dynamic description card, labels"
```

---

### Task 6: Challenge-courts engine (submit branch + holding fill)

**Files:**
- Modify: `app.html` — `submitScore()` normal branch (~1819), `generateMatchForCourt()` (~1761), `rebuildMatchQueue()` (~1709), `<script type="module">` bridge block (~2360)

**Interfaces:**
- Consumes: `resolveChallengeCourt` (Task 3) via `window.resolveChallengeCourt`.
- Produces: in `challenge` mode, submitting a court keeps winners, queues losers, seats challengers from the waiting queue, or holds the court (`awaitingChallengers`) until enough players exist; `fillChallengeCourts()` fills holding courts whenever the roster changes.

- [ ] **Step 1: Bridge the pure fn.** In the `<script type="module">` block where other `window.X` bridges live (~2360), add:

```javascript
import { resolveChallengeCourt } from './tournament.js';
window.resolveChallengeCourt = resolveChallengeCourt;
```

(If `tournament.js` is already imported there, just add the one `window.resolveChallengeCourt = resolveChallengeCourt;` line and include the name in the existing import.)

- [ ] **Step 2: Add the challenge branch to `submitScore()`.** In the normal accounting path, after `gameHistory.unshift(...)` (~1831) and before `rebuildMatchQueue();` (~1832), insert:

```javascript
  if(mm()==='challenge' && winTeam){
    const winnerIds=[...winTeam];
    const loserIds=[...loseTeam];
    const ts=teamSize();
    // waiting pool excludes the players who just played on this court
    const queueIds=getFreeWaiting().map(p=>p.id).filter(id=>!winnerIds.includes(id)&&!loserIds.includes(id));
    const r=window.resolveChallengeCourt({winnerIds, loserIds, queueIds, teamSize:ts});
    // losers sink to the back of the waiting order
    loserIds.forEach(id=>{ const p=getPlayer(id); if(p) p.lastPlayedRound=globalRound; });
    const def=courtDefs.find(d=>d.id===courtId);
    const now=Date.now(); globalRound++;
    const slot={id:courtId,name:def?.name||`Court ${courtId}`,team1:r.stayIds,team2:r.opponentIds,score1:'',score2:'',submitted:false,round:globalRound,startedAt:now,awaitingChallengers:!r.ready};
    const idx=courts.findIndex(x=>x.id===courtId);
    if(idx>=0) courts[idx]=slot; else courts.push(slot);
    if(!courtTimerInterval) courtTimerInterval=setInterval(tickCourtTimers,1000);
    rebuildMatchQueue();
    renderCourts(); renderRankings(); renderGameHistory(); renderQueue(); saveState();
    showToast(r.ready?'Winners stay. Challengers are up!':'Winners stay. Waiting for challengers.');
    return;
  }
```

- [ ] **Step 3: Add `fillChallengeCourts()`** near `rebuildMatchQueue()` (~1709):

```javascript
function fillChallengeCourts(){
  if(mm()!=='challenge') return false;
  let changed=false;
  const ts=teamSize();
  courts.forEach(c=>{
    if(c.submitted) return;
    if(c.team2 && c.team2.length>0) return; // already has an opponent
    const queueIds=getFreeWaiting().map(p=>p.id).filter(id=>!c.team1.includes(id));
    if(queueIds.length>=ts){
      c.team2=queueIds.slice(0,ts);
      c.awaitingChallengers=false;
      c.startedAt=Date.now();
      changed=true;
    }
  });
  return changed;
}
```

- [ ] **Step 4: Call the filler when the roster changes.** At the very end of `rebuildMatchQueue()`, before it returns, add:

```javascript
  if(mm()==='challenge'){ if(fillChallengeCourts()){ /* re-clean queue after seating */ } }
```

(Place it after the existing matchQueue cleanup so seated players are recognized; calling `fillChallengeCourts` here covers add/remove/togglePresent because they all call `rebuildMatchQueue`.)

- [ ] **Step 5: Render the holding state.** In `renderCourts()` where team names are mapped (~2155), ensure an empty `team2` in challenge mode shows a placeholder. After the `namesHtml` definition, where team2 is rendered, guard:

```javascript
// when c.team2 is empty (challenge holding), render a waiting placeholder instead of blank
```

Concretely, in the team-2 row output, use:

```javascript
${(c.team2&&c.team2.length)?namesHtml(c.team2,'team2'):'<span class="ct-name" style="color:var(--muted)">Waiting for challengers…</span>'}
```

- [ ] **Step 6: Guard generate in challenge mode is fine.** Confirm `generateMatchForCourt` still works for the INITIAL fill in challenge mode (it pulls from `matchQueue`). No change needed unless `rebuildMatchQueue` early-returns for challenge; verify challenge is NOT in the manual/ladder early-return list (~1720). If it is excluded from auto-queue, add `challenge` to the modes that DO build the queue so the initial "Generate Match" works.

- [ ] **Step 7: Browser smoke test.** Create a Doubles / Challenge courts session, add 6 present players, Generate Match on a court, enter a decisive score, Submit → winners stay on the same court, losers drop to the queue back, two challengers come on; drain the queue so a court holds ("Waiting for challengers…"), mark another player present → court auto-fills; submit a tie → rejected; reload mid-session → state restores; open `view.html` → court mirrors live.

- [ ] **Step 8: Commit.**

```bash
git add app.html
git commit -m "Challenge courts engine: winners stay, losers queue, challengers in, holding auto-fill"
```

---

### Task 7: Skill-aware matching (balanced mode + initial pairing)

**Files:**
- Modify: `app.html` — `chooseMatchPlayers()` (~1694), bridge `skillBalancedTeams` in the module block

**Interfaces:**
- Consumes: `skillBalancedTeams` (Task 4) via `window.skillBalancedTeams`; `player.skill` (Task 1).
- Produces: `balanced` mode pairs by skill level (was wins−losses).

- [ ] **Step 1: Bridge the helper.** In the `<script type="module">` block, add `skillBalancedTeams` to the tournament.js import and:

```javascript
window.skillBalancedTeams = skillBalancedTeams;
```

- [ ] **Step 2: Use skill in balanced pairing.** In `chooseMatchPlayers()` replace the balanced-doubles block (~1700-1703):

```javascript
  if(style==='balanced' && ts===2){
    const four=pool.slice(0,need).map(p=>({id:p.id, skill:p.skill||'intermediate'}));
    return window.skillBalancedTeams(four, ts);
  }
```

- [ ] **Step 3: Browser smoke test.** Create a Doubles / Balanced session, add players with mixed Beg/Int/Adv badges, Generate Match repeatedly — confirm each match splits strong and weak across the two teams (one advanced + one beginner per side when possible).

- [ ] **Step 4: Commit.**

```bash
git add app.html
git commit -m "Balanced matchmaking now pairs by declared skill level"
```

---

### Task 8: In-match edit / replace panel (3 options + outgoing fate)

**Files:**
- Modify: `app.html` — `_openSwapOptions()` (~2061), `confirmSwap()` (~2081), swap modal markup (~1148), bridge `bestSkillMatch`

**Interfaces:**
- Consumes: `bestSkillMatch` (Task 4) via `window.bestSkillMatch`; `player.skill`.
- Produces: the per-seat edit modal offers Auto-generate / Pick from queue / Override (any checked-in player, incl. those playing), plus an outgoing-player choice (queue vs remove from session). Override of a currently-playing player empties their old seat, which is then backfilled from the queue (or held).

- [ ] **Step 1: Bridge the helper.** Add `bestSkillMatch` to the tournament.js module import and `window.bestSkillMatch = bestSkillMatch;`.

- [ ] **Step 2: Add an outgoing-fate toggle to the modal.** In the swap modal markup (~1148-1153), add above the option list:

```html
    <div class="swap-fate" id="swapFate" style="display:flex;gap:8px;margin:8px 0;">
      <label style="font-size:0.8rem;font-weight:600;"><input type="radio" name="swapFate" value="queue" checked> Send to waiting queue</label>
      <label style="font-size:0.8rem;font-weight:600;"><input type="radio" name="swapFate" value="remove"> Remove from session</label>
    </div>
```

- [ ] **Step 3: Rework `_openSwapOptions()`** (~2061) to render three sections. Replace its body with:

```javascript
function _openSwapOptions(outgoingId) {
  const outgoing=getPlayer(outgoingId);
  const onCourtIds=new Set();
  courts.filter(c=>!c.submitted).forEach(c=>[...c.team1,...c.team2].forEach(id=>onCourtIds.add(id)));
  const queueCands=getFreeWaiting().map(p=>({id:p.id, skill:p.skill||'intermediate', name:p.name}));
  const overrideCands=presentPlayers().filter(p=>p.id!==outgoingId).map(p=>({id:p.id, name:p.name, playing:onCourtIds.has(p.id)}));
  const autoId=window.bestSkillMatch(outgoing?.skill||'intermediate', queueCands);
  const chip=(id,name,tag)=>`<div class="swap-option" onclick="confirmSwap(${id})">${name}${tag?` <span style="color:var(--muted);font-size:0.7rem;">${tag}</span>`:''}</div>`;
  const autoHtml = autoId!=null
    ? `<div class="swap-section-label">Auto-generate (best skill match)</div>${chip(autoId, getPlayer(autoId)?.name||'?','auto')}`
    : '';
  const queueHtml = queueCands.length
    ? `<div class="swap-section-label">Pick from waiting queue</div>${queueCands.map(c=>chip(c.id,c.name,'')).join('')}`
    : '<div class="swap-section-label">Pick from waiting queue</div><div style="color:var(--muted);font-size:0.8rem;padding:8px;">Queue is empty.</div>';
  const overrideHtml = `<div class="swap-section-label">Override (any checked-in player)</div>${overrideCands.map(c=>chip(c.id,c.name,c.playing?'playing':'')).join('')}`;
  document.getElementById('swapOptions').innerHTML = autoHtml + queueHtml + overrideHtml;
}
```

Add CSS:

```css
.swap-section-label{font-size:0.66rem;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin:12px 0 6px;}
```

(Confirm the modal's options container id is `swapOptions`; if it differs, match the existing id used by the current `_openSwapOptions`.)

- [ ] **Step 4: Handle outgoing fate + override-from-court in `confirmSwap()`** (~2081). Replace its court-swap branch so that: (a) it reads the selected fate; (b) if the incoming player is currently on another court, it empties that seat (challenge holding / backfill handled by `rebuildMatchQueue`/`fillChallengeCourts`); (c) the outgoing player is queued or removed per fate. Implementation:

```javascript
function confirmSwap(incomingId) {
  const fate=(document.querySelector('input[name="swapFate"]:checked')?.value)||'queue';
  if(_swapCtx.kind==='court'){
    const {courtId,team,playerIndex}=_swapCtx;
    const c=courts.find(ct=>ct.id===courtId); if(!c){closeSwapModal();return;}
    const outgoingId=c[team][playerIndex];
    // if incoming is playing elsewhere, vacate that seat
    courts.filter(ct=>!ct.submitted&&ct.id!==courtId).forEach(ct=>{
      ['team1','team2'].forEach(tk=>{ const i=ct[tk].indexOf(incomingId); if(i>=0) ct[tk].splice(i,1); });
    });
    c[team][playerIndex]=incomingId;
    // outgoing fate
    if(fate==='remove'){ const p=getPlayer(outgoingId); if(p){ p.present=false; } queueOrder=queueOrder.filter(q=>q!==outgoingId); }
    else { if(!queueOrder.includes(outgoingId)) queueOrder.push(outgoingId); const p=getPlayer(outgoingId); if(p) p.lastPlayedRound=globalRound; }
    closeSwapModal(); rebuildMatchQueue(); renderCourts(); renderQueue(); saveState();
    return;
  }
  // queue-swap branch (existing behavior) ...
}
```

This requires storing swap context. In `openSwapModal()` set `_swapCtx={kind:'court',courtId,team,playerIndex}` and in `openQueueSwapModal()` set `_swapCtx={kind:'queue',matchId,team,playerIndex}`; declare `let _swapCtx=null;` near the top of the script. Preserve the existing queue-swap logic in the second branch.

- [ ] **Step 5: Expose any new inline handlers.** Ensure `window.confirmSwap = confirmSwap;` exists (it should already). No new globals beyond bridges.

- [ ] **Step 6: Browser smoke test.** On a live doubles court: tap a seat's edit (⇄). Confirm three sections show. (a) Auto-generate seats the nearest-skill queued player. (b) Pick-from-queue swaps a chosen queued player; outgoing goes to queue. (c) Override a player who is on another court → that player moves in and their old court shows a freed seat that backfills (or holds in challenge). Toggle "Remove from session" and confirm the outgoing player leaves (present=false). Reload to confirm persistence.

- [ ] **Step 7: Commit.**

```bash
git add app.html
git commit -m "In-match edit panel: auto/queue/override options + outgoing queue-or-remove + vacate-and-backfill"
```

---

### Task 9: Drag-and-drop match customize (touch + mouse)

**Files:**
- Modify: `app.html` — `renderManualPick()` (~2009), add pointer-based drag handlers + CSS

**Interfaces:**
- Consumes: existing `manualPick` state, `toggleManualPlayer()`, `confirmManualPick()`.
- Produces: in the manual Pick-Match modal, players can be dragged (mouse OR touch) from the available list onto Team A / Team B seats; tap-to-pick still works.

- [ ] **Step 1: Make the preview seats droppable.** In `renderManualPick()`, change the preview markup so Team A and Team B are drop targets with per-seat slots:

```javascript
  document.getElementById('manualPreview').innerHTML=
    `<div class="manual-team drop-team" data-team="A"><span class="manual-team-tag">Team A</span><span class="manual-team-names">${aNames.length?aNames.join(' & '):'Drop here'}</span></div>`+
    `<div class="manual-vs">VS</div>`+
    `<div class="manual-team drop-team" data-team="B"><span class="manual-team-tag">Team B</span><span class="manual-team-names">${bNames.length?bNames.join(' & '):'Drop here'}</span></div>`;
```

- [ ] **Step 2: Add a pointer-drag shim** (works for mouse + touch via Pointer Events). Add near the manual-pick functions:

```javascript
let _drag=null;
function manualDragStart(ev, id){
  ev.preventDefault();
  _drag={id, ghost:null};
  const ghost=document.createElement('div');
  ghost.className='drag-ghost';
  ghost.textContent=getPlayer(id)?.name||'?';
  document.body.appendChild(ghost);
  _drag.ghost=ghost;
  moveGhost(ev);
  window.addEventListener('pointermove', moveGhost);
  window.addEventListener('pointerup', manualDragEnd);
}
function moveGhost(ev){ if(_drag?.ghost){ _drag.ghost.style.left=ev.clientX+'px'; _drag.ghost.style.top=ev.clientY+'px'; } }
function manualDragEnd(ev){
  window.removeEventListener('pointermove', moveGhost);
  window.removeEventListener('pointerup', manualDragEnd);
  const el=document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.drop-team');
  if(el && _drag){
    const team=el.getAttribute('data-team');
    assignManualToTeam(_drag.id, team);
  }
  if(_drag?.ghost) _drag.ghost.remove();
  _drag=null;
}
function assignManualToTeam(id, team){
  const ts=teamSize();
  // remove if already selected, then insert into the chosen team's region
  manualPick.selected=manualPick.selected.filter(x=>x!==id);
  if(team==='A'){ const aCount=Math.min(manualPick.selected.filter((_,i)=>i<ts).length, ts);
    // rebuild: keep current B side, set A side
    const a=manualPick.selected.slice(0,ts), b=manualPick.selected.slice(ts);
    if(a.length<ts) a.push(id); else if(b.length<ts){ b.push(id);} else { showToast('Team A is full.'); return; }
    manualPick.selected=[...a.slice(0,ts), ...b].slice(0,ts*2);
    if(a.length<=ts && !a.includes(id) && manualPick.selected.length<ts*2) manualPick.selected.splice(Math.min(a.length,ts),0,id);
  }
  // Simpler deterministic model: A = indices [0,ts), B = [ts,2ts). Use explicit slot insert:
  renderManualPick();
}
```

NOTE TO IMPLEMENTER: keep the assignment model identical to the tap model — Team A is `selected[0..ts)`, Team B is `selected[ts..2ts)`. Implement `assignManualToTeam(id, team)` as: remove `id` if present; if target side has a free slot, insert at the correct index; else show "Team X is full." Verify against `renderManualPick()`'s slicing before finalizing. (The block above is a starting point; the deterministic slot-insert version is the requirement.)

- [ ] **Step 3: Make chips draggable.** In `renderManualPick()` chip markup, add a pointer handler:

```javascript
        return `<button class="manual-chip ${on?'on':''}" onpointerdown="manualDragStart(event, ${p.id})" onclick="toggleManualPlayer(${p.id})">...same inner...`;
```

(Keep the existing `onclick` for tap; `pointerdown` starts a drag only if the pointer moves — guard a small movement threshold so a tap still registers as a click. Add a threshold in `manualDragStart`/`moveGhost`: only create the ghost once movement exceeds ~6px.)

- [ ] **Step 4: Add CSS.**

```css
.drag-ghost{position:fixed;transform:translate(-50%,-120%);pointer-events:none;background:var(--army);color:#fff;padding:6px 10px;border-radius:8px;font-size:0.8rem;font-weight:700;z-index:9999;}
.drop-team.drag-over{outline:2px dashed var(--army);}
.manual-chip{touch-action:none;}
```

- [ ] **Step 5: Expose handlers.** Add `window.manualDragStart = manualDragStart;` (and any other inline-referenced new fns).

- [ ] **Step 6: Browser smoke test.** Open Manual Pick modal on desktop (mouse-drag a chip to Team A / Team B) AND on a phone (touch-drag). Confirm players land in the dragged-to team, the preview updates, the Start button enables at full match size, and a plain tap still toggles selection. Confirm `confirmManualPick()` starts the match unchanged.

- [ ] **Step 7: Commit.**

```bash
git add app.html
git commit -m "Manual customize: pointer-based drag-and-drop (mouse + touch) onto team seats"
```

---

### Task 10: Docs + smoke-test checklist + dev-notes entry

**Files:**
- Modify: `session-notes.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Append a dated dev-notes entry** to `session-notes.md` following the existing "Stage N" pattern, summarizing Phase 1: skill field, mode-menu reorg + description card, Challenge courts engine, Numbering relabel, edit/replace panel, drag-and-drop. Note the `resolveChallengeCourt`/skill helpers live in `tournament.js` (tested via `node --test`) and are bridged via `window.X`.

- [ ] **Step 2: Add a Phase 1 live smoke-test checklist** under the dev-notes entry covering: challenge play + holding/auto-fill + tie rejection + view mirror + reload; skill badges/counts/persistence; balanced-by-skill pairing; the 3 edit options + outgoing fate + override-vacate-backfill; drag-and-drop on mouse and touch.

- [ ] **Step 3: Run the full unit suite once more.**

Run: `node --test`
Expected: PASS (existing 15 + new challenge/skill tests).

- [ ] **Step 4: Commit.**

```bash
git add session-notes.md
git commit -m "Session notes: Phase 1 matching-styles summary + smoke-test checklist"
```

---

## Self-Review

**Spec coverage (against `2026-06-27-matching-styles-phase1-design.md`):**
- A. Mode menu reorg + description card → Task 5. ✓
- B. Minimal skill field (data + UI + counts) → Tasks 1, 2. ✓
- C. Challenge courts engine → Tasks 3 (pure), 6 (wiring). ✓
- D. Numbering relabel → Task 5 (select label + `modeLabel`). ✓
- E. Edit/replace panel (3 options + outgoing fate + override vacate/backfill) → Task 8 (uses Task 4 best-match). ✓
- F. Drag-and-drop (touch + mouse) → Task 9. ✓
- Skill feeds balanced + auto-best-match → Tasks 7, 8 (use Task 4). ✓
- Invariants (update(), bridges, normArr, startedAt, view.html untouched) → Global Constraints + per-task notes. ✓
- Tests in `tournament.js`/`tests/` → Tasks 3, 4; smoke tests per UI task; checklist Task 10. ✓

**Type consistency:** `resolveChallengeCourt({winnerIds,loserIds,queueIds,teamSize})→{stayIds,opponentIds,updatedQueue,ready}` used identically in Task 3 and Task 6. `skillRank/bestSkillMatch/skillBalancedTeams` signatures match between Task 4 and consumers (Tasks 7, 8). `player.skill` enum/default consistent across Tasks 1, 2, 4, 7, 8. `window.X` bridge names match imports.

**Known soft spots flagged for the implementer (not placeholders — they require reading current code to finalize):** Task 1 Step 3 (locate the exact saveState player serialization), Task 6 Step 6 (confirm `challenge` is not in the auto-queue early-return), Task 8 Step 3 (confirm the modal options container id), Task 9 Step 2 (finalize the deterministic slot-insert assignment to mirror the tap model). Each step says what to verify and the target behavior.
