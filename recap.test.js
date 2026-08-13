// Node test for recap.js buildRecapData (pure logic). Run: node recap.test.js
// recap.js is a browser IIFE; imported for side effects it attaches PDRecap to globalThis.
import './recap.js';
const { buildRecapData } = globalThis.PDRecap;

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  expected ${e}\n  got      ${a}`); }
}
function ok(cond, msg){ if(cond){pass++;} else {fail++; console.error('FAIL: '+msg);} }

// Fixture: 5-hour session, several players, some who never played.
const HOUR = 3600000;
const start = 1000000000000;              // fixed epoch
const end = start + 5 * HOUR;             // exactly 5 hours
const state = {
  sessionName: 'Sunday Open Play',
  sessionStartTime: start,
  sessionEndTime: end,
  courtDefs: [{name:'Court 6'},{name:'Court 7'},{name:'Court 8'},{name:'Court 9'}],
  gameHistory: new Array(76).fill(0).map((_,i)=>({round:i})),
  players: [
    // name, GP, wins, points, pointsAgainst  (diff = points - against)
    {name:'jake',      gamesPlayed:12, wins:10, points:200, pointsAgainst:149}, // +51
    {name:'Ivory',     gamesPlayed:10, wins:8,  points:180, pointsAgainst:143}, // +37
    {name:'Edgarfield',gamesPlayed:13, wins:8,  points:175, pointsAgainst:150}, // +25  (tie 8 wins, lower diff -> below Ivory)
    {name:'Luke USA',  gamesPlayed:10, wins:8,  points:170, pointsAgainst:149}, // +21  (tie 8 wins, lowest diff)
    {name:'Reynan',    gamesPlayed:11, wins:7,  points:160, pointsAgainst:127}, // +33
    {name:'Ja9',       gamesPlayed:10, wins:7,  points:150, pointsAgainst:132}, // +18
    {name:'Ghost',     gamesPlayed:0,  wins:0,  points:0,   pointsAgainst:0},   // never played -> excluded
    {name:'A',         gamesPlayed:9,  wins:6,  points:120, pointsAgainst:104},
    {name:'B',         gamesPlayed:10, wins:6,  points:118, pointsAgainst:106},
    {name:'C',         gamesPlayed:10, wins:6,  points:110, pointsAgainst:100},
    {name:'D',         gamesPlayed:11, wins:6,  points:105, pointsAgainst:95},
    {name:'E',         gamesPlayed:9,  wins:5,  points:90,  pointsAgainst:85},
  ]
};

const r = buildRecapData(state, { viewUrl: 'https://x/view.html?session=abc', now: end });

// stats
eq(r.stats.games, 76, 'game count from gameHistory length');
eq(r.stats.players, 11, 'player count excludes gamesPlayed===0');
eq(r.stats.hours, 5, 'hours = round(duration / 1h)');

// podium ordering: wins desc, then diff desc
eq(r.podium.map(p=>p.name), ['jake','Ivory','Edgarfield'], 'podium is top 3 by wins then diff');
eq(r.podium[0].wins, 10, 'champion wins');
eq(r.podium[0].diff, 51, 'champion diff = points - pointsAgainst');

// tie-break: Ivory (+37) ranks above Edgarfield (+25) above Luke USA (+21), all 8 wins
eq(r.top10.map(p=>p.name), ['jake','Ivory','Edgarfield','Luke USA','Reynan','Ja9','A','B','C','D'], 'top10 order + tiebreak by diff');
ok(r.top10.length === 10, 'top10 capped at 10');
ok(!r.top10.find(p=>p.name==='Ghost'), 'never-played excluded from top10');

// derived labels present
ok(/COURTS?\s/i.test(r.courtLabel), 'court label mentions courts: '+r.courtLabel);
ok(r.viewUrl === 'https://x/view.html?session=abc', 'viewUrl passthrough');

// empty session -> no crash, empty podium
const empty = buildRecapData({ players: [], gameHistory: [] }, {});
eq(empty.stats.players, 0, 'empty players');
eq(empty.podium, [], 'empty podium');

// live (not ended): duration from now
const live = buildRecapData({ sessionStartTime: start, players:[], gameHistory:[] }, { now: start + 2*HOUR });
eq(live.stats.hours, 2, 'live hours from now when not ended');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
