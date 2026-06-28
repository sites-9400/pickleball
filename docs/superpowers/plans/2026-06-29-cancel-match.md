# Cancel Match (in-progress) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin cancel an in-progress match (no score recorded) in both apps, with per-mode choices for what happens to the players/teams.

**Architecture:** A new `cancelMatch(courtId)` opens a small confirm modal whose radio options adapt to the session mode; `confirmCancel()` applies the chosen fate and clears the court to idle (a court is "idle" simply by being absent from the `courts` array). Production app gets the single queue variant. Modes app gets queue + tournament (replay/skip) + ladder (sit-out/remove) variants. Round-robin "skip" needs a new persisted `skipped` flag on tournament matches, excluded by the shared `computeStandings` (so the change lands in `tournament.js` and benefits both `app.html` and `view.html`).

**Tech Stack:** Plain HTML/CSS/JS, no build step. Firebase Realtime DB. `tournament.js` is an ES module unit-tested with `node --test`.

## Global Constraints

- Persist only via `update()` (never `set()`) — preserve `ownerId`/`ownerName`/`createdAt`/`date`/`mode`. (Canceling uses existing `saveState()`, which already uses `update()`.)
- Empty arrays serialize as the `{_empty:true}` sentinel; read back via `normArr`/`normTournament`/`normLadder`. Reuse existing helpers; do not hand-roll persistence.
- `view.html` uses the named `'viewer'` Firebase app instance — do not touch it.
- Court timers derive from `startedAt` — unaffected (cancel removes the slot).
- New inline-`onclick` functions must be global. `app.html` game functions live in the regular `<script>` (global); define the new functions there (no `window.` needed). Only module-scope functions need `window.` exposure.
- No em-dashes in user-facing copy; use plain punctuation.
- Two repos, two Firebase projects: production = `PickleDistrict/files-github` (repo `paddle-district`); Modes = `PickleDistrict-Modes` (repo `pickleball`). Run git inside each folder. Push to deploy via GitHub Pages.

---

### Task 1: tournament.js — exclude skipped matches from standings

**Files:**
- Modify: `PickleDistrict-Modes/tournament.js` (function `computeStandings`, ~lines 34-51)
- Test: `PickleDistrict-Modes/tests/tournament.test.js`

**Interfaces:**
- Consumes: existing `computeStandings(teamCount, matches)`.
- Produces: `computeStandings` now treats a match with `m.skipped === true` as if it were not submitted (ignored in standings). Match objects gain an optional boolean `skipped`.

- [ ] **Step 1: Write the failing test**

Add to `PickleDistrict-Modes/tests/tournament.test.js` (it already imports `computeStandings`):

```javascript
test('computeStandings ignores skipped matches', () => {
  const matches = [
    { teamA: 0, teamB: 1, score1: 11, score2: 5, submitted: true },
    { teamA: 0, teamB: 1, score1: 11, score2: 0, submitted: true, skipped: true },
  ];
  const rows = computeStandings(2, matches);
  const t0 = rows.find(r => r.team === 0);
  assert.equal(t0.played, 1);   // only the non-skipped match counts
  assert.equal(t0.wins, 1);
  assert.equal(t0.pointsFor, 11);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes" && node --test`
Expected: FAIL on the new test (`played` would be 2, `pointsFor` 22) because skipped is not yet excluded.

- [ ] **Step 3: Make the minimal change**

In `computeStandings`, change the guard line from:

```javascript
    if (!m.submitted) continue;
```

to:

```javascript
    if (!m.submitted || m.skipped) continue;
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes" && node --test`
Expected: PASS, all tests (previous count + 1).

- [ ] **Step 5: Commit**

```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes"
git add tournament.js tests/tournament.test.js
git commit -m "tournament.js: exclude skipped matches from standings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Production app — cancel match (queue variant)

**Files:**
- Modify: `PickleDistrict/files-github/app.html`

No automated DOM harness exists for `app.html`; this task is verified by the in-browser smoke steps below (this matches how the codebase has always verified app.html).

**Interfaces:**
- Consumes: existing globals `courts`, `players`, `queueOrder`, `matchQueue`, `getPlayer`, `rebuildMatchQueue`, `renderCourts`, `renderPlayers`, `renderQueue`, `saveState`, `showToast`, and the modal `.hidden` show/hide pattern used by `swapOverlay`.
- Produces: globals `cancelMatch(courtId)`, `confirmCancel()`, `closeCancelModal(e)`; a `#cancelOverlay` modal.

