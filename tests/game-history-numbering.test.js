// Game History must number games sequentially (1, 2, 3...) with no gaps.
//
// Bug: globalRound is consumed when a match is PLACED on a court, but a history
// row is only written when the score is SUBMITTED. Cancelling a match (or
// closing its court without recording) burned the number forever, so history
// read "Rd 4, Rd 3, Rd 1". The displayed number is now derived from the entry's
// position, so a cancelled match consumes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './apphtml-harness.mjs';
import { loadView } from './viewhtml-harness.mjs';

// Two courts; one match is cancelled mid-session, three are played to a score.
function sessionWithACancelledMatch() {
  const app = loadApp();
  const { run, els } = app;
  run(`
    sessionMode = { format:'doubles', matchmaking:'waittime' };
    for (let i=1;i<=12;i++) players.push({id:i,name:'P'+i,present:true,gamesPlayed:0,wins:0,losses:0,
      points:0,pointsAgainst:0,skill:'intermediate',lastPlayedRound:-1,partnerId:null});
    playerIdCounter=12; queueOrder=players.map(p=>p.id);
    addCourt(); addCourt();
  `);
  const score = (court, a, b) => {
    els['score1_' + court].value = String(a);
    els['score2_' + court].value = String(b);
  };
  run(`generateMatchForCourt(1); generateMatchForCourt(2);`);
  score(1, 11, 5);  run(`submitScore(1);`);        // -> history
  run(`cancelMatch(2); confirmCancel();`);         // cancelled, no history row
  run(`generateMatchForCourt(1);`); score(1, 11, 7); run(`submitScore(1);`);
  run(`generateMatchForCourt(2);`); score(2, 11, 9); run(`submitScore(2);`);
  return app;
}

const gameLabels = html => [...String(html).matchAll(/Game (\d+)/g)].map(m => Number(m[1]));
const rdLabels   = html => [...String(html).matchAll(/Rd (\d+)/g)].map(m => Number(m[1]));

test('app: cancelled match leaves no gap in Game History numbering', () => {
  const { run, captured } = sessionWithACancelledMatch();
  assert.equal(run('gameHistory.length'), 3);
  run(`renderGameHistory();`);
  // newest first -> 3, 2, 1
  assert.deepEqual(gameLabels(captured.gameHistory), [3, 2, 1]);
  assert.ok(!/Rd \d/.test(captured.gameHistory), 'history should no longer show the leaked Rd number');
});

test('app: search-filtered history keeps each game its real number', () => {
  const { run, captured, els } = sessionWithACancelledMatch();
  const gh = JSON.parse(run('JSON.stringify(gameHistory)'));
  // Pick a name that played exactly one game, so the search narrows to one row.
  const count = {};
  gh.forEach(g => [...g.team1, ...g.team2].forEach(n => { count[n] = (count[n] || 0) + 1; }));
  const idx = gh.findIndex(g => [...g.team1, ...g.team2].some(n => count[n] === 1));
  const name = [...gh[idx].team1, ...gh[idx].team2].find(n => count[n] === 1);
  assert.ok(name, 'expected at least one player with a single game');
  els.historySearch.value = name;
  run(`renderGameHistory();`);
  // Filtering must not renumber: the row keeps its position-based game number.
  assert.deepEqual(gameLabels(captured.gameHistory), [gh.length - idx]);
});

test('app: the stored round stamp is untouched (matchmaking + edit identity)', () => {
  const { run } = sessionWithACancelledMatch();
  assert.deepEqual(JSON.parse(run('JSON.stringify(gameHistory.map(g=>g.round))')), [4, 3, 1]);
  assert.equal(run('globalRound'), 4);
});

test('app: edit-score dialog names the game by its sequential number', () => {
  const { run, els } = sessionWithACancelledMatch();
  run(`openEditScore(2);`);   // oldest entry
  assert.match(els.editScoreSub.textContent, /^Game 1 · /);
});

test('app: CSV export numbers games sequentially', () => {
  const { run, blobs } = sessionWithACancelledMatch();
  run(`exportCSV();`);
  const csv = blobs.at(-1);
  const rows = csv.split('\n');
  const head = rows.findIndex(r => r.startsWith('Game,Court,'));
  assert.ok(head > -1, 'CSV should have a Game/Court header row');
  const nums = rows.slice(head + 1).filter(Boolean).map(r => Number(r.split(',')[0]));
  assert.deepEqual(nums, [3, 2, 1]);
});

