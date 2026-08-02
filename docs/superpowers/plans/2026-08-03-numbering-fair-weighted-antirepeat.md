# Numbering Fair-Weighted + Anti-Repeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Numbering mode's memoryless random matchmaking with a fair-weighted draw that favours longest-waiters and actively avoids recent opponents/partners, and stop the on-deck queue from undoing it.

**Architecture:** Add one pure function `fairWeightedMatch()` to `tournament.js` (mirroring the existing `skillBalancedTeams`), wire it through the test harness and into `app.html`'s `chooseMatchPlayers()` for the `random` style, and reduce the on-deck queue depth to 1 for that mode. No behaviour changes to any other mode.

**Tech Stack:** Vanilla JS in `app.html` (classic `<script>` run in a Node VM for tests), pure helpers in `tournament.js` (ES module), `node:test` + `node:assert` test runner, `tests/apphtml-harness.mjs` VM harness.

## Global Constraints

- Change **only** the `random` (UI label "Numbering") matchmaking style. `waittime`, `balanced`, `manual`, `ladder`, `roundrobin`, `bracket`, `challenge` behave exactly as before.
- `fairWeightedMatch` must be **pure**: no globals, no DOM, deterministic given its `rng` argument. It lives in `tournament.js` and is exposed on `window` exactly like `skillBalancedTeams`.
- Tuned default constants (verbatim): `K=1.5, alpha=8, beta=1, gamma=1, decay=0.95`.
- `gameHistory` is stored **most-recent-first** (entries are `unshift`ed) and each entry has `team1Ids` and `team2Ids` (arrays of numeric player ids). History weighting uses `decay^index`, so index 0 (newest) has weight 1.
- Wait metric: `wait = currentRound - lastPlayedRound`, where a never-played player has `lastPlayedRound = -1`. `currentRound` is the global `globalRound`.
- On-deck depth for `random` mode: `MAX_QUEUED = 1`. No starvation guard.
- Run tests with: `node --test tests/`.

---

### Task 1: Pure `fairWeightedMatch` + history scoring in `tournament.js`

**Files:**
- Modify: `tournament.js` (append two exports: `fairWeightedMatch`, and a non-exported helper `buildHistoryScores` — keep `buildHistoryScores` module-private but exported for testing as shown)
- Test: `tests/fair-match.test.js` (create)

**Interfaces:**
- Consumes: nothing (leaf function).
- Produces:
  - `fairWeightedMatch(pool, gameHistory, currentRound, opts) -> { team1: number[], team2: number[] } | null`
    - `pool`: `Array<{ id:number, lastPlayedRound:number }>` (the free-waiting players)
    - `gameHistory`: `Array<{ team1Ids:number[], team2Ids:number[] }>`, most-recent-first
    - `currentRound`: `number`
    - `opts`: `{ K?=1.5, alpha?=8, beta?=1, gamma?=1, decay?=0.95, teamSize?=2, rng?=Math.random }`
    - returns `null` when `pool.length < teamSize*2`
  - `buildHistoryScores(gameHistory, decay) -> { opp: Record<string,number>, part: Record<string,number> }` (exported for tests)

- [ ] **Step 1: Write the failing tests**

