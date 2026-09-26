// buildSessionCSV/buildSessionJSON are shared by app.html's export buttons and the
// dashboard's per-session export, so the two can never drift. They take a raw Firebase
// snapshot: Firebase drops empty arrays (the app writes {_empty:true}) and may hand back
// objects keyed by index instead of arrays, so both shapes have to work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSessionCSV, buildSessionJSON } from '../tournament.js';

const T0 = new Date(2026, 8, 6, 16, 8).getTime();     // 4:08 PM local
const at = n => T0 + n * 60000;

const SESSION = {
  name: 'Sunday Open Play', sessionName: 'Sunday Open Play',
  mode: { matchmaking: 'random', format: 'doubles' },
  sessionStartTime: T0, sessionEndTime: at(240),
  players: [
    { id: 'p1', name: 'Amy',  present: true,  gamesPlayed: 2, wins: 1, losses: 1,
      points: 20, pointsAgainst: 15, events: [{ t: 'in', ts: T0 }] },
    { id: 'p2', name: 'Che',  present: false, gamesPlayed: 1, wins: 0, losses: 1,
      points: 6, pointsAgainst: 11, events: [{ t: 'in', ts: at(10) }, { t: 'out', ts: at(130) }] },
    { id: 'p3', name: 'Jab',  present: true,  gamesPlayed: 0, wins: 0, losses: 0,
      points: 0, pointsAgainst: 0, events: [] },
  ],
  gameHistory: [
    { round: 2, court: 1, courtName: 'Court 1', team1: ['Amy','Jab'], team2: ['Che','Reg'],
      team1Ids: ['p1','p3'], team2Ids: ['p2','p4'], score1: 11, score2: 6,
      startedAt: at(30), endedAt: at(48) },
    { round: 1, court: 1, courtName: 'Court 1', team1: ['Amy','Che'], team2: ['Jab','Reg'],
      team1Ids: ['p1','p2'], team2Ids: ['p3','p4'], score1: 9, score2: 11 },
  ],
};
const lines = csv => csv.split('\n');
const row = (csv, prefix) => lines(csv).find(l => l.startsWith(prefix));

test('player rows carry stats plus attendance', () => {
  const csv = buildSessionCSV(SESSION);
  assert.ok(lines(csv)[0].includes('Checked in'), 'attendance columns present');
  const amy = row(csv, 'Amy,').split(',');
  assert.deepEqual(amy.slice(-3), ['4:08 PM', '-', '240'], 'still here -> counted to session end');
  const che = row(csv, 'Che,').split(',');
  assert.deepEqual(che.slice(-3), ['4:18 PM', '6:18 PM', '120'], 'left -> counted to checkout');
  const jab = row(csv, 'Jab,').split(',');
  assert.deepEqual(jab.slice(-3), ['-', '-', '-'], 'never checked in');
});

test('game rows are numbered Game N in queue modes, newest first', () => {
  const csv = buildSessionCSV(SESSION);
  const head = lines(csv).find(l => l.startsWith('Game,'));
  assert.ok(head.endsWith('Started,Ended,Length (min)'), head);
  assert.ok(row(csv, '2,Court 1,').endsWith('4:38 PM,4:56 PM,18'), 'timed game');
  assert.ok(row(csv, '1,Court 1,').endsWith('-,-,-'), 'untimed game exports as dashes');
});

test('round-based modes keep the real round number', () => {
  const csv = buildSessionCSV({ ...SESSION, mode: { matchmaking: 'roundrobin', format: 'doubles' } });
  assert.ok(lines(csv).find(l => l.startsWith('Round,')), 'header says Round');
});

test('Firebase _empty sentinels and index-keyed objects both work', () => {
  const empty = buildSessionCSV({ ...SESSION, players: { _empty: true }, gameHistory: { _empty: true } });
  assert.ok(empty.includes('Name,Present'), 'still emits headers');
  const asObjects = buildSessionCSV({
    ...SESSION,
    players: { 0: SESSION.players[0], 1: SESSION.players[1], _empty: false },
    gameHistory: { 0: SESSION.gameHistory[0] },
  });
  assert.ok(row(asObjects, 'Amy,'), 'object-keyed players are read');
  assert.ok(row(asObjects, '1,Court 1,'), 'object-keyed history is read');
});

test('a still-running session measures time on site to now', () => {
  const now = at(300);
  const csv = buildSessionCSV({ ...SESSION, sessionEndTime: null }, { now });
  assert.equal(row(csv, 'Amy,').split(',').slice(-1)[0], '300');
});

test('an event from another day keeps its date', () => {
  const csv = buildSessionCSV({ ...SESSION, players: [{ ...SESSION.players[0],
    events: [{ t: 'in', ts: new Date(2026, 8, 8, 14, 9).getTime() }] }] });
  assert.match(row(csv, 'Amy,').split(',').slice(-3)[0], /Sep 8/);
});

test('JSON carries session meta, players and history', () => {
  const j = JSON.parse(buildSessionJSON(SESSION));
  assert.equal(j.session.name, 'Sunday Open Play');
  assert.equal(j.players.length, 4, '3 on the roster + Reg, who played but is not on it');
  assert.equal(j.players[3].name, 'Reg');
  assert.equal(j.players[3].removed, true);
  assert.equal(j.gameHistory.length, 2);
  assert.equal(j.players[0].checkedIn, '4:08 PM', 'attendance is in the JSON too');
  assert.equal(j.gameHistory[0].lengthMin, 18, 'game length is in the JSON too');
});

test('quotes and commas in names are escaped', () => {
  const csv = buildSessionCSV({ ...SESSION,
    players: [{ ...SESSION.players[0], name: 'Amy "AJ", Jr' }] });
  assert.ok(csv.includes('"Amy ""AJ"", Jr"'), csv.split('\n')[1]);
});

test('both pages are wired to the shared builders, not their own copies', () => {
  // The whole point of extracting these is that the dashboard export and the in-session
  // export can never drift. Guard the wiring so a future refactor cannot quietly re-fork it.
  const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const app = read('app.html'), dash = read('dashboard.html');
  assert.match(app, /buildSessionCSV, buildSessionJSON \} from '\.\/tournament\.js'|buildSessionCSV,\s*buildSessionJSON/,
    'app.html imports the shared builders');
  assert.match(app, /window\.buildSessionCSV\(sessionSnapshot\(\)\)/, 'app CSV export calls the shared builder');
  assert.match(app, /window\.buildSessionJSON\(sessionSnapshot\(\)\)/, 'app JSON export calls the shared builder');
  assert.doesNotMatch(app, /function attendanceSpan\(/, 'app.html no longer keeps its own copy');
  assert.match(dash, /import \{ buildSessionCSV, buildSessionJSON \} from '\.\/tournament\.js'/,
    'dashboard imports the shared builders');
  assert.match(dash, /buildSessionJSON\(s\) : buildSessionCSV\(s\)/, 'dashboard calls them');
});
