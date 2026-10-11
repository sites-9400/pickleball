// Hybrid matchmaking: courts split into Men's / Women's / Mixed groups. The session's
// own mode (Numbering / By wait time / Balanced) runs unchanged once per group, on that
// group's pool only. Men's courts take men, Women's courts take women, Mixed takes
// anyone (and is the only place untagged players can go). Hybrid off = no change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
// genders: string like 'mmmmffff?' (m / f / ? = untagged), one char per player
function appWith({ genders, groups, mode = 'waittime', hybrid = true, extra = {} }) {
  const app = loadApp();
  const players = [...genders].map((g, i) => ({
    id: i + 1, name: (g === '?' ? 'U' : g.toUpperCase()) + (i + 1), present: true, gamesPlayed: 0,
    wins: 0, losses: 0, points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate',
    events: [], partnerId: null, ...(g === '?' ? {} : { gender: g }),
  }));
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: mode, format: 'doubles' }, players, hybrid,
    courtDefs: groups.map((g, i) => ({ id: i + 1, name: 'Court ' + (i + 1), group: g })),
    queueOrder: players.map(p => p.id), playerIdCounter: players.length, courtIdCounter: groups.length,
    ...extra,
  }))});`);
  return app;
}
const J = (app, js) => JSON.parse(app.run(`JSON.stringify(${js})`));
const genderOf = (app, id) => J(app, `getPlayer(${id}).gender||null`);
const finish = (app, id) => app.run(
  `document.getElementById('score1_${id}').value='11'; document.getElementById('score2_${id}').value='6'; submitScore(${id});`);
const seated = (app, id) => J(app, `(()=>{const c=courts.find(c=>c.id===${id}&&!c.submitted);return c?[...c.team1,...c.team2]:null})()`);

test('Up Next holds one labelled match per court group, each from its own pool', () => {
  const app = appWith({ genders: 'mmmmmmffffff', groups: ['men', 'women'] });
  const q = J(app, `matchQueue.map(m=>({g:m.group,ids:[...m.team1,...m.team2]}))`);
  assert.deepEqual(q.map(m => m.g), ['men', 'women']);
  q.find(m => m.g === 'men').ids.forEach(id => assert.equal(genderOf(app, id), 'm'));
  q.find(m => m.g === 'women').ids.forEach(id => assert.equal(genderOf(app, id), 'f'));
});

test('each court takes the match of its own group', () => {
  const app = appWith({ genders: 'mmmmmmmmffffffff', groups: ['men', 'men', 'women', 'women'] });
  for (let c = 1; c <= 4; c++) app.run(`generateMatchForCourt(${c})`);
  [1, 2].forEach(c => seated(app, c).forEach(id => assert.equal(genderOf(app, id), 'm')));
  [3, 4].forEach(c => seated(app, c).forEach(id => assert.equal(genderOf(app, id), 'f')));
});

test('a short group leaves its court empty and says who is missing', () => {
  const app = appWith({ genders: 'mmmmmmfff', groups: ['men', 'women'] });
  app.run(`generateMatchForCourt(2)`);
  assert.equal(seated(app, 2), null, 'women court must not start with 3 women');
  assert.equal(app.run(`hybridShortMsg('women')`), 'Need 1 more woman');
  assert.equal(app.run(`hybridShortMsg('men')`), '');
  app.run(`generateMatchForCourt(1)`);
  assert.equal(seated(app, 1).length, 4);
  assert.equal(app.run(`hybridShortMsg('men')`), 'Need 2 more men');
});

test('untagged players only ever go to Mixed courts', () => {
  const app = appWith({ genders: 'mmmmffff????', groups: ['men', 'women', 'mixed'] });
  const mixed = J(app, `(()=>{const m=matchQueue.find(m=>m.group==='mixed');return [...m.team1,...m.team2]})()`);
  assert.deepEqual(mixed.sort((a, b) => a - b), [9, 10, 11, 12]);
  const app2 = appWith({ genders: 'mmmm??', groups: ['men', 'women'] });
  assert.deepEqual(J(app2, `matchQueue.map(m=>m.group)`), ['men']);
});

test('Mixed takes the longest-waiting players of either gender', () => {
  const app = appWith({ genders: 'mmmmmmff', groups: ['men', 'mixed'] });
  const mixed = J(app, `(()=>{const m=matchQueue.find(m=>m.group==='mixed');return [...m.team1,...m.team2]})()`);
  assert.equal(mixed.length, 4);
  assert.ok(mixed.includes(7) && mixed.includes(8), 'the two women wait for Mixed and get it');
});

test('a full night never puts the wrong gender on a gendered court (all three modes)', () => {
  for (const mode of ['waittime', 'random', 'balanced']) {
    withSeed(7, () => {
      const app = appWith({ genders: 'm'.repeat(14) + 'f'.repeat(8), groups: ['men', 'men', 'women', 'mixed'], mode });
      for (let c = 1; c <= 4; c++) app.run(`generateMatchForCourt(${c})`);
      for (let g = 0; g < 80; g++) { const c = (g % 4) + 1; finish(app, c); app.run(`generateMatchForCourt(${c})`); }
      const hist = J(app, `gameHistory.map(g=>({c:g.court,ids:[...g.team1Ids,...g.team2Ids]}))`);
      assert.ok(hist.length >= 75, `${mode}: games kept flowing (${hist.length})`);
      for (const h of hist) {
        if (h.c <= 2) h.ids.forEach(id => assert.equal(genderOf(app, id), 'm', `${mode}: men court`));
        if (h.c === 3) h.ids.forEach(id => assert.equal(genderOf(app, id), 'f', `${mode}: women court`));
      }
      const gp = J(app, `players.map(p=>p.gamesPlayed)`);
      assert.ok(Math.min(...gp) >= 10, `${mode}: nobody starved: ${gp}`);
    });
  }
});

// Regression (sim 2026-10-11): with a Mixed court, the Mixed Up Next kept reserving every
// woman who came off it, so the Women's court re-dealt the same 4 women 19 games straight
// while the other 4 only ever played Mixed (10 vs 19 games). Gendered courts now take
// priority over Mixed's not-yet-started match.
test('with a Mixed court, women rotate through the Women\'s court (no group locked on)', () => {
  for (const mode of ['waittime', 'random', 'balanced']) {
    withSeed(3, () => {
      const app = appWith({ genders: 'm'.repeat(14) + 'f'.repeat(8), groups: ['men', 'men', 'women', 'mixed'], mode });
      for (let c = 1; c <= 4; c++) app.run(`generateMatchForCourt(${c})`);
      for (let g = 0; g < 80; g++) { const c = (g % 4) + 1; finish(app, c); app.run(`generateMatchForCourt(${c})`); }
      const hist = J(app, `gameHistory.slice().reverse().map(g=>({c:g.court,ids:[...g.team1Ids,...g.team2Ids]}))`);
      const women = J(app, `players.filter(p=>p.gender==='f').map(p=>p.id)`);
      const onWomensCourt = women.map(id => hist.filter(h => h.c === 3 && h.ids.includes(id)).length);
      assert.ok(Math.min(...onWomensCourt) >= 4, `${mode}: every woman gets Women's-court games: ${onWomensCourt}`);
      const gp = J(app, `players.filter(p=>p.gender==='f').map(p=>p.gamesPlayed)`);
      assert.ok(Math.max(...gp) - Math.min(...gp) <= 3, `${mode}: women's games stay even: ${gp}`);
    });
  }
});