- [ ] **Step 1: Add the Cancel modal HTML**

Immediately after the `swapOverlay` modal block (the `<div ... id="swapOverlay">...</div>`, ~lines 1169-1176), add:

```html
<div class="modal-overlay hidden" id="cancelOverlay" onclick="closeCancelModal(event)">
  <div class="modal">
    <div class="modal-title">Cancel match</div>
    <div class="modal-sub" id="cancelSub"></div>
    <div id="cancelOptions" style="display:flex;flex-direction:column;gap:6px;margin:10px 0;"></div>
    <button class="btn btn-full" style="background:#c0392b;color:#fff;border:none;" onclick="confirmCancel()">Cancel this match</button>
    <button class="btn btn-outline btn-full" style="margin-top:8px" onclick="closeCancelModal()">Keep playing</button>
  </div>
</div>
```

- [ ] **Step 2: Add the three functions**

Immediately after `closeSwapModal` (~lines 1831-1835) in the regular `<script>`, add:

```javascript
let cancelContext = null;
function cancelMatch(courtId) {
  const c = courts.find(ct => ct.id === courtId);
  if (!c || c.submitted) return;
  cancelContext = { courtId };
  const names = [...c.team1, ...c.team2].map(id => getPlayer(id)?.name || '?').join(', ');
  document.getElementById('cancelSub').textContent = `${c.name || 'Court'}: ${names}. No score will be recorded.`;
  document.getElementById('cancelOptions').innerHTML = `
    <label style="font-size:0.85rem;font-weight:600;display:flex;gap:6px;align-items:flex-start;"><input type="radio" name="cancelFate" value="queue" checked> This match only (players go back to the waiting queue)</label>
    <label style="font-size:0.85rem;font-weight:600;display:flex;gap:6px;align-items:flex-start;"><input type="radio" name="cancelFate" value="bench"> Take players out of the queue (sit out, stay in session)</label>
    <label style="font-size:0.85rem;font-weight:600;display:flex;gap:6px;align-items:flex-start;"><input type="radio" name="cancelFate" value="remove"> Remove players from the session</label>`;
  document.getElementById('cancelOverlay').classList.remove('hidden');
}
function closeCancelModal(e) {
  if (e && e.target !== document.getElementById('cancelOverlay')) return;
  document.getElementById('cancelOverlay').classList.add('hidden');
  cancelContext = null;
}
function confirmCancel() {
  if (!cancelContext) return;
  const { courtId } = cancelContext;
  const c = courts.find(ct => ct.id === courtId);
  if (!c) { closeCancelModal(); return; }
  const fate = (document.querySelector('input[name="cancelFate"]:checked')?.value) || 'queue';
  const ids = [...c.team1, ...c.team2];
  if (fate === 'remove') {
    players = players.filter(pl => !ids.includes(pl.id));
    queueOrder = queueOrder.filter(q => !ids.includes(q));
    matchQueue = matchQueue.filter(m => ![...m.team1, ...m.team2].some(id => ids.includes(id)));
  } else if (fate === 'bench') {
    ids.forEach(id => { const p = getPlayer(id); if (p) p.present = false; });
    queueOrder = queueOrder.filter(q => !ids.includes(q));
  } else { // queue
    ids.forEach(id => { if (!queueOrder.includes(id)) queueOrder.push(id); });
  }
  courts = courts.filter(ct => ct.id !== courtId);
  closeCancelModal();
  rebuildMatchQueue();
  renderCourts(); renderPlayers(); renderQueue();
  saveState();
  showToast('Match cancelled.');
}
```

- [ ] **Step 3: Add the Cancel button to active court cards**

In `renderCourts`, find the active-court Submit button (the one with `onclick="submitScore(${def.id})"`, ~line 1890). Immediately after that button's markup, add:

```javascript
`<button class="btn btn-outline btn-full" style="margin-top:6px;color:#c0392b;border-color:#c0392b;" onclick="cancelMatch(${def.id})">Cancel match</button>`
```

(Match the surrounding template-literal concatenation style; the button must be inside the active/unsubmitted branch so it never shows on a submitted court.)

- [ ] **Step 4: Add the Close-court modal HTML**

Immediately after the `cancelOverlay` block you just added, add:

```html
<div class="modal-overlay hidden" id="closeCourtOverlay" onclick="closeCloseCourtModal(event)">
  <div class="modal">
    <div class="modal-title">Close this court?</div>
    <div class="modal-sub" id="closeCourtSub"></div>
    <div id="closeCourtActions" style="display:flex;flex-direction:column;gap:8px;margin-top:12px;"></div>
  </div>
</div>
```

- [ ] **Step 5: Replace `removeCourt` and add the close-court handlers**

Replace the existing `removeCourt` function (~lines 1696-1704) with:

```javascript
let closeCourtContext = null;
function removeCourt(courtId) {
  const def = courtDefs.find(d => d.id === courtId);
  const active = courts.find(c => c.id === courtId && !c.submitted);
  if (!active) { // idle court: remove directly (existing behavior)
    courtDefs = courtDefs.filter(d => d.id !== courtId);
    courts = courts.filter(c => c.id !== courtId);
    renderCourts(); renderQueue(); saveState();
    if (def) showToast(`${def.name} removed.`);
    return;
  }
  // live match: confirm via dialog
  closeCourtContext = { courtId };
  const names = [...active.team1, ...active.team2].map(id => getPlayer(id)?.name || '?').join(', ');
  const s1 = parseInt(document.getElementById(`score1_${courtId}`)?.value);
  const s2 = parseInt(document.getElementById(`score2_${courtId}`)?.value);
  const recordable = !isNaN(s1) && !isNaN(s2);
  document.getElementById('closeCourtSub').textContent = `${active.name || def?.name || 'Court'}: ${names}. The court will be removed and players go back to the waiting queue.`;
  let actions = '';
  if (recordable) {
    actions += `<button class="btn btn-full" style="background:#1e8e3e;color:#fff;border:none;" onclick="closeCourtConfirm('record')">Record score (${s1} - ${s2}) and close</button>`;
    actions += `<button class="btn btn-full" style="background:#c0392b;color:#fff;border:none;" onclick="closeCourtConfirm('discard')">Close without recording</button>`;
  } else {
    actions += `<button class="btn btn-full" style="background:#c0392b;color:#fff;border:none;" onclick="closeCourtConfirm('discard')">Close court (no score)</button>`;
  }
  actions += `<button class="btn btn-outline btn-full" onclick="closeCloseCourtModal()">Keep court</button>`;
  document.getElementById('closeCourtActions').innerHTML = actions;
  document.getElementById('closeCourtOverlay').classList.remove('hidden');
}
function closeCloseCourtModal(e) {
  if (e && e.target !== document.getElementById('closeCourtOverlay')) return;
  document.getElementById('closeCourtOverlay').classList.add('hidden');
  closeCourtContext = null;
}
function closeCourtConfirm(action) {
  if (!closeCourtContext) return;
  const { courtId } = closeCourtContext;
  const def = courtDefs.find(d => d.id === courtId);
  if (action === 'record') {
    closeCloseCourtModal();
    submitScore(courtId);
    const after = courts.find(ct => ct.id === courtId);
    if (after && !after.submitted) return; // submit was aborted (e.g. 0-0 guard declined) -> keep court
    courtDefs = courtDefs.filter(d => d.id !== courtId);
    courts = courts.filter(ct => ct.id !== courtId);
    rebuildMatchQueue(); renderCourts(); renderQueue(); saveState();
    if (def) showToast(`${def.name} closed.`);
    return;
  }
  // discard: players back to the waiting queue, then remove the court
  const c = courts.find(ct => ct.id === courtId);
  if (c) { [...c.team1, ...c.team2].forEach(id => { if (!queueOrder.includes(id)) queueOrder.push(id); }); }
  closeCloseCourtModal();
  courtDefs = courtDefs.filter(d => d.id !== courtId);
  courts = courts.filter(ct => ct.id !== courtId);
  rebuildMatchQueue(); renderCourts(); renderQueue(); saveState();
  if (def) showToast(`${def.name} closed. Players back in the queue.`);
}
```

- [ ] **Step 6: Smoke test in a browser**

Sign in, create a session, add 4+ players (mark present), add a court, Generate Match. Then verify:

*Cancel match:*
- Cancel match -> "This match only" -> Confirm: court goes idle (shows Generate Match), no score/win/loss recorded, leaderboard + match history unchanged, players re-matchable.
- Generate again -> "Take players out of the queue": players show not-present in Players panel, not auto-matched; court idle.
- Generate again (re-add present) -> "Remove from session": players gone from Players list; court idle.
- "Keep playing" / tapping outside closes the modal with no change.

