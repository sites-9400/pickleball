// Organizer request: on the Open Play Recap the time comes first, then the date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../recap.js';

const { render, buildRecapData } = globalThis.PDRecap;

test('recap meta line reads time · date · courts', () => {
  const start = new Date(2026, 8, 26, 19, 0).getTime(), end = start + 2 * 3600000;
  const state = {
    sessionStartTime: start, sessionEndTime: end, courtDefs: [{ id: 1 }, { id: 2 }],
    players: [{ id: 'a', name: 'Ana', gamesPlayed: 1, wins: 1, losses: 0, points: 11, pointsAgainst: 5 }],
    gameHistory: [{}],
  };
  const r = buildRecapData(state, {});
  globalThis.document ??= { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) };
  const container = { innerHTML: '', querySelector: () => null };
  render(container, state, {});
  const meta = container.innerHTML.match(/<div class="pdr-meta">(.*?)<\/div>/)[1].replace(/<[^>]+>/g, '');
  assert.equal(meta, [r.timeLabel, r.dateLabel, r.courtLabel].join('  ·  '));
});
