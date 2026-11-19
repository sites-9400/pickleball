// The admin Queue shows minutes since each waiting player's last game (or since they
// checked in, whichever is later) and flags anyone waiting 30+ minutes in red, so the
// host can spot them. Display only: the matchmaking order is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const P = (id, over = {}) => ({
  id, name: id.toUpperCase(), present: true, gamesPlayed: 1, wins: 0, losses: 1,
  points: 5, pointsAgainst: 11, lastPlayedRound: 1, skill: 'intermediate',
  events: [{ t: 'in', ts: NOW - 90 * MIN }], ...over,
});
const game = (ids, endedMinAgo) => ({
  round: 1, court: 1, courtName: 'Court 1', team1: ['x', 'x'], team2: ['x', 'x'],
  team1Ids: ids.slice(0, 2), team2Ids: ids.slice(2, 4), score1: 11, score2: 5,
  startedAt: NOW - (endedMinAgo + 12) * MIN, endedAt: NOW - endedMinAgo * MIN,
});

function load(players, gameHistory, over = {}) {
  const realNow = Date.now; Date.now = () => NOW;
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'manual', format: 'doubles' },
    sessionStartTime: NOW - 120 * MIN,
    players, gameHistory, queueOrder: players.map(p => p.id),
    courtDefs: [{ id: 1, name: 'Court 1' }], ...over,
  }))});`);
  app.run(`renderQueue();`);
  const html = app.captured['queueList'];
  Date.now = realNow;
  return html;
}
// The queue row for one player, from its avatar to the end of the row.
const row = (html, name) => {
  const i = html.indexOf(`>${name}<`); assert.ok(i > 0, `${name} not in queue`);
  const start = html.lastIndexOf('<div class="queue-item', i);
  return html.slice(start, html.indexOf('</div>', html.indexOf('queue-idle', i)) + 6);
};

test('shows minutes since the last game instead of rounds', () => {
  const html = load([P('a'), P('b'), P('c'), P('d')], [game(['a', 'b', 'c', 'd'], 12)]);
  const r = row(html, 'A');
  assert.match(r, />12m</);
  assert.doesNotMatch(r, /\d+r</, 'rounds badge should be gone');
  assert.doesNotMatch(r, /wait-long/);
});

test('flags a player who has waited 30+ minutes', () => {
  const html = load([P('a'), P('b'), P('c'), P('d')], [game(['a', 'b', 'c', 'd'], 34)]);
  const r = row(html, 'A');
  assert.match(r, /queue-idle wait-long/);
  assert.match(r, /34m</);
  assert.match(r, /queue-item tappable waiting-long/);
});

test('29 minutes is not flagged, 30 is', () => {
  const h29 = load([P('a'), P('b'), P('c'), P('d')], [game(['a', 'b', 'c', 'd'], 29)]);
  assert.doesNotMatch(row(h29, 'A'), /wait-long/);
  const h30 = load([P('a'), P('b'), P('c'), P('d')], [game(['a', 'b', 'c', 'd'], 30)]);
  assert.match(row(h30, 'A'), /wait-long/);
});

test('uses the latest game when a player has several', () => {
  const html = load([P('a'), P('b'), P('c'), P('d')],
    [game(['a', 'b', 'c', 'd'], 5), game(['a', 'b', 'c', 'd'], 60)]);
  assert.match(row(html, 'A'), />5m</);
});

test('a player who has not played yet counts from check-in', () => {
  const html = load([P('n', { gamesPlayed: 0, lastPlayedRound: -1, events: [{ t: 'in', ts: NOW - 41 * MIN }] })], []);
  const r = row(html, 'N');
  assert.match(r, /41m</);
  assert.match(r, /wait-long/);
});

test('a break (checked out and back in) does not count as waiting', () => {
  const html = load([P('a', { events: [
    { t: 'in', ts: NOW - 90 * MIN }, { t: 'out', ts: NOW - 45 * MIN }, { t: 'in', ts: NOW - 6 * MIN },
  ] }), P('b'), P('c'), P('d')], [game(['a', 'b', 'c', 'd'], 50)]);
  const r = row(html, 'A');
  assert.match(r, />6m</);
  assert.doesNotMatch(r, /wait-long/);
});

test('no check-in time and no games shows a dash, never a warning', () => {
  const html = load([P('z', { events: [], gamesPlayed: 0, lastPlayedRound: -1 })], []);
  const r = row(html, 'Z');
  assert.match(r, />-</);
  assert.doesNotMatch(r, /wait-long/);
});