Create `tests/fair-match.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fairWeightedMatch, buildHistoryScores } from '../tournament.js';

// deterministic RNG so stochastic behaviour is testable
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const P = (id, lastPlayedRound = -1) => ({ id, lastPlayedRound });

test('returns null when pool smaller than a full match', () => {
  assert.equal(fairWeightedMatch([P(1),P(2),P(3)], [], 5, { teamSize: 2 }), null);
  assert.equal(fairWeightedMatch([P(1)], [], 5, { teamSize: 1 }), null);
});

test('buildHistoryScores weights recent games more (decay^index, newest first)', () => {
  const hist = [
    { team1Ids:[1,2], team2Ids:[3,4] }, // newest, weight 1
    { team1Ids:[1,2], team2Ids:[5,6] }, // older,  weight decay
  ];
  const s = buildHistoryScores(hist, 0.5);
  assert.equal(s.part['1|2'], 1 + 0.5);      // partnered in both
  assert.equal(s.opp['1|3'], 1);             // opponents only in newest
  assert.equal(s.opp['1|5'], 0.5);           // opponents only in older
});

test('team split avoids a heavily-repeated partnership (pool == 4, deterministic)', () => {
  // 1&2 have partnered a lot; with only 4 free, the foursome is fixed and only
  // the split varies -> it must NOT pair 1 with 2.
  const hist = Array.from({length:5}, () => ({ team1Ids:[1,2], team2Ids:[7,8] }));
  const pool = [P(1),P(2),P(3),P(4)];
  const m = fairWeightedMatch(pool, hist, 10, { teamSize: 2, rng: mulberry32(1) });
  const together = (m.team1.includes(1) && m.team1.includes(2)) ||
                   (m.team2.includes(1) && m.team2.includes(2));
  assert.equal(together, false, '1 and 2 must be split onto opposite teams');
});

test('fairness: a long-waiter is picked far more often than a just-played player', () => {
  const pool = [P(1,0), P(2,9), P(3,9), P(4,9), P(5,9), P(6,9)]; // p1 waited since round 0
  let p1count = 0;
  for (let s = 0; s < 300; s++) {
    const m = fairWeightedMatch(pool, [], 10, { teamSize: 2, rng: mulberry32(s+1) });
    if ([...m.team1, ...m.team2].includes(1)) p1count++;
  }
  // random baseline would be 4/6 ~= 200; wait-weighting must exceed that clearly
  assert.ok(p1count > 245, `expected p1 picked >245/300, got ${p1count}`);
});

test('anti-repeat: recent opponents are grouped into the same match less often', () => {
  // 1 vs 5 were opponents in many recent games. Over many draws from a wider pool,
  // they should share a match (as opponents) far less than an unbiased baseline.
  const hist = Array.from({length:6}, () => ({ team1Ids:[1,2], team2Ids:[5,6] }));
  const pool = [P(1,5),P(2,5),P(3,5),P(4,5),P(5,5),P(6,5),P(7,5),P(8,5)];
  let opp15 = 0;
  for (let s = 0; s < 400; s++) {
    const m = fairWeightedMatch(pool, hist, 6, { teamSize: 2, rng: mulberry32(s+1) });
    const t1 = new Set(m.team1), t2 = new Set(m.team2);
    if ((t1.has(1)&&t2.has(5)) || (t2.has(1)&&t1.has(5))) opp15++;
  }
  // unbiased chance of 1 and 5 both drawn AND on opposite teams is ~14%
  // (~56/400); anti-repeat must push it well below that.
  assert.ok(opp15 < 30, `expected 1-vs-5 opponents <30/400, got ${opp15}`);
});

test('singles returns a 1v1', () => {
  const m = fairWeightedMatch([P(1),P(2),P(3),P(4)], [], 5, { teamSize: 1, rng: mulberry32(1) });
  assert.equal(m.team1.length, 1);
  assert.equal(m.team2.length, 1);
  assert.notEqual(m.team1[0], m.team2[0]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/fair-match.test.js`
Expected: FAIL — `fairWeightedMatch`/`buildHistoryScores` are not exported yet (import error / not a function).

- [ ] **Step 3: Implement the function in `tournament.js`**

Append to `tournament.js`:

