// Live view: Team A and Team B get light tints (green / blue) so players can tell the two
// sides apart at a glance, on the courts and in the Next Up / On Deck cards.
// Sep 29 PD update. Display only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadView } from './viewhtml-harness.mjs';

const players = ['Ana', 'Ben', 'Cai', 'Dee', 'Eve', 'Finn', 'Gus', 'Hal'].map((name, i) => ({ id: i + 1, name, skill: 'intermediate', present: true, lastPlayedRound: -1 }));
const session = {
  mode: { matchmaking: 'random', format: 'doubles' },
  players,
  courtDefs: [{ id: 1, name: 'Court 1' }, { id: 2, name: 'Court 2' }],
  courts: [{ id: 1, name: 'Court 1', team1: [1, 2], team2: [3, 4], submitted: false, round: 1, startedAt: Date.now() }],
  matchQueue: [{ team1: [5, 6], team2: [7, 8] }],
  queueOrder: [5, 6, 7, 8],
  gameHistory: [],
  upNextAlways: true,   // 2 courts: Up Next shows only when the organizer switches it on
};

test('court cards mark Team A and Team B with their own classes', () => {
  const v = loadView();
  v.call('renderCourts', session);
  const html = v.captured['vCourts'];
  assert.match(html, /class="team-view team-a"[\s\S]*?Team A[\s\S]*?Ana[\s\S]*?Ben/);
  assert.match(html, /class="team-view team-b"[\s\S]*?Team B[\s\S]*?Cai[\s\S]*?Dee/);
});

test('Next Up / On Deck cards tint the two teams the same way', () => {
  const v = loadView();
  v.call('renderQueue', session);
  const html = v.captured['vQueue'];
  assert.match(html, /class="mq-team-v team-a"[\s\S]*?Eve[\s\S]*?Finn/);
  assert.match(html, /class="mq-team-v team-b"[\s\S]*?Gus[\s\S]*?Hal/);
});

test('both tints are defined for light and dark mode', () => {
  const css = readFileSync(new URL('../view.html', import.meta.url), 'utf8');
  for (const theme of ['light', 'dark']) {
    const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\{([^}]*)\\}`))[1];
    assert.match(block, /--teamA:/, `${theme}: --teamA`);
    assert.match(block, /--teamB:/, `${theme}: --teamB`);
  }
});
