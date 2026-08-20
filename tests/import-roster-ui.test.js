import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './apphtml-harness.mjs';
import { mergeImportedNames } from '../tournament.js';

// Drive app.html's real import functions with the Firebase read-bridges stubbed
// (those live in the module block, which the harness doesn't load).
function setup() {
  const { run, els, windowMock } = loadApp();
  windowMock._uid = 'owner1';
  windowMock._mergeImportedNames = mergeImportedNames;   // the real, tested helper
  run(`_access='owner';`);
  run(`players=[{id:1,name:'Existing',present:true,gamesPlayed:5,wins:3,losses:2,points:44,pointsAgainst:30,lastPlayedRound:2,skill:'advanced',via:'manual',events:[],partnerId:null}]; playerIdCounter=1;`);
  return { run, els, windowMock };
}

test('opening import lists the owner\'s other sessions; empty ones are disabled', async () => {
  const { run, els, windowMock } = setup();
  windowMock._loadImportSessions = async () => [
    { id: 'sessA', name: 'Friday Open Play', date: '2026-08-15', createdAt: 2, playerCount: 3 },
    { id: 'sessEmpty', name: 'Empty Night', date: '2026-08-10', createdAt: 1, playerCount: 0 },
  ];
  await run(`openImportSessions()`);
  const html = els.importList.innerHTML;
  assert.match(html, /Friday Open Play/);
  assert.match(html, /3 players/);
  assert.match(html, /Empty Night/);
  assert.match(html, /import-row disabled/);            // the 0-player session isn't tappable
  assert.equal(els.importOverlay.classList.contains('hidden'), false);
});

test('importing a session adds its names as fresh players and skips dupes', async () => {
  const { run, els, windowMock } = setup();
  windowMock._loadSessionPlayers = async () => [
    { id: 7, name: 'Eve', present: true, gamesPlayed: 12, wins: 8, losses: 4, points: 120, pointsAgainst: 90, skill: 'advanced', partnerId: 9 },
    { id: 9, name: 'existing', present: true, skill: 'beginner' },   // dupe (case-insensitive) vs current roster
    { id: 11, name: 'Jude', present: true, skill: 'beginner' },
  ];
  await run(`importFromSession('sessA')`);
  const names = JSON.parse(run(`JSON.stringify(players.map(p=>p.name))`));
  assert.deepEqual(names, ['Existing', 'Eve', 'Jude']);   // 'existing' skipped

  const eve = run(`players.find(p=>p.name==='Eve')`);
  assert.equal(eve.present, false);        // not checked in
  assert.equal(eve.gamesPlayed, 0);
  assert.equal(eve.wins, 0);
  assert.equal(eve.points, 0);
  assert.equal(eve.skill, 'intermediate'); // skill NOT carried over
  assert.equal(eve.via, 'import');
  assert.equal(eve.partnerId, null);
  assert.equal(run(`players.every(p=>typeof p.id==='number')`), true);
  const ids = JSON.parse(run(`JSON.stringify(players.map(p=>p.id))`));
  assert.equal(new Set(ids).size, 3); // unique ids
  assert.equal(els.importOverlay.classList.contains('hidden'), true); // modal closes after import
});

test('non-owner cannot open the import modal', async () => {
  const { run, els } = setup();
  run(`_access='cohost';`);
  await run(`openImportSessions()`);
  assert.equal(els.importOverlay, undefined); // guard returned before ever touching the modal
});
