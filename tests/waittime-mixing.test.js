// By wait time: strict longest-wait order sent every group that finished together straight
// back out together, so at 4 courts x 40 players each player met only 3 opponents all
// night. waitMix() swaps up to a team's worth of the longest waiters for the next-longest
// when the top group has already shared a court (never passing over someone who waited 2+
// rounds longer or has fewer games), and freshestSplit() picks the teams with the fewest
// repeat partners. It also reserves a single Up Next match, like Numbering/Balanced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp, snap } from './apphtml-harness.mjs';

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function withSeed(seed, fn) {
  const real = Math.random;
  Math.random = lcg(seed);
  try { return fn(); } finally { Math.random = real; }
}
function appWith({ n, courts = 1, format = 'doubles' }) {
  const app = loadApp();
  const players = [...Array(n)].map((_, i) => ({
    id: i + 1, name: 'P' + (i + 1), present: true, gamesPlayed: 0, wins: 0, losses: 0,
    points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate', events: [], partnerId: null,
  }));
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'waittime', format }, players,
    courtDefs: [...Array(courts)].map((_, i) => ({ id: i + 1, name: 'Court ' + (i + 1) })),
    queueOrder: players.map(p => p.id), playerIdCounter: n, courtIdCounter: courts,
  }))});`);
  return app;
}
const finish = (app, id) => app.run(
  `document.getElementById('score1_${id}').value='11'; document.getElementById('score2_${id}').value='6'; submitScore(${id});`);
const history = app => JSON.parse(app.run(`JSON.stringify(gameHistory.map(g=>[g.team1Ids,g.team2Ids]))`));
const gp = app => JSON.parse(app.run(`JSON.stringify(players.map(p=>p.gamesPlayed))`));

// Courts finish in a rolling order (court 1 first, then 2, ...), like a real night.
function night({ n, courts, games, seed = 1 }) {
  return withSeed(seed, () => {
    const app = appWith({ n, courts });
    for (let c = 1; c <= courts; c++) app.run(`generateMatchForCourt(${c})`);
    for (let g = 0; g < games; g++) { const c = (g % courts) + 1; finish(app, c); app.run(`generateMatchForCourt(${c})`); }
    return app;
  });
}
const distinctOpponents = hist => {
  const o = {};
  for (const [t1, t2] of hist) for (const a of t1) for (const b of t2) { (o[a] ||= new Set()).add(b); (o[b] ||= new Set()).add(a); }
  return Object.values(o).reduce((s, x) => s + x.size, 0) / Object.keys(o).length;
};

test('4 courts x 40: groups no longer come back out together all night', () => {
  const app = night({ n: 40, courts: 4, games: 76 });
  const hist = history(app);
  const foursomes = new Set(hist.map(([a, b]) => [...a, ...b].sort((x, y) => x - y).join(',')));
  assert.ok(foursomes.size > 60, `live code played only 10 different foursomes; got ${foursomes.size}`);
  assert.ok(distinctOpponents(hist) > 8, `live code: 3 opponents each; got ${distinctOpponents(hist).toFixed(1)}`);
  const g = gp(app);
  assert.ok(Math.max(...g) - Math.min(...g) <= 1, `games played stays even: ${g}`);
});

test('1 court x 12: the three groups mix', () => {
  const app = night({ n: 12, courts: 1, games: 20 });
  const foursomes = new Set(history(app).map(([a, b]) => [...a, ...b].sort((x, y) => x - y).join(',')));
  assert.ok(foursomes.size >= 15, `live code rotated 3 fixed foursomes; got ${foursomes.size}`);
});

test('nobody is passed over for someone with more games or 2+ rounds less wait', () => {
  withSeed(4, () => {
    const app = appWith({ n: 20, courts: 3 });
    for (let c = 1; c <= 3; c++) app.run(`generateMatchForCourt(${c})`);
    for (let g = 0; g < 60; g++) {
      const c = (g % 3) + 1;
      finish(app, c);
      const bad = app.run(`(()=>{const pool=getFreeWaiting(), need=matchSize();
        const M=waitMix(pool,need), out=pool.slice(0,need).filter(p=>!M.includes(p)), inn=M.filter(p=>pool.indexOf(p)>=need);
        return out.filter(o=>inn.some(q=>o.lastPlayedRound<q.lastPlayedRound-1||(o.gamesPlayed||0)<(q.gamesPlayed||0))).length
          + (out.length>teamSize()?100:0);})()`);
      assert.equal(bad, 0, `game ${g}: unfair pass-over`);
      app.run(`generateMatchForCourt(${c})`);
    }
  });
});

test('freshestSplit avoids a repeat partner when another split exists', () => {
  const app = appWith({ n: 4 });
  app.run(`gameHistory=[{court:1,round:1,team1Ids:[1,2],team2Ids:[3,4]}];`);
  for (let s = 1; s <= 10; s++) {
    const t = JSON.parse(withSeed(s, () => app.run(`JSON.stringify(freshestSplit(players.slice(0,4)))`)));
    const same = t.team1.includes(1) === t.team1.includes(2);
    assert.equal(same, false, `seed ${s}: 1 and 2 partnered again: ${JSON.stringify(t)}`);
  }
});

test('Up Next: one match; hidden at 1-2 courts with the switch, shown from 3 courts', () => {
  const two = appWith({ n: 16, courts: 2 });
  two.run(`generateMatchForCourt(1); generateMatchForCourt(2);`);
  assert.equal(two.run(`matchQueue.length`), 1);
  assert.equal(two.run(`showUpNext()`), false);
  assert.equal(two.run(`canToggleUpNext()`), true);
  const three = appWith({ n: 24, courts: 3 });
  three.run(`generateMatchForCourt(1); generateMatchForCourt(2); generateMatchForCourt(3);`);
  assert.equal(three.run(`matchQueue.length`), 1);
  assert.equal(three.run(`showUpNext()`), true);
  const view = readFileSync(new URL('../view.html', import.meta.url), 'utf8');
  assert.match(view, /const small = \([^)]*mode==='waittime'[^)]*\) && \(s\.courtDefs/, 'view.html hides Up Next for By wait time below 3 courts too');
});

test('Show Up Next button sits above the queue list', () => {
  const app = appWith({ n: 16, courts: 2 });
  app.run(`generateMatchForCourt(1); generateMatchForCourt(2); renderQueue();`);
  const html = app.captured['queueList'];
  const head = html.indexOf('mm-qhead'), btn = html.indexOf('Show Up Next'), row = html.indexOf('queue-item');
  assert.ok(head >= 0 && btn > head && row > btn, 'order: Queue header, Show Up Next, then the players');
});

test('a By wait time session saved with 3 reserved matches drops to 1', () => {
  const app = appWith({ n: 24, courts: 3 });
  app.run(`generateMatchForCourt(1); generateMatchForCourt(2); generateMatchForCourt(3);`);
  const free = JSON.parse(app.run(`JSON.stringify(getFreeWaiting().map(p=>p.id))`));
  app.run(`matchQueue=[0,1,2].map(i=>({id:100+i,team1:${JSON.stringify(free)}.slice(i*4,i*4+2),team2:${JSON.stringify(free)}.slice(i*4+2,i*4+4)}));`);
  app.run(`rebuildMatchQueue();`);
  assert.equal(app.run(`matchQueue.length`), 1);
  assert.equal(app.run(`matchQueue[0].id`), 100, 'the first reserved match is kept');
});
