// Hybrid matchmaking: the Men/Women choice made on the check-in page and the tag on an
// imported roster reach the player record. Junk values are ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkinToPlayer, mergeImportedNames } from '../tournament.js';
import { loadApp, snap } from './apphtml-harness.mjs';

test('checkinToPlayer passes a valid gender for listed and new players', () => {
  const ex = [{ name: 'Ana' }];
  assert.deepEqual(checkinToPlayer({ name: 'ana', skill: 'advanced', gender: 'f' }, ex), { markPresentName: 'Ana', skill: 'advanced', gender: 'f' });
  assert.deepEqual(checkinToPlayer({ name: 'ana', gender: 'm' }, ex), { markPresentName: 'Ana', gender: 'm' });
  assert.deepEqual(checkinToPlayer({ name: 'ana', gender: 'x' }, ex), { markPresentName: 'Ana' });
  assert.equal(checkinToPlayer({ name: 'Bo', gender: 'm' }, ex).player.gender, 'm');
  assert.equal('gender' in checkinToPlayer({ name: 'Bo' }, ex).player, false);
});

test('mergeImportedNames keeps a valid gender tag', () => {
  const res = mergeImportedNames([{ name: 'Eve', gender: 'f' }, { name: 'Jo', gender: 'zz' }, { name: 'Al' }], [], 0);
  assert.equal(res.players[0].gender, 'f');
  assert.equal('gender' in res.players[1], false);
  assert.equal('gender' in res.players[2], false);
});

test('a QR check-in with a gender tags the existing player', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'waittime', format: 'doubles' }, hybrid: true,
    players: [{ id: 1, name: 'Ana', present: false, gamesPlayed: 0, wins: 0, losses: 0, points: 0, pointsAgainst: 0, lastPlayedRound: -1, skill: 'intermediate', events: [] }],
    playerIdCounter: 1,
  }))});`);
  app.run(`window._importCheckin('k1', { name: 'Ana', skill: 'intermediate', gender: 'f', ts: 1 })`);
  assert.equal(app.run(`getPlayer(1).gender`), 'f');
  assert.equal(app.run(`getPlayer(1).present`), true);
});
