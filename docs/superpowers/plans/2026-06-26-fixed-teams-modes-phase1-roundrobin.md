# Fixed-Teams Modes — Phase 1: Team Builder + Round-Robin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed-teams **round-robin** matchmaking mode (and the shared team builder it needs) to the PickleDistrict-Modes app, plus a read-only standings mirror in the public viewer.

**Architecture:** Pure tournament logic (team formation, schedule generation, standings, match selection) lives in a new `tournament.js` ES module, unit-tested in Node. `app.html` imports it and wires up state, persistence, the team-builder UI, round-robin play (auto-fill courts with manual override, reusing the existing `courts` slots so `view.html` mirrors live matches unchanged), and the standings table. `view.html` gains a read-only standings mirror.

**Tech Stack:** Plain ES-module JavaScript (no framework, no build step). Firebase Realtime DB (`pickleball-255db`). Node 26 built-in `node:test`/`node:assert` for unit tests.

## Global Constraints

- No build step, no bundler, no npm dependencies. `tournament.js` is a native ES module loaded directly by the browser and by Node.
- `app.html` is the ONLY writer to Firebase; all writes go through the existing `saveState()` which uses `update()` — never `set()`.
- `session.mode` (`{format, matchmaking}`) is set once at dashboard creation and is read-only in `app.html`; `saveState()` must never write `mode`.
- Firebase strips empty arrays → persist them as the `{_empty:true}` sentinel and convert back on read (existing `normArr`/`cleanForFirebase` helpers).
- `view.html` uses the named `'viewer'` Firebase app instance — do not touch its auth.
- Live matches MUST flow through the existing `courts` slots (`team1`/`team2` = arrays of player ids, `startedAt` = Firebase timestamp) so `view.html` renders them with no changes.
- No em-dashes in user-facing copy; use plain punctuation.
- `teamSize()` returns 1 (singles) or 2 (doubles) from `session.mode.format`; all team logic must respect it.

---

## Testing strategy (read before starting)

- **Pure logic** (Tasks 1-4, all in `tournament.js`): full TDD with `node --test`. These functions have no DOM/Firebase dependency.
- **UI/integration** (Tasks 5-9, in `app.html`/`view.html`/`dashboard.html`): there is no DOM test harness in this repo and the no-build constraint forbids adding one. These tasks are verified by (a) the pure functions they call already being unit-tested, (b) an ES-module syntax check, and (c) the manual browser smoke test in Task 10. This is a deliberate tradeoff, not an oversight.
- **Syntax check for `app.html`/`view.html`** (they embed the module inline): extract the module body and run `node --check`. Command given in each UI task.

---

## File Structure

- **Create `tournament.js`** — pure tournament logic (team formation, RR schedule, standings, eligible-match selection). One responsibility: tournament math, zero I/O.
- **Create `tests/tournament.test.js`** — Node unit tests for `tournament.js`.
- **Create `package.json`** — `{"type":"module","private":true}` so Node treats `.js` as ESM (lets the same `tournament.js` be imported by both the browser and the tests). Harmless on GitHub Pages.
- **Modify `dashboard.html`** — add `roundrobin` (and `bracket`, for forward-compat) options to the matchmaking `<select>`.
- **Modify `app.html`** — import `tournament.js`; add `tournament` state + `normTournament`/`cleanTournament` + save/load wiring; team-builder UI; round-robin play; standings render; mode guards.
- **Modify `view.html`** — read-only round-robin standings mirror.
- **Modify `session-notes.md`** — append a session entry (gitignored, local only).

---

### Task 1: Pure team formation (`buildTeams`)

**Files:**
- Create: `package.json`
- Create: `tournament.js`
- Test: `tests/tournament.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildTeams(playerIds: string[], teamSize: number) => { teams: string[][], leftover: string[] }`. Slices `playerIds` in order into teams of `teamSize`; any remainder (fewer than `teamSize`) is returned as `leftover`. Deterministic (caller shuffles first for random pairing).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pickleball-modes",
  "version": "1.0.0",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/tournament.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeams } from '../tournament.js';

