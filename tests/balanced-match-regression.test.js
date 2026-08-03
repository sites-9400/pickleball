import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancedMatch, skillBalancedTeams } from '../tournament.js';

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const key = (a,b)=> a<b ? a+'|'+b : b+'|'+a;
const RANK = { beginner:1, intermediate:2, advanced:3 };
const skillOf = i => { const m=i%10; return m<3?'beginner':(m<7?'intermediate':'advanced'); };

// old Balanced control: strict top-4 (pre-sorted), snake by skill
function oldMatch(pool){
  if (pool.length < 4) return null;
  return skillBalancedTeams(pool.slice(0,4).map(p=>({id:p.id, skill:p.skill})), 2);
}

function runSession(matchFn, N, NC, GT, seed){
  const rng = mulberry32(seed);
  const st = {}; for (let i=1;i<=N;i++) st[i] = { id:i, skill:skillOf(i-1), lastPlayedRound:-1 };
  const courts = Array.from({length:NC},()=>({freeAt:rng()*10, players:[]}));
  const history = []; const log = []; let counter=0, guard=0, skillGapSum=0;
  while (log.length<GT && guard++<GT*12){
    courts.sort((a,b)=>a.freeAt-b.freeAt); const c=courts[0]; const t=c.freeAt;
    const onCourt=new Set(); courts.forEach(x=>{ if(x!==c && x.freeAt>t) x.players.forEach(p=>onCourt.add(p)); });
    const pool = Object.values(st).filter(p=>!onCourt.has(p.id))
      .sort((a,b)=> a.lastPlayedRound-b.lastPlayedRound); // longest-wait first
    counter++;
    const m = matchFn(pool.map(p=>({id:p.id,skill:p.skill,lastPlayedRound:p.lastPlayedRound})), history, counter, {rng});
    if(!m){ c.freeAt=t+15; continue; }
    [...m.team1,...m.team2].forEach(id=>{ st[id].lastPlayedRound=counter; });
    const sg = Math.abs((RANK[st[m.team1[0]].skill]+RANK[st[m.team1[1]].skill])
                       -(RANK[st[m.team2[0]].skill]+RANK[st[m.team2[1]].skill]));
    skillGapSum += sg;
    c.freeAt = t + [10,15,20,25][Math.floor(rng()*4)];
    c.players = [...m.team1,...m.team2];
    history.unshift({ team1Ids:m.team1, team2Ids:m.team2 });
    log.push(m);
  }
  const opp={}; for(const g of log) for(const a of g.team1) for(const b of g.team2) opp[key(a,b)]=(opp[key(a,b)]||0)+1;
  return { oppPairs3: Object.values(opp).filter(v=>v>=3).length,
           maxOpp: Math.max(...Object.values(opp)),
           skillGap: skillGapSum/log.length };
}

test('balancedMatch slashes repeat opponents while keeping teams skill-even', () => {
  let newRep=0, oldRep=0, newMaxF=0, oldMaxF=0, newGap=0, oldGap=0;
  const seeds=[1,2,3,4,5];
  for(const s of seeds){
    const n = runSession(balancedMatch, 40, 4, 78, s);
    const o = runSession(oldMatch,      40, 4, 78, s);
    newRep+=n.oppPairs3; oldRep+=o.oppPairs3;
    newMaxF=Math.max(newMaxF,n.maxOpp); oldMaxF=Math.max(oldMaxF,o.maxOpp);
    newGap+=n.skillGap; oldGap+=o.skillGap;
  }
  const nRep=newRep/seeds.length, oRep=oldRep/seeds.length;
  const nGap=newGap/seeds.length, oGap=oldGap/seeds.length;
  assert.ok(nRep < 8, `new oppPairs3 avg should be low, got ${nRep} (old ${oRep})`);
  assert.ok(nRep < oRep / 3, `new (${nRep}) should be well below old (${oRep})`);
  assert.ok(newMaxF < oldMaxF, `new max-faced (${newMaxF}) should beat old (${oldMaxF})`);
  assert.ok(nGap <= oGap + 0.15, `new skill-gap (${nGap}) must not exceed old (${oGap}) beyond noise`);
});