test('swap options only offer players who fit the match group', () => {
  const app = appWith({ genders: 'mmmmmmffffff', groups: ['men', 'women'] });
  const m = J(app, `matchQueue.find(m=>m.group==='women').id`);
  app.run(`document.getElementById('swapOptions');`);
  app.els.swapOptions.children = [];
  app.run(`openQueueSwapModal(${m},'team1',0)`);
  const html = app.run(`document.getElementById('swapOptions').innerHTML`);
  assert.ok(!/\bM\d+\b/.test(html), 'no men offered for a women match');
  assert.ok(/\bF\d+\b/.test(html), 'women are offered');
});

test('a queued match that loses a player is refilled from the same group', () => {
  const app = appWith({ genders: 'mmmmmmffffff', groups: ['men', 'women'] });
  const w = J(app, `matchQueue.find(m=>m.group==='women').team1[0]`);
  app.run(`togglePresent(${w})`);
  const ids = J(app, `(()=>{const m=matchQueue.find(m=>m.group==='women');return [...m.team1,...m.team2]})()`);
  assert.equal(ids.length, 4);
  ids.forEach(id => assert.equal(genderOf(app, id), 'f'));
});

test('a locked man+woman pair is dormant on gendered courts and together on Mixed', () => {
  const genders = 'mmmmmmffffff';
  const app = appWith({ genders, groups: ['men', 'women', 'mixed'], mode: 'random' });
  app.run(`players[0].partnerId=7; players[6].partnerId=1; matchQueue=[]; rebuildMatchQueue();`);
  const q = J(app, `matchQueue.map(m=>({g:m.group,t1:m.team1,t2:m.team2}))`);
  for (const m of q) {
    const all = [...m.t1, ...m.t2];
    if (m.g === 'men') all.forEach(id => assert.equal(genderOf(app, id), 'm'));
    if (m.g === 'women') all.forEach(id => assert.equal(genderOf(app, id), 'f'));
    if (all.includes(1) && all.includes(7)) {
      const same = (m.t1.includes(1) && m.t1.includes(7)) || (m.t2.includes(1) && m.t2.includes(7));
      assert.ok(same, 'locked pair on the same team when both are in a match');
    }
  }
});