```js
// ===== Numbering mode: fair-weighted draw + anti-repeat =====
// Pure. pool: [{id, lastPlayedRound}]. gameHistory: most-recent-first
// [{team1Ids, team2Ids}]. Returns {team1:[ids], team2:[ids]} or null.
const _pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

export function buildHistoryScores(gameHistory, decay) {
  const opp = {}, part = {};
  const h = gameHistory || [];
  for (let i = 0; i < h.length; i++) {           // index 0 = newest = weight 1
    const g = h[i] || {};
    const t1 = g.team1Ids || [], t2 = g.team2Ids || [];
    const w = Math.pow(decay, i);
    if (t1.length === 2) part[_pairKey(t1[0], t1[1])] = (part[_pairKey(t1[0], t1[1])] || 0) + w;
    if (t2.length === 2) part[_pairKey(t2[0], t2[1])] = (part[_pairKey(t2[0], t2[1])] || 0) + w;
    for (const x of t1) for (const y of t2) opp[_pairKey(x, y)] = (opp[_pairKey(x, y)] || 0) + w;
  }
  return { opp, part };
}

export function fairWeightedMatch(pool, gameHistory, currentRound, opts = {}) {
  const { K = 1.5, alpha = 8, beta = 1, gamma = 1, decay = 0.95,
          teamSize = 2, rng = Math.random } = opts;
  const need = teamSize * 2;
  if (!pool || pool.length < need) return null;

  const s = buildHistoryScores(gameHistory, decay);
  const oppS = (a, b) => s.opp[_pairKey(a, b)] || 0;
  const partS = (a, b) => s.part[_pairKey(a, b)] || 0;
  const waitOf = p => currentRound - (p.lastPlayedRound == null ? -1 : p.lastPlayedRound);
  const selW = p => Math.pow(waitOf(p) + 1, K);

  // 1) weighted pick without replacement, penalising recent opponents/partners
  const remaining = pool.slice();
  const chosen = [];
  while (chosen.length < need) {
    const weights = remaining.map(c => {
      let pen = 1;
      if (chosen.length) {
        let so = 0, sp = 0;
        for (const q of chosen) { so += oppS(c.id, q.id); sp += partS(c.id, q.id); }
        pen = 1 / (1 + alpha * so + beta * sp);
      }
      return selW(c) * pen;
    });
    let total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total, idx = 0;
    for (; idx < weights.length; idx++) { r -= weights[idx]; if (r <= 0) break; }
    if (idx >= remaining.length) idx = remaining.length - 1;
    chosen.push(remaining[idx]);
    remaining.splice(idx, 1);
  }

  if (teamSize === 1) return { team1: [chosen[0].id], team2: [chosen[1].id] };

  // 2) doubles: choose the freshest 2v2 split, ties broken randomly
  const [a, b, c, d] = chosen;
  const splits = [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]];
  const cost = x =>
      partS(x[0][0].id, x[0][1].id) + partS(x[1][0].id, x[1][1].id)
    + gamma * (oppS(x[0][0].id, x[1][0].id) + oppS(x[0][0].id, x[1][1].id)
             + oppS(x[0][1].id, x[1][0].id) + oppS(x[0][1].id, x[1][1].id));
  const costs = splits.map(cost);
  const min = Math.min(...costs);
  const best = splits.filter((_, i) => costs[i] === min);
  const pick = best[Math.floor(rng() * best.length)];
  return { team1: [pick[0][0].id, pick[0][1].id], team2: [pick[1][0].id, pick[1][1].id] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/fair-match.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add tournament.js tests/fair-match.test.js
git commit -m "feat: fairWeightedMatch pure helper for Numbering mode"
```

---

### Task 2: Wire `fairWeightedMatch` into the harness and `chooseMatchPlayers`

**Files:**
- Modify: `tests/apphtml-harness.mjs` (add `fairWeightedMatch` to `windowMock`)
- Modify: `app.html:3441` (import), `app.html:3453` (window wiring), `app.html:2066-2068` (`chooseMatchPlayers` `random` branch)
- Test: `tests/fair-match-integration.test.js` (create)

**Interfaces:**
- Consumes: `fairWeightedMatch` from Task 1.
- Produces: `chooseMatchPlayers()` returns `fairWeightedMatch(pool, gameHistory, globalRound, { teamSize: ts })` for `style==='random'`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/fair-match-integration.test.js`:

```js
// Numbering mode's chooseMatchPlayers must route through fairWeightedMatch:
// with exactly 4 free players and a heavily-repeated partnership in history,
// it must split that pair onto opposite teams (deterministic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id) => ({
  id, name: 'p' + id, present: true, gamesPlayed: 2, wins: 0, losses: 0,
  points: 0, pointsAgainst: 0, lastPlayedRound: 1, skill: 'intermediate',
});

test('random mode chooseMatchPlayers uses anti-repeat split', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'random', format: 'doubles' },
    players: [1,2,3,4].map(P),
    queueOrder: [1,2,3,4],
    globalRound: 5,
    courtDefs: [{ id: 1, name: 'Court 1' }],
    // history: players 1 & 2 partnered repeatedly -> must be split
    gameHistory: Array.from({length:4}, (_,i)=>({
      round: i+1, court: 1, courtName: 'Court 1',
      team1: ['p1','p2'], team2: ['p3','p4'],
      team1Ids: [1,2], team2Ids: [3,4], score1: 11, score2: 5,
    })),
  }))});`);
  const m = app.run(`JSON.stringify(chooseMatchPlayers())`);
  const { team1, team2 } = JSON.parse(m);
  const together = (team1.includes(1) && team1.includes(2)) ||
                   (team2.includes(1) && team2.includes(2));
  assert.equal(together, false, '1 & 2 must not be paired again');
  assert.equal([...team1, ...team2].sort().join(','), '1,2,3,4');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/fair-match-integration.test.js`
