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
    if (!m.submitted || m.skipped) continue;
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

export function checkinToPlayer(entry, existingPlayers) {
  const name = (entry && typeof entry.name === 'string') ? entry.name.trim() : '';
  if (!name) return { skip: true, reason: 'invalid' };
  const skills = ['beginner', 'intermediate', 'advanced'];
  const skill = (entry && skills.includes(entry.skill)) ? entry.skill : 'intermediate';
  const match = (existingPlayers || []).find(p =>
    p && typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase());
  if (match) return { markPresentName: match.name };
  return { player: {
    name, present: true, gamesPlayed: 0, wins: 0, losses: 0,
    points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill, via: 'qr'
  } };
}

// ===== Numbering mode: fair-weighted draw + anti-repeat =====
// Pure. pool: [{id, lastPlayedRound}]. gameHistory: most-recent-first
// [{team1Ids, team2Ids}]. Returns {team1:[ids], team2:[ids]} or null.
const _pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

// Partner pairs from the last W games (recent-partner blocker). Returns a Set of pair keys.
// W = 0 -> empty set (blocker disabled), preserving prior split behaviour.
function _recentPartnerPairs(gameHistory, W) {
  const s = new Set();
  const h = gameHistory || [];
  const n = Math.min(W, h.length);
  for (let i = 0; i < n; i++) {
    const g = h[i] || {};
    const t1 = g.team1Ids || [], t2 = g.team2Ids || [];
    if (t1.length === 2) s.add(_pairKey(t1[0], t1[1]));
    if (t2.length === 2) s.add(_pairKey(t2[0], t2[1]));
  }
  return s;
}

export function buildHistoryScores(gameHistory, decay) {
  const opp = {}, part = {};
  const h = gameHistory || [];
  for (let i = 0; i < h.length; i++) {           // index 0 = newest = weight 1
    const g = h[i] || {};
    const t1 = g.team1Ids || [], t2 = g.team2Ids || [];
    const w = Math.pow(decay, i);
    if (t1.length === 2) part[_pairKey(t1[0], t1[1])] = (part[_pairKey(t1[0], t1[1])] || 0) + w;
    if (t2.length === 2) part[_pairKey(t2[0], t2[1])] = (part[_pairKey(t2[0], t2[1])] || 0) + w;
    for (const x of t1) for (const y of t2) opp[_pairKey(x, y)] = (opp[_pairKey(x, y)] || 0) + w;
  }
  return { opp, part };
}

export function fairWeightedMatch(pool, gameHistory, currentRound, opts = {}) {
  const { K = 1.5, alpha = 8, beta = 1, gamma = 1, decay = 0.95,
          teamSize = 2, rng = Math.random, blockWindow = 0 } = opts;
  const need = teamSize * 2;
  if (!pool || pool.length < need) return null;

  const s = buildHistoryScores(gameHistory, decay);
  const oppS = (a, b) => s.opp[_pairKey(a, b)] || 0;
  const partS = (a, b) => s.part[_pairKey(a, b)] || 0;
  const waitOf = p => currentRound - (p.lastPlayedRound == null ? -1 : p.lastPlayedRound);
  const selW = p => Math.pow(waitOf(p) + 1, K);

  // 1) weighted pick without replacement, penalising recent opponents/partners
  const remaining = pool.slice();
  const chosen = [];
  while (chosen.length < need) {
    const weights = remaining.map(c => {
      let pen = 1;
      if (chosen.length) {
        let so = 0, sp = 0;
        for (const q of chosen) { so += oppS(c.id, q.id); sp += partS(c.id, q.id); }
        pen = 1 / (1 + alpha * so + beta * sp);
      }
      return selW(c) * pen;
    });
    let total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total, idx = 0;
    for (; idx < weights.length; idx++) { r -= weights[idx]; if (r <= 0) break; }
    if (idx >= remaining.length) idx = remaining.length - 1;
    chosen.push(remaining[idx]);
    remaining.splice(idx, 1);
  }

  if (teamSize === 1) return { team1: [chosen[0].id], team2: [chosen[1].id] };

  // 2) doubles: avoid recent partners first (blocker), then freshest split, ties random
  const [a, b, c, d] = chosen;
  const splits = [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]];
  const recent = _recentPartnerPairs(gameHistory, blockWindow);
  const blockCount = x => (recent.has(_pairKey(x[0][0].id, x[0][1].id)) ? 1 : 0)
                        + (recent.has(_pairKey(x[1][0].id, x[1][1].id)) ? 1 : 0);
  const cost = x =>
      partS(x[0][0].id, x[0][1].id) + partS(x[1][0].id, x[1][1].id)
    + gamma * (oppS(x[0][0].id, x[1][0].id) + oppS(x[0][0].id, x[1][1].id)
             + oppS(x[0][1].id, x[1][0].id) + oppS(x[0][1].id, x[1][1].id));
  const minBlock = Math.min(...splits.map(blockCount));
  let cand = splits.filter(x => blockCount(x) === minBlock);   // fewest recent-partner repeats
  const minCost = Math.min(...cand.map(cost));
  cand = cand.filter(x => cost(x) === minCost);                // then freshest
  const pick = cand[Math.floor(rng() * cand.length)];         // then random
  return { team1: [pick[0][0].id, pick[0][1].id], team2: [pick[1][0].id, pick[1][1].id] };
}

