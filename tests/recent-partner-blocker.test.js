import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fairWeightedMatch, balancedMatch } from '../tournament.js';

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const P  = (id, lastPlayedRound = -1) => ({ id, lastPlayedRound });
const PS = (id, skill, lastPlayedRound = -1) => ({ id, skill, lastPlayedRound });
const together = (m, a, b) =>
  (m.team1.includes(a) && m.team1.includes(b)) || (m.team2.includes(a) && m.team2.includes(b));

// History where pairing 1&2 is the CHEAPEST split (they partnered only once, recently;
// 1&3 and 1&4 partnered many times, so any split pairing 1 with 3 or 4 costs far more).
// So the freshness cost alone would re-pair 1&2 — only the blocker prevents it.
function historyThatFavorsPairing12() {
  return [
    { team1Ids:[1,2], team2Ids:[5,6] },                                   // newest: 1&2 partners
    ...Array.from({length:8}, () => ({ team1Ids:[1,3], team2Ids:[7,8] })),  // 1&3 partner a lot
    ...Array.from({length:8}, () => ({ team1Ids:[1,4], team2Ids:[9,10] })), // 1&4 partner a lot
  ];
}

// ---- fairWeightedMatch (Numbering) ----

test('fairWeightedMatch: without the blocker, the cheap split re-pairs the recent partners', () => {
  const m = fairWeightedMatch([P(1),P(2),P(3),P(4)], historyThatFavorsPairing12(), 20,
    { teamSize: 2, blockWindow: 0, rng: mulberry32(1) });
  assert.equal(together(m, 1, 2), true, 'control: cost alone pairs 1&2');
});

test('fairWeightedMatch: blocker (window 3) refuses to re-pair a last-3-games partnership', () => {
  const m = fairWeightedMatch([P(1),P(2),P(3),P(4)], historyThatFavorsPairing12(), 20,
    { teamSize: 2, blockWindow: 3, rng: mulberry32(1) });
  assert.equal(together(m, 1, 2), false, '1 and 2 partnered last game — must be split');
});

test('fairWeightedMatch: blocker falls back gracefully when every split is blocked', () => {
  // 1&2, 1&3, 1&4 (hence 2&3, 2&4, 3&4 too) all appear in the last 3 games — no clean
  // split exists. Must still return a valid 2v2, not null or a crash.
  const hist = [
    { team1Ids:[1,2], team2Ids:[3,4] },
    { team1Ids:[1,3], team2Ids:[2,4] },
    { team1Ids:[1,4], team2Ids:[2,3] },
  ];
  const m = fairWeightedMatch([P(1),P(2),P(3),P(4)], hist, 10, { teamSize: 2, blockWindow: 3, rng: mulberry32(2) });
  assert.ok(m && m.team1.length === 2 && m.team2.length === 2, 'still returns a full doubles match');
  assert.equal(new Set([...m.team1, ...m.team2]).size, 4, 'four distinct players');
});

// ---- balancedMatch (Balanced doubles) ----

test('balancedMatch: on a skill-tie, the blocker splits the recent partners', () => {
  // all intermediate -> every split is equally skill-even, so the blocker decides.
  const pool = [PS(1,'intermediate'),PS(2,'intermediate'),PS(3,'intermediate'),PS(4,'intermediate')];
  const control = balancedMatch(pool, historyThatFavorsPairing12(), 20, { blockWindow: 0, rng: mulberry32(1) });
  assert.equal(together(control, 1, 2), true, 'control: repeat-cost tiebreak pairs 1&2');
  const blocked = balancedMatch(pool, historyThatFavorsPairing12(), 20, { blockWindow: 3, rng: mulberry32(1) });
  assert.equal(together(blocked, 1, 2), false, 'blocker splits the recent 1&2 pair');
});

test('balancedMatch: skill balance still wins — blocker never unbalances teams', () => {
  // Skills 3,1,2,2 -> the ONLY skill-even (gap 0) split is (1&2) vs (3&4). Even though
  // 1&2 just partnered, keeping teams even must win over the blocker.
  const pool = [PS(1,'advanced'),PS(2,'beginner'),PS(3,'intermediate'),PS(4,'intermediate')];
  const hist = [{ team1Ids:[1,2], team2Ids:[5,6] }];   // 1&2 recent
  const m = balancedMatch(pool, hist, 10, { blockWindow: 3, rng: mulberry32(1) });
  assert.equal(together(m, 1, 2), true, 'balance forces 1&2 together; blocker yields to skill-evenness');
  assert.equal(together(m, 3, 4), true, 'the balanced partner split is 3&4');
});
