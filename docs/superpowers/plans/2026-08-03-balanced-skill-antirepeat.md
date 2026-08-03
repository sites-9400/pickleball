# Balanced Skill + Anti-Repeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Balanced doubles the same anti-repeat fairness as Numbering — draw the four from a longest-waiting window with anti-repeat weighting, then pick the most skill-even 2v2 split — so it stops producing "I keep playing the same people" while keeping teams even by skill.

**Architecture:** Add one pure function `balancedMatch()` to `tournament.js` (mirroring `fairWeightedMatch`/`skillBalancedTeams`, reusing the existing `buildHistoryScores` and `skillRank`). Wire it through the test harness and into the `balanced` branch of `chooseMatchPlayers()` in `app.html` (the live host), reduce on-deck depth to 1 for Balanced, and reword the Numbering + Balanced descriptions in `dashboard.html`. No other mode's behavior changes.

**Out of scope — `play.html`:** `play.html` is an unmerged PR (compact Live-view preview) whose contents will be migrated into `app.html` later. Do **not** edit `play.html` in this plan — changing it now only creates conflicts for that future migration. The balanced rework carries over when `play.html` folds into `app.html`.

**Tech Stack:** Vanilla JS in `app.html` (classic `<script>` run in a Node VM for tests), pure helpers in `tournament.js` (ES module), `node:test` + `node:assert`, `tests/apphtml-harness.mjs` VM harness. Run tests with `node --test tests/*.test.js`.

## Global Constraints

- Change **only** the `balanced` (UI label "Balanced") doubles matchmaking style. `waittime`, `random`, `manual`, `ladder`, `roundrobin`, `bracket`, `challenge` behave exactly as before. Balanced-**singles** is out of scope — it already falls through to the waittime path and must stay there.
- `balancedMatch` must be **pure**: no globals, no DOM, deterministic given its `rng` argument. It lives in `tournament.js` and is exposed on `window` exactly like `skillBalancedTeams`/`fairWeightedMatch`.
- Reuse the existing `tournament.js` module internals: `buildHistoryScores(gameHistory, decay)` and `skillRank(skill)` and `_pairKey`. Do not duplicate them.
- Tuned default constants (verbatim): `W=8, K=1.5, alpha=8, beta=1, gamma=1, lambda=0, decay=0.95`. `lambda=0` means skill-gap is the sole primary objective and repeat-cost is a pure tiebreak.
- `gameHistory` is stored **most-recent-first** (`unshift`ed); each entry has `team1Ids`/`team2Ids` (numeric id arrays). History weighting uses `decay^index` (index 0 = newest = weight 1).
- Wait metric: `wait = currentRound - lastPlayedRound`, never-played = `lastPlayedRound = -1`. `currentRound` is the global `globalRound`.
- On-deck depth for `balanced` mode: `MAX_QUEUED = 1` (same as `random`).
- All algorithm/wiring changes apply to `app.html` only (the live host). `play.html` is out of scope (see Architecture). Descriptions change only in `dashboard.html`.

---

### Task 1: Pure `balancedMatch` in `tournament.js`

**Files:**
- Modify: `tournament.js` (append one export: `balancedMatch`; reuse existing `buildHistoryScores`, `skillRank`, `_pairKey`)
- Test: `tests/balanced-match.test.js` (create)

**Interfaces:**
- Consumes: `buildHistoryScores`, `skillRank`, `_pairKey` (existing module internals).
- Produces:
  - `balancedMatch(pool, gameHistory, currentRound, opts) -> { team1:number[], team2:number[] } | null`
    - `pool`: `Array<{ id:number, skill:string, lastPlayedRound:number }>` free-waiting players, **pre-sorted longest-wait-first** (as `getFreeWaiting` returns).
    - `gameHistory`: `Array<{ team1Ids:number[], team2Ids:number[] }>`, most-recent-first.
    - `currentRound`: `number`.
    - `opts`: `{ W?=8, K?=1.5, alpha?=8, beta?=1, gamma?=1, lambda?=0, decay?=0.95, rng?=Math.random }`.
    - returns `null` when `pool.length < 4` (doubles only).