test('view: viewer history mirrors the same gap-free numbering', () => {
  const { run, captured } = loadView();
  // gameHistory as the viewer receives it from Firebase: newest first, with the
  // cancelled match's round number missing from the stamps.
  run(`state = { gameHistory: [
    { round:4, court:2, courtName:'Court 2', team1:['P1'], team2:['P2'], score1:11, score2:9 },
    { round:3, court:1, courtName:'Court 1', team1:['P3'], team2:['P4'], score1:11, score2:7 },
    { round:1, court:1, courtName:'Court 1', team1:['P5'], team2:['P6'], score1:11, score2:5 },
  ] };
  renderHistory(state);`);
  assert.deepEqual(gameLabels(captured.vHistory), [3, 2, 1]);
});

// --- Round robin / bracket / ladder keep their REAL round ---------------------
// Round 1 of a 10-team round robin is 5 separate matches that are all genuinely
// "Rd 1". Position-numbering those would destroy the round grouping, so history
// shows the schedule's round in those modes.

test('app: round robin history shows the real round, not a game number', () => {
  const { run, captured } = loadApp();
  run(`
    sessionMode = { format:'doubles', matchmaking:'roundrobin' };
    // 5 finished matches, all from round 1 of a 10-team schedule
    gameHistory = [
      {round:1,court:2,courtName:'Court 2',team1:['Gael','Jude'],team2:['Alexa','Eve'],score1:11,score2:2},
      {round:1,court:1,courtName:'Court 1',team1:['March','Tweetums'],team2:['Jan','Mira'],score1:11,score2:1},
      {round:1,court:1,courtName:'Court 1',team1:['Rv Joy','Ed'],team2:['Macky','Cris'],score1:11,score2:2},
      {round:1,court:1,courtName:'Court 1',team1:['Franz','Ja9'],team2:['Peaches','Hans'],score1:12,score2:2},
      {round:1,court:1,courtName:'Court 1',team1:['Rexell','Luke'],team2:['Lynet','Kylie'],score1:11,score2:2},
    ];
    renderGameHistory();
  `);
  assert.deepEqual(rdLabels(captured.gameHistory), [1, 1, 1, 1, 1]);
  assert.deepEqual(gameLabels(captured.gameHistory), []);
});

test('app: round robin CSV keeps the Round column', () => {
  const { run, blobs } = loadApp();
  run(`
    sessionMode = { format:'doubles', matchmaking:'roundrobin' };
    gameHistory = [
      {round:2,court:1,courtName:'Court 1',team1:['A','B'],team2:['C','D'],score1:11,score2:4},
      {round:1,court:1,courtName:'Court 1',team1:['E','F'],team2:['G','H'],score1:11,score2:6},
    ];
    exportCSV();
  `);
  const rows = blobs.at(-1).split('\n');
  const head = rows.findIndex(r => r.startsWith('Round,Court,'));
  assert.ok(head > -1, 'tournament CSV should keep a Round column');
  assert.deepEqual(rows.slice(head + 1).filter(Boolean).map(r => Number(r.split(',')[0])), [2, 1]);
});

test('app: ladder history shows the real ladder round', () => {
  const { run, captured } = loadApp();
  run(`
    sessionMode = { format:'doubles', matchmaking:'ladder' };
    gameHistory = [
      {round:2,court:1,courtName:'Court 1',team1:['A','B'],team2:['C','D'],score1:11,score2:4},
      {round:1,court:2,courtName:'Court 2',team1:['E','F'],team2:['G','H'],score1:11,score2:6},
      {round:1,court:1,courtName:'Court 1',team1:['I','J'],team2:['K','L'],score1:11,score2:9},
    ];
    renderGameHistory();
  `);
  assert.deepEqual(rdLabels(captured.gameHistory), [2, 1, 1]);
});

test('view: round robin viewer history also shows the real round', () => {
  const { run, captured } = loadView();
  run(`state = { mode:{matchmaking:'roundrobin'}, gameHistory: [
    { round:1, court:2, courtName:'Court 2', team1:['Gael','Jude'], team2:['Alexa','Eve'], score1:11, score2:2 },
    { round:1, court:1, courtName:'Court 1', team1:['March','Tweetums'], team2:['Jan','Mira'], score1:11, score2:1 },
  ] };
  renderHistory(state);`);
  assert.deepEqual(rdLabels(captured.vHistory), [1, 1]);
  assert.deepEqual(gameLabels(captured.vHistory), []);
});
