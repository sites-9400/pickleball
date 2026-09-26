// Organizer request: no "PADDLE DISTRICT" over the photo, QR at the bottom of the
// header (off the faces), and "padq.app / powered by Paddle District" lower right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../recap.js';

const { render } = globalThis.PDRecap;
function html() {
  globalThis.document ??= { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) };
  const c = { innerHTML: '', querySelector: () => null };
  render(c, { sessionStartTime: 1700000000000, sessionEndTime: 1700007200000, courtDefs: [{ id: 1 }],
    players: [{ id: 1, name: 'Ana', gamesPlayed: 1, wins: 1, losses: 0, points: 11, pointsAgainst: 3 }],
    gameHistory: [{}], recapPhoto: 'data:image/jpeg;base64,AAAA' }, { viewUrl: 'https://padq.app/view.html?session=x' });
  return c.innerHTML;
}

test('header has no PADDLE DISTRICT eyebrow', () => {
  assert.doesNotMatch(html(), /pdr-eyebrow/);
});

test('QR comes after the header text (bottom of the photo)', () => {
  const h = html();
  assert.ok(h.indexOf('class="pdr-qr"') > h.indexOf('class="pdr-statrow"'));
});

test('footer brands padq.app, powered by Paddle District', () => {
  assert.match(html(), /<div class="r"><b>padq\.app<\/b><span>powered by Paddle District<\/span><\/div>/);
});
