// Organizer request (2026-10-12): separate Men's / Women's leaderboards on hybrid
// nights (Men's / Women's / Mixed courts). Recap shows a podium + top 5 per gender;
// the admin Rankings tab and the player view get All / Men / Women pills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';
import '../recap.js';

const { buildRecapData, render } = globalThis.PDRecap;

const P = (id, name, gender, wins, gp = 6) =>
  ({ id, name, gender, gamesPlayed: gp, wins, losses: gp - wins, points: 60 + wins * 5, pointsAgainst: 60 });
const roster = [
  P(1, 'Carl', 'm', 6), P(2, 'Dan', 'm', 5), P(3, 'Eli', 'm', 4), P(4, 'Finn', 'm', 3),
  P(5, 'Gus', 'm', 2), P(6, 'Hal', 'm', 1),
  P(7, 'Ana', 'f', 5), P(8, 'Bea', 'f', 4), P(9, 'Cat', 'f', 3),
  P(10, 'Untagged', undefined, 6),
];
const hyb = extra => ({ hybrid: true, mode: { matchmaking: 'waittime' }, players: roster, gameHistory: [{}], ...extra });

test('recap data: hybrid night splits into men / women boards, top 5 each', () => {
  const r = buildRecapData(hyb());
  assert.ok(r.genderSplit, 'split present');
  assert.deepEqual(r.genderSplit.men.map(p => p.name), ['Carl', 'Dan', 'Eli', 'Finn', 'Gus']);
  assert.deepEqual(r.genderSplit.women.map(p => p.name), ['Ana', 'Bea', 'Cat']);
  assert.equal(r.genderSplit.menTotal, 6);
  assert.equal(r.genderSplit.womenTotal, 3);
  // Combined board is still there (unchanged) for non-split use.
  assert.equal(r.podium[0].name, 'Carl');
});

test('recap data: no split when hybrid is off, or in a mode without hybrid', () => {
  assert.equal(buildRecapData(hyb({ hybrid: false })).genderSplit, null);
  assert.equal(buildRecapData(hyb({ mode: { matchmaking: 'roundrobin' } })).genderSplit, null);
  assert.equal(buildRecapData({ players: roster }).genderSplit, null);
});

test('recap data: hybrid but nobody tagged -> no split (falls back to one board)', () => {
  const untagged = roster.map(p => ({ ...p, gender: undefined }));
  assert.equal(buildRecapData(hyb({ players: untagged })).genderSplit, null);
});

function html(state) {
  globalThis.document ??= { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) };
  const c = { innerHTML: '', querySelector: () => null };
  render(c, state, { noWarmUp: true });
  return c.innerHTML;
}

test('recap render: hybrid shows Men\'s and Women\'s podiums + top 5s', () => {
  const h = html(hyb());
  assert.match(h, /Men's Podium/);
  assert.match(h, /Women's Podium/);
  assert.match(h, /Men's Top 5/);
  assert.match(h, /Women's Top 3/);
  assert.ok(h.indexOf("Men's Podium") < h.indexOf("Women's Podium"));
  assert.doesNotMatch(h, />Untagged</, 'untagged players stay off the split recap');
  assert.doesNotMatch(h, />Hal</, '6th man is past the top 5');
});

test('recap render: non-hybrid recap is unchanged (one podium + top list)', () => {
  const h = html(hyb({ hybrid: false }));
  assert.match(h, /<h3>Podium<\/h3>/);
  assert.doesNotMatch(h, /Men's Podium/);
});

test('recap render: hybrid with only men tagged shows just the men\'s board', () => {
  const h = html(hyb({ players: roster.filter(p => p.gender !== 'f') }));
  assert.match(h, /Men's Podium/);
  assert.doesNotMatch(h, /Women's Podium/);
});

// ---- admin Rankings tab -----------------------------------------------------
function app(extra) {
  const a = loadApp();
  a.run(`window._uid = 'owner1';`);
  a.run(`window._fbApplyRemote(${JSON.stringify(snap({ hybrid: true, mode: { format: 'doubles', matchmaking: 'waittime' }, players: roster, ...extra }))});`);
  return a;
}

test('admin: rankGenderFilter keeps only that gender and renumbers from 1', () => {
  const a = app();
  const names = g => JSON.parse(a.run(`JSON.stringify(rankRows('${g}').map(p=>p.name))`));
  assert.deepEqual(names('f').sort(), ['Ana', 'Bea', 'Cat']);
  assert.deepEqual(names('m').length, 6);
  assert.equal(names('all').length, 10);
});

test('admin: gender filter is ignored when hybrid is off', () => {
  const a = app({ hybrid: false });
  assert.equal(a.run(`rankRows('f').length`), 10);
});