Expected: FAIL — `window.fairWeightedMatch` is undefined in the harness / `chooseMatchPlayers` still uses `shuffle`, so the split is not guaranteed.

- [ ] **Step 3: Add `fairWeightedMatch` to the harness `windowMock`**

In `tests/apphtml-harness.mjs`, find the `skillBalancedTeams: T.skillBalancedTeams, bestSkillMatch: T.bestSkillMatch,` line inside `windowMock` and add on the next line:

```js
    fairWeightedMatch: T.fairWeightedMatch,
```

- [ ] **Step 4: Wire the import and window binding in `app.html`**

At `app.html:3441`, add `fairWeightedMatch` to the import list:

```js
import { buildTeams, generateRoundRobin, computeStandings, nextEligibleMatch, resolveChallengeCourt, skillBalancedTeams, bestSkillMatch, checkinToPlayer, fairWeightedMatch } from './tournament.js';
```

At `app.html:3453` (next to `window.skillBalancedTeams = skillBalancedTeams;`), add:

```js
window.fairWeightedMatch = fairWeightedMatch;
```

- [ ] **Step 5: Route the `random` branch of `chooseMatchPlayers` through it**

In `app.html`, replace the random-pick lines (currently `app.html:2065-2068`):

```js
  // Random: random selection AND pairing. Waittime/balanced-singles: longest-waiting, random pairing.
  const chosen = style==='random' ? shuffle(pool.slice()).slice(0,need) : pool.slice(0,need);
  const g=shuffle(chosen.slice());
  return {team1:g.slice(0,ts).map(p=>p.id), team2:g.slice(ts,ts*2).map(p=>p.id)};
```

with:

```js
  // Numbering (random): fair-weighted draw + anti-repeat opponents (see fairWeightedMatch).
  if(style==='random'){
    return window.fairWeightedMatch(pool, gameHistory, globalRound, {teamSize:ts});
  }
  // Waittime / balanced-singles: longest-waiting N, random pairing.
  const chosen = pool.slice(0,need);
  const g=shuffle(chosen.slice());
  return {team1:g.slice(0,ts).map(p=>p.id), team2:g.slice(ts,ts*2).map(p=>p.id)};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/fair-match-integration.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite (no regressions)**

Run: `node --test tests/`
Expected: PASS (all existing tests, including `swap-queue`/`swap-rearrange`, still green).

- [ ] **Step 8: Commit**

```bash
git add tests/apphtml-harness.mjs app.html tests/fair-match-integration.test.js
git commit -m "feat: route Numbering mode through fairWeightedMatch"
```

---

### Task 3: On-deck depth = 1 for Numbering mode

**Files:**
- Modify: `app.html:2136` (`MAX_QUEUED` in `rebuildMatchQueue`)
- Test: `tests/fair-match-ondeck.test.js` (create)

**Interfaces:**
- Consumes: `rebuildMatchQueue()`, `mm()`.
- Produces: `matchQueue.length <= 1` after `rebuildMatchQueue()` in `random` mode; unchanged (`<= 3`) otherwise.

- [ ] **Step 1: Write the failing test**

Create `tests/fair-match-ondeck.test.js`:

```js
// Numbering pre-builds at most ONE on-deck match (depth 3 re-creates repeats).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id) => ({
  id, name: 'p' + id, present: true, gamesPlayed: 0, wins: 0, losses: 0,
  points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate',
});

test('random mode builds at most 1 on-deck match', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'random', format: 'doubles' },
    players: Array.from({length:16}, (_,i)=>P(i+1)),   // 16 free -> could fill 3
    queueOrder: Array.from({length:16}, (_,i)=>i+1),
    courtDefs: [{ id: 1, name: 'Court 1' }],
  }))});`);
  app.run(`rebuildMatchQueue();`);
  const n = app.run(`matchQueue.length`);
  assert.equal(n, 1, 'Numbering keeps a single on-deck preview');
});

test('waittime mode still builds up to 3', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'waittime', format: 'doubles' },
    players: Array.from({length:16}, (_,i)=>P(i+1)),
    queueOrder: Array.from({length:16}, (_,i)=>i+1),
    courtDefs: [{ id: 1, name: 'Court 1' }],
  }))});`);
  app.run(`rebuildMatchQueue();`);
  const n = app.run(`matchQueue.length`);
  assert.equal(n, 3, 'other modes unchanged');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/fair-match-ondeck.test.js`
Expected: FAIL — first test gets `3` (current `MAX_QUEUED=3`).

- [ ] **Step 3: Make `MAX_QUEUED` mode-aware**

In `app.html:2136`, replace:

```js
  const MAX_QUEUED=3;
