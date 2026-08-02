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