- [ ] **Step 1: Write the failing tests**

Create `tests/balanced-match.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancedMatch } from '../tournament.js';

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const P = (id, skill='intermediate', lastPlayedRound=-1) => ({ id, skill, lastPlayedRound });

test('returns null when fewer than 4 free players', () => {
  assert.equal(balancedMatch([P(1),P(2),P(3)], [], 5, {}), null);
});

test('skill-even split is primary: 2 advanced + 2 beginner are split across teams', () => {
  // one fixed foursome (pool==4); the only choice is the split. The even split
  // (adv+beg vs adv+beg, gap 0) must beat stacking (adv+adv vs beg+beg, gap 4).
  const pool = [P(1,'advanced'),P(2,'advanced'),P(3,'beginner'),P(4,'beginner')];
  const m = balancedMatch(pool, [], 10, { rng: mulberry32(1) });
  const adv = new Set([1,2]);
  const t1adv = m.team1.filter(id=>adv.has(id)).length;
  const t2adv = m.team2.filter(id=>adv.has(id)).length;
  assert.equal(t1adv, 1, 'each team must hold exactly one advanced player');
  assert.equal(t2adv, 1);
});

test('repeat-cost breaks ties when skill is uniform: a repeated partnership is split', () => {
  // all intermediate -> every split ties on skill (gap 0) -> repeat cost decides.
  const hist = Array.from({length:5}, () => ({ team1Ids:[1,2], team2Ids:[3,4] }));
  const pool = [P(1),P(2),P(3),P(4)];
  const m = balancedMatch(pool, hist, 10, { rng: mulberry32(1) });
  const together = (m.team1.includes(1)&&m.team1.includes(2)) ||
                   (m.team2.includes(1)&&m.team2.includes(2));
  assert.equal(together, false, '1 & 2 partnered repeatedly -> must be split');
});

test('selection window: players outside the longest-waiting W are never drawn', () => {
  // 10 free, all same skill, pre-sorted longest-wait-first. With W=8 the two
  // shortest-waiting (ids 9,10 at the tail) must never appear.
  const pool = Array.from({length:10}, (_,i)=> P(i+1,'intermediate', i)); // id1 waited longest
  const seen = new Set();
  for (let s=0;s<300;s++){
    const m = balancedMatch(pool, [], 20, { W:8, rng: mulberry32(s+1) });
    [...m.team1,...m.team2].forEach(id=>seen.add(id));
  }
  assert.equal(seen.has(9), false, 'id 9 is outside the window');
  assert.equal(seen.has(10), false, 'id 10 is outside the window');
});

test('anti-repeat: recent opponents share a match far less than an unbiased draw', () => {
  const hist = Array.from({length:6}, () => ({ team1Ids:[1,2], team2Ids:[5,6] }));
  const pool = Array.from({length:8}, (_,i)=> P(i+1,'intermediate',5));
  let opp15 = 0;
  for (let s=0;s<400;s++){
    const m = balancedMatch(pool, hist, 6, { rng: mulberry32(s+1) });
    const t1=new Set(m.team1), t2=new Set(m.team2);
    if ((t1.has(1)&&t2.has(5))||(t2.has(1)&&t1.has(5))) opp15++;
  }
  assert.ok(opp15 < 40, `expected 1-vs-5 opponents <40/400, got ${opp15}`);
});

test('deterministic under a fixed rng', () => {
  const pool = [P(1,'advanced'),P(2,'beginner'),P(3,'intermediate'),P(4,'beginner'),P(5,'advanced')];
  const a = JSON.stringify(balancedMatch(pool, [], 5, { rng: mulberry32(42) }));
  const b = JSON.stringify(balancedMatch(pool, [], 5, { rng: mulberry32(42) }));
  assert.equal(a, b);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/balanced-match.test.js`
Expected: FAIL — `balancedMatch` not exported (import error / not a function).

- [ ] **Step 3: Implement `balancedMatch` in `tournament.js`**

Append to `tournament.js` (after `fairWeightedMatch`; it reuses the existing `_pairKey`, `buildHistoryScores`, and `skillRank` already defined in this module):