*Close court:*
- Close an idle (no-match) court via the X -> removed directly.
- With a live match and NO score entered, click the X -> dialog -> "Close court (no score)": court removed, those players are back in the waiting queue. "Keep court" aborts.
- Enter a score, click X -> dialog shows "Record score (a - b) and close" and "Close without recording". Record -> score saved to current roster + history, court removed. Discard -> no score recorded, players back in queue, court removed.

*Shared:*
- Open `view.html` via QR during a cancel/close: court shows idle/removed, standings/leaderboard unchanged unless a score was explicitly recorded.
- Confirm a normal Submit still credits whoever is on court (swap one player in, submit, verify the swapped-in player got the result).

- [ ] **Step 7: Commit and push**

```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict/files-github"
git add app.html
git commit -m "app.html: cancel in-progress match + close-court safety dialog

Cancel a live match (back to queue / sit out / remove). Closing a court
with a live match now confirms via dialog and, if a score is entered,
asks whether to record it; players return to the queue.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: Modes app — cancel match (queue + tournament + ladder variants)

**Files:**
- Modify: `PickleDistrict-Modes/app.html`

Depends on Task 1 (the `skipped` exclusion in `computeStandings`). Verified by `node --test` (pure part, from Task 1) plus the in-browser smoke steps below.

**Interfaces:**
- Consumes: existing globals `courts`, `players`, `queueOrder`, `matchQueue`, `getPlayer`, `rebuildMatchQueue`, `renderCourts`, `renderPlayers`, `renderQueue`, `saveState`, `showToast`, `mm()`, `tournament`, `courtDefs`, `busyTeamIndices()`, `placeMatchOnCourt(def, match)`, `fillCourtsFromTournament()`, `normTournament`, `cleanTournament`, and the `swapOverlay` modal pattern.
- Produces: globals `cancelMatch(courtId)`, `confirmCancel()`, `closeCancelModal(e)`; a `#cancelOverlay` modal; tournament match objects gain a persisted optional `skipped` boolean.

- [ ] **Step 1: Persist the `skipped` flag on tournament matches**

In `normTournament` (the `matches: normArr(val.matches).map(m => ({...}))` block, ~lines 1375-1378), add `skipped` to the mapped object so it reads:

```javascript
  matches: normArr(val.matches).map(m => ({
    id: m.id, round: m.round || 1, teamA: m.teamA, teamB: m.teamB,
    score1: (m.score1 ?? ''), score2: (m.score2 ?? ''), submitted: !!m.submitted,
    skipped: !!m.skipped,
  })),
```

Then find `cleanTournament` (the inverse serializer used by `saveState`) and add the same field to each match it emits: `skipped: !!m.skipped`. (Mirror whatever shape `cleanTournament` already builds for a match; just add the one field so it round-trips to Firebase.)

- [ ] **Step 2: Add the Cancel modal HTML**

Immediately after the `swapOverlay` modal block (~lines 1177-1189), add:

```html
<div class="modal-overlay hidden" id="cancelOverlay" onclick="closeCancelModal(event)">
  <div class="modal">
    <div class="modal-title">Cancel match</div>
    <div class="modal-sub" id="cancelSub"></div>
    <div id="cancelOptions" style="display:flex;flex-direction:column;gap:6px;margin:10px 0;"></div>
    <button class="btn btn-full" style="background:#c0392b;color:#fff;border:none;" onclick="confirmCancel()">Cancel this match</button>
    <button class="btn btn-outline btn-full" style="margin-top:8px" onclick="closeCancelModal()">Keep playing</button>
  </div>
</div>
```

- [ ] **Step 3: Add the mode-aware functions**

Immediately after `confirmSwap` (ends ~line 2353) in the regular `<script>`, add:

