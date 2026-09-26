// Organizer request: zoom in / out and reposition the recap event photo. The framing
// is stored as { z, x, y } (zoom >= 1 = fills the header; x/y = the photo point kept at
// the header centre) so it holds on the phone, the 680px saved image and the view link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRules, SESSION_KEYS } from '../scripts/gen-firebase-rules.mjs';
import { loadApp, snap } from './apphtml-harness.mjs';
import '../recap.js';

const { photoLayout, render } = globalThis.PDRecap;

test('z=1 centred = cover: fills the box, centred', () => {
  // 3000x2000 photo in a 680x340 header: cover scale = max(680/3000, 340/2000) = 0.2267
  const l = photoLayout(3000, 2000, 680, 340, { z: 1, x: 0.5, y: 0.5 });
  assert.equal(Math.round(l.w), 680); assert.equal(Math.round(l.h), 453);
  assert.equal(Math.round(l.left), 0); assert.equal(Math.round(l.top), Math.round((340 - l.h) / 2));
});

test('zoom 2x doubles the drawn size around the chosen point', () => {
  const l = photoLayout(3000, 2000, 680, 340, { z: 2, x: 0.5, y: 0.5 });
  assert.equal(Math.round(l.w), 1360);
  assert.equal(Math.round(l.left), Math.round(340 - 0.5 * 1360));
});

test('never shows empty edges: position is clamped to keep the header covered', () => {
  const l = photoLayout(3000, 2000, 680, 340, { z: 2, x: 0, y: 0 });   // top-left corner
  assert.equal(l.left, 0); assert.equal(l.top, 0);
  const r = photoLayout(3000, 2000, 680, 340, { z: 2, x: 1, y: 1 });   // bottom-right
  assert.equal(Math.round(r.left + r.w), 680); assert.equal(Math.round(r.top + r.h), 340);
});

test('bad or missing frame falls back to centred cover; zoom capped 1..4', () => {
  const d = photoLayout(3000, 2000, 680, 340, null);
  assert.equal(Math.round(d.w), 680);
  assert.equal(Math.round(photoLayout(3000, 2000, 680, 340, { z: 0.2, x: 0.5, y: 0.5 }).w), 680);
  assert.equal(Math.round(photoLayout(3000, 2000, 680, 340, { z: 9, x: 0.5, y: 0.5 }).w), 2720);
});

test('the recap header carries the framing for the drawer', () => {
  globalThis.document ??= { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) };
  const c = { innerHTML: '', querySelector: () => null };
  render(c, { sessionStartTime: 1, sessionEndTime: 2, courtDefs: [], gameHistory: [{}],
    players: [{ id: 1, name: 'A', gamesPlayed: 1, wins: 1, losses: 0, points: 1, pointsAgainst: 0 }],
    recapPhoto: 'data:image/jpeg;base64,AAAA', recapPhotoFrame: { z: 1.5, x: 0.3, y: 0.7 } }, {});
  assert.match(c.innerHTML, /data-frame="1\.5,0\.3,0\.7"/);
});

test('rules: recapPhotoFrame is { z 1..4, x 0..1, y 0..1 }', () => {
  assert.ok(SESSION_KEYS.includes('recapPhotoFrame'));
  const r = buildRules().rules.sessions.$sid.recapPhotoFrame;
  assert.match(r.z['.validate'], /newData\.val\(\) >= 1 && newData\.val\(\) <= 4/);
  assert.match(r.x['.validate'], /newData\.val\(\) >= 0 && newData\.val\(\) <= 1/);
  assert.equal(r.$other['.validate'], false);
});

function app() {
  const a = loadApp();
  const writes = [];
  a.windowMock._fbWrite = d => writes.push(JSON.parse(JSON.stringify(d)));
  a.windowMock._setRecapPhoto = () => Promise.resolve();
  a.run(`window._uid = 'owner1';`);
  a.run(`window._fbApplyRemote(${JSON.stringify(snap({ recapPhoto: 'data:image/jpeg;base64,AAAA' }))});`);
  return { a, writes };
}

test('owner saves a framing; it is rounded and clamped', () => {
  const { a, writes } = app();
  a.run(`saveRecapPhotoFrame({ z: 2.123456, x: 1.4, y: -0.2 })`);
  assert.deepEqual(writes.at(-1).recapPhotoFrame, { z: 2.12, x: 1, y: 0 });
});

test('a new photo resets the framing; viewers cannot frame', () => {
  const { a, writes } = app();
  a.run(`saveRecapPhotoFrame({ z: 2, x: 0.5, y: 0.5 })`);
  a.run(`recapPhotoChanged()`);
  assert.equal(a.run('recapPhotoFrame'), null);
  assert.equal(writes.at(-1).recapPhotoFrame, null, 'cleared in Firebase too');
  a.run(`_access = 'viewer'; saveRecapPhotoFrame({ z: 3, x: 0.5, y: 0.5 })`);
  assert.equal(a.run('recapPhotoFrame'), null);
});