```

with:

```js
  const MAX_QUEUED = (mm()==='random') ? 1 : 3;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/fair-match-ondeck.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add app.html tests/fair-match-ondeck.test.js
git commit -m "feat: on-deck depth 1 for Numbering mode"
```

---

### Task 4: Regression guardrail — replay proves the repeat drop

**Files:**
- Test: `tests/fair-match-regression.test.js` (create)

**Interfaces:**
- Consumes: `fairWeightedMatch` (pure) from Task 1.
- Produces: an automated guardrail asserting Numbering's repeat metrics stay far below the pure-random baseline documented in the spec.

- [ ] **Step 1: Write the regression test**

Create `tests/fair-match-regression.test.js`. It drives a compact 4-court scheduler over 30 players for ~240 games and compares `fairWeightedMatch` against a pure-random control (both through the identical scheduler), asserting a large drop in repeat-opponent pairs.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fairWeightedMatch } from '../tournament.js';

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const key = (a,b)=> a<b ? a+'|'+b : b+'|'+a;

// pure-random control matching the OLD behaviour (shuffle pool, take 4, random split)
function randomMatch(pool, _h, _cr, opts){
  const rng = opts.rng; const a = pool.slice();
  for (let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  const f=a.slice(0,4); return { team1:[f[0].id,f[1].id], team2:[f[2].id,f[3].id] };
}

// 4 courts, N present the whole time, GT games; history built as games are logged
function runSession(matchFn, N, NC, GT, seed){
  const rng = mulberry32(seed);
  const st = {}; for (let i=1;i<=N;i++) st[i] = { id:i, lastPlayedRound:null };
  const courts = Array.from({length:NC},()=>({freeAt:rng()*10, players:[]}));
  const history = []; const log = []; let counter=0, guard=0;
  while (log.length<GT && guard++<GT*12){
    courts.sort((a,b)=>a.freeAt-b.freeAt); const c=courts[0]; const t=c.freeAt;
    const onCourt=new Set(); courts.forEach(x=>{ if(x!==c && x.freeAt>t) x.players.forEach(p=>onCourt.add(p)); });
    const pool = Object.values(st).filter(p=>!onCourt.has(p.id));
    counter++;
    const m = matchFn(pool.map(p=>({id:p.id,lastPlayedRound:p.lastPlayedRound})), history, counter, {teamSize:2, rng});
    if(!m){ c.freeAt=t+15; continue; }
    [...m.team1,...m.team2].forEach(id=>{ st[id].lastPlayedRound=counter; });
    c.freeAt = t + [10,15,20,25][Math.floor(rng()*4)];
    c.players = [...m.team1,...m.team2];
    history.unshift({ team1Ids:m.team1, team2Ids:m.team2 });  // newest-first
    log.push(m);
  }
  const opp={}; for(const g of log) for(const a of g.team1) for(const b of g.team2) opp[key(a,b)]=(opp[key(a,b)]||0)+1;
  return { oppPairs3: Object.values(opp).filter(v=>v>=3).length,
           maxOpp: Math.max(...Object.values(opp)) };
}

test('fairWeightedMatch massively reduces repeat opponents vs random', () => {
  // 30 players / 4 courts / ~72 games (~10 each). Keep games low enough that avg
  // opponent-meetings/pair stays ~<1 — past that no algorithm can keep oppPairs3 low
  // (capacity limit, not an algorithm signal). Measured: fair ~0.2, random ~11.
  let fairSum=0, randSum=0, fairMax=0, randMax=0;
  const seeds=[1,2,3,4,5];
  for(const s of seeds){
    const f = runSession(fairWeightedMatch, 30, 4, 72, s);
    const r = runSession(randomMatch,       30, 4, 72, s);
    fairSum+=f.oppPairs3; randSum+=r.oppPairs3; fairMax=Math.max(fairMax,f.maxOpp); randMax=Math.max(randMax,r.maxOpp);
  }
  const fairAvg=fairSum/seeds.length, randAvg=randSum/seeds.length;
  assert.ok(fairAvg < 3, `fair oppPairs3 avg should be <3, got ${fairAvg}`);
  assert.ok(fairAvg < randAvg / 3, `fair (${fairAvg}) should be well below random (${randAvg})`);
  assert.ok(fairMax <= randMax, `fair max-faced (${fairMax}) should not exceed random (${randMax})`);
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `node --test tests/fair-match-regression.test.js`
Expected: PASS. (This test has no pre-implementation "fail" step because it depends only on Task 1, which already exists; it is a guardrail, not a TDD driver.)

- [ ] **Step 3: Commit**

```bash
git add tests/fair-match-regression.test.js
git commit -m "test: regression guardrail for Numbering anti-repeat"
```

---

### Task 5: Record the decision + organizer guidance

**Files:**
- Modify: `session-notes.md` (append a dated entry)

**Interfaces:** none (documentation).

- [ ] **Step 1: Append a session-notes entry**

Add to the top of the running log in `session-notes.md` (match the file's existing bullet style):

```markdown
### Numbering mode reworked: fair-weighted draw + anti-repeat opponents (2026-08-03)
- Reverses the earlier "Numbering stays fully random by user decision" call, after
  players complained of repeat opponents at the 4pm-9pm open play
  (session -Oz0WBqbjehYBIihAW-A, 76 games / 33 players). Analysis showed repeats
  matched pure-random baseline (memoryless), with opponents the real pain
  (Tweetums faced Ja9 4x); partners were already fine.