```javascript
let cancelContext = null;
function cancelMatch(courtId) {
  const c = courts.find(ct => ct.id === courtId);
  if (!c || c.submitted) return;
  const mode = mm();
  let variant = 'queue';
  if (mode === 'roundrobin' || mode === 'bracket') variant = 'tournament';
  else if (mode === 'ladder') variant = 'ladder';
  cancelContext = { courtId, variant };
  const names = [...c.team1, ...c.team2].map(id => getPlayer(id)?.name || '?').join(', ');
  document.getElementById('cancelSub').textContent = `${c.name || 'Court'}: ${names}. No score will be recorded.`;
  const optStyle = 'font-size:0.85rem;font-weight:600;display:flex;gap:6px;align-items:flex-start;';
  let opts = '';
  if (variant === 'tournament') {
    opts = `
      <label style="${optStyle}"><input type="radio" name="cancelFate" value="replay" checked> Replay later (put the match back in the schedule)</label>
      <label style="${optStyle}"><input type="radio" name="cancelFate" value="skip"> Skip this match (not counted in standings)</label>`;
  } else if (variant === 'ladder') {
    opts = `
      <label style="${optStyle}"><input type="radio" name="cancelFate" value="sitout" checked> Drop players to sitting out (tap Reset to re-seed)</label>
      <label style="${optStyle}"><input type="radio" name="cancelFate" value="remove"> Remove players from the session</label>`;
  } else {
    opts = `
      <label style="${optStyle}"><input type="radio" name="cancelFate" value="queue" checked> This match only (players go back to the waiting queue)</label>
      <label style="${optStyle}"><input type="radio" name="cancelFate" value="bench"> Take players out of the queue (sit out, stay in session)</label>
      <label style="${optStyle}"><input type="radio" name="cancelFate" value="remove"> Remove players from the session</label>`;
  }
  document.getElementById('cancelOptions').innerHTML = opts;
  document.getElementById('cancelOverlay').classList.remove('hidden');
}
function closeCancelModal(e) {
  if (e && e.target !== document.getElementById('cancelOverlay')) return;
  document.getElementById('cancelOverlay').classList.add('hidden');
  cancelContext = null;
}
function confirmCancel() {
  if (!cancelContext) return;
  const { courtId, variant } = cancelContext;
  const c = courts.find(ct => ct.id === courtId);
  if (!c) { closeCancelModal(); return; }
  const fate = (document.querySelector('input[name="cancelFate"]:checked')?.value) || '';
  const ids = [...c.team1, ...c.team2];

  if (variant === 'tournament') {
    const prevId = c.tMatchId;
    if (fate === 'skip') {
      const m = tournament.matches.find(x => x.id === prevId);
      if (m) { m.submitted = true; m.skipped = true; m.score1 = ''; m.score2 = ''; }
      courts = courts.filter(ct => ct.id !== courtId);
      fillCourtsFromTournament();
    } else { // replay later: free court, re-seat a different eligible match (match stays unplayed)
      courts = courts.filter(ct => ct.id !== courtId);
      const busy = busyTeamIndices();
      const candidates = tournament.matches.filter(m => !m.submitted && !busy.has(m.teamA) && !busy.has(m.teamB) && m.id !== prevId);
      const def = courtDefs.find(d => d.id === courtId);
      if (candidates.length && def) placeMatchOnCourt(def, candidates[0]);
    }
    closeCancelModal();
    renderCourts(); renderRankings(); saveState();
    showToast('Match cancelled.');
    return;
  }

  if (variant === 'ladder') {
    if (fate === 'remove') {
      players = players.filter(pl => !ids.includes(pl.id));
      queueOrder = queueOrder.filter(q => !ids.includes(q));
    }
    // sitout: players stay present but become unplaced (court removed) -> they render in "Sitting out"
    courts = courts.filter(ct => ct.id !== courtId);
    closeCancelModal();
    renderCourts(); renderPlayers(); saveState();
    showToast(fate === 'remove' ? 'Players removed.' : 'Players moved to sitting out. Tap Reset to re-seed.');
    return;
  }

  // queue variant (waittime / balanced / random / manual / challenge)
  if (fate === 'remove') {
    players = players.filter(pl => !ids.includes(pl.id));
    queueOrder = queueOrder.filter(q => !ids.includes(q));
    matchQueue = matchQueue.filter(m => ![...m.team1, ...m.team2].some(id => ids.includes(id)));
  } else if (fate === 'bench') {
    ids.forEach(id => { const p = getPlayer(id); if (p) p.present = false; });
    queueOrder = queueOrder.filter(q => !ids.includes(q));
  } else { // queue
    ids.forEach(id => { if (!queueOrder.includes(id)) queueOrder.push(id); });
  }
  courts = courts.filter(ct => ct.id !== courtId);
  closeCancelModal();
  rebuildMatchQueue();
  renderCourts(); renderPlayers(); renderQueue();
  saveState();
  showToast('Match cancelled.');
}
```

- [ ] **Step 4: Add the Cancel button to standard active court cards**

