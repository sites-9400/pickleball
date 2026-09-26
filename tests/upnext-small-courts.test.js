// Organizer request: let Up Next show at 1-2 courts too, with a note that it can change.
// Numbering/Balanced always build (and later seat) the reserved next match at any court
// count; below 3 courts it was only hidden. So this is a display switch: the
// matchmaking itself is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id, name) => ({
  id, name, present: true, gamesPlayed: 0, wins: 0, losses: 0, points: 0, pointsAgainst: 0,
  lastPlayedRound: -1, skill: 'intermediate', events: [],
});

function app(over = {}, courts = 2) {
  const a = loadApp();
  const writes = [];
  a.windowMock._fbWrite = d => writes.push(JSON.parse(JSON.stringify(d)));
  a.run(`window._uid = 'owner1';`);
  a.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'random', format: 'doubles' },
    players: Array.from({ length: 12 }, (_, i) => P(i + 1, 'P' + (i + 1))),
    queueOrder: Array.from({ length: 12 }, (_, i) => i + 1),
    courtDefs: Array.from({ length: courts }, (_, i) => ({ id: i + 1, name: 'Court ' + (i + 1) })),
    ...over,
  }))});`);
  a.run('rebuildMatchQueue(); renderQueue();');
  return { a, writes, html: () => a.captured['queueList'] };
}

test('2 courts: Up Next hidden by default, with a switch to show it', () => {
  const { html } = app();
  assert.doesNotMatch(html(), /class="mm-upnext"/);
  assert.match(html(), /onclick="toggleUpNext\(\)"[^>]*>[^<]*Show Up Next/);
});

test('switching it on shows the reserved match plus the note, and saves the choice', () => {
  const { a, writes, html } = app();
  a.run('toggleUpNext()');
  assert.match(html(), /class="mm-upnext"/);
  assert.match(html(), /Up Next 1/);
  assert.match(html(), /class="upnext-note"[^>]*>[^<]*can still change/);
  assert.equal(writes.at(-1).upNextAlways, true);
  a.run('toggleUpNext()');
  assert.doesNotMatch(html(), /class="mm-upnext"/);
  assert.equal(writes.at(-1).upNextAlways, false, 'switching off is saved too');
});

test('the choice loads from the session for everyone', () => {
  const { html } = app({ upNextAlways: true });
  assert.match(html(), /class="mm-upnext"/);
});

test('sessions that never use the switch do not write the key', () => {
  const { a, writes } = app();
  a.run('saveState()');
  assert.equal('upNextAlways' in writes.at(-1), false);
});

test('3+ courts: Up Next as before, no switch and no note', () => {
  const { html } = app({}, 3);
  assert.match(html(), /class="mm-upnext"/);
  assert.doesNotMatch(html(), /toggleUpNext|upnext-note/);
});

test('viewers see no switch', () => {
  const { a, html } = app();
  a.run(`_access = 'viewer'; renderQueue();`);
  assert.doesNotMatch(html(), /toggleUpNext/);
});

test('view link honours the switch and shows the note', () => {
  const v = readFileSync(new URL('../view.html', import.meta.url), 'utf8');
  assert.match(v, /s\.upNextAlways/);
  assert.match(v, /upnext-note/);
});

test('upNextAlways is an allowed Firebase session key', async () => {
  const { SESSION_KEYS } = await import('../scripts/gen-firebase-rules.mjs');
  assert.ok(SESSION_KEYS.includes('upNextAlways'));
});

// Pre-existing bug found while building the switch: with Up Next hidden, the players
// reserved for the next match were left out of the organizer's Queue ("No one waiting"
// while four people wait). view.html already folds them in; app.html now does too.
test('Up Next hidden: reserved players still listed in the Queue, first', () => {
  const { a, html } = app();
  a.run('generateMatchForCourt(1); generateMatchForCourt(2); renderQueue();');
  const reserved = a.run('JSON.stringify([...matchQueue[0].team1, ...matchQueue[0].team2])');
  const ids = JSON.parse(reserved);
  assert.equal(ids.length, 4);
  const listed = [...html().matchAll(/openProfile\((\d+)\)/g)].map(m => +m[1]);
  assert.deepEqual(listed.slice(0, 4), ids, 'reserved four lead the queue');
  assert.doesNotMatch(html(), /No one waiting/);
});

test('Up Next shown: reserved players live in the card, not repeated in the Queue', () => {
  const { a, html } = app();
  a.run('generateMatchForCourt(1); generateMatchForCourt(2); toggleUpNext();');
  const ids = JSON.parse(a.run('JSON.stringify([...matchQueue[0].team1, ...matchQueue[0].team2])'));
  const queueCol = html().split('class="mm-upnext"')[0];
  for (const id of ids) assert.doesNotMatch(queueCol, new RegExp(`openProfile\\(${id}\\)`));
});
