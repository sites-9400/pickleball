// Numbering-mode session driver with STAGGERED LATE CHECK-INS, driving the real
// app.html. Unlike the stock sim-driver this keeps the real `courts` array populated,
// so getActivePlayers()/getFreeWaiting() genuinely exclude players who are mid-game
// instead of merely deprioritising them. Late arrivals go through the REAL
// togglePresent(), which is what calls seedWaitClock().
// Runs the whole session twice: seeding ON (shipped) and OFF (pre-fix baseline).
async (page) => {
  const result = await page.evaluate(() => {
    const NCOURTS = 4, SESSION = 300;
    const NAMES = ['Jude','Tweetums','Ja9','Edgarfield','Elmarie','Ton Ton','Luke','Mira','Reynan','Kaye',
      'Ivory','Rosal','Jigs','Ed sarce','Aynz','Jan','Lynet','Shi Na','Karlito','Dennis',
      'Mariel','RR','Cris','Avelina','Gelai','Ashley','Kzian','JVince','John G','Alexa',
      'Eve','Alysson','Marco','Bea','Paolo','Nina','Karl','Trina','Vince','Mika'];
    // 30 there from the start; 10 trickle in across the night (minutes after start)
    const LATE = { Eve:45, Alysson:75, Marco:105, Bea:135, Paolo:165, Nina:190, Karl:215, Trina:240, Vince:262, Mika:280 };

    if (typeof seedWaitClock !== 'function') return { error: 'seedWaitClock missing' };
    const realSeed = seedWaitClock;

    function session(useSeeding, RSEED) {
      seedWaitClock = useSeeding ? realSeed : function(){};
      sessionMode = { matchmaking: 'random', format: 'doubles' };
      players.length = 0; queueOrder.length = 0; courtDefs.length = 0;
      courts.length = 0; matchQueue.length = 0; gameHistory.length = 0;
      NAMES.forEach((n, i) => {
        const late = (n in LATE);
        players.push({ id: i+1, name: n, present: !late, gamesPlayed: 0, wins: 0, losses: 0,
          points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate', events: [], partnerId: null });
        if (!late) queueOrder.push(i+1);
      });
      for (let c = 0; c < NCOURTS; c++) courtDefs.push({ id: c+1, name: 'Court ' + (c+1) });
      window.globalRound = 0;
      const byName = n => players.find(p => p.name === n);
      const nameOf = id => (players.find(p => p.id === id) || {}).name || '?';

      let seed = RSEED; const rnd = () => { seed = (seed*1103515245+12345) & 0x7fffffff; return seed/0x7fffffff; };
      const dur = () => [10,13,15,15,18,20][Math.floor(rnd()*6)];

      const freeAt = courtDefs.map(() => rnd()*8);
      const slot = courtDefs.map(() => null);          // court id currently live, per index
      const arrivedAt = {}, firstGameRound = {}, checkinRound = {};
      let t = 0, games = 0;

      while (true) {
        let ci = 0; for (let i = 1; i < NCOURTS; i++) if (freeAt[i] < freeAt[ci]) ci = i;
        t = freeAt[ci]; if (t >= SESSION) break;

        // late arrivals check in through the real path before the next draw
        for (const n in LATE) {
          const p = byName(n);
          if (!p.present && LATE[n] <= t) {
            arrivedAt[n] = t; checkinRound[n] = globalRound;
            togglePresent(p.id);                        // <-- REAL check-in, calls seedWaitClock
            matchQueue.length = 0;                      // keep the loop the sole scheduler
          }
        }
        // free the court that just finished
        if (slot[ci] != null) { const k = courts.findIndex(c => c.id === slot[ci]); if (k >= 0) courts.splice(k,1); slot[ci] = null; }

        const m = chooseMatchPlayers();                 // <-- REAL Numbering logic
        if (!m) { freeAt[ci] = t + 5; continue; }
        globalRound++; games++;
        const ids = [...m.team1, ...m.team2];
        ids.forEach(id => { const p = players.find(x => x.id === id); p.lastPlayedRound = globalRound; p.gamesPlayed++;
          const nm = p.name; if (nm in LATE && firstGameRound[nm] == null) firstGameRound[nm] = globalRound; });
        courts.push({ id: ci+1, name: 'Court '+(ci+1), team1: m.team1, team2: m.team2,
          score1:'', score2:'', submitted:false, round: globalRound, startedAt: Date.now() });
        slot[ci] = ci+1;
        const t1w = rnd() < 0.5, s1 = t1w ? 11 : Math.floor(rnd()*10), s2 = t1w ? Math.floor(rnd()*10) : 11;
        m.team1.forEach(id => { const p = players.find(x=>x.id===id); p.wins += t1w?1:0; p.losses += t1w?0:1; p.points += s1; p.pointsAgainst += s2; });
        m.team2.forEach(id => { const p = players.find(x=>x.id===id); p.wins += t1w?0:1; p.losses += t1w?1:0; p.points += s2; p.pointsAgainst += s1; });
        gameHistory.unshift({ round: globalRound, court: ci+1, courtName: 'Court '+(ci+1),
          team1: m.team1.map(nameOf), team2: m.team2.map(nameOf), team1Ids: [...m.team1], team2Ids: [...m.team2],
          score1: s1, score2: s2, startMin: Math.round(t) });
        freeAt[ci] = t + dur();
      }

      const key = (a,b) => a<b ? a+'|'+b : b+'|'+a;
      const opp = {}, part = {}, gp = {};
      for (const g of gameHistory) {
        part[key(g.team1Ids[0],g.team1Ids[1])] = (part[key(g.team1Ids[0],g.team1Ids[1])]||0)+1;
        part[key(g.team2Ids[0],g.team2Ids[1])] = (part[key(g.team2Ids[0],g.team2Ids[1])]||0)+1;
        for (const a of g.team1Ids) for (const b of g.team2Ids) opp[key(a,b)] = (opp[key(a,b)]||0)+1;
        for (const id of [...g.team1Ids,...g.team2Ids]) gp[id] = (gp[id]||0)+1;
      }
      const early = NAMES.filter(n => !(n in LATE)).map(n => byName(n).gamesPlayed);
      const mean = early.reduce((a,b)=>a+b,0)/early.length;
      const sd = Math.sqrt(early.reduce((a,b)=>a+(b-mean)**2,0)/early.length);
      const oV = Object.values(opp), pV = Object.values(part);
      const lateRows = Object.keys(LATE).map(n => {
        const p = byName(n), onSite = SESSION - arrivedAt[n];
        return { name:n, arrivedMin:Math.round(arrivedAt[n]), onSiteMin:Math.round(onSite),
          games:p.gamesPlayed, perHr:+(p.gamesPlayed/(onSite/60)).toFixed(2),
          roundsToFirstGame: firstGameRound[n] != null ? firstGameRound[n]-checkinRound[n] : null };
      });
      return { games,
        earlyMin: Math.min(...early), earlyMax: Math.max(...early), earlySpread: Math.max(...early)-Math.min(...early),
        earlyAvg: +mean.toFixed(2), earlySD: +sd.toFixed(2),
        oppPairs3plus: oV.filter(v=>v>=3).length, maxFacedSameOpp: Math.max(...oV),
        partnerPairs2plus: pV.filter(v=>v>=2).length, maxSamePartner: Math.max(...pV),
        late: lateRows };
    }

    const SEEDS=[12345,222,3331,44441,5555,66661,777,8888,99991,10101,11111,121212];
    const acc={off:[],on:[]};
    for(const S of SEEDS){ acc.off.push(session(false,S)); acc.on.push(session(true,S)); }
    const mean=a=>+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(3);
    const roll=rs=>({
      games:mean(rs.map(r=>r.games)),
      earlyAvg:mean(rs.map(r=>r.earlyAvg)), earlySD:mean(rs.map(r=>r.earlySD)),
      earlySpread:mean(rs.map(r=>r.earlySpread)),
      oppPairs3plus:mean(rs.map(r=>r.oppPairs3plus)), maxFacedSameOpp:mean(rs.map(r=>r.maxFacedSameOpp)),
      partnerPairs2plus:mean(rs.map(r=>r.partnerPairs2plus)), maxSamePartner:mean(rs.map(r=>r.maxSamePartner)),
      lateFirstGameWait:mean(rs.flatMap(r=>r.late.map(l=>l.roundsToFirstGame).filter(v=>v!=null))),
      lateTookNextMatchPct:mean(rs.flatMap(r=>r.late.map(l=>l.roundsToFirstGame===1?100:0))),
      latePerHr:mean(rs.flatMap(r=>r.late.map(l=>l.perHr))),
    });
    const off=roll(acc.off), on=roll(acc.on);
    seedWaitClock = realSeed;
    session(true,12345);
    // leave the seeding-ON session rendered for the screenshot
    if (typeof rebuildMatchQueue === 'function') rebuildMatchQueue();
    if (typeof switchTab === 'function') switchTab('courts');
    ['renderCourts','renderQueue','renderRankings','renderGameHistory','renderPlayers']
      .forEach(fn => { if (typeof window[fn] === 'function') window[fn](); });
    return { seeds:12, off, on, mode: mm(), courtsLive: courts.length };
  });
  await page.waitForTimeout(500);
  return result;
}