```js
// ===== Balanced mode: skill-even teams + anti-repeat (match PickleQ "Auto-balanced") =====
// Pure. pool: [{id, skill, lastPlayedRound}] pre-sorted longest-wait-first.
// gameHistory: most-recent-first [{team1Ids, team2Ids}]. Doubles only.
// 1) draw 4 from the longest-waiting window (wait-weighted + anti-repeat penalty),
// 2) pick the most skill-even 2v2 split, tie-broken by lowest repeat cost.
export function balancedMatch(pool, gameHistory, currentRound, opts = {}) {
  const { W = 8, K = 1.5, alpha = 8, beta = 1, gamma = 1, lambda = 0,
          decay = 0.95, rng = Math.random } = opts;
  const need = 4;
  if (!pool || pool.length < need) return null;

  const s = buildHistoryScores(gameHistory, decay);
  const oppS = (a, b) => s.opp[_pairKey(a, b)] || 0;
  const partS = (a, b) => s.part[_pairKey(a, b)] || 0;
  const waitOf = p => currentRound - (p.lastPlayedRound == null ? -1 : p.lastPlayedRound);
  const selW = p => Math.pow(waitOf(p) + 1, K);

  // 1) draw 4 from the longest-waiting window, penalising recent opponents/partners
  const win = pool.slice(0, Math.max(need, Math.min(W, pool.length)));
  const remaining = win.slice();
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

  // 2) most skill-even split; tie -> lowest repeat cost; tie -> random
  const sk = p => skillRank(p.skill);
  const [a, b, c, d] = chosen;
  const splits = [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]];
  const skillGap = x => Math.abs((sk(x[0][0]) + sk(x[0][1])) - (sk(x[1][0]) + sk(x[1][1])));
  const repeatCost = x =>
      partS(x[0][0].id, x[0][1].id) + partS(x[1][0].id, x[1][1].id)
    + gamma * (oppS(x[0][0].id, x[1][0].id) + oppS(x[0][0].id, x[1][1].id)
             + oppS(x[0][1].id, x[1][0].id) + oppS(x[0][1].id, x[1][1].id));
  const combined = x => skillGap(x) + lambda * repeatCost(x);
  let cand = splits.map(x => ({ x, cg: combined(x), rc: repeatCost(x) }));
  const minCg = Math.min(...cand.map(o => o.cg)); cand = cand.filter(o => o.cg === minCg);
  const minRc = Math.min(...cand.map(o => o.rc)); cand = cand.filter(o => o.rc === minRc);
  const pick = cand[Math.floor(rng() * cand.length)].x;
  return { team1: [pick[0][0].id, pick[0][1].id], team2: [pick[1][0].id, pick[1][1].id] };
}
```

> If `skillRank` is not already defined in `tournament.js`, verify with `grep -n 'skillRank' tournament.js` — `skillBalancedTeams` uses it (line ~87), so it exists. Do NOT redefine it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/balanced-match.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add tournament.js tests/balanced-match.test.js
git commit -m "feat: balancedMatch pure helper — skill-even + anti-repeat"
```

---

### Task 2: Wire `balancedMatch` into the harness and `app.html`

**Files:**
- Modify: `tests/apphtml-harness.mjs:64` (add `balancedMatch` to `windowMock`)
- Modify: `app.html:3445` (import), `app.html:3459` (window wiring), `app.html:2061-2063` (balanced branch)
- Test: `tests/balanced-match-integration.test.js` (create)

**Interfaces:**
- Consumes: `balancedMatch` from Task 1.
- Produces: `chooseMatchPlayers()` returns `window.balancedMatch(pool, gameHistory, globalRound, {})` for `style==='balanced' && teamSize()===2`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/balanced-match-integration.test.js`:

```js
// Balanced doubles chooseMatchPlayers must route through balancedMatch: with exactly
// 4 free players, all same skill, and a heavily-repeated partnership in history, it
// must split that pair (skill ties -> repeat tiebreak).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id) => ({
  id, name: 'p' + id, present: true, gamesPlayed: 2, wins: 0, losses: 0,
  points: 0, pointsAgainst: 0, lastPlayedRound: 1, skill: 'intermediate',
});

test('balanced mode chooseMatchPlayers uses anti-repeat split', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'balanced', format: 'doubles' },
    players: [1,2,3,4].map(P),
    queueOrder: [1,2,3,4],
    globalRound: 5,
    courtDefs: [{ id: 1, name: 'Court 1' }],
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

Run: `node --test tests/balanced-match-integration.test.js`
Expected: FAIL — `window.balancedMatch` undefined in the harness; `chooseMatchPlayers` still snake-pairs the fixed foursome so the pair is not guaranteed split.

- [ ] **Step 3: Add `balancedMatch` to the harness `windowMock`**

In `tests/apphtml-harness.mjs`, the line after `fairWeightedMatch: T.fairWeightedMatch,` (line 64) — add:

```js
    balancedMatch: T.balancedMatch,
```

- [ ] **Step 4: Wire import + window binding in `app.html`**

In `app.html:3445`, add `balancedMatch` to the `./tournament.js` import list (append to the existing names):

```js
import { buildTeams, generateRoundRobin, computeStandings, nextEligibleMatch, resolveChallengeCourt, skillBalancedTeams, bestSkillMatch, checkinToPlayer, fairWeightedMatch, balancedMatch } from './tournament.js';
```

Next to `window.fairWeightedMatch = fairWeightedMatch;` (`app.html:3459`), add:

```js
window.balancedMatch = balancedMatch;
```

- [ ] **Step 5: Route the balanced branch through it in `app.html`**

In `app.html:2061-2063`, replace:

```js
  if(style==='balanced' && ts===2){
    const four=pool.slice(0,need).map(p=>({id:p.id, skill:p.skill||'intermediate'}));
    return window.skillBalancedTeams(four, ts);
```

with:

```js
  if(style==='balanced' && ts===2){
    // Balanced doubles: longest-waiting window + anti-repeat draw, then most skill-even split.
    return window.balancedMatch(pool, gameHistory, globalRound, {});
```

(Leave the closing `}` of the `if` block and everything after it unchanged.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/balanced-match-integration.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite (no regressions)**

Run: `node --test tests/*.test.js`
Expected: PASS — all existing tests still green (numbering, swap, cohost, tournament, etc.).

- [ ] **Step 8: Commit**

```bash
git add tests/apphtml-harness.mjs app.html tests/balanced-match-integration.test.js
git commit -m "feat: route Balanced doubles through balancedMatch"
```

---

### Task 3: On-deck depth = 1 for Balanced mode

**Files:**
- Modify: `app.html:2140` (`MAX_QUEUED` in `rebuildMatchQueue`)
- Test: `tests/balanced-match-ondeck.test.js` (create)

**Interfaces:**
- Consumes: `rebuildMatchQueue()`, `mm()`.
- Produces: `matchQueue.length <= 1` after `rebuildMatchQueue()` in `balanced` mode; unchanged (`<= 3`) for waittime and other queue modes.

- [ ] **Step 1: Write the failing test**

Create `tests/balanced-match-ondeck.test.js`:

```js
// Balanced pre-builds at most ONE on-deck match (depth 3 re-creates repeats).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id) => ({
  id, name: 'p' + id, present: true, gamesPlayed: 0, wins: 0, losses: 0,
  points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate',
});

test('balanced mode builds at most 1 on-deck match', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'balanced', format: 'doubles' },
    players: Array.from({length:16}, (_,i)=>P(i+1)),
    queueOrder: Array.from({length:16}, (_,i)=>i+1),
    courtDefs: [{ id: 1, name: 'Court 1' }],
  }))});`);
  app.run(`rebuildMatchQueue();`);
  assert.equal(app.run(`matchQueue.length`), 1, 'Balanced keeps a single on-deck preview');
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
  assert.equal(app.run(`matchQueue.length`), 3, 'other modes unchanged');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/balanced-match-ondeck.test.js`
Expected: FAIL — first test gets `3` (current `MAX_QUEUED = (mm()==='random') ? 1 : 3`).

- [ ] **Step 3: Make `MAX_QUEUED` include balanced**

In `app.html:2140`, replace:

```js
  const MAX_QUEUED = (mm()==='random') ? 1 : 3;
```

with:

```js
  const MAX_QUEUED = (mm()==='random' || mm()==='balanced') ? 1 : 3;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/balanced-match-ondeck.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add app.html tests/balanced-match-ondeck.test.js
git commit -m "feat: on-deck depth 1 for Balanced mode"
```

---

### Task 4: Regression guardrail — replay proves the repeat drop + skill-balance kept

**Files:**
- Test: `tests/balanced-match-regression.test.js` (create)

**Interfaces:**
- Consumes: `balancedMatch` (pure) from Task 1.
- Produces: an automated guardrail asserting Balanced's repeat metrics drop far below the old snake baseline while mean skill-gap per game does **not** get worse.

- [ ] **Step 1: Write the regression test**

Create `tests/balanced-match-regression.test.js`. It drives a compact 4-court scheduler over 40 mixed-skill players and compares `balancedMatch` against the old top-4 snake control (both through the identical scheduler).

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancedMatch, skillBalancedTeams } from '../tournament.js';

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const key = (a,b)=> a<b ? a+'|'+b : b+'|'+a;
const RANK = { beginner:1, intermediate:2, advanced:3 };
const skillOf = i => { const m=i%10; return m<3?'beginner':(m<7?'intermediate':'advanced'); };

// old Balanced control: strict top-4 (pre-sorted), snake by skill
function oldMatch(pool){
  if (pool.length < 4) return null;
  return skillBalancedTeams(pool.slice(0,4).map(p=>({id:p.id, skill:p.skill})), 2);
}

function runSession(matchFn, N, NC, GT, seed){
  const rng = mulberry32(seed);
  const st = {}; for (let i=1;i<=N;i++) st[i] = { id:i, skill:skillOf(i-1), lastPlayedRound:-1 };
  const courts = Array.from({length:NC},()=>({freeAt:rng()*10, players:[]}));
  const history = []; const log = []; let counter=0, guard=0, skillGapSum=0;
  while (log.length<GT && guard++<GT*12){
    courts.sort((a,b)=>a.freeAt-b.freeAt); const c=courts[0]; const t=c.freeAt;
    const onCourt=new Set(); courts.forEach(x=>{ if(x!==c && x.freeAt>t) x.players.forEach(p=>onCourt.add(p)); });
    const pool = Object.values(st).filter(p=>!onCourt.has(p.id))
      .sort((a,b)=> a.lastPlayedRound-b.lastPlayedRound); // longest-wait first
    counter++;
    const m = matchFn(pool.map(p=>({id:p.id,skill:p.skill,lastPlayedRound:p.lastPlayedRound})), history, counter, {rng});
    if(!m){ c.freeAt=t+15; continue; }
    [...m.team1,...m.team2].forEach(id=>{ st[id].lastPlayedRound=counter; });
    const sg = Math.abs((RANK[st[m.team1[0]].skill]+RANK[st[m.team1[1]].skill])
                       -(RANK[st[m.team2[0]].skill]+RANK[st[m.team2[1]].skill]));
    skillGapSum += sg;
    c.freeAt = t + [10,15,20,25][Math.floor(rng()*4)];
    c.players = [...m.team1,...m.team2];
    history.unshift({ team1Ids:m.team1, team2Ids:m.team2 });
    log.push(m);
  }
  const opp={}; for(const g of log) for(const a of g.team1) for(const b of g.team2) opp[key(a,b)]=(opp[key(a,b)]||0)+1;
  return { oppPairs3: Object.values(opp).filter(v=>v>=3).length,
           maxOpp: Math.max(...Object.values(opp)),
           skillGap: skillGapSum/log.length };
}

test('balancedMatch slashes repeat opponents while keeping teams skill-even', () => {
  let newRep=0, oldRep=0, newMaxF=0, oldMaxF=0, newGap=0, oldGap=0;
  const seeds=[1,2,3,4,5];
  for(const s of seeds){
    const n = runSession(balancedMatch, 40, 4, 78, s);
    const o = runSession(oldMatch,      40, 4, 78, s);
    newRep+=n.oppPairs3; oldRep+=o.oppPairs3;
    newMaxF=Math.max(newMaxF,n.maxOpp); oldMaxF=Math.max(oldMaxF,o.maxOpp);
    newGap+=n.skillGap; oldGap+=o.skillGap;
  }
  const nRep=newRep/seeds.length, oRep=oldRep/seeds.length;
  const nGap=newGap/seeds.length, oGap=oldGap/seeds.length;
  assert.ok(nRep < 8, `new oppPairs3 avg should be low, got ${nRep} (old ${oRep})`);
  assert.ok(nRep < oRep / 3, `new (${nRep}) should be well below old (${oRep})`);
  assert.ok(newMaxF < oldMaxF, `new max-faced (${newMaxF}) should beat old (${oldMaxF})`);
  assert.ok(nGap <= oGap + 0.15, `new skill-gap (${nGap}) must not exceed old (${oGap}) beyond noise`);
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `node --test tests/balanced-match-regression.test.js`
Expected: PASS. (Guardrail only — depends on Task 1, which already exists; no pre-fail step.)

- [ ] **Step 3: Commit**

```bash
git add tests/balanced-match-regression.test.js
git commit -m "test: regression guardrail for Balanced anti-repeat + skill-balance"
```

---

### Task 5: Reword Numbering + Balanced descriptions in `dashboard.html`

**Files:**
- Modify: `dashboard.html:531` (`MODE_DESC.random`), `:533` (`MODE_DESC.balanced`), `:563` (`MODES.balanced.why`), `:564` (`MODES.random.why`), `:572` (`SHORT.balanced` + `SHORT.random`)

**Interfaces:** none (user-facing copy). These strings are not unit-tested; verify by reading.

- [ ] **Step 1: Reword `MODE_DESC` (the subtitle under the picker)**

`dashboard.html:531` — replace:

```js
  random: 'Numbering. Players are numbered off and rotate into random matchups.',
```

with:

```js
  random: 'Numbering — random teams, everyone mixes. Players are drawn into fresh matchups, avoiding repeat partners and opponents.',
```

`dashboard.html:533` — replace:

```js
  balanced: 'Teams are balanced by skill level for even games.',
```

with:

```js
  balanced: 'Balanced — even teams by skill level, with fresh matchups. Skill-matched teams while avoiding repeat partners and opponents.',
```

- [ ] **Step 2: Reword the pre-game assistant `MODES.why`**

`dashboard.html:563` — replace:

```js
    balanced:{name:'Balanced',why:'Takes the longest-waiting four, then pairs the strongest with the weakest against the middle two — games stay close. Best with a mix of skill levels.'},
```

with:

```js
    balanced:{name:'Balanced',why:'Builds even teams by skill level from the longest-waiting players, while avoiding repeat partners and opponents — so games stay close and you still meet new people. Best with a mix of skill levels.'},
```

`dashboard.html:564` — replace:

```js
    random:{name:'Numbering',why:'Players are numbered off and drawn into fresh matchups, avoiding repeat partners and opponents. Great for a social night where people mix.'},
```

with:

```js
    random:{name:'Numbering',why:'Players are numbered off into random teams and drawn into fresh matchups, avoiding repeat partners and opponents. Great for a social night where people mix.'},
```

- [ ] **Step 3: Reword the assistant `SHORT` one-liners (the matched pair)**

`dashboard.html:572` — replace:

```js
  const SHORT={waittime:'Fairest equal-time rotation',balanced:'Even teams by skill',random:'Fresh, social matchups',
```

with:

```js
  const SHORT={waittime:'Fairest equal-time rotation',balanced:'Even teams by skill level · fresh matchups',random:'Random teams · everyone mixes · fresh matchups',
```

- [ ] **Step 4: Sanity-check nothing else references the old wording**

Run: `grep -n "rotate into random matchups\|strongest with the weakest\|balanced by skill level for even" dashboard.html`
Expected: no matches (all replaced).

- [ ] **Step 5: Commit**

```bash
git add dashboard.html
git commit -m "copy: reword Numbering + Balanced descriptions as a matched pair"
```

---

### Task 6: Record the decision in `session-notes.md`

**Files:**
- Modify: `session-notes.md` (append a dated entry at the top of the running log)

**Interfaces:** none (documentation).

- [ ] **Step 1: Append a session-notes entry**

Add to the top of the running log in `session-notes.md` (match the file's bullet style):

```markdown
### Balanced mode reworked: skill-even teams + anti-repeat (2026-08-03)
- Browser harness (/test-this-mode, 40p/4court/5hr, staggered arrivals + mixed skills)
  showed old Balanced (strict top-4 longest-waiting, snake by skill, NO anti-repeat)
  gave 42-46 opponent-pairs met 3+ times, worst pair faced 9x. Wait/games fairness
  was already good; opponent variety was the pain.
- `chooseMatchPlayers` `balanced && ts===2` branch now calls pure `balancedMatch`
  (tournament.js): draw 4 from the longest-waiting window (W=8) with wait-weight
  (K=1.5) + anti-repeat penalty (alpha=8, beta=1, decay=0.95), then pick the most
  skill-even 2v2 split, tie-broken by repeat cost (gamma=1); lambda=0 keeps skill
  primary. app.html only (play.html PR out of scope — folds in with its later migration).
- On-deck depth cut to 1 for Balanced (MAX_QUEUED includes 'balanced'), same as
  Numbering. A/B (identical schedule, 2-3 seeds, 4 skill mixes): opp-pairs-3+ ~44 -> ~2,
  worst-faced 9 -> 3, distinct opponents ~tripled, mean skill-gap/game held or improved
  (0.75 -> ~0.69), games/hr spread unchanged; worst single wait 30 -> ~40 min (tunable).
  Scarce-tier rooms (1-3 advanced) degrade gracefully: no stalls, no benched players,
  strong players never stacked. Design + validation: docs/superpowers/specs/
  2026-08-03-balanced-skill-antirepeat-design.md. Matches PickleQ "Auto-balanced".
- Descriptions reworded (dashboard.html) as a matched pair: Numbering = "Random teams
  · everyone mixes · fresh matchups"; Balanced = "Even teams by skill level · fresh
  matchups".
```

- [ ] **Step 2: Commit**

```bash
git add session-notes.md
git commit -m "docs: record Balanced skill+anti-repeat rework"
```

---

## Deploy (after all tasks pass) — like Numbering

1. Run the whole suite once more: `node --test tests/*.test.js` — all green.
2. Browser re-verify with the real board: serve locally, boot `app.html` in balanced mode, run the `test-this-mode` harness, confirm the audit (opp-pairs-3+ near Numbering levels, skill-gap held, games/hr tight) and screenshot the live board.
3. Merge `feat/balanced-skill-antirepeat` to `main` (PR, like Numbering's PR #1) and let GitHub Pages deploy. Confirm the Pages build succeeds and the live `app.html`/`dashboard.html` reflect the new behavior + copy.
4. Watch the first live Balanced session; the constants (`W, K, α, β, γ, λ, decay`) are v1 tuned to simulation — re-tune if the live night disagrees (bimodal rooms are the first place to consider a non-zero `λ`).

---

## Self-review notes

- **Spec coverage:** algorithm windowed-draw + skill-even split + tiebreak (Task 1), wiring in app.html (Task 2; play.html out of scope), on-deck depth 1 (Task 3), regression guardrail incl. skill-gap-not-worse (Task 4), reworded matched-pair descriptions incl. Numbering (Task 5), decision record (Task 6), deploy + live re-verify (Deploy section). Balanced-singles explicitly out of scope (Global Constraints). `λ` escape hatch present via `lambda` opt (Task 1). Scarcity/edge behavior validated in spec; no code path needed.
- **Placeholders:** none — every step has concrete code/commands and exact line anchors.
- **Type consistency:** `balancedMatch(pool, gameHistory, currentRound, opts)` returning `{team1,team2}` id arrays is used identically in Tasks 1, 2, 4; pool item shape `{id, skill, lastPlayedRound}` matches `getFreeWaiting` output and the harness `P()` factories; reuses existing `buildHistoryScores`/`skillRank`/`_pairKey` without redefining.