- `chooseMatchPlayers` `random` branch now calls pure `fairWeightedMatch`
  (tournament.js): wait-weighted selection (K=1.5) + recency-decayed anti-repeat
  penalty (alpha=8 opponents, beta=1 partners, gamma=1 split, decay=0.95),
  whole-session memory. Constants centralised at the top of the function.
- On-deck depth cut to 1 for Numbering (`MAX_QUEUED = mm()==='random' ? 1 : 3`):
  simulation showed depth 3 re-created ~60% of the repeats. Starvation guard
  rejected (throughput-bound). Design + simulation: docs/superpowers/specs/
  2026-08-03-numbering-fair-weighted-antirepeat-design.md.
- ORGANIZER GUIDANCE (for how-to docs): keep a bench of ~10-12 (about one court
  per 5-6 players). 30p->5 courts, 35p->6, 40p->6-7. Too many courts spikes
  repeats; too few means long waits. For ~33-player nights, run 5 courts (today's
  4 left too big a bench and more sitting than necessary). The how-to PDF is built
  from gitignored local sources; add this there in a separate manual pass.
```

- [ ] **Step 2: Commit**

```bash
git add session-notes.md
git commit -m "docs: record Numbering rework + organizer court guidance"
```

---

## Simulation appendix — today (4pm-9pm) under the new plan

A realistic replay of the real session (33 players, real attendance windows, 4
courts, on-deck depth 1, variable 10/15/20/25-min games, staggered court starts,
**hard 5-hour cap 4:00pm–9:00pm** since the court is paid by the hour, one seed) is
saved at `docs/superpowers/specs/2026-08-03-today-under-new-plan.txt`. Headline vs
today's actual:

| Metric | Today actual | Replay under new plan |
|---|---|---|
| Games played (5 hr, 4 courts) | 76 | 62 |
| Opponent pairs met 3+ times | 12 | **1** |
| Max faced same opponent | 4 | **3** |
| Repeat-partner games (avg) | 1.15 | **0.24** |
| Players with 0 repeat partners | 10/33 | **25/33** |

Notes: (1) the replay yields 62 games vs the real 76 because the 10/15/20/25 model
averages 17.5 min/game while the real night averaged ~15.8 — a throughput artifact,
not the algorithm. (2) These are one seed; the 40-seed averages are ~1–2 opponent
pairs met 3+ and max faced ~2.4. Timing does not affect the anti-repeat result (the
algorithm keys off game count/history, not the clock).

## Self-review notes

- **Spec coverage:** algorithm (Tasks 1-2), team split (Task 1), on-deck depth
  correction (Task 3), pure/testable interface (Task 1), edge cases — pool<need,
  exactly 4, empty history, singles (Task 1 tests), regression vs baseline (Task 4),
  session-notes + organizer guidance (Task 5), rejected starvation guard (recorded
  in Task 5). No user-facing tuning UI — out of scope per spec.
- **Placeholders:** none — every step has concrete code/commands.
- **Type consistency:** `fairWeightedMatch(pool, gameHistory, currentRound, opts)`
  and its `{team1,team2}` id-array return are used identically in Tasks 1, 2, 4;
  `buildHistoryScores(gameHistory, decay)` return shape matches its tests.