// ===== Balanced mode: skill-even teams + anti-repeat (match PickleQ "Auto-balanced") =====
// Pure. pool: [{id, skill, lastPlayedRound}] pre-sorted longest-wait-first.
// gameHistory: most-recent-first [{team1Ids, team2Ids}]. Doubles only.
// 1) draw 4 from the longest-waiting window (wait-weighted + anti-repeat penalty),
// 2) pick the most skill-even 2v2 split, tie-broken by lowest repeat cost.
export function balancedMatch(pool, gameHistory, currentRound, opts = {}) {
  const { W = 8, K = 1.5, alpha = 8, beta = 1, gamma = 1, lambda = 0,
          decay = 0.95, rng = Math.random, blockWindow = 0 } = opts;
  const need = 4;
  if (!pool || pool.length < need) return null;

  const s = buildHistoryScores(gameHistory, decay);
  const oppS = (a, b) => s.opp[_pairKey(a, b)] || 0;
  const partS = (a, b) => s.part[_pairKey(a, b)] || 0;
  const waitOf = p => currentRound - (p.lastPlayedRound == null ? -1 : p.lastPlayedRound);
  const selW = p => Math.pow(waitOf(p) + 1, K);

  // 1) draw 4 from the longest-waiting window, penalising recent opponents/partners
  const win = pool.slice(0, Math.max(need, Math.min(W, pool.length)));
  const remaining = win.slice();
  const chosen = [];
  while (chosen.length < need) {
    const weights = remaining.map(c => {
      let pen = 1;
      if (chosen.length) {
        let so = 0, sp = 0;
        for (const q of chosen) { so += oppS(c.id, q.id); sp += partS(c.id, q.id); }
        pen = 1 / (1 + alpha * so + beta * sp);
      }
      return selW(c) * pen;
    });
    let total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total, idx = 0;
    for (; idx < weights.length; idx++) { r -= weights[idx]; if (r <= 0) break; }
    if (idx >= remaining.length) idx = remaining.length - 1;
    chosen.push(remaining[idx]);
    remaining.splice(idx, 1);
  }

  // 2) most skill-even split; tie -> avoid recent partners (blocker); tie -> lowest repeat cost; tie -> random
  const sk = p => skillRank(p.skill);
  const [a, b, c, d] = chosen;
  const splits = [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]];
  const recent = _recentPartnerPairs(gameHistory, blockWindow);
  const blockCount = x => (recent.has(_pairKey(x[0][0].id, x[0][1].id)) ? 1 : 0)
                        + (recent.has(_pairKey(x[1][0].id, x[1][1].id)) ? 1 : 0);
  const skillGap = x => Math.abs((sk(x[0][0]) + sk(x[0][1])) - (sk(x[1][0]) + sk(x[1][1])));
  const repeatCost = x =>
      partS(x[0][0].id, x[0][1].id) + partS(x[1][0].id, x[1][1].id)
    + gamma * (oppS(x[0][0].id, x[1][0].id) + oppS(x[0][0].id, x[1][1].id)
             + oppS(x[0][1].id, x[1][0].id) + oppS(x[0][1].id, x[1][1].id));
  const combined = x => skillGap(x) + lambda * repeatCost(x);
  let cand = splits.map(x => ({ x, cg: combined(x), bc: blockCount(x), rc: repeatCost(x) }));
  const minCg = Math.min(...cand.map(o => o.cg)); cand = cand.filter(o => o.cg === minCg);  // skill-even is top priority
  const minBc = Math.min(...cand.map(o => o.bc)); cand = cand.filter(o => o.bc === minBc);  // then avoid recent partners
  const minRc = Math.min(...cand.map(o => o.rc)); cand = cand.filter(o => o.rc === minRc);  // then freshest overall
  const pick = cand[Math.floor(rng() * cand.length)].x;
  return { team1: [pick[0][0].id, pick[0][1].id], team2: [pick[1][0].id, pick[1][1].id] };
}
