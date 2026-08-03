import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancedMatch } from '../tournament.js';

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const P = (id, skill='intermediate', lastPlayedRound=-1) => ({ id, skill, lastPlayedRound });

test('returns null when fewer than 4 free players', () => {
  assert.equal(balancedMatch([P(1),P(2),P(3)], [], 5, {}), null);
});

test('skill-even split is primary: 2 advanced + 2 beginner are split across teams', () => {
  const pool = [P(1,'advanced'),P(2,'advanced'),P(3,'beginner'),P(4,'beginner')];
  const m = balancedMatch(pool, [], 10, { rng: mulberry32(1) });
  const adv = new Set([1,2]);
  assert.equal(m.team1.filter(id=>adv.has(id)).length, 1, 'each team holds exactly one advanced');
  assert.equal(m.team2.filter(id=>adv.has(id)).length, 1);
});

test('repeat-cost breaks ties when skill is uniform: a repeated partnership is split', () => {
  const hist = Array.from({length:5}, () => ({ team1Ids:[1,2], team2Ids:[3,4] }));
  const pool = [P(1),P(2),P(3),P(4)];
  const m = balancedMatch(pool, hist, 10, { rng: mulberry32(1) });
  const together = (m.team1.includes(1)&&m.team1.includes(2)) ||
                   (m.team2.includes(1)&&m.team2.includes(2));
  assert.equal(together, false, '1 & 2 partnered repeatedly -> must be split');
});

test('selection window: players outside the longest-waiting W are never drawn', () => {
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
