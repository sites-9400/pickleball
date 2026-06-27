// Pure tournament logic. No DOM, no Firebase, no I/O.

export function buildTeams(playerIds, teamSize) {
  const teams = [];
  let i = 0;
  for (; i + teamSize <= playerIds.length; i += teamSize) {
    teams.push(playerIds.slice(i, i + teamSize));
  }
  return { teams, leftover: playerIds.slice(i) };
}

export function generateRoundRobin(teamCount, passes = 1) {
  const matches = [];
  let round = 1;
  for (let pass = 0; pass < passes; pass++) {
    // Circle method. Pad with a sentinel "bye" (-1) when odd.
    const ids = Array.from({ length: teamCount }, (_, i) => i);
    if (ids.length % 2 === 1) ids.push(-1);
    const n = ids.length;
    const arr = ids.slice();
    for (let r = 0; r < n - 1; r++) {
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i], b = arr[n - 1 - i];
        if (a !== -1 && b !== -1) matches.push({ round, teamA: a, teamB: b });
      }
      // rotate all but the first element
      arr.splice(1, 0, arr.pop());
      round++;
    }
  }
  return matches;
}

export function computeStandings(teamCount, matches) {
  const rows = Array.from({ length: teamCount }, (_, team) => ({
    team, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, diff: 0, played: 0,
  }));
  for (const m of matches) {
    if (!m.submitted) continue;
    const a = rows[m.teamA], b = rows[m.teamB];
    if (!a || !b) continue;
    a.played++; b.played++;
    a.pointsFor += m.score1; a.pointsAgainst += m.score2;
    b.pointsFor += m.score2; b.pointsAgainst += m.score1;
    if (m.score1 > m.score2) { a.wins++; b.losses++; }
    else if (m.score2 > m.score1) { b.wins++; a.losses++; }
  }
  for (const r of rows) r.diff = r.pointsFor - r.pointsAgainst;
  rows.sort((x, y) => y.wins - x.wins || y.diff - x.diff || y.pointsFor - x.pointsFor);
  return rows;
}

export function nextEligibleMatch(matches, busyTeams) {
  const busy = busyTeams instanceof Set ? busyTeams : new Set(busyTeams);
  return matches.find(m => !m.submitted && !busy.has(m.teamA) && !busy.has(m.teamB)) || null;
}

export function resolveChallengeCourt({ winnerIds, loserIds, queueIds, teamSize }) {
  const stayIds = [...winnerIds];
  // challengers come from the front of the queue; losers wait at the back
  if (queueIds.length >= teamSize) {
    const opponentIds = queueIds.slice(0, teamSize);
    const updatedQueue = [...queueIds.slice(teamSize), ...loserIds];
    return { stayIds, opponentIds, updatedQueue, ready: true };
  }
  // not enough challengers in queue; hold and append losers to back
  const updatedQueue = [...queueIds, ...loserIds];
  return { stayIds, opponentIds: [], updatedQueue, ready: false };
}

export function skillRank(skill) {
  return { beginner:1, intermediate:2, advanced:3 }[skill] || 2;
}

export function bestSkillMatch(outgoingSkill, candidates) {
  if (!candidates || !candidates.length) return null;
  const target = skillRank(outgoingSkill);
  let best = candidates[0], bestDiff = Math.abs(skillRank(best.skill) - target);
  for (const c of candidates.slice(1)) {
    const d = Math.abs(skillRank(c.skill) - target);
    if (d < bestDiff) { best = c; bestDiff = d; }
  }
  return best.id;
}

export function skillBalancedTeams(playerObjs, teamSize) {
  const sorted = [...playerObjs].sort((a,b) => skillRank(b.skill) - skillRank(a.skill));
  const team1 = [], team2 = [];
  // snake: 0->t1, 1->t2, 2->t2, 3->t1, ... keeps total skill even
  sorted.forEach((p, i) => { (i % 4 === 0 || i % 4 === 3 ? team1 : team2).push(p.id); });
  return { team1, team2 };
}
