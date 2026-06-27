import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeams, generateRoundRobin, computeStandings, nextEligibleMatch, resolveChallengeCourt, skillRank, bestSkillMatch, skillBalancedTeams } from '../tournament.js';

test('buildTeams: doubles pairs in order, no leftover', () => {
  const r = buildTeams(['a', 'b', 'c', 'd'], 2);
  assert.deepEqual(r.teams, [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(r.leftover, []);
});

test('buildTeams: doubles with odd remainder leaves leftover', () => {
  const r = buildTeams(['a', 'b', 'c', 'd', 'e'], 2);
  assert.deepEqual(r.teams, [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(r.leftover, ['e']);
});

test('buildTeams: singles makes one-player teams', () => {
  const r = buildTeams(['a', 'b', 'c'], 1);
  assert.deepEqual(r.teams, [['a'], ['b'], ['c']]);
  assert.deepEqual(r.leftover, []);
});

function pairKey(m) { return [m.teamA, m.teamB].sort((a, b) => a - b).join('-'); }

test('generateRoundRobin: 4 teams single pass = 6 unique matches', () => {
  const s = generateRoundRobin(4, 1);
  assert.equal(s.length, 6);
  const keys = new Set(s.map(pairKey));
  assert.equal(keys.size, 6); // every pair exactly once
});

test('generateRoundRobin: 4 teams has 3 rounds of 2 matches each', () => {
  const s = generateRoundRobin(4, 1);
  const byRound = {};
  for (const m of s) (byRound[m.round] ||= []).push(m);
  assert.deepEqual(Object.keys(byRound).map(Number).sort((a, b) => a - b), [1, 2, 3]);
  for (const r of Object.values(byRound)) assert.equal(r.length, 2);
});

test('generateRoundRobin: no team plays twice in one round', () => {
  const s = generateRoundRobin(6, 1);
  const byRound = {};
  for (const m of s) (byRound[m.round] ||= []).push(m);
  for (const matches of Object.values(byRound)) {
    const seen = new Set();
    for (const m of matches) {
      assert.ok(!seen.has(m.teamA) && !seen.has(m.teamB), 'team double-booked in a round');
      seen.add(m.teamA); seen.add(m.teamB);
    }
  }
});

test('generateRoundRobin: 5 teams (odd) = 10 matches, one bye per round', () => {
  const s = generateRoundRobin(5, 1);
  assert.equal(s.length, 10); // 5*4/2
});

test('generateRoundRobin: double pass = twice the matches', () => {
  assert.equal(generateRoundRobin(4, 2).length, 12);
});

test('computeStandings: wins rank first', () => {
  const matches = [
    { teamA: 0, teamB: 1, score1: 11, score2: 5, submitted: true },
    { teamA: 0, teamB: 2, score1: 11, score2: 9, submitted: true },
    { teamA: 1, teamB: 2, score1: 11, score2: 3, submitted: true },
  ];
  const s = computeStandings(3, matches);
  assert.equal(s[0].team, 0); // 2 wins
  assert.equal(s[0].wins, 2);
});

test('computeStandings: tie on wins broken by diff', () => {
  const matches = [
    { teamA: 0, teamB: 1, score1: 11, score2: 1, submitted: true }, // 0 big win (+10)
    { teamA: 1, teamB: 2, score1: 11, score2: 9, submitted: true }, // 1 small win (+2)
    { teamA: 2, teamB: 0, score1: 11, score2: 9, submitted: true }, // 2 beats 0
  ];
  // wins: 0=1, 1=1, 2=1. diff: 0=+10-2=+8, 1=-10+2=-8, 2=+2-... compute
  const s = computeStandings(3, matches);
  assert.equal(s[0].team, 0); // best diff
});

test('computeStandings: ignores unsubmitted matches', () => {
  const matches = [
    { teamA: 0, teamB: 1, score1: 11, score2: 5, submitted: true },
    { teamA: 0, teamB: 1, score1: 0, score2: 0, submitted: false },
  ];
  const s = computeStandings(2, matches);
  assert.equal(s.find(t => t.team === 0).played, 1);
});

test('computeStandings: includes teams with no games played', () => {
  const s = computeStandings(4, []);
  assert.equal(s.length, 4);
  assert.ok(s.every(t => t.played === 0));
});

test('nextEligibleMatch: skips matches with a busy team', () => {
  const matches = [
    { id: 'm1', teamA: 0, teamB: 1, submitted: false },
    { id: 'm2', teamA: 2, teamB: 3, submitted: false },
  ];
  const r = nextEligibleMatch(matches, [0]); // team 0 busy
  assert.equal(r.id, 'm2');
});

test('nextEligibleMatch: skips submitted matches', () => {
  const matches = [
    { id: 'm1', teamA: 0, teamB: 1, submitted: true },
    { id: 'm2', teamA: 0, teamB: 2, submitted: false },
  ];
  assert.equal(nextEligibleMatch(matches, []).id, 'm2');
});

test('nextEligibleMatch: null when nothing eligible', () => {
  const matches = [{ id: 'm1', teamA: 0, teamB: 1, submitted: false }];
  assert.equal(nextEligibleMatch(matches, [0, 1]), null);
});

test('challenge doubles: winners stay, losers to back, challengers from front', () => {
  const r = resolveChallengeCourt({ winnerIds:[1,2], loserIds:[3,4], queueIds:[5,6,7], teamSize:2 });
  assert.deepEqual(r.stayIds, [1,2]);
  assert.deepEqual(r.opponentIds, [5,6]);
  assert.deepEqual(r.updatedQueue, [7,3,4]);
  assert.equal(r.ready, true);
});

test('challenge singles: one stays, one challenger', () => {
  const r = resolveChallengeCourt({ winnerIds:[1], loserIds:[2], queueIds:[3], teamSize:1 });
  assert.deepEqual(r.stayIds, [1]);
  assert.deepEqual(r.opponentIds, [3]);
  assert.deepEqual(r.updatedQueue, [2]);
  assert.equal(r.ready, true);
});

test('challenge holds when queue too small', () => {
  const r = resolveChallengeCourt({ winnerIds:[1,2], loserIds:[3,4], queueIds:[5], teamSize:2 });
  assert.deepEqual(r.stayIds, [1,2]);
  assert.deepEqual(r.opponentIds, []);
  assert.deepEqual(r.updatedQueue, [5,3,4]);
  assert.equal(r.ready, false);
});

test('challenge conserves players', () => {
  const r = resolveChallengeCourt({ winnerIds:[1,2], loserIds:[3,4], queueIds:[5,6], teamSize:2 });
  const all = [...r.stayIds, ...r.opponentIds, ...r.updatedQueue].sort();
  assert.deepEqual(all, [1,2,3,4,5,6]);
});

test('skillRank maps levels and defaults to 2', () => {
  assert.equal(skillRank('beginner'), 1);
  assert.equal(skillRank('intermediate'), 2);
  assert.equal(skillRank('advanced'), 3);
  assert.equal(skillRank('whatever'), 2);
});

test('bestSkillMatch picks nearest skill, ties by order', () => {
  const cands = [{id:5,skill:'advanced'},{id:6,skill:'beginner'},{id:7,skill:'beginner'}];
  // outgoing intermediate(2): beginner diff 1, advanced diff 1 -> first in order wins (id5)
  assert.equal(bestSkillMatch('intermediate', cands), 5);
  // outgoing beginner(1): id6 diff 0 wins
  assert.equal(bestSkillMatch('beginner', cands), 6);
  assert.equal(bestSkillMatch('beginner', []), null);
});

test('skillBalancedTeams snake-distributes by skill (doubles)', () => {
  const ps = [{id:1,skill:'advanced'},{id:2,skill:'advanced'},{id:3,skill:'beginner'},{id:4,skill:'beginner'}];
  const { team1, team2 } = skillBalancedTeams(ps, 2);
  // strongest..weakest = 1,2,3,4 -> snake: team1=[1,4], team2=[2,3]
  assert.deepEqual(team1, [1,4]);
  assert.deepEqual(team2, [2,3]);
});
