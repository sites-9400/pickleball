// Time-based 5-hour session driver for QUEUE-style modes (random/Numbering, waittime,
// balanced). Runs INSIDE the booted app.html page via mcp__playwright__browser_run_code_unsafe.
// It drives the REAL chooseMatchPlayers() (whatever mode the session is in), accumulates
// real gameHistory, audits partner/opponent repeats + fairness, then seats one live round
// onto the real court UI for a screenshot.
//
// Tunables at the top of the evaluate() body: NCOURTS, SESSION (minutes), the NAMES list,
// and the game-length distribution `dur()`.
//
// NOTE ON MODES: this pure loop works for modes whose next match comes from chooseMatchPlayers
// (random/waittime/balanced). Score-driven modes (ladder=King of the court, challenge,
// roundrobin, bracket) advance through submitScore/tournament flow, not chooseMatchPlayers —
// for those, drive the real submit/close functions instead (see SKILL.md "Mode caveats").
async (page) => {
  const result = await page.evaluate(() => {
    // ---- tunables ----
    const NCOURTS = 4;
    const SESSION = 300;              // minutes (5 hours)
    const NAMES = ['Jude','Tweetums','Ja9','Edgarfield','Elmarie','Ton Ton','Luke','Mira','Reynan','Kaye',
      'Ivory','Rosal','Jigs','Ed sarce','Aynz','Jan','Lynet','Shi Na','Karlito','Dennis',
      'Mariel','RR','Cris','Avelina','Gelai','Ashley','Kzian','JVince','John G','Alexa',
      'Eve','Alysson','Marco','Bea','Paolo','Nina','Karl','Trina','Vince','Mika'];
    // ------------------

    players.length=0; queueOrder.length=0; courtDefs.length=0; courts.length=0;
    matchQueue.length=0; gameHistory.length=0;
    NAMES.forEach((n,i)=>{ players.push({id:i+1,name:n,present:true,gamesPlayed:0,wins:0,losses:0,
      points:0,pointsAgainst:0,lastPlayedRound:-1,skill:'intermediate'}); queueOrder.push(i+1); });
    for(let c=0;c<NCOURTS;c++) courtDefs.push({id:c+1,name:'Court '+(c+1)});
    window.globalRound=0;
    const nameOf=id=>(players.find(p=>p.id===id)||{}).name||'?';

    let seed=12345; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff;};
    const dur=()=>[10,13,15,15,18,20][Math.floor(rnd()*6)];   // ~15 min avg

    const freeAt=courtDefs.map(()=>rnd()*8);   // staggered starts 0-8 min
    const courtPlayers=courtDefs.map(()=>null);
    let t=0, games=0;
    while(true){
      let ci=0; for(let i=1;i<NCOURTS;i++) if(freeAt[i]<freeAt[ci]) ci=i;
      t=freeAt[ci]; if(t>=SESSION) break;
      if(courtPlayers[ci]) courtPlayers[ci]=null;               // court frees
      const m=chooseMatchPlayers();                             // <-- REAL mode logic
      if(!m){ freeAt[ci]=t+5; continue; }
      globalRound++; games++;
      const ids=[...m.team1,...m.team2];
      ids.forEach(id=>{ const p=players.find(x=>x.id===id); p.lastPlayedRound=globalRound; p.gamesPlayed++; });
      courtPlayers[ci]=ids;
      gameHistory.unshift({round:globalRound,court:ci+1,courtName:'Court '+(ci+1),
        team1:m.team1.map(nameOf),team2:m.team2.map(nameOf),team1Ids:[...m.team1],team2Ids:[...m.team2],
        score1:11,score2:(games%9),startMin:Math.round(t)});
      freeAt[ci]=t+dur();
    }

    const key=(a,b)=>a<b?a+'|'+b:b+'|'+a;
    const opp={},part={},gp={};
    for(const g of gameHistory){
      part[key(g.team1Ids[0],g.team1Ids[1])]=(part[key(g.team1Ids[0],g.team1Ids[1])]||0)+1;
      part[key(g.team2Ids[0],g.team2Ids[1])]=(part[key(g.team2Ids[0],g.team2Ids[1])]||0)+1;
      for(const a of g.team1Ids)for(const b of g.team2Ids)opp[key(a,b)]=(opp[key(a,b)]||0)+1;
      for(const id of [...g.team1Ids,...g.team2Ids]) gp[id]=(gp[id]||0)+1;
    }
    const oV=Object.values(opp),pV=Object.values(part),gV=Object.values(gp);
    const audit={mode:(typeof mm==='function')?mm():'?',games,players:NAMES.length,courts:NCOURTS,sessionMins:SESSION,
      oppPairs3plus:oV.filter(v=>v>=3).length,maxFacedSameOpp:Math.max(...oV),distinctOppPairs:oV.length,
      partnerPairs2plus:pV.filter(v=>v>=2).length,maxSamePartner:Math.max(...pV),
      gpMin:Math.min(...gV),gpMax:Math.max(...gV),gpAvg:+(gV.reduce((a,b)=>a+b,0)/gV.length).toFixed(1)};

    // seat one live round on the real court UI for a screenshot
    courts.length=0; matchQueue.length=0;
    for(const def of courtDefs){ const m=chooseMatchPlayers(); if(!m) break; globalRound++;
      [...m.team1,...m.team2].forEach(id=>{players.find(p=>p.id===id).lastPlayedRound=globalRound;});
      courts.push({id:def.id,name:def.name,team1:m.team1,team2:m.team2,score1:'',score2:'',submitted:false,round:globalRound,startedAt:Date.now()}); }
    if(typeof rebuildMatchQueue==='function') rebuildMatchQueue();
    if(typeof switchTab==='function') switchTab('courts');
    ['renderCourts','renderQueue','renderRankings','renderGameHistory','renderPlayers'].forEach(fn=>{ if(typeof window[fn]==='function') window[fn](); });
    return {audit, onDeckDepth: matchQueue.length};
  });
  await page.waitForTimeout(400);
  return result;
}