In `renderCourts`, find the standard active-court Submit button (`onclick="submitScore(${def.id})"`, ~line 2419, next to the `tSwapMatch(${def.id})` button ~line 2420). Immediately after those buttons, add (matching the template-literal concatenation style):

```javascript
`<button class="btn btn-outline btn-full" style="margin-top:6px;color:#c0392b;border-color:#c0392b;" onclick="cancelMatch(${def.id})">Cancel match</button>`
```

It must sit inside the active/unsubmitted branch so it never renders on a submitted court.

- [ ] **Step 5: Add the Cancel button to ladder court cards**

In `renderLadder`, find the per-court Save Result button (`onclick="saveLadderResult(${c.id})"`, ~line 2096). Immediately after it, add:

```javascript
`<button class="btn btn-outline btn-full" style="margin-top:6px;color:#c0392b;border-color:#c0392b;" onclick="cancelMatch(${c.id})">Cancel match</button>`
```

- [ ] **Step 6: Add the Close-court modal HTML**

Immediately after the `cancelOverlay` block (Step 2), add:

```html
<div class="modal-overlay hidden" id="closeCourtOverlay" onclick="closeCloseCourtModal(event)">
  <div class="modal">
    <div class="modal-title">Close this court?</div>
    <div class="modal-sub" id="closeCourtSub"></div>
    <div id="closeCourtActions" style="display:flex;flex-direction:column;gap:8px;margin-top:12px;"></div>
  </div>
</div>
```

- [ ] **Step 7: Replace `removeCourt` and add the close-court handlers**

Replace the existing `removeCourt` function (~lines 1851-1859) with the block below. It is identical to the production version; `submitScore` is mode-aware in this app, so recording on a round-robin/ladder court routes correctly with no extra code.

```javascript
let closeCourtContext = null;
function removeCourt(courtId) {
  const def = courtDefs.find(d => d.id === courtId);
  const active = courts.find(c => c.id === courtId && !c.submitted);
  if (!active) { // idle court: remove directly (existing behavior)
    courtDefs = courtDefs.filter(d => d.id !== courtId);
    courts = courts.filter(c => c.id !== courtId);
    renderCourts(); renderQueue(); saveState();
    if (def) showToast(`${def.name} removed.`);
    return;
  }
  // live match: confirm via dialog
  closeCourtContext = { courtId };
  const names = [...active.team1, ...active.team2].map(id => getPlayer(id)?.name || '?').join(', ');
  const s1 = parseInt(document.getElementById(`score1_${courtId}`)?.value);
  const s2 = parseInt(document.getElementById(`score2_${courtId}`)?.value);
  const recordable = !isNaN(s1) && !isNaN(s2);
  document.getElementById('closeCourtSub').textContent = `${active.name || def?.name || 'Court'}: ${names}. The court will be removed and players go back to the waiting queue.`;
  let actions = '';
  if (recordable) {
    actions += `<button class="btn btn-full" style="background:#1e8e3e;color:#fff;border:none;" onclick="closeCourtConfirm('record')">Record score (${s1} - ${s2}) and close</button>`;
    actions += `<button class="btn btn-full" style="background:#c0392b;color:#fff;border:none;" onclick="closeCourtConfirm('discard')">Close without recording</button>`;
  } else {
    actions += `<button class="btn btn-full" style="background:#c0392b;color:#fff;border:none;" onclick="closeCourtConfirm('discard')">Close court (no score)</button>`;
  }
  actions += `<button class="btn btn-outline btn-full" onclick="closeCloseCourtModal()">Keep court</button>`;
  document.getElementById('closeCourtActions').innerHTML = actions;
  document.getElementById('closeCourtOverlay').classList.remove('hidden');
}
function closeCloseCourtModal(e) {
  if (e && e.target !== document.getElementById('closeCourtOverlay')) return;
  document.getElementById('closeCourtOverlay').classList.add('hidden');
  closeCourtContext = null;
}
function closeCourtConfirm(action) {
  if (!closeCourtContext) return;
  const { courtId } = closeCourtContext;
  const def = courtDefs.find(d => d.id === courtId);
  if (action === 'record') {
    closeCloseCourtModal();
    submitScore(courtId);
    const after = courts.find(ct => ct.id === courtId);
    if (after && !after.submitted) return; // submit aborted (e.g. 0-0 guard declined) -> keep court
    courtDefs = courtDefs.filter(d => d.id !== courtId);
    courts = courts.filter(ct => ct.id !== courtId);
    rebuildMatchQueue(); renderCourts(); renderQueue(); saveState();
    if (def) showToast(`${def.name} closed.`);
    return;
  }
  // discard: players back to the waiting queue, then remove the court
  const c = courts.find(ct => ct.id === courtId);
  if (c) { [...c.team1, ...c.team2].forEach(id => { if (!queueOrder.includes(id)) queueOrder.push(id); }); }
  closeCloseCourtModal();
  courtDefs = courtDefs.filter(d => d.id !== courtId);
  courts = courts.filter(ct => ct.id !== courtId);
  rebuildMatchQueue(); renderCourts(); renderQueue(); saveState();
  if (def) showToast(`${def.name} closed. Players back in the queue.`);
}
```

