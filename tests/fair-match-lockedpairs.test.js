import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fairWeightedMatch } from '../tournament.js';

// deterministic RNG so stochastic behaviour is testable
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const P = (id, lastPlayedRound = -1) => ({ id, lastPlayedRound });

const sameTeam = (m, x, y) =>
  (m.team1.includes(x) && m.team1.includes(y)) ||
  (m.team2.includes(x) && m.team2.includes(y));

test('locked pair lands on the same team (pool of 4: pair + 2 solos)', () => {
  const pool = [P(1), P(2), P(3), P(4)];
  const m = fairWeightedMatch(pool, [], 10, { teamSize: 2, rng: mulberry32(1), lockedPairs: [[1, 2]] });
  assert.ok(sameTeam(m, 1, 2), '1 and 2 must be partners');
  assert.ok(sameTeam(m, 3, 4), '3 and 4 fill the other team');
});

test('locked pair stays together despite heavy recent partnership (blocker exempted)', () => {
  // Without the lock this exact setup splits 1 & 2 (see fair-match.test.js).
  const hist = Array.from({ length: 5 }, () => ({ team1Ids: [1, 2], team2Ids: [7, 8] }));
  const pool = [P(1), P(2), P(3), P(4)];
  const m = fairWeightedMatch(pool, hist, 10, { teamSize: 2, rng: mulberry32(1), lockedPairs: [[1, 2]] });
  assert.ok(sameTeam(m, 1, 2), 'the lock overrides recent-partner avoidance');
});

test('two locked pairs oppose each other, each intact', () => {
  const pool = [P(1), P(2), P(3), P(4)];
  const m = fairWeightedMatch(pool, [], 10, { teamSize: 2, rng: mulberry32(3), lockedPairs: [[1, 2], [3, 4]] });
  assert.ok(sameTeam(m, 1, 2), '1 and 2 stay together');
  assert.ok(sameTeam(m, 3, 4), '3 and 4 stay together');
});

test('dormant: a locked pair with only one member present behaves like no lock', () => {
  // player 2 is not in the pool -> the lock is ignored, 1 is drawn normally
  const pool = [P(1), P(3), P(4), P(5)];
  const m = fairWeightedMatch(pool, [], 10, { teamSize: 2, rng: mulberry32(1), lockedPairs: [[1, 2]] });
  assert.ok(m, 'still returns a match');
  const ids = [...m.team1, ...m.team2].sort();
  assert.deepEqual(ids, [1, 3, 4, 5], 'all four present players used');
});

test('a locked pair never plays as opponents and never gets split (larger pool)', () => {
  const pool = [P(1), P(2), P(3), P(4), P(5), P(6), P(7), P(8)];
  for (let s = 0; s < 200; s++) {
    const m = fairWeightedMatch(pool, [], 10, { teamSize: 2, rng: mulberry32(s + 1), lockedPairs: [[1, 2]] });
    const has1 = [...m.team1, ...m.team2].includes(1);
    const has2 = [...m.team1, ...m.team2].includes(2);
    // if either is drawn, both must be, on the same team
    if (has1 || has2) {
      assert.ok(has1 && has2, `seed ${s}: locked partners must be drawn together`);
      assert.ok(sameTeam(m, 1, 2), `seed ${s}: locked partners must share a team`);
    }
  }
});

test('the longer-waiting partner drives the pair up the queue', () => {
  // pair (1,2): 1 has waited since round 0, 2 just played; the pair should be
  // picked far more than an unbiased 2/8-of-a-foursome baseline via 1's wait.
  const pool = [P(1, 0), P(2, 9), P(3, 9), P(4, 9), P(5, 9), P(6, 9), P(7, 9), P(8, 9)];
  let pairCount = 0;
  for (let s = 0; s < 300; s++) {
    const m = fairWeightedMatch(pool, [], 10, { teamSize: 2, rng: mulberry32(s + 1), lockedPairs: [[1, 2]] });
    if ([...m.team1, ...m.team2].includes(1)) pairCount++;
  }
  assert.ok(pairCount > 200, `expected the long-waiting pair picked >200/300, got ${pairCount}`);
});

test('opponents of a locked pair still anti-repeat among themselves', () => {
  // pair (1,2) fills one team; solos 3 & 5 have partnered a lot recently and
  // should be forced together (as the opposing team) far less than baseline.
  const hist = Array.from({ length: 6 }, () => ({ team1Ids: [3, 5], team2Ids: [7, 8] }));
  const pool = [P(1), P(2), P(3), P(4), P(5), P(6), P(7), P(8)];
  let part35 = 0;
  for (let s = 0; s < 400; s++) {
    const m = fairWeightedMatch(pool, hist, 6, { teamSize: 2, rng: mulberry32(s + 1), lockedPairs: [[1, 2]] });
    if (sameTeam(m, 3, 5)) part35++;
  }
  assert.ok(part35 < 40, `expected 3&5 partnered <40/400, got ${part35}`);
});
