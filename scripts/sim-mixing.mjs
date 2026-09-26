// Seeded 5-hour open-play nights driving the REAL app.html (via tests/apphtml-harness.mjs).
// Measures partner/opponent mixing, games-played spread and play/sit streaks per config,
// and (with two roots) compares game histories seed by seed.
//
//   node scripts/sim-mixing.mjs <rootA> [<rootB>] [--json out.json]
//
// A root is a directory holding app.html, tournament.js, cohost.js, common.js and
// tests/apphtml-harness.mjs (e.g. this repo, or a copy of main for a baseline).
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const roots = args.filter((a, i) => !a.startsWith('--') && (jsonIdx < 0 || i !== jsonIdx + 1));
if (!roots.length) { console.error('usage: sim-mixing.mjs <rootA> [<rootB>]'); process.exit(1); }

const SEEDS = 12, MINUTES = 300;
const SKILLS = ['beginner', 'intermediate', 'advanced'];
const CONFIGS = [];
for (const mode of (process.env.MODES || 'random,balanced,waittime').split(',')) {
  for (const n of [5, 6, 7, 8, 9, 10, 12]) CONFIGS.push({ mode, fmt: 'doubles', c: 1, n });
  for (const n of [10, 12, 16, 20]) CONFIGS.push({ mode, fmt: 'doubles', c: 2, n });
  for (const n of [16, 24]) CONFIGS.push({ mode, fmt: 'doubles', c: 3, n });
  for (const n of [3, 4, 5]) CONFIGS.push({ mode, fmt: 'singles', c: 1, n });
  for (const n of [6, 7]) CONFIGS.push({ mode, fmt: 'singles', c: 2, n });
}

function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

async function runNight(harness, cfg, seed) {
  const realRandom = Math.random;
  Math.random = lcg(seed * 7919 + 17);
  const ev = lcg(seed * 104729 + 3);   // game lengths + losing scores, independent of the app
  try {
    const app = harness.loadApp();
    const players = [];
    for (let i = 1; i <= cfg.n; i++) players.push({
      id: i, name: 'P' + i, present: true, gamesPlayed: 0, wins: 0, losses: 0, points: 0,
      pointsAgainst: 0, lastPlayedRound: -1, skill: SKILLS[(i - 1) % 3], events: [], partnerId: null,
    });
    const courtDefs = [...Array(cfg.c)].map((_, i) => ({ id: i + 1, name: 'Court ' + (i + 1) }));
    app.run(`window._uid = 'owner1';`);
    app.run(`window._fbApplyRemote(${JSON.stringify(harness.snap({
      mode: { matchmaking: cfg.mode, format: cfg.fmt }, players, courtDefs,
      queueOrder: players.map(p => p.id), playerIdCounter: cfg.n, courtIdCounter: cfg.c,
    }))});`);

    const seq = {}; for (const p of players) seq[p.id] = [];   // 'P' seated, 'S' idle at a seating
    const seat = id => {
      const idle = app.run(`JSON.stringify((()=>{const on=new Set();courts.filter(c=>!c.submitted).forEach(c=>[...c.team1,...c.team2].forEach(x=>on.add(x)));return presentPlayers().filter(p=>!on.has(p.id)).map(p=>p.id);})())`);
      app.run(`generateMatchForCourt(${id})`);
      const on = JSON.parse(app.run(`JSON.stringify((()=>{const c=courts.find(x=>x.id===${id}&&!x.submitted);return c?[...c.team1,...c.team2]:[];})())`));
      if (!on.length) return false;
      for (const pid of JSON.parse(idle)) seq[pid].push(on.includes(pid) ? 'P' : 'S');
      return true;
    };
    const end = {};
    for (const d of courtDefs) if (seat(d.id)) end[d.id] = 12 + Math.floor(ev() * 7);
    for (;;) {
      const live = Object.keys(end).map(Number);
      if (!live.length) break;
      live.sort((a, b) => end[a] - end[b] || a - b);
      const id = live[0], t = end[id];
      if (t > MINUTES) break;
      app.run(`document.getElementById('score1_${id}').value='11'; document.getElementById('score2_${id}').value='${Math.floor(ev() * 10)}'; submitScore(${id});`);
      if (seat(id)) end[id] = t + 12 + Math.floor(ev() * 7); else delete end[id];
    }
    const hist = JSON.parse(app.run(`JSON.stringify(gameHistory.map(g=>[g.court,g.round,g.team1Ids,g.team2Ids,g.score1,g.score2]))`)).reverse();
    const gp = JSON.parse(app.run(`JSON.stringify(players.map(p=>p.gamesPlayed))`));
    return { hist, gp, seq };
  } finally { Math.random = realRandom; }
}