test('hybrid off ignores court groups and gender (today\'s behaviour)', () => {
  const app = appWith({ genders: 'mmmmffff', groups: ['men', 'women'], hybrid: false });
  const q = J(app, `matchQueue.map(m=>({g:m.group||null,n:m.team1.length+m.team2.length}))`);
  assert.deepEqual(q, [{ g: null, n: 4 }]);
});

test('setHybridSplit tags courts in order and saves hybrid', () => {
  const app = appWith({ genders: 'mmmmffff', groups: [undefined, undefined, undefined, undefined], hybrid: false });
  app.run(`setHybridSplit({men:1,women:2,mixed:1})`);
  assert.deepEqual(J(app, `courtDefs.map(d=>d.group)`), ['men', 'women', 'women', 'mixed']);
  assert.equal(J(app, `hybrid`), true);
  assert.deepEqual(J(app, `matchQueue.map(m=>m.group)`), ['men', 'women']);
  app.run(`setHybrid(false)`);
  assert.equal(J(app, `hybrid`), false);
  assert.deepEqual(J(app, `matchQueue.map(m=>m.group||null)`), [null]);
});

test('defaultHybridSplit: even men/women, odd court to Mixed', () => {
  const app = appWith({ genders: 'mm', groups: [], hybrid: false });
  assert.deepEqual(J(app, `defaultHybridSplit(4)`), { men: 2, women: 2, mixed: 0 });
  assert.deepEqual(J(app, `defaultHybridSplit(5)`), { men: 2, women: 2, mixed: 1 });
  assert.deepEqual(J(app, `defaultHybridSplit(1)`), { men: 0, women: 0, mixed: 1 });
});

test('setGender cycles untagged -> m -> f -> m and saves', () => {
  const app = appWith({ genders: 'mmmmffff?', groups: ['men', 'women'] });
  app.run(`window.__saved = []; window._fbWrite = d => window.__saved.push(d);`);
  app.run(`setGender(9)`); assert.equal(genderOf(app, 9), 'm');
  // the roster re-renders and the tag is saved (a stray comment once swallowed both)
  assert.match(app.run(`document.getElementById('playerList').innerHTML`), /gender-badge m" onclick="setGender\(9\)"/);
  assert.equal(J(app, `window.__saved.length`), 1);
  assert.equal(J(app, `window.__saved[0].players.find(p=>p.id===9).gender`), 'm');
  app.run(`setGender(9)`); assert.equal(genderOf(app, 9), 'f');
  app.run(`setGender(9)`); assert.equal(genderOf(app, 9), 'm');
});
