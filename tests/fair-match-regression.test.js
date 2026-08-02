import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fairWeightedMatch } from '../tournament.js';

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const key = (a,b)=> a<b ? a+'|'+b : b+'|'+a;

// pure-random control matching the OLD behaviour (shuffle pool, take 4, random split)
function randomMatch(pool, _h, _cr, opts){
  const rng = opts.rng; const a = pool.slice();
  for (let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  const f=a.slice(0,4); return { team1:[f[0].id,f[1].id], team2:[f[2].id,f[3].id] };
}

// 4 courts, N present the whole time, GT games; history built as games are logged
function runSession(matchFn, N, NC, GT, seed){
  const rng = mulberry32(seed);
  const st = {}; for (let i=1;i<=N;i++) st[i] = { id:i, lastPlayedRound:null };
  const courts = Array.from({length:NC},()=>({freeAt:rng()*10, players:[]}));
  const history = []; const log = []; let counter=0, guard=0;
  while (log.length<GT && guard++<GT*12){
    courts.sort((a,b)=>a.freeAt-b.freeAt); const c=courts[0]; const t=c.freeAt;
    const onCourt=new Set(); courts.forEach(x=>{ if(x!==c && x.freeAt>t) x.players.forEach(p=>onCourt.add(p)); });
    const pool = Object.values(st).filter(p=>!onCourt.has(p.id));
    counter++;
    const m = matchFn(pool.map(p=>({id:p.id,lastPlayedRound:p.lastPlayedRound})), history, counter, {teamSize:2, rng});
    if(!m){ c.freeAt=t+15; continue; }
    [...m.team1,...m.team2].forEach(id=>{ st[id].lastPlayedRound=counter; });
    c.freeAt = t + [10,15,20,25][Math.floor(rng()*4)];
    c.players = [...m.team1,...m.team2];
    history.unshift({ team1Ids:m.team1, team2Ids:m.team2 });  // newest-first
    log.push(m);
  }
  const opp={}; for(const g of log) for(const a of g.team1) for(const b of g.team2) opp[key(a,b)]=(opp[key(a,b)]||0)+1;
  return { oppPairs3: Object.values(opp).filter(v=>v>=3).length,
           maxOpp: Math.max(...Object.values(opp)) };
}

test('fairWeightedMatch massively reduces repeat opponents vs random', () => {
  // 30 players / 4 courts / ~72 games (≈10 games each) — a realistic session length
  // where the bench is big enough for anti-repeat to work. (Do NOT crank games so high
  // that avg opponent-meetings/pair exceeds ~1; at ~2.2 meetings/pair no algorithm can
  // keep oppPairs3 low — that's a capacity limit, not an algorithm signal.)
  // Measured baseline at these params: fair oppPairs3 ~0.2, random ~11; fair max-faced ~3,
  // random ~6.
  let fairSum=0, randSum=0, fairMax=0, randMax=0;
  const seeds=[1,2,3,4,5];
  for(const s of seeds){
    const f = runSession(fairWeightedMatch, 30, 4, 72, s);
    const r = runSession(randomMatch,       30, 4, 72, s);
    fairSum+=f.oppPairs3; randSum+=r.oppPairs3; fairMax=Math.max(fairMax,f.maxOpp); randMax=Math.max(randMax,r.maxOpp);
  }
  const fairAvg=fairSum/seeds.length, randAvg=randSum/seeds.length;
  assert.ok(fairAvg < 3, `fair oppPairs3 avg should be <3, got ${fairAvg}`);
  assert.ok(fairAvg < randAvg / 3, `fair (${fairAvg}) should be well below random (${randAvg})`);
  assert.ok(fairMax <= randMax, `fair max-faced (${fairMax}) should not exceed random (${randMax})`);
});