test('buildTeams: doubles pairs in order, no leftover', () => {
  const r = buildTeams(['a', 'b', 'c', 'd'], 2);
  assert.deepEqual(r.teams, [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(r.leftover, []);
});

test('buildTeams: doubles with odd remainder leaves leftover', () => {
  const r = buildTeams(['a', 'b', 'c', 'd', 'e'], 2);
  assert.deepEqual(r.teams, [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(r.leftover, ['e']);
});

test('buildTeams: singles makes one-player teams', () => {
  const r = buildTeams(['a', 'b', 'c'], 1);
  assert.deepEqual(r.teams, [['a'], ['b'], ['c']]);
  assert.deepEqual(r.leftover, []);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — cannot resolve `../tournament.js` / `buildTeams` is not exported.

- [ ] **Step 4: Write minimal implementation**

Create `tournament.js`:

```js
// Pure tournament logic. No DOM, no Firebase, no I/O.

export function buildTeams(playerIds, teamSize) {
  const teams = [];
  let i = 0;
  for (; i + teamSize <= playerIds.length; i += teamSize) {
    teams.push(playerIds.slice(i, i + teamSize));
  }
  return { teams, leftover: playerIds.slice(i) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json tournament.js tests/tournament.test.js
git commit -m "feat: pure buildTeams + Node test scaffold"
```

---

### Task 2: Pure round-robin schedule (`generateRoundRobin`)

**Files:**
- Modify: `tournament.js`
- Test: `tests/tournament.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `generateRoundRobin(teamCount: number, passes: number) => Array<{ round: number, teamA: number, teamB: number }>`. Uses the circle method. `teamA`/`teamB` are 0-based team indices. For odd `teamCount`, one team sits out each round (the bye is simply omitted, never emitted as a match). `passes` (1 or 2) repeats the whole schedule, continuing the `round` counter. `round` starts at 1.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tournament.test.js`:

```js
import { generateRoundRobin } from '../tournament.js';

function pairKey(m) { return [m.teamA, m.teamB].sort((a, b) => a - b).join('-'); }

test('generateRoundRobin: 4 teams single pass = 6 unique matches', () => {
  const s = generateRoundRobin(4, 1);
  assert.equal(s.length, 6);
  const keys = new Set(s.map(pairKey));
  assert.equal(keys.size, 6); // every pair exactly once
});

test('generateRoundRobin: 4 teams has 3 rounds of 2 matches each', () => {
  const s = generateRoundRobin(4, 1);
  const byRound = {};
  for (const m of s) (byRound[m.round] ||= []).push(m);
  assert.deepEqual(Object.keys(byRound).map(Number).sort((a, b) => a - b), [1, 2, 3]);
  for (const r of Object.values(byRound)) assert.equal(r.length, 2);
});

test('generateRoundRobin: no team plays twice in one round', () => {
  const s = generateRoundRobin(6, 1);
  const byRound = {};
  for (const m of s) (byRound[m.round] ||= []).push(m);
  for (const matches of Object.values(byRound)) {
    const seen = new Set();
    for (const m of matches) {
      assert.ok(!seen.has(m.teamA) && !seen.has(m.teamB), 'team double-booked in a round');
      seen.add(m.teamA); seen.add(m.teamB);
    }
  }
});

test('generateRoundRobin: 5 teams (odd) = 10 matches, one bye per round', () => {
  const s = generateRoundRobin(5, 1);
  assert.equal(s.length, 10); // 5*4/2
});

test('generateRoundRobin: double pass = twice the matches', () => {
  assert.equal(generateRoundRobin(4, 2).length, 12);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `generateRoundRobin` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tournament.js`:

```js
export function generateRoundRobin(teamCount, passes = 1) {
  const matches = [];
  let round = 1;
  for (let pass = 0; pass < passes; pass++) {
    // Circle method. Pad with a sentinel "bye" (-1) when odd.
    const ids = Array.from({ length: teamCount }, (_, i) => i);
    if (ids.length % 2 === 1) ids.push(-1);
    const n = ids.length;
    const arr = ids.slice();
    for (let r = 0; r < n - 1; r++) {
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i], b = arr[n - 1 - i];
        if (a !== -1 && b !== -1) matches.push({ round, teamA: a, teamB: b });
      }
      // rotate all but the first element
      arr.splice(1, 0, arr.pop());
      round++;
    }
  }
  return matches;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add tournament.js tests/tournament.test.js
git commit -m "feat: pure round-robin schedule generation (circle method)"
```

---

### Task 3: Pure standings (`computeStandings`)

**Files:**
- Modify: `tournament.js`
- Test: `tests/tournament.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `computeStandings(teamCount: number, matches: Array<{teamA, teamB, score1, score2, submitted}>) => Array<{ team: number, wins, losses, pointsFor, pointsAgainst, diff, played }>`. Aggregates only `submitted` matches (`score1` is teamA's score, `score2` is teamB's). Sorted by **wins desc → diff desc → pointsFor desc**. `team` is the 0-based index. Ties in scores count as no win/loss for either but still add points (round-robin allows draws in scoring even though Ladder does not).

- [ ] **Step 1: Write the failing tests**

Append to `tests/tournament.test.js`:

```js
import { computeStandings } from '../tournament.js';

test('computeStandings: wins rank first', () => {
  const matches = [
    { teamA: 0, teamB: 1, score1: 11, score2: 5, submitted: true },
    { teamA: 0, teamB: 2, score1: 11, score2: 9, submitted: true },
    { teamA: 1, teamB: 2, score1: 11, score2: 3, submitted: true },
  ];
  const s = computeStandings(3, matches);
  assert.equal(s[0].team, 0); // 2 wins
  assert.equal(s[0].wins, 2);
});

test('computeStandings: tie on wins broken by diff', () => {
  const matches = [
    { teamA: 0, teamB: 1, score1: 11, score2: 1, submitted: true }, // 0 big win (+10)
    { teamA: 1, teamB: 2, score1: 11, score2: 9, submitted: true }, // 1 small win (+2)
    { teamA: 2, teamB: 0, score1: 11, score2: 9, submitted: true }, // 2 beats 0
  ];
  // wins: 0=1, 1=1, 2=1. diff: 0=+10-2=+8, 1=-10+2=-8, 2=+2-... compute
  const s = computeStandings(3, matches);
  assert.equal(s[0].team, 0); // best diff
});

test('computeStandings: ignores unsubmitted matches', () => {
  const matches = [
    { teamA: 0, teamB: 1, score1: 11, score2: 5, submitted: true },
    { teamA: 0, teamB: 1, score1: 0, score2: 0, submitted: false },
  ];
  const s = computeStandings(2, matches);
  assert.equal(s.find(t => t.team === 0).played, 1);
});

test('computeStandings: includes teams with no games played', () => {
  const s = computeStandings(4, []);
  assert.equal(s.length, 4);
  assert.ok(s.every(t => t.played === 0));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `computeStandings` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tournament.js`:

```js
export function computeStandings(teamCount, matches) {
  const rows = Array.from({ length: teamCount }, (_, team) => ({
    team, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, diff: 0, played: 0,
  }));
  for (const m of matches) {
    if (!m.submitted) continue;
    const a = rows[m.teamA], b = rows[m.teamB];
    if (!a || !b) continue;
    a.played++; b.played++;
    a.pointsFor += m.score1; a.pointsAgainst += m.score2;
    b.pointsFor += m.score2; b.pointsAgainst += m.score1;
    if (m.score1 > m.score2) { a.wins++; b.losses++; }
    else if (m.score2 > m.score1) { b.wins++; a.losses++; }
  }
  for (const r of rows) r.diff = r.pointsFor - r.pointsAgainst;
  rows.sort((x, y) => y.wins - x.wins || y.diff - x.diff || y.pointsFor - x.pointsFor);
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS (all tests so far).

- [ ] **Step 5: Commit**

```bash
git add tournament.js tests/tournament.test.js
git commit -m "feat: pure round-robin standings (wins > diff > points-for)"
```

---

### Task 4: Pure next-eligible-match selection (`nextEligibleMatch`)

**Files:**
- Modify: `tournament.js`
- Test: `tests/tournament.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `nextEligibleMatch(matches: Array<{id, teamA, teamB, submitted}>, busyTeams: Set<number>|number[]) => match | null`. Returns the first unsubmitted match whose `teamA` and `teamB` are both NOT in `busyTeams`, in schedule order; else `null`. `busyTeams` may be an array or Set.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tournament.test.js`:

```js
import { nextEligibleMatch } from '../tournament.js';

test('nextEligibleMatch: skips matches with a busy team', () => {
  const matches = [
    { id: 'm1', teamA: 0, teamB: 1, submitted: false },
    { id: 'm2', teamA: 2, teamB: 3, submitted: false },
  ];
  const r = nextEligibleMatch(matches, [0]); // team 0 busy
  assert.equal(r.id, 'm2');
});

test('nextEligibleMatch: skips submitted matches', () => {
  const matches = [
    { id: 'm1', teamA: 0, teamB: 1, submitted: true },
    { id: 'm2', teamA: 0, teamB: 2, submitted: false },
  ];
  assert.equal(nextEligibleMatch(matches, []).id, 'm2');
});

test('nextEligibleMatch: null when nothing eligible', () => {
  const matches = [{ id: 'm1', teamA: 0, teamB: 1, submitted: false }];
  assert.equal(nextEligibleMatch(matches, [0, 1]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `nextEligibleMatch` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tournament.js`:

```js
export function nextEligibleMatch(matches, busyTeams) {
  const busy = busyTeams instanceof Set ? busyTeams : new Set(busyTeams);
  return matches.find(m => !m.submitted && !busy.has(m.teamA) && !busy.has(m.teamB)) || null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS (full suite).

- [ ] **Step 5: Commit**

```bash
git add tournament.js tests/tournament.test.js
git commit -m "feat: pure next-eligible-match selection"
```

---

### Task 5: Dashboard option + mode label + mode guards

**Files:**
- Modify: `dashboard.html:117` (after the `ladder` option)
- Modify: `app.html:1634` (modeLabel map)
- Modify: `app.html` `rebuildMatchQueue` early-return guard (find with grep below)

**Interfaces:**
- Consumes: nothing.
- Produces: `session.mode.matchmaking` can now be `'roundrobin'` or `'bracket'`; `modeLabel()` renders friendly text; the standard auto-queue does not run for these modes.

- [ ] **Step 1: Add dashboard options**

In `dashboard.html`, after the line `<option value="ladder">Ladder — King of the Court</option>` add:

```html
          <option value="roundrobin">Round robin (fixed teams)</option>
          <option value="bracket">Bracket (fixed teams)</option>
```

- [ ] **Step 2: Extend `modeLabel()` map**

In `app.html`, find the `modeLabel` map line:

Run: `grep -n "waittime:'By wait time'" app.html`

Replace that object literal with (add the two new keys):

```js
  const m = {waittime:'By wait time', balanced:'Balanced', random:'Random', manual:'Manual', ladder:'Ladder (KotC)', roundrobin:'Round robin', bracket:'Bracket'}[mm()] || mm();
```

- [ ] **Step 3: Guard the auto-queue for the new modes**

Run: `grep -n "function rebuildMatchQueue" app.html`

At the top of `rebuildMatchQueue()` (right after the opening brace) there is an existing early-return for ladder/manual modes. Find it:

Run: `grep -n "mm()==='ladder'\|mm()==='manual'\|style==='ladder'" app.html`

Add `roundrobin` and `bracket` to that guard so the function returns early for them too. The guard line currently reads similar to:

```js
  if(mm()==='manual' || mm()==='ladder'){ matchQueue=[]; renderQueue(); return; }
```

Change it to:

```js
  if(mm()==='manual' || mm()==='ladder' || mm()==='roundrobin' || mm()==='bracket'){ matchQueue=[]; renderQueue(); return; }
```

(If the existing guard is written differently, preserve its body and just add the two `|| mm()===...` clauses.)

- [ ] **Step 4: Verify the new options are present**

Run: `grep -c "roundrobin\|bracket" dashboard.html app.html`
Expected: at least `dashboard.html:2` and `app.html:` ≥ 2.

- [ ] **Step 5: Commit**

```bash
git add dashboard.html app.html
git commit -m "feat: add round-robin + bracket mode options and guards"
```

---

### Task 6: Tournament state + persistence in `app.html`

**Files:**
- Modify: `app.html` — module top-level state declarations (near where `let ladder` is declared)
- Modify: `app.html:1255` (saveState payload) and `app.html:1345` (load/apply state)
- Modify: `app.html` — add `normTournament`/`cleanTournament` next to `normLadder`/`cleanLadder` (`app.html:1290-1303`)
- Modify: `app.html` module imports (`app.html:2226-2228`)

**Interfaces:**
- Consumes: `normArr`, `cleanForFirebase` (existing). The pure functions from `tournament.js`.
- Produces: module-scope `let tournament` holding `{ kind:'roundrobin', started:bool, locked:bool, passes:1|2, teams:[{id,players:[pid],name}], matches:[{id,round,teamA,teamB,score1,score2,submitted}] }`; persisted round-trip via `cleanTournament`/`normTournament`.

- [ ] **Step 1: Import the pure module**

After `app.html:2228` (the last Firebase import inside the `<script type="module">`) add:

```js
import { buildTeams, generateRoundRobin, computeStandings, nextEligibleMatch } from './tournament.js';
```

- [ ] **Step 2: Declare state**

Run: `grep -n "let ladder" app.html`

Immediately after the `let ladder ...;` declaration add:

```js
let tournament = null;
```

- [ ] **Step 3: Add norm/clean helpers**

After the `cleanLadder` function (ends at `app.html:1303`) add:

```js
function normTournament(val) {
  if (!val || typeof val !== 'object') return null;
  return {
    kind: val.kind || 'roundrobin',
    started: !!val.started,
    locked: !!val.locked,
    passes: val.passes === 2 ? 2 : 1,
    teams: normArr(val.teams).map(t => ({
      id: t.id, name: t.name || '', players: normArr(t.players),
    })),
    matches: normArr(val.matches).map(m => ({
      id: m.id, round: m.round || 1, teamA: m.teamA, teamB: m.teamB,
      score1: (m.score1 ?? ''), score2: (m.score2 ?? ''), submitted: !!m.submitted,
    })),
  };
}
function cleanTournament(t) {
  return {
    kind: t.kind || 'roundrobin',
    started: !!t.started,
    locked: !!t.locked,
    passes: t.passes === 2 ? 2 : 1,
    teams: t.teams && t.teams.length
      ? t.teams.map(tm => ({ id: tm.id, name: tm.name || '', players: cleanForFirebase(tm.players) }))
      : {_empty:true},
    matches: t.matches && t.matches.length
      ? t.matches.map(m => ({ id: m.id, round: m.round, teamA: m.teamA, teamB: m.teamB,
          score1: m.score1 === '' ? -1 : m.score1, score2: m.score2 === '' ? -1 : m.score2, submitted: !!m.submitted }))
      : {_empty:true},
  };
}
```

Note: scores persist as `-1` for "not entered" because Firebase keeps numbers; `normTournament` leaves them as-is and the render layer treats `< 0` as blank (handled in Task 8).

- [ ] **Step 4: Wire into saveState payload**

At `app.html:1255` there is `ladder: ladder ? cleanLadder(ladder) : null,`. Add directly below it:

```js
    tournament: tournament ? cleanTournament(tournament) : null,
```

- [ ] **Step 5: Wire into load/apply state**

At `app.html:1345` there is `ladder = s.ladder ? normLadder(s.ladder) : null;`. Add directly below it:

```js
  tournament = s.tournament ? normTournament(s.tournament) : null;
```

- [ ] **Step 6: Syntax-check the module**

Run:
```bash
node -e "const h=require('fs').readFileSync('app.html','utf8');const m=h.match(/<script type=\"module\">([\s\S]*?)<\/script>/);require('fs').writeFileSync('/tmp/app-mod.mjs',m[1]);" && node --check /tmp/app-mod.mjs && echo "SYNTAX OK"
```
Expected: `SYNTAX OK` (the bare `import './tournament.js'` resolves syntactically; `node --check` does not execute imports).

- [ ] **Step 7: Commit**

```bash
git add app.html
git commit -m "feat: tournament state + persistence (norm/clean, save/load wiring)"
```

---

### Task 7: Team-builder UI (shared setup panel)

**Files:**
- Modify: `app.html` — Courts tab render path (find `renderCourts`), add a `renderTournamentSetup()` branch
- Modify: `app.html` — add CSS for the setup panel near the existing `.ladder-*` styles
- Modify: `app.html` — expose new inline-handler functions on `window`

**Interfaces:**
- Consumes: `presentPlayers()`, `getPlayer(id)`, `shuffle(arr)`, `teamSize()`, `showToast(msg)`, `saveState()`, `buildTeams`.
- Produces: `window.tAutoPair()`, `window.tAssignPlayer(pid)`, `window.tNewTeam()`, `window.tRemoveTeam(teamId)`, `window.tLockTeams()`. After lock: `tournament.locked === true`, `tournament.teams` populated.

- [ ] **Step 1: Add the render gate in `renderCourts`**

Run: `grep -n "function renderCourts" app.html`

At the very top of `renderCourts()`, before its existing body, add a branch that diverts round-robin/bracket modes to the tournament UI until play has started:

```js
  if ((mm()==='roundrobin' || mm()==='bracket')) {
    if (!tournament || !tournament.started) { renderTournamentSetup(); return; }
  }
```

(The existing `renderCourts` body continues to handle live `courts` slots once `tournament.started` is true, since matches use standard slots.)

- [ ] **Step 2: Add `renderTournamentSetup()` and team-builder handlers**

After `renderCourts` (or near `renderLadder`), add:

```js
function ensureTournament() {
  if (!tournament) tournament = { kind: mm(), started:false, locked:false, passes:1, teams:[], matches:[] };
  return tournament;
}
function tNewTeam() {
  const t = ensureTournament();
  if (t.locked) return;
  const n = t.teams.length + 1;
  t.teams.push({ id: 'tm' + n + '_' + n, name: 'Team ' + n, players: [] });
  saveState(); renderCourts();
}
function tRemoveTeam(teamId) {
  const t = ensureTournament();
  if (t.locked) return;
  t.teams = t.teams.filter(tm => tm.id !== teamId);
  saveState(); renderCourts();
}
function tAutoPair() {
  const t = ensureTournament();
  if (t.locked) return;
  const ids = shuffle(presentPlayers().map(p => p.id));
  const { teams } = buildTeams(ids, teamSize());
  t.teams = teams.map((players, i) => ({ id: 'tm' + (i+1) + '_' + (i+1), name: 'Team ' + (i+1), players }));
  saveState(); renderCourts();
}
function tAssignPlayer(pid) {
  // Move player into the first team with an open slot; if already on a team, remove (toggle).
  const t = ensureTournament();
  if (t.locked) return;
  const cur = t.teams.find(tm => tm.players.includes(pid));
  if (cur) { cur.players = cur.players.filter(x => x !== pid); saveState(); renderCourts(); return; }
  let target = t.teams.find(tm => tm.players.length < teamSize());
  if (!target) { tNewTeam(); target = t.teams[t.teams.length - 1]; }
  target.players.push(pid);
  saveState(); renderCourts();
}
function tLockTeams() {
  const t = ensureTournament();
  const full = t.teams.filter(tm => tm.players.length === teamSize());
  if (full.length < 2) { showToast('Need at least 2 full teams to start.'); return; }
  t.teams = full;            // drop any incomplete teams
  t.locked = true;
  saveState(); renderCourts();
  showToast('Teams locked. Choose options and start.');
}
function renderTournamentSetup() {
  const host = document.getElementById('courtsArea');   // existing Courts tab container
  const t = ensureTournament();
  const ts = teamSize();
  const present = presentPlayers();
  const assigned = new Set(t.teams.flatMap(tm => tm.players));
  const free = present.filter(p => !assigned.has(p.id));
  const teamsHtml = t.teams.map(tm => `
    <div class="t-team">
      <div class="t-team-h">${tm.name}${t.locked ? '' : ` <button class="t-x" onclick="tRemoveTeam('${tm.id}')">remove</button>`}</div>
      <div class="t-team-players">${tm.players.map(pid => `<span class="t-chip" onclick="tAssignPlayer('${pid}')">${getPlayer(pid)?.name || '?'}</span>`).join('') || '<span class="t-empty">empty</span>'}</div>
    </div>`).join('');
  const freeHtml = t.locked ? '' : `
    <div class="t-free">
      <div class="t-free-h">Tap a player to assign (team size ${ts})</div>
      <div class="t-free-list">${free.map(p => `<span class="t-chip" onclick="tAssignPlayer('${p.id}')">${p.name}</span>`).join('') || '<span class="t-empty">everyone assigned</span>'}</div>
    </div>`;
  const controls = t.locked
    ? renderTournamentStartControls(t)     // defined in Task 8
    : `<div class="t-setup-actions">
         <button class="btn" onclick="tAutoPair()">Auto-pair</button>
         <button class="btn" onclick="tNewTeam()">Add team</button>
         <button class="btn btn-primary" onclick="tLockTeams()">Lock teams</button>
       </div>`;
  host.innerHTML = `
    <div class="t-setup">
      <h3>${mm()==='bracket' ? 'Bracket' : 'Round robin'} setup</h3>
      <div class="t-teams">${teamsHtml || '<span class="t-empty">No teams yet. Auto-pair or add a team.</span>'}</div>
      ${freeHtml}
      ${controls}
    </div>`;
}
```

NOTE: confirm the Courts tab container id. Run `grep -n "courtsArea\|id=\"courts" app.html` and use the actual id in `renderTournamentSetup` (`host`). If the container has a different id, substitute it consistently.

- [ ] **Step 3: Add CSS**

Run: `grep -n "\.ladder-start\|\.ct-row{" app.html` to find the style block, and add near it:

```css
.t-setup{padding:12px}
.t-team{border:1px solid var(--line);border-radius:10px;padding:8px;margin:6px 0}
.t-team-h{font-weight:700;display:flex;justify-content:space-between;align-items:center}
.t-team-players{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.t-chip{background:var(--army);color:#fff;border-radius:14px;padding:4px 10px;cursor:pointer;font-size:14px}
.t-free{margin-top:10px}
.t-free-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.t-free .t-chip{background:var(--gold);color:#222}
.t-empty{color:var(--muted);font-size:14px}
.t-x{background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;text-decoration:underline}
.t-setup-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
```

(Use the actual CSS variable names from the file; run `grep -n "\-\-army\|\-\-gold\|\-\-line\|\-\-muted" app.html | head` to confirm. Substitute if different.)

- [ ] **Step 4: Expose handlers on `window`**

Find the block where other inline handlers are exposed (`grep -n "window.startLadder" app.html`) and add:

```js
window.tAutoPair = tAutoPair;
window.tAssignPlayer = tAssignPlayer;
window.tNewTeam = tNewTeam;
window.tRemoveTeam = tRemoveTeam;
window.tLockTeams = tLockTeams;
```

- [ ] **Step 5: Syntax-check**

Run:
```bash
node -e "const h=require('fs').readFileSync('app.html','utf8');const m=h.match(/<script type=\"module\">([\s\S]*?)<\/script>/);require('fs').writeFileSync('/tmp/app-mod.mjs',m[1]);" && node --check /tmp/app-mod.mjs && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`. (Will fail if `renderTournamentStartControls` is referenced but not yet defined only at runtime, not at parse time — `node --check` is parse-only, so this passes. The function is added in Task 8.)

- [ ] **Step 6: Commit**

```bash
git add app.html
git commit -m "feat: shared team-builder setup UI (auto-pair, manual assign, lock)"
```

---

### Task 8: Round-robin play (generate schedule, auto-fill courts, submit, standings)

**Files:**
- Modify: `app.html` — add `renderTournamentStartControls`, `startRoundRobin`, `fillCourtsFromTournament`, `tStartMatch`, `tSwapMatch`, hook submit-score back to the tournament, `renderTournamentStandings`, `resetTournament`
- Modify: `app.html` — submit-score path (find `submitScore`) to detect tournament matches
- Modify: `app.html` — Rankings tab render path to show standings when in round-robin

**Interfaces:**
- Consumes: `generateRoundRobin`, `computeStandings`, `nextEligibleMatch`, `getPlayer`, `courtDefs`, `courts`, `globalRound`, `saveState`, `showToast`, `renderCourts`, `tickCourtTimers`, `courtTimerInterval`.
- Produces: `window.startRoundRobin()`, `window.tStartMatch(courtId, matchId)`, `window.tSwapMatch(courtId)`, `window.resetTournament()`. Live matches occupy standard `courts` slots with an added `tMatchId` field linking back to `tournament.matches[].id`.

- [ ] **Step 1: Start controls (passes picker + Start)**

Add:

```js
function renderTournamentStartControls(t) {
  if (mm() === 'bracket') return '<div class="t-empty">Bracket play is added in a later phase.</div>';
  return `
    <div class="t-start">
      <label>Rounds:
        <select id="rrPasses">
          <option value="1"${t.passes===1?' selected':''}>Single (play each once)</option>
          <option value="2"${t.passes===2?' selected':''}>Double (play each twice)</option>
        </select>
      </label>
      <button class="btn btn-primary" onclick="startRoundRobin()">Start round robin</button>
    </div>`;
}
```

- [ ] **Step 2: Start the round-robin (generate schedule + first fill)**

Add:

```js
function startRoundRobin() {
  const t = ensureTournament();
  if (!t.locked) { showToast('Lock teams first.'); return; }
  if (courtDefs.length < 1) { showToast('Add at least one court first.'); return; }
  const sel = document.getElementById('rrPasses');
  t.passes = sel && sel.value === '2' ? 2 : 1;
  const sched = generateRoundRobin(t.teams.length, t.passes);
  t.matches = sched.map((m, i) => ({ id: 'rr' + i, round: m.round, teamA: m.teamA, teamB: m.teamB, score1:'', score2:'', submitted:false }));
  t.started = true;
  courts = [];
  globalRound = 1;
  fillCourtsFromTournament();
  if (!courtTimerInterval) courtTimerInterval = setInterval(tickCourtTimers, 1000);
  saveState(); renderCourts(); renderRankings();
  showToast('Round robin started.');
}
```

- [ ] **Step 3: Auto-fill open courts**

Add:

```js
function busyTeamIndices() {
  const busy = new Set();
  courts.filter(c => !c.submitted && c.tMatchId).forEach(c => {
    const m = tournament.matches.find(x => x.id === c.tMatchId);
    if (m) { busy.add(m.teamA); busy.add(m.teamB); }
  });
  return busy;
}
function placeMatchOnCourt(def, m) {
  const now = Date.now();
  courts.push({
    id: def.id, name: def.name,
    team1: tournament.teams[m.teamA].players.slice(),
    team2: tournament.teams[m.teamB].players.slice(),
    score1:'', score2:'', submitted:false, round: m.round, startedAt: now,
    tMatchId: m.id,
  });
}
function fillCourtsFromTournament() {
  const openDefs = courtDefs.filter(def => !courts.some(c => c.id === def.id && !c.submitted));
  for (const def of openDefs) {
    const m = nextEligibleMatch(tournament.matches, busyTeamIndices());
    if (!m) break;
    // remove any finished slot with this court id before reusing
    courts = courts.filter(c => c.id !== def.id);
    placeMatchOnCourt(def, m);
  }
}
```

- [ ] **Step 4: Manual override (swap which pending match is on a court)**

Add a simple cycle-to-next-eligible override:

```js
function tSwapMatch(courtId) {
  const slot = courts.find(c => c.id === courtId);
  if (slot && slot.submitted) return;
  // free this court, then pick the next eligible match that's different
  const prevId = slot ? slot.tMatchId : null;
  courts = courts.filter(c => c.id !== courtId);
  const busy = busyTeamIndices();
  const candidates = tournament.matches.filter(m => !m.submitted && !busy.has(m.teamA) && !busy.has(m.teamB) && m.id !== prevId);
  const def = courtDefs.find(d => d.id === courtId);
  if (candidates.length && def) placeMatchOnCourt(def, candidates[0]);
  else if (def) fillCourtsFromTournament();
  saveState(); renderCourts();
}
```

- [ ] **Step 5: Route score submission back to the tournament**

Run: `grep -n "function submitScore" app.html`

Inside `submitScore(courtId)`, after the existing validation reads `s1`/`s2`, add a tournament branch BEFORE the normal (non-tournament) stat accounting. Insert near the top of the function body:

```js
  const _slot = courts.find(c => c.id === courtId);
  if (_slot && _slot.tMatchId && tournament) {
    const s1 = parseInt(document.getElementById(`score1_${courtId}`)?.value);
    const s2 = parseInt(document.getElementById(`score2_${courtId}`)?.value);
    if (isNaN(s1) || isNaN(s2)) { showToast('Enter both scores first.'); return; }
    const m = tournament.matches.find(x => x.id === _slot.tMatchId);
    if (m && !m.submitted) {
      m.score1 = s1; m.score2 = s2; m.submitted = true;
      // record per-player stats + history once (mirror saveLadderResult accounting)
      const all = [..._slot.team1, ..._slot.team2];
      all.forEach(id => { const p = getPlayer(id); if (p) { p.gamesPlayed++; p.lastPlayedRound = m.round; } });
      const aWin = s1 > s2, bWin = s2 > s1;
      const aPts = s1, bPts = s2;
      _slot.team1.forEach(id => { const p = getPlayer(id); if (p) { if (aWin) p.wins++; else if (bWin) p.losses++; p.points += aPts; p.pointsAgainst += bPts; } });
      _slot.team2.forEach(id => { const p = getPlayer(id); if (p) { if (bWin) p.wins++; else if (aWin) p.losses++; p.points += bPts; p.pointsAgainst += aPts; } });
      gameHistory.unshift({ round: m.round, court: _slot.id, courtName: _slot.name || ('Court ' + _slot.id),
        team1: _slot.team1.map(id => getPlayer(id)?.name || '?'), team2: _slot.team2.map(id => getPlayer(id)?.name || '?'),
        score1: s1, score2: s2 });
    }
    _slot.score1 = s1; _slot.score2 = s2; _slot.submitted = true;
    fillCourtsFromTournament();
    saveState(); renderCourts(); renderRankings(); renderGameHistory();
    const remaining = tournament.matches.filter(x => !x.submitted).length;
    showToast(remaining ? 'Result saved.' : 'Round robin complete!');
    return;
  }
```

(Confirm `gameHistory` and `renderGameHistory` exist: `grep -n "gameHistory\b\|function renderGameHistory" app.html`.)

- [ ] **Step 6: Standings render**

Add:

```js
function renderTournamentStandings(containerId) {
  const host = document.getElementById(containerId);
  if (!host || !tournament || !tournament.started) return;
  const rows = computeStandings(tournament.teams.length, tournament.matches);
  const name = i => tournament.teams[i] ? (tournament.teams[i].players.map(pid => getPlayer(pid)?.name || '?').join(' & ')) : ('Team ' + (i+1));
  host.innerHTML = `
    <div class="t-standings">
      <h3>Standings</h3>
      <table class="t-table">
        <thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>Diff</th><th>PF</th></tr></thead>
        <tbody>
        ${rows.map((r, i) => `<tr><td>${i+1}</td><td>${name(r.team)}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.diff>0?'+':''}${r.diff}</td><td>${r.pointsFor}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
```

Add matching CSS near the Task 7 block:

```css
.t-table{width:100%;border-collapse:collapse;margin-top:8px}
.t-table th,.t-table td{padding:6px 8px;text-align:left;border-bottom:1px solid var(--line)}
.t-table th{font-size:12px;color:var(--muted);text-transform:uppercase}
```

- [ ] **Step 7: Show standings on the Rankings tab**

Run: `grep -n "function renderRankings" app.html`

At the top of `renderRankings()`, add a branch so round-robin shows team standings (use the actual Rankings container id from `grep -n "rankingsArea\|id=\"rankings" app.html`):

```js
  if (mm()==='roundrobin' && tournament && tournament.started) {
    renderTournamentStandings('rankingsArea');   // substitute real container id
    return;
  }
```

- [ ] **Step 8: Reset action**

Add (and a Reset button in `renderTournamentStartControls` once started, plus expose on window):

```js
function resetTournament() {
  if (!confirm('Reset this tournament? Teams and schedule are rebuilt; game history is kept.')) return;
  if (tournament) { tournament.started = false; tournament.locked = false; tournament.matches = []; }
  courts = [];
  saveState(); renderCourts(); renderRankings();
}
```

- [ ] **Step 9: Expose handlers**

Near the other `window.*` exposures add:

```js
window.startRoundRobin = startRoundRobin;
window.tSwapMatch = tSwapMatch;
window.resetTournament = resetTournament;
```

- [ ] **Step 10: Syntax-check**

Run:
```bash
node -e "const h=require('fs').readFileSync('app.html','utf8');const m=h.match(/<script type=\"module\">([\s\S]*?)<\/script>/);require('fs').writeFileSync('/tmp/app-mod.mjs',m[1]);" && node --check /tmp/app-mod.mjs && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`.

- [ ] **Step 11: Re-run unit tests (no regressions in pure module)**

Run: `node --test`
Expected: PASS (full suite).

- [ ] **Step 12: Commit**

```bash
git add app.html
git commit -m "feat: round-robin play - schedule, auto-fill courts, submit, standings"
```

---

### Task 9: Read-only round-robin standings mirror in `view.html`

**Files:**
- Modify: `view.html` — read tournament from the live snapshot; render standings under the leaderboard

**Interfaces:**
- Consumes: the Firebase session snapshot already streamed by `view.html` (`onValue`). The pure `computeStandings` (import it).
- Produces: a read-only standings table for spectators when the session is round-robin.

- [ ] **Step 1: Import the pure module in `view.html`**

Run: `grep -n "import .*firebasejs" view.html` to find the module imports, and after them add:

```js
import { computeStandings } from './tournament.js';
```

- [ ] **Step 2: Render standings from the snapshot**

Run: `grep -n "onValue\|function render" view.html` to find where the snapshot is applied. In that render path, after the leaderboard renders, add (adapt container id to the viewer's layout, e.g. create a `<div id="vStandings"></div>` near the leaderboard):

```js
  try {
    const s = snap || {};
    const mode = (s.mode && s.mode.matchmaking) || 'waittime';
    const t = s.tournament;
    const host = document.getElementById('vStandings');
    if (host && mode === 'roundrobin' && t && t.started) {
      const teams = Array.isArray(t.teams) ? t.teams : [];
      const matches = Array.isArray(t.matches) ? t.matches.map(m => ({
        teamA: m.teamA, teamB: m.teamB,
        score1: m.score1 < 0 ? 0 : m.score1, score2: m.score2 < 0 ? 0 : m.score2, submitted: !!m.submitted,
      })) : [];
      const rows = computeStandings(teams.length, matches);
      const nm = i => teams[i] ? (Array.isArray(teams[i].players) ? teams[i].players.length : 0) && (teams[i].name || ('Team ' + (i+1))) : ('Team ' + (i+1));
      host.innerHTML = '<h3>Standings</h3><table class="v-table"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>Diff</th></tr></thead><tbody>' +
        rows.map((r, i) => `<tr><td>${i+1}</td><td>${teams[r.team] ? (teams[r.team].name || ('Team '+(r.team+1))) : ('Team '+(r.team+1))}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.diff>0?'+':''}${r.diff}</td></tr>`).join('') +
        '</tbody></table>';
    } else if (host) { host.innerHTML = ''; }
  } catch (e) { /* viewer must never crash on optional standings */ }
```

NOTE: Firebase may deliver `tournament.teams`/`matches` as the `{_empty:true}` sentinel or as objects keyed by index. Guard with `Array.isArray` (as above); if not an array, treat as empty. The viewer shows team names (not player names) to keep it dependency-free of the players map; team names default to "Team N".

- [ ] **Step 3: Add the container + minimal CSS in `view.html`**

Add `<div id="vStandings"></div>` near the leaderboard markup, and:

```css
.v-table{width:100%;border-collapse:collapse;margin-top:8px}
.v-table th,.v-table td{padding:6px 8px;text-align:left;border-bottom:1px solid #ddd}
```

- [ ] **Step 4: Syntax-check `view.html`**

Run:
```bash
node -e "const h=require('fs').readFileSync('view.html','utf8');const m=h.match(/<script type=\"module\">([\s\S]*?)<\/script>/);require('fs').writeFileSync('/tmp/view-mod.mjs',m[1]);" && node --check /tmp/view-mod.mjs && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`.

- [ ] **Step 5: Commit**

```bash
git add view.html
git commit -m "feat: read-only round-robin standings mirror in viewer"
```

---

### Task 10: Manual smoke test + session notes

**Files:**
- Modify: `session-notes.md` (gitignored, local dev log)

**Interfaces:** none (verification + documentation).

- [ ] **Step 1: Serve locally and run the round-robin smoke test**

Run: `python3 -m http.server 8000` (from the repo root), then in a browser open `http://localhost:8000/index.html`.

Note: Firebase auth/domains are configured for `sites-9400.github.io`. If localhost auth is blocked, deploy to a throwaway branch or test on the live Pages URL instead. Record which you used.

Checklist (Doubles unless noted):
1. Dashboard: create a session with Format=Doubles, Matchmaking=Round robin (fixed teams). Confirm it opens app.html and the mode badge reads "Doubles · Round robin".
2. Players tab: add 8 players, mark present. Courts tab shows the team-builder setup.
3. Auto-pair: produces 4 teams of 2. Manually move one player between teams. Add/remove a team. Lock teams (blocks if < 2 full teams).
4. Choose Single, Start round robin: courts auto-fill with eligible matches; no team appears on two courts at once.
5. Enter a score, Submit: standings update on Rankings tab (Wins > Diff > PF); a freed court auto-fills the next eligible match; match history updates.
6. Swap match on an open court: a different eligible pending match loads.
7. Play through all matches: final toast "Round robin complete!"; standings final.
8. Open view.html via the QR/link on a phone or second tab: live courts mirror, and the read-only standings table appears.
9. Reload app.html mid-tournament: state restores from Firebase (teams, schedule, scores intact).
10. Repeat steps 2-5 quickly with Format=Singles and Double rounds: matches are 1v1, each pair plays twice.

- [ ] **Step 2: Fix any defects found**

For each failure, debug with the systematic-debugging skill, fix, re-run the relevant unit tests (`node --test`) and the failing checklist item. Commit each fix separately.

- [ ] **Step 3: Append a session entry to `session-notes.md`**

Document: what shipped (team builder + round-robin + viewer standings), the `tournament` state shape, the `tournament.js` module + how to run its tests (`node --test`), the score-not-entered `-1` persistence convention, and remaining phases (single-elim, double-elim, viewer bracket diagram).

- [ ] **Step 4: Commit**

```bash
git add session-notes.md
git commit -m "docs: session notes for Phase 1 (team builder + round robin)"
```

---

## Self-Review

**Spec coverage:**
- Two new mode values + dashboard picker → Task 5. (Round-robin selectable now; bracket option present but its play is gated to a later phase, per the phased build the user approved.)
- Format singles/doubles applies → `teamSize()` used throughout (Tasks 1, 7, 8).
- Team entry: auto-pair + manual + lock → Task 7.
- Round-robin host chooses 1x/2x → Task 8 Step 1-2.
- Court assignment auto-fill + manual override → Task 8 Steps 3-4.
- Round-robin ranking wins > diff > points-for → Task 3 + Task 8 Step 6-7.
- Persistence like ladder, update() only, mode never written → Task 6.
- view.html unchanged for live courts (free) + RR standings mirror → Task 9; bracket diagram in viewer correctly deferred.
- Edge cases: < 2 teams blocked (Task 7 `tLockTeams`); absent player → name `?` (Task 8 render, Task 9); Reset keeps history (Task 8 Step 8).
- Bracket engine (single/double elim) → intentionally NOT in this plan; separate Phase 2/3 plans, matching the approved phased order.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to" placeholders. Where a container id or CSS variable must be confirmed against the live file, an exact `grep` command and substitution instruction is given (these are lookups, not vague directions).

**Type consistency:** `tournament` shape is identical across `cleanTournament`/`normTournament` (Task 6), the builder (Task 7), play (Task 8), and the viewer (Task 9). Pure-function signatures (`buildTeams`, `generateRoundRobin`, `computeStandings`, `nextEligibleMatch`) match their imports in Tasks 6-9. Court-slot link field `tMatchId` is written in `placeMatchOnCourt` (Task 8 Step 3) and read in `busyTeamIndices`, `submitScore`, `tSwapMatch` (Task 8 Steps 3-5) consistently.
