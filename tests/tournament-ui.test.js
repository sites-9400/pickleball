import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

function loadRR() {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({ mode: { format: 'doubles', matchmaking: 'roundrobin' } }))});`);
  return app;
}

// Regression: team ids were generated as 'tm' + (teams.length + 1) — after
// remove-then-add, the new id collided with an existing team's, and
// tRemoveTeam's filter then deleted BOTH teams.
test('team ids stay unique after remove-then-add', () => {
  const app = loadRR();
  app.run(`tNewTeam(); tNewTeam(); tNewTeam();`);
  app.run(`tRemoveTeam(tournament.teams[0].id);`); // drop team 1 of 3
  app.run(`tNewTeam();`);                          // length+1 would collide with team 3
  const ids = app.run(`tournament.teams.map(t => t.id).join(',')`).split(',');
  assert.equal(new Set(ids).size, ids.length, `team ids must be unique, got: ${ids}`);
});

test('removing a team removes exactly one team', () => {
  const app = loadRR();
  app.run(`tNewTeam(); tNewTeam(); tNewTeam();`);
  app.run(`tRemoveTeam(tournament.teams[0].id); tNewTeam();`);
  assert.equal(app.run(`tournament.teams.length`), 3);
  app.run(`tRemoveTeam(tournament.teams[2].id);`); // remove the newest
  assert.equal(app.run(`tournament.teams.length`), 2, 'one removal must drop exactly one team');
});

// tAssignPlayer auto-creates a team when all are full — same generator, same risk.
test('tAssignPlayer auto-created team gets a unique id', () => {
  const app = loadRR();
  app.run(`
    players = [1,2,3].map(i => ({ id: i, name: 'P' + i, present: true, gamesPlayed: 0, wins: 0, losses: 0, points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate', via: 'manual' }));
    tNewTeam(); tNewTeam();                     // tm1, tm2
    tAssignPlayer(1); tAssignPlayer(2);         // fill tm1 (doubles: 2 slots)
    tRemoveTeam(tournament.teams[0].id);        // drop tm1 -> only tm2 left
    tAssignPlayer(3); tAssignPlayer(1); tAssignPlayer(2); // fill tm2, then auto-create
  `);
  const ids = app.run(`tournament.teams.map(t => t.id).join(',')`).split(',');
  assert.equal(new Set(ids).size, ids.length, `team ids must be unique, got: ${ids}`);
});
