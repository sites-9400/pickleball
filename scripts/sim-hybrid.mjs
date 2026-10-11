// Hybrid matchmaking full-night sim: 14 men + 8 women, 4 courts, 80 games, 3 seeds, all 3 queue modes.
// Usage: node scripts/sim-hybrid.mjs   (drives the real app.html via tests/apphtml-harness.mjs)
import { loadApp, snap } from '../tests/apphtml-harness.mjs';
function lcg(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function night(mode, groups, seed, M=14, F=8, games=80){
  const real=Math.random; Math.random=lcg(seed);
  try{
    const app=loadApp();
    const g='m'.repeat(M)+'f'.repeat(F);
    const players=[...g].map((x,i)=>({id:i+1,name:x+(i+1),present:true,gamesPlayed:0,wins:0,losses:0,points:0,pointsAgainst:0,lastPlayedRound:-1,skill:['beginner','intermediate','advanced'][i%3],events:[],partnerId:null,gender:x}));
    app.run(`window._uid='owner1'`);
    app.run(`window._fbApplyRemote(${JSON.stringify(snap({mode:{matchmaking:mode,format:'doubles'},players,hybrid:true,courtDefs:groups.map((gr,i)=>({id:i+1,name:'C'+(i+1),group:gr})),queueOrder:players.map(p=>p.id),playerIdCounter:players.length,courtIdCounter:groups.length}))})`);
    const C=groups.length;
    for(let c=1;c<=C;c++) app.run(`generateMatchForCourt(${c})`);
    let idle=0;
    for(let k=0;k<games;k++){ const c=(k%C)+1;
      app.run(`(()=>{const ct=courts.find(x=>x.id===${c}&&!x.submitted); if(ct){document.getElementById('score1_${c}').value='11';document.getElementById('score2_${c}').value='7';submitScore(${c});}})()`);
      const before=app.run(`courts.filter(x=>!x.submitted).length`);
      app.run(`generateMatchForCourt(${c})`);
      if(app.run(`courts.filter(x=>!x.submitted).length`)===before) idle++;
    }
    const J=js=>JSON.parse(app.run(`JSON.stringify(${js})`));
    const hist=J(`gameHistory.map(h=>({c:h.court,t1:h.team1Ids,t2:h.team2Ids}))`);
    const gen=J(`Object.fromEntries(players.map(p=>[p.id,p.gender]))`);
    const gp=J(`players.map(p=>({g:p.gender,n:p.gamesPlayed}))`);
    let bad=0; hist.forEach(h=>{const gr=groups[h.c-1]; [...h.t1,...h.t2].forEach(id=>{ if(gr==='men'&&gen[id]!=='m')bad++; if(gr==='women'&&gen[id]!=='f')bad++; });});
    const part={}, pk=(a,b)=>a<b?a+'|'+b:b+'|'+a;
    hist.forEach(h=>[h.t1,h.t2].forEach(t=>{const k=pk(t[0],t[1]); part[k]=(part[k]||0)+1;}));
    const rep3=Object.values(part).filter(v=>v>=3).length;
    const avg=g=>{const a=gp.filter(p=>p.g===g).map(p=>p.n);return {avg:(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1),min:Math.min(...a),max:Math.max(...a)};};
    return {bad, idle, games:hist.length, men:avg('m'), women:avg('f'), rep3};
  } finally{ Math.random=real; }
}
for(const groups of [['men','men','women','women'],['men','men','women','mixed']]){
  for(const mode of ['waittime','random','balanced']){
    const runs=[1,2,3].map(s=>night(mode,groups,s));
    const r=runs[0];
    console.log(`${groups.join('/').padEnd(24)} ${mode.padEnd(9)} wrong-gender=${runs.reduce((a,x)=>a+x.bad,0)} games=${r.games} idleStarts=${runs.map(x=>x.idle).join(',')} men avg ${r.men.avg} (${r.men.min}-${r.men.max}) | women avg ${r.women.avg} (${r.women.min}-${r.women.max}) | partner pairs 3+ = ${runs.map(x=>x.rep3).join(',')}`);
  }
}