function metrics(cfg, night) {
  const { hist, gp, seq } = night;
  const part = {}, opp = {}, partners = {}, opps = {}, groups = new Set();
  for (let i = 1; i <= cfg.n; i++) { partners[i] = new Set(); opps[i] = new Set(); }
  for (const [, , t1, t2] of hist) {
    for (const t of [t1, t2]) if (t.length === 2) {
      part[key(t[0], t[1])] = (part[key(t[0], t[1])] || 0) + 1;
      partners[t[0]].add(t[1]); partners[t[1]].add(t[0]);
    }
    for (const x of t1) for (const y of t2) { opp[key(x, y)] = (opp[key(x, y)] || 0) + 1; opps[x].add(y); opps[y].add(x); }
    groups.add([...t1, ...t2].sort((a, b) => a - b).join(','));
  }
  const runs = ch => Math.max(0, ...Object.values(seq).map(s => {
    let best = 0, cur = 0; for (const x of s) { cur = x === ch ? cur + 1 : 0; best = Math.max(best, cur); } return best;
  }));
  const b2b = Object.values(seq).reduce((a, s) => a + s.filter((x, i) => i && x === 'P' && s[i - 1] === 'P').length, 0);
  const avg = o => Object.values(o).reduce((a, s) => a + s.size, 0) / cfg.n;
  const pv = Object.values(part), ov = Object.values(opp);
  return {
    games: hist.length,
    distPart: avg(partners), distOpp: avg(opps),
    maxPart: pv.length ? Math.max(...pv) : 0, maxOpp: ov.length ? Math.max(...ov) : 0,
    part2: pv.filter(v => v >= 2).length, opp3: ov.filter(v => v >= 3).length,
    groups: groups.size, stuck2: groups.size === 2 ? 1 : 0,
    gpMin: Math.min(...gp), gpMax: Math.max(...gp),
    maxPlay: runs('P'), maxSit: runs('S'), b2b,
  };
}

const results = {};
for (const root of roots) {
  const harness = await import(pathToFileURL(resolve(root, 'tests/apphtml-harness.mjs')).href);
  results[root] = [];
  for (const cfg of CONFIGS) {
    const nights = [];
    for (let s = 1; s <= SEEDS; s++) nights.push(await runNight(harness, cfg, s));
    const ms = nights.map(n => metrics(cfg, n));
    const mean = k => ms.reduce((a, m) => a + m[k], 0) / ms.length;
    const worst = k => Math.max(...ms.map(m => m[k]));
    const agg = {};
    for (const k of Object.keys(ms[0])) agg[k] = mean(k);
    agg.stuck2 = ms.reduce((a, m) => a + m.stuck2, 0);
    agg.gpMinLo = Math.min(...ms.map(m => m.gpMin)); agg.gpMaxHi = worst('gpMax');
    agg.maxPlayW = worst('maxPlay'); agg.maxSitW = worst('maxSit');
    agg.spreadW = Math.max(...ms.map(m => m.gpMax - m.gpMin));
    results[root].push({ cfg, agg, sigs: nights.map(n => JSON.stringify(n.hist)) });
  }
}

const f = (v, d = 1) => (Number.isInteger(v) ? String(v) : v.toFixed(d));
const label = c => `${({ random: 'Numb', balanced: 'Bal ', waittime: 'Wait' })[c.mode]} ${c.fmt === 'singles' ? 'S' : 'D'} ${c.c}c×${String(c.n).padStart(2)}`;
const cols = [
  ['games', 'games'], ['distPart', 'dPart'], ['distOpp', 'dOpp'], ['maxPart', 'mxP'], ['maxOpp', 'mxO'],
  ['part2', 'P2+'], ['opp3', 'O3+'], ['groups', 'grps'], ['stuck2', 'stk'], ['spreadW', 'gpSpr'],
  ['maxPlayW', 'plRun'], ['maxSitW', 'sitRun'], ['b2b', 'b2b'],
];
const A = results[roots[0]], B = roots[1] ? results[roots[1]] : null;
console.log(`${SEEDS} seeds x ${MINUTES} min per config. Values = mean over seeds, except stk (nights stuck in exactly 2 groups), gpSpr (worst games-played max-min), plRun/sitRun (worst run of consecutive seatings played / sat), b2b (mean back-to-back games per night, all players).`);
console.log('config            ' + cols.map(([, h]) => h.padStart(B ? 11 : 6)).join('') + (B ? '  identical' : ''));
let identCount = 0;
for (let i = 0; i < A.length; i++) {
  const a = A[i].agg, b = B ? B[i].agg : null;
  const same = B ? A[i].sigs.filter((s, j) => s === B[i].sigs[j]).length : null;
  if (B && same === SEEDS) identCount++;
  console.log(label(A[i].cfg).padEnd(18) + cols.map(([k]) =>
    (B ? `${f(a[k])}/${f(b[k])}` : f(a[k])).padStart(B ? 11 : 6)).join('') + (B ? `  ${same}/${SEEDS}` : ''));
}
if (B) console.log(`\nconfigs with byte-identical histories on all ${SEEDS} seeds: ${identCount}/${A.length}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(Object.fromEntries(Object.entries(results).map(([r, v]) => [r, v.map(x => ({ cfg: x.cfg, agg: x.agg }))])), null, 1));