- [ ] **Step 8: Run the pure tests**

Run: `cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes" && node --test`
Expected: PASS (Task 1's `skipped` test confirms standings ignore skipped matches).

- [ ] **Step 9: Smoke test in a browser (each mode)**

- **Queue mode (By wait time):** add 4+ present players, court, Generate Match. Cancel -> each of the three fates as in Task 2 (back to queue / sit out / remove). Confirm no score/history recorded.
- **Challenge:** with a full waiting queue, Cancel a court (back to queue) -> court auto-refills with challengers from the queue.
- **Round robin:** build/lock teams, start, court auto-fills.
  - Cancel -> "Replay later": court re-seats a different eligible match (or stays idle if none), the cancelled match stays unplayed and comes up again later; standings unchanged.
  - Cancel -> "Skip this match": that match never appears again, is excluded from standings (Rankings table), court frees. Reload mid-tournament: the skipped match stays skipped (persisted), standings consistent.
- **Ladder:** Start ladder. Cancel a court -> "Drop to sitting out": those players appear in the "Sitting out" section; Reset re-seeds cleanly. "Remove from session": players deleted.
- **Close court:** close an idle court -> removed directly. Close a live-match court with no score -> dialog -> "Close court (no score)" returns players to the queue and removes the court; "Keep court" aborts. Enter a score, close -> "Record score and close" (records via the mode-aware `submitScore`, e.g. a round-robin court updates standings) vs "Close without recording" (discarded, players to queue). Decline the 0-0 guard during record -> court kept.
- **view.html:** open the live mirror during cancels/closes: idle/removed court shows, RR standings exclude skipped matches, leaderboard unchanged unless a score was recorded.
- Confirm swap-mid-game + normal Submit still credit the current on-court roster.

- [ ] **Step 10: Commit and push**

```bash
cd "/Users/gamaliel/Library/CloudStorage/Dropbox/PickleDistrict-Modes"
git add app.html
git commit -m "app.html: cancel in-progress match (all modes) + close-court dialog

Cancel queue modes (back to queue / sit out / remove), round robin
(replay later or skip, skipped excluded from standings), ladder (sit out
or remove). Closing a court with a live match now confirms via dialog and
asks whether to record an entered score; players return to the queue.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Self-Review

- **Spec coverage:** Section 1 (entry point/shared) -> Tasks 2 & 3 (button + modal + clear-to-idle, no score). Section 2 (queue fates) -> Task 2 (production) + Task 3 queue branch. Section 3 round-robin replay/skip -> Task 1 (standings) + Task 3 tournament branch + Step 1 persistence; ladder sit-out/remove -> Task 3 ladder branch + Step 5 button. Section 4 (view.html no-op, invariants) -> covered in constraints + smoke steps. Swap/score-to-current "already exists, don't rebuild" -> reaffirmed in smoke steps only. Covered.
- **Placeholder scan:** No TBD/TODO. All code shown. The one "mirror the existing shape" instruction (cleanTournament, Task 3 Step 1) is concrete: add `skipped: !!m.skipped` to its match object — the field name and value are given.
- **Type consistency:** `cancelContext`, `cancelMatch`, `confirmCancel`, `closeCancelModal`, `#cancelOverlay`, `#cancelSub`, `#cancelOptions`, radio name `cancelFate`, and fate values (`queue`/`bench`/`remove`/`replay`/`skip`/`sitout`) are used consistently across modal HTML and handlers. `skipped` is added in `computeStandings` (Task 1), `normTournament` + `cleanTournament` (Task 3 Step 1), and set in the tournament skip branch (Task 3 Step 3) — consistent.
